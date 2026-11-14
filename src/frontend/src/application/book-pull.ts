import type { Activity, BookProject } from "../domain/types";
import { getBook, getDb } from "../infrastructure/db";
import {
  confirmGitHubHead, isGitHubAncestor, readGitHubSnapshot, RemoteConflict,
} from "../infrastructure/github-sync";
import { getManualPushIntent } from "../infrastructure/manual-push-intent";
import { getOutbox } from "../infrastructure/outbox";

export interface BookPullResult {
  status: "up_to_date" | "pulled";
  commit: string;
  title: string;
}

const NOT_FAST_FORWARD = " Usa «Confronto e recupero» in Archivio per decidere cosa tenere: nessun dato è stato modificato.";

/**
 * Brings a book that THIS device has not changed up to the commit another device
 * pushed. It is a fast-forward in the Git sense: it only runs when
 *  - the local copy is exactly what was last synchronised (no local edits),
 *  - nothing waits in the outbox, no manual push is half-done, no autopilot runs,
 *  - the remote head descends from the last synchronised commit (checked on GitHub).
 * Anything else stops with an explanation and leaves the book untouched; divergent
 * work goes through the explicit comparison tool. It never pushes and never deletes
 * a local audit entry.
 */
export async function pullBookFastForward(bookId: string, signal?: AbortSignal): Promise<BookPullResult> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request)
    throw new Error("Web Locks non disponibile: l'aggiornamento da GitHub è disattivato per evitare scritture concorrenti.");
  return locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new RemoteConflict("Una scheda sta scrivendo questo libro: metti prima in pausa l'autopilot.");
    return locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outboxLock => {
      if (!outboxLock) throw new RemoteConflict("Sincronizzazione GitHub in corso: riprova dopo il checkpoint.");
      const local = await getBook(bookId);
      if (!local?.remote) throw new Error("Collega prima il libro a una repository GitHub.");
      const base = local.remote.lastSyncedCommit;
      if (!base) throw new Error("Questo libro non è mai stato sincronizzato con GitHub: usa la sincronizzazione manuale o il confronto.");
      if (local.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
      if (local.remote.lastSyncedLocalUpdatedAt !== local.updatedAt)
        throw new RemoteConflict("Il libro ha modifiche locali non ancora su GitHub: non lo sovrascrivo." + NOT_FAST_FORWARD);
      if (await getOutbox(bookId))
        throw new RemoteConflict("Ci sono sincronizzazioni in coda per questo libro: attendi che finiscano." + NOT_FAST_FORWARD);
      if (await getManualPushIntent(bookId))
        throw new RemoteConflict("Un push manuale precedente è ancora sospeso: risolvilo in Archivio." + NOT_FAST_FORWARD);

      const snapshot = await readGitHubSnapshot(local.remote, signal);
      if (!snapshot) throw new Error("Nessun libro BookWriter nella repository collegata.");
      if (snapshot.book.id !== local.id)
        throw new RemoteConflict("La repository contiene un libro con ID differente: nessuna copia locale modificata.");
      if (snapshot.head === base) return { status: "up_to_date", commit: base, title: local.title };

      const ancestry = await isGitHubAncestor(local.remote, base, snapshot.head, signal);
      if (ancestry !== "ancestor")
        throw new RemoteConflict(ancestry === "too_far"
          ? "GitHub ha più di 1.000 commit di differenza dall'ultima sincronizzazione." + NOT_FAST_FORWARD
          : "Il branch GitHub non discende dall'ultima versione sincronizzata qui: la storia è stata riscritta o divergente." + NOT_FAST_FORWARD);
      // The head may have moved while we compared: the reviewed commit must still be the head.
      await confirmGitHubHead(local.remote, snapshot.head, signal);

      const now = new Date().toISOString();
      const remoteTime = Date.parse(snapshot.book.updatedAt), localTime = Date.parse(local.updatedAt);
      // A revision never goes backwards, whatever the other device's clock said.
      const updatedAt = Number.isFinite(remoteTime) && remoteTime > localTime
        ? snapshot.book.updatedAt : new Date(localTime + 1).toISOString();
      const next: BookProject = {
        ...snapshot.book, updatedAt,
        status: snapshot.book.status === "running" ? "paused" : snapshot.book.status,
        ...(snapshot.book.status === "running"
          ? { previousError: "Il lavoro era in esecuzione su un altro dispositivo: riprendi quando vuoi." } : {}),
        // Destination and sync policy stay the ones of this device; only the baseline advances.
        remote: { ...local.remote, lastSyncedCommit: snapshot.head, lastSyncedLocalUpdatedAt: updatedAt, lastSyncAt: now },
      };
      const db = await getDb();
      const tx = db.transaction(["books", "activities", "outbox"], "readwrite");
      void tx.done.catch(() => undefined);
      const stored = await tx.objectStore("books").get(bookId) as BookProject | undefined;
      if (!stored || stored.updatedAt !== local.updatedAt || stored.status === "running" ||
          await tx.objectStore("outbox").get(bookId)) {
        tx.abort();
        throw new RemoteConflict("Il libro è cambiato durante l'aggiornamento: nessuna modifica applicata. Riprova.");
      }
      void tx.objectStore("books").put(next, bookId);
      for (const activity of snapshot.activities) {
        const safe: Activity = activity.status === "running" ? { ...activity, status: "cancelled" as const } : activity;
        void tx.objectStore("activities").put(safe, safe.id);
      }
      await tx.done;
      return { status: "pulled", commit: snapshot.head, title: next.title };
    });
  });
}
