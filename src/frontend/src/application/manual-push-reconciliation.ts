import type { BookProject } from "../domain/types";
import { getDb } from "../infrastructure/db";
import {
  getManualPushIntent, type ManualPushIntent,
} from "../infrastructure/manual-push-intent";
import { verifyPublishedManualPush } from "../infrastructure/github-sync";

function mismatchedDestinationOrBaseline(book: BookProject, intent: ManualPushIntent): boolean {
  return !book.remote ||
    book.remote.owner !== intent.owner ||
    book.remote.repository !== intent.repository ||
    book.remote.branch !== intent.branch ||
    book.remote.lastSyncedCommit !== intent.baseSha;
}

function sameIntent(a: ManualPushIntent | undefined, b: ManualPushIntent): boolean {
  return !!a && a.bookId === b.bookId &&
    a.operationId === b.operationId && a.owner === b.owner &&
    a.repository === b.repository && a.branch === b.branch &&
    a.baseSha === b.baseSha && a.sourceRevision === b.sourceRevision &&
    a.preparedAt === b.preparedAt;
}

export interface ManualPushReconciliation {
  commit: string;
  repository: string;
}

/**
 * Explicit human-requested reconciliation of a stuck local manual intent.
 * The old repository must independently prove that the exact commit is
 * published. Only the intent is deleted, never book, remote, canon or outbox.
 */
export async function reconcileSuspendedManualPush(
  bookId: string,
): Promise<ManualPushReconciliation> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request)
    throw new Error("Web Locks non disponibile: verifica dell'intento sospeso bloccata.");

  return locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new Error("Un'altra scheda sta scrivendo questo libro.");
    return locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outbox => {
      if (!outbox) throw new Error("Una sincronizzazione GitHub è già in corso.");
      const db = await getDb();
      const current = await db.get("books", bookId) as BookProject | undefined;
      const intent = await getManualPushIntent(bookId);
      if (!current || !intent || intent.bookId !== bookId)
        throw new Error("Nessun tentativo manuale sospeso da verificare.");
      if (current.status === "running")
        throw new Error("Metti in pausa l'autopilot prima della riconciliazione.");
      if (!mismatchedDestinationOrBaseline(current, intent))
        throw new Error("La destinazione non è cambiata: usa il normale recupero con Sincronizza.");

      // Read-only GitHub proof must complete BEFORE any local mutation.
      const commit = await verifyPublishedManualPush(intent);

      // CAS for both the author's book snapshot and exact intent identity.
      // A stale button/another tab cannot delete a replacement intent.
      const tx = db.transaction(["books", "meta"], "readwrite");
      const latest = await tx.objectStore("books").get(bookId) as BookProject | undefined;
      const intentKey = "manual-github-push:" + bookId;
      const stored = await tx.objectStore("meta").get(intentKey) as ManualPushIntent | undefined;
      const sameBook = latest?.updatedAt === current.updatedAt &&
        latest?.status !== "running" &&
        !!latest && mismatchedDestinationOrBaseline(latest, intent) &&
        latest.remote?.owner === current.remote?.owner &&
        latest.remote?.repository === current.remote?.repository &&
        latest.remote?.branch === current.remote?.branch &&
        latest.remote?.lastSyncedCommit === current.remote?.lastSyncedCommit;
      if (!sameBook || !sameIntent(stored, intent)) {
        await tx.done;
        throw new Error("Il libro o l'intento sono cambiati durante la verifica: ricarica e riprova.");
      }
      await tx.objectStore("meta").delete(intentKey);
      await tx.done;
      return { commit, repository: intent.owner + "/" + intent.repository };
    });
  });
}
