import { getBook, loadSettings } from "../core/store";
import { pushGitHubBook, RemoteConflict } from "../infrastructure/github-sync";
import {
  deferAttempt, enqueueIfUnsaved, getOutbox, listOutbox, markAttempt, recordSyncFailure,
  type EnqueueResult,
} from "../infrastructure/outbox";
import { LocalBookChanged } from "../infrastructure/sync-errors";
import { host } from "../core/host";
import { LocksUnavailable } from "../core/errors";

/** Between two automatic saves of the same book. Every save costs a few write requests and
 * GitHub limits those per hour (together with the writer-lock heartbeat): saving after EVERY
 * task of a fast run would trip it. Whatever is skipped is not lost: the next task, the periodic
 * pass, the end of the run or «Salva ora» pick it up. */
export const AUTO_SAVE_MIN_INTERVAL_MS = 120_000;
/** Retry delay when the book changed while a save was being prepared. */
const LOCAL_CHANGE_RETRY_MS = 5_000;

export interface DrainOptions {
  /** The author (or the end of a run) asks to save now: skip the spacing and any back-off delay. */
  force?: boolean;
}

function nonRetryable(error: unknown): boolean {
  if (error instanceof RemoteConflict) return true;
  const msg = error instanceof Error ? error.message : "";
  return /\b(?:HTTP 40[134]|PAT|PUBBLICA|modello|autorizzazion|non valido|mancante|supera il limite|non abilitata|non configurat|schema|manifest)\b/i.test(msg);
}
function sanitize(error: unknown): string {
  const text = error instanceof Error ? error.message : "Errore sconosciuto di sincronizzazione.";
  return text.replace(/github_pat_[a-z0-9_\-]+/gi, "[PAT redatto]")
    .replace(/sk-[a-z0-9_\-]+/gi, "[chiave redatta]").slice(0, 480);
}
/** True when the last successful save of this book is too recent for another automatic one. */
function savedTooRecently(lastSyncAt: string | undefined, now: number): boolean {
  const last = Date.parse(lastSyncAt ?? "");
  const elapsed = now - last;
  // A date in the future (clock skew) must never hold saving back.
  return Number.isFinite(last) && elapsed >= 0 && elapsed < AUTO_SAVE_MIN_INTERVAL_MS;
}

/**
 * The sync worker. The host's exclusive lock serializes uploads on this device; across devices we
 * only have optimistic Git SHA conflict detection (the writer lease protects a running book).
 */
async function processOutbox(force: boolean): Promise<void> {
  const h = host();
  if (h.online && !h.online()) return;
  const process = async () => {
    const entries = (await listOutbox()).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    for (const item of entries) {
      if (item.state === "blocked" || !force && item.retryAfter && Date.parse(item.retryAfter) > Date.now())
        continue;
      const book = await getBook(item.bookId);
      if (!book?.remote?.autoSync || !book.remote.lastSyncedCommit) continue;
      if (h.admission?.owns && !h.admission.owns(book)) continue;
      // The credential is chosen per book where the host keeps one PAT per book.
      if (!(await h.withBookScope(book.id, loadSettings)).githubToken) continue;
      if (!force && savedTooRecently(book.remote.lastSyncAt, Date.now())) continue;
      if (!await markAttempt(item, force)) continue;
      try {
        // pushGitHubBook persists the remote ACK AND the outbox decision in one host transaction.
        await h.withBookScope(book.id, () => pushGitHubBook(book.id, false, {
          automatic: true,
          operationId: item.operationId,
        }));
      } catch (error) {
        if (error instanceof LocalBookChanged) await deferAttempt(item.bookId, item.operationId, LOCAL_CHANGE_RETRY_MS);
        else await recordSyncFailure(item.bookId, item.operationId, sanitize(error), nonRetryable(error));
      }
    }
  };
  // Without exclusive locks nothing can prove another uploader is absent: stay idle, never upload blind.
  try { await h.tryLock("bookwriter:github-outbox", process); }
  catch (error) { if (!(error instanceof LocksUnavailable)) throw error; }
}

let running: Promise<void> | undefined;
let forcedNext: Promise<void> | undefined;
function pass(force: boolean): Promise<void> {
  const current: Promise<void> = processOutbox(force).finally(() => { if (running === current) running = undefined; });
  running = current;
  return current;
}

/** Sends what is waiting in the queue. A forced call made while a pass is running is not lost:
 * it runs once more right after it. */
export function drainGitHubOutbox(options: DrainOptions = {}): Promise<void> {
  if (!running) return pass(options.force === true);
  if (!options.force) return running;
  forcedNext ??= running.catch(() => undefined).then(() => { forcedNext = undefined; return pass(true); });
  return forcedNext;
}

/** «Save now»: queue whatever GitHub does not have yet and send it at once, also while the autopilot
 * works (the push does not need the writer lock; a change during the push is simply sent next).
 * Returns why nothing was sent when there was nothing to do. */
export async function saveToGitHubNow(bookId: string): Promise<Exclude<EnqueueResult, "queued"> | "attempted"> {
  const queued = await enqueueIfUnsaved(bookId);
  if (queued !== "queued") return queued;
  await drainGitHubOutbox({ force: true });
  return "attempted";
}

export async function getSyncStatus(bookId: string) {
  return getOutbox(bookId);
}
