import { getBook, loadSettings } from "../infrastructure/db";
import { pushGitHubBook, RemoteConflict } from "../infrastructure/github-sync";
import {
  getOutbox, listOutbox, markAttempt, recordSyncFailure,
} from "../infrastructure/outbox";

let processing: Promise<void> | undefined;

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

/**
 * Browser-only sync worker. The Web Locks API serializes writes across tabs
 * in this origin. Across devices we only have optimistic Git SHA conflict
 * detection (remote leases require a separate ADR and implementation).
 */
async function processOutbox(): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine === false) return;
  if (!navigator.locks?.request) return; // fail closed: unsafe on older browsers
  await navigator.locks.request("bookwriter:github-outbox", { ifAvailable: true }, async lock => {
    if (!lock) return;
    const settings = await loadSettings();
    if (!settings.githubToken) return;
    const entries = (await listOutbox()).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    for (const item of entries) {
      if (item.state === "blocked" || item.retryAfter && Date.parse(item.retryAfter) > Date.now())
        continue;
      const book = await getBook(item.bookId);
      if (!book?.remote?.autoSync || !book.remote.lastSyncedCommit) continue;
      if (!await markAttempt(item)) continue;
      try {
        // pushGitHubBook now persists the remote ACK AND outbox decision
        // in one IndexedDB transaction. No separate, crash-vulnerable ACK.
        await pushGitHubBook(book.id, false, {
          automatic: true,
          operationId: item.operationId,
        });
      } catch (error) {
        await recordSyncFailure(item.bookId, item.operationId, sanitize(error), nonRetryable(error));
      }
    }
  });
}

export function drainGitHubOutbox(): Promise<void> {
  processing ??= processOutbox().finally(() => { processing = undefined; });
  return processing;
}

export async function getSyncStatus(bookId: string) {
  return getOutbox(bookId);
}
