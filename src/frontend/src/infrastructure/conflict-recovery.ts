import type { Activity, BookProject, GitHubRemote } from "../domain/types";
import {
  assembleBookResolution, compareBookVersions,
  type ConflictUnit, type ResolutionChoice,
} from "../domain/conflicts";
import { getBook, getDb, listActivities } from "./db";
import {
  confirmGitHubHead, readGitHubSnapshot, readGitHubSnapshotAt,
  RemoteConflict, type RemoteBookSnapshot,
} from "./github-sync";

export interface ConflictReview {
  bookId: string;
  localUpdatedAt: string;
  localSyncedCommit?: string;
  headSha: string;
  baselineSha?: string;
  baseAvailable: boolean;
  baselineWarning?: string;
  local: BookProject;
  remote: BookProject;
  remoteActivities: Activity[];
  units: ConflictUnit[];
}

/** Read-only inspection. Never mutates the book, remote repo or sync outbox. */
export async function inspectBookConflict(bookId: string): Promise<ConflictReview> {
  const local = await getBook(bookId);
  if (!local?.remote) throw new Error("Seleziona un libro collegato a GitHub.");
  if (local.status === "running") throw new Error("Metti l'autopilot in pausa prima di confrontare le versioni.");
  const head = await readGitHubSnapshot(local.remote);
  if (!head) throw new Error("Nessuno snapshot BookWriter nella repository selezionata.");
  if (head.book.id !== local.id)
    throw new RemoteConflict("La repository contiene un libro con ID differente. Nessuna copia locale modificata.");

  let baseline: RemoteBookSnapshot | null = null;
  let baselineWarning: string | undefined;
  const baselineSha = local.remote.lastSyncedCommit;
  if (baselineSha) {
    if (baselineSha === head.head) baseline = head;
    else {
      try {
        baseline = await readGitHubSnapshotAt(local.remote, baselineSha);
        if (baseline && baseline.book.id !== local.id) {
          baselineWarning = "La baseline GitHub è di un altro libro. Confronto a due versioni.";
          baseline = null;
        } else if (!baseline) {
          baselineWarning = "Snapshot della baseline non disponibile; le differenze saranno confrontate senza antenato comune.";
        }
      } catch {
        // Treat an unreachable/unreadable base as unavailable, never as a
        // verified ancestor: no automatic merge follows from this fallback.
        baselineWarning = "Non è stato possibile leggere la baseline. Confronto a due versioni, senza merge automatico.";
      }
    }
  }
  return {
    bookId, localUpdatedAt: local.updatedAt,
    localSyncedCommit: local.remote.lastSyncedCommit,
    headSha: head.head, baselineSha,
    baseAvailable: !!baseline, baselineWarning,
    local, remote: head.book, remoteActivities: head.activities,
    units: compareBookVersions(local, head.book, baseline?.book),
  };
}

function repositoryMatches(a?: GitHubRemote, b?: GitHubRemote): boolean {
  return !!a && !!b && a.owner === b.owner &&
    a.repository === b.repository && a.branch === b.branch;
}
function createSafetyCopy(
  source: BookProject, kind: "locale" | "GitHub", headSha?: string,
): BookProject {
  const now = new Date().toISOString();
  return {
    ...structuredClone(source),
    id: crypto.randomUUID(),
    title: source.title + " (copia " + kind + " " + now.slice(0, 10) + ")",
    remote: undefined,
    status: "paused",
    createdAt: now, updatedAt: now,
    previousError: "Copia di sicurezza generata dal confronto GitHub" +
      (headSha ? " al commit " + headSha.slice(0, 12) : "") +
      ". È indipendente dalla sincronizzazione remota.",
  };
}

function clonedActivities(items: Activity[], bookId: string): Activity[] {
  return items.map(activity => ({
    ...structuredClone(activity),
    id: crypto.randomUUID(), bookId,
    status: activity.status === "running" ? "cancelled" as const : activity.status,
    error: activity.status === "running" ? "Copiata durante il recupero; sessione non più attiva." : activity.error,
  }));
}
function nowGreater(previous: string): string {
  const timestamp = Date.parse(previous);
  return new Date(Math.max(Date.now(), Number.isFinite(timestamp) ? timestamp + 1 : Date.now())).toISOString();
}

/** Additive rescue: save the pinned remote snapshot as a separate OFFLINE book. */
export async function preserveRemoteVersion(review: ConflictReview): Promise<string> {
  const local = await getBook(review.bookId);
  if (!local || !repositoryMatches(local.remote, review.local.remote))
    throw new RemoteConflict("Il collegamento GitHub del libro è cambiato. Ricarica il confronto.");
  const copy = createSafetyCopy(review.remote, "GitHub", review.headSha);
  const db = await getDb();
  const tx = db.transaction(["books", "activities"], "readwrite");
  await tx.objectStore("books").put(copy, copy.id);
  for (const item of clonedActivities(review.remoteActivities, copy.id)) {
    await tx.objectStore("activities").put(item, item.id);
  }
  await tx.done;
  return copy.id;
}

export interface ConflictResolutionResult {
  restoredBookId: string;
  localBackupId: string;
  remoteBackupId: string;
  remoteSelections: number;
}

/**
 * Writes locally only, NEVER pushes to GitHub. Two complete safety copies
 * (local and remote) are persisted atomically before replacing the original.
 * A stale local revision or remote HEAD aborts without touching either copy.
 */
export async function applyBookConflictResolution(
  review: ConflictReview, selections: Record<string, ResolutionChoice>,
): Promise<ConflictResolutionResult> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request)
    throw new Error("Web Locks non disponibile: non è sicuro applicare il ripristino in questo browser.");
  return locks.request("bookwriter:writer:" + review.bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new RemoteConflict("Una scheda sta scrivendo questo libro. Metti prima in pausa l'autopilot.");
    return locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outboxLock => {
      if (!outboxLock) throw new RemoteConflict("Sincronizzazione GitHub in corso. Riprova dopo il checkpoint.");
      const before = await getBook(review.bookId);
      if (!before?.remote || !repositoryMatches(before.remote, review.local.remote) ||
          before.status === "running" || before.updatedAt !== review.localUpdatedAt ||
          before.remote.lastSyncedCommit !== review.localSyncedCommit) {
        throw new RemoteConflict("Il libro locale è cambiato durante il confronto. Ricarica prima di applicare.");
      }

      // No remote writes: compare the branch HEAD without any force push.
      await confirmGitHubHead(before.remote, review.headSha);
      const activityHistory = await listActivities(review.bookId);
      const backupLocal = createSafetyCopy(before, "locale");
      const backupRemote = createSafetyCopy(review.remote, "GitHub", review.headSha);
      const merged = assembleBookResolution(before, review.remote, review.units, selections);
      merged.updatedAt = nowGreater(before.updatedAt);
      merged.remote = {
        ...before.remote,
        autoSync: false, // Explicit reconnection after editorial review.
        allowPublicSync: false,
        lastSyncedCommit: review.headSha,
        lastSyncedLocalUpdatedAt: undefined,
      };
      const remoteSelections = review.units.filter(unit => selections[unit.id] === "remote").length;
      const now = new Date().toISOString();
      const audit: Activity = {
        id: crypto.randomUUID(), bookId: review.bookId,
        runId: crypto.randomUUID(), phase: merged.phase,
        title: "Risoluzione manuale del conflitto GitHub",
        reason: "Confronto locale/GitHub con due copie di sicurezza create prima di applicare la selezione.",
        nextStep: "Rileggi la prosa, i segreti e la timeline. Poi esegui un push manuale da Archivio.",
        status: "succeeded", createdAt: now, endedAt: now,
        summary: remoteSelections + " differenze selezionate dal remoto su " + review.units.length +
          "; backup locale " + backupLocal.id.slice(0, 8) +
          ", backup GitHub " + backupRemote.id.slice(0, 8) +
          "; SHA " + review.headSha.slice(0, 12),
      };

      const db = await getDb();
      const tx = db.transaction(["books", "activities", "outbox"], "readwrite");
      const books = tx.objectStore("books");
      const actual = await books.get(review.bookId) as BookProject | undefined;
      if (!actual?.remote || actual.status === "running" ||
          actual.updatedAt !== review.localUpdatedAt ||
          actual.remote.lastSyncedCommit !== review.localSyncedCommit ||
          !repositoryMatches(actual.remote, review.local.remote)) {
        await tx.done;
        throw new RemoteConflict("La revisione locale è cambiata prima del salvataggio: nessun dato sostituito.");
      }
      await books.put(backupLocal, backupLocal.id);
      await books.put(backupRemote, backupRemote.id);
      for (const item of clonedActivities(activityHistory, backupLocal.id)) {
        await tx.objectStore("activities").put(item, item.id);
      }
      for (const item of clonedActivities(review.remoteActivities, backupRemote.id)) {
        await tx.objectStore("activities").put(item, item.id);
      }
      await books.put(merged, merged.id);
      await tx.objectStore("outbox").delete(review.bookId);
      await tx.objectStore("activities").put(audit, audit.id);
      await tx.done;
      return {
        restoredBookId: review.bookId,
        localBackupId: backupLocal.id,
        remoteBackupId: backupRemote.id,
        remoteSelections,
      };
    });
  });
}
