import { getBook } from "../infrastructure/db";
import {
  acquireWriterLease, assertWriterLease, LEASE_RENEW_MS,
  releaseWriterLease, renewWriterLease, RemoteWriterLost,
  type WriterLeaseHandle,
} from "../infrastructure/github-lease";

export interface WriterGuard {
  /** Revalidate ownership against GitHub; required before and after AI calls. */
  assertActive: () => Promise<void>;
  failure: () => Error | undefined;
}

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Sessione interrotta.", "AbortError");
}

/**
 * One AI writer per book. Web Locks protects tabs of this browser; a
 * fast-forward-only remote branch protects a book linked to GitHub.
 * If GitHub cannot be reached we fail closed, before spending AI credits.
 */
export async function withWriterGuard<T>(
  bookId: string, sessionId: string, controller: AbortController,
  action: (guard: WriterGuard) => Promise<T>,
): Promise<T> {
  const book = await getBook(bookId);
  if (!book) throw new Error("Libro non trovato.");
  const remote = book.remote;
  const signal = controller.signal;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) {
    if (remote)
      throw new Error("Questo browser non supporta Web Locks: scrittura cloud disabilitata per sicurezza.");
    cancelled(signal);
    return action({
      assertActive: async () => cancelled(signal),
      failure: () => undefined,
    });
  }

  return locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Questo libro è già in scrittura in un'altra scheda del browser.");
    cancelled(signal);
    let lease: WriterLeaseHandle | undefined;
    let problem: Error | undefined;
    let renewing: Promise<void> | undefined;

    if (remote) lease = await acquireWriterLease(remote, bookId, sessionId);
    const heartbeat = async () => {
      if (!lease || signal.aborted || problem || renewing) return;
      renewing = (async () => {
        try { lease = await renewWriterLease(lease!); }
        catch (error) {
          problem = error instanceof Error ? error : new RemoteWriterLost();
          controller.abort(); // Abort the in-flight AI request if possible.
        }
      })().finally(() => { renewing = undefined; });
      await renewing;
    };
    const timer = lease ? setInterval(() => { void heartbeat(); }, LEASE_RENEW_MS) : undefined;
    const guard: WriterGuard = {
      failure: () => problem,
      assertActive: async () => {
        if (problem) throw problem;
        cancelled(signal);
        if (renewing) await renewing;
        if (problem) throw problem;
        if (lease) {
          try { lease = await assertWriterLease(lease); }
          catch (error) {
            problem = error instanceof Error ? error : new RemoteWriterLost();
            controller.abort();
            throw problem;
          }
        }
        if (problem) throw problem;
        cancelled(signal);
      },
    };
    try {
      await guard.assertActive();
      return await action(guard);
    } finally {
      if (timer) clearInterval(timer);
      if (renewing) await renewing;
      if (lease) await releaseWriterLease(lease);
    }
  });
}
