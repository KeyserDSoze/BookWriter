import { getBook } from "../infrastructure/db";
import {
  acquireWriterLease, assertWriterLease, LEASE_RENEW_MS, LeaseRenewalMissed,
  releaseWriterLease, renewWriterLease, RemoteWriterLost,
  type WriterLeaseHandle,
} from "../infrastructure/github-lease";
import { rememberWriterSession } from "../infrastructure/writer-sessions";

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
    // Local books share the same IndexedDB across tabs: allowing AI without
    // Web Locks can duplicate billed requests and overwrite canon checkpoints.
    // Never fall back to a non-atomic localStorage flag or an in-memory mutex.
    throw new Error("Web Locks non disponibile: autopilot bloccato per evitare scritture concorrenti, anche nei libri locali. Usa un browser aggiornato in un contesto HTTPS sicuro.");
  }

  return locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Questo libro è già in scrittura in un'altra scheda del browser.");
    cancelled(signal);
    let lease: WriterLeaseHandle | undefined;
    let problem: Error | undefined;
    let renewing: Promise<void> | undefined;

    // Remembered BEFORE acquiring, so a page lost right after the lease was written is
    // still recognised as ours at the next start (best effort: without it we only wait).
    if (remote) {
      await rememberWriterSession(bookId, sessionId).catch(() => undefined);
      // We hold this browser's writer lock: a lease left by an earlier page of this browser is
      // taken over at once instead of blocking the book until it expires.
      lease = await acquireWriterLease(remote, bookId, sessionId, false, { writerLockHeld: true });
    }
    const heartbeat = async () => {
      if (!lease || signal.aborted || problem || renewing) return;
      renewing = (async () => {
        try { lease = await renewWriterLease(lease!); }
        catch (error) {
          // Accepted by GitHub but not visible yet while the lease is still ours and valid: keep
          // working with the old expiry and try again at the next beat. It never counts as renewed.
          if (error instanceof LeaseRenewalMissed) { lease = error.current; return; }
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
