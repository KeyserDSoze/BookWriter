import { host } from "../core/host";
import { BookNotFound, withExclusiveLock } from "../core/store";
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

/** Holds the named locks, outermost first, for the duration of `action`. */
async function holdingAll<T>(names: string[], busy: string, action: () => Promise<T>): Promise<T> {
  const [first, ...rest] = names;
  if (first === undefined) return action();
  return withExclusiveLock(first, { busy }, () => holdingAll(rest, busy, action));
}

const NO_LOCKS = "Web Locks non disponibile: autopilot bloccato per evitare scritture concorrenti, anche nei libri locali. Usa un browser aggiornato in un contesto HTTPS sicuro.";
const BUSY = "Questo libro è già in scrittura in un'altra scheda o sessione.";

/**
 * One AI writer per book. The host's exclusive lock protects against another page or process on
 * this device; a fast-forward-only remote branch protects a book linked to GitHub. If the lock
 * cannot be taken, or GitHub cannot be reached, we fail closed, before spending AI credits.
 */
export async function withWriterGuard<T>(
  bookId: string, sessionId: string, controller: AbortController,
  action: (guard: WriterGuard) => Promise<T>,
): Promise<T> {
  const h = host();
  const signal = controller.signal;
  // Refuse a replica before trying to lock. Remote admission is different: it must
  // run inside the lock and the book scope, where the server can load the delegated PAT.
  if (!await h.getBookForMutation(bookId)) throw new BookNotFound();
  return h.withBookScope(bookId, () => withExclusiveLock("bookwriter:writer:" + bookId, { busy: BUSY, unsupported: NO_LOCKS }, async () => {
    cancelled(signal);
    // Read again under the lock: the book may have changed while we waited for it.
    const book = await h.getBookForMutation(bookId);
    if (!book) throw new BookNotFound();
    const extra = h.admission?.locks?.(book) ?? [];
    return holdingAll(extra, "Un'altra operazione sta usando il blocco: riprova più tardi.", async () => {
      await h.admission?.assert?.(book, signal);
      cancelled(signal);
      const remote = book.remote;
      const epoch = book.executionAuthority?.epoch;
      let lease: WriterLeaseHandle | undefined;
      let problem: Error | undefined;
      let renewing: Promise<void> | undefined;

      // Remembered BEFORE acquiring, so a holder lost right after the lease was written is
      // still recognised as ours at the next start (best effort: without it we only wait).
      if (remote) {
        await rememberWriterSession(bookId, sessionId).catch(() => undefined);
        // We hold this device's writer lock: a lease left by an earlier page of this device is
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
          const latest = await h.getBookForMutation(bookId);
          if (!latest) throw new BookNotFound();
          if (latest.executionAuthority?.epoch !== epoch) throw new Error("Autorità del libro cambiata.");
          await h.admission?.assert?.(latest, signal);
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
  }));
}
