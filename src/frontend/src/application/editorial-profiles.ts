import type { Activity, BookProject } from "../domain/types";
import { bumpProfileVersions, parseEditorialProfiles, withStandardReaders, type EditorialProfiles } from "../domain/editorial-profiles";
import { contentStamp, newEdit, pruneEdits } from "../domain/book-edits";
import { BookRevisionConflict, getDb } from "../infrastructure/db";

/** Explicit author configuration only. No AI, canonical edits or retroactive
 * reinterpretation of cycles: each started cycle keeps its own templates.
 * Every change is recorded in the book's edit log, so it can be compared and restored. */
export async function saveEditorialProfiles(bookId: string, expectedUpdatedAt: string,
  value: EditorialProfiles | undefined, confirmed: boolean, isCurrent: () => boolean = () => true,
  options: { restoredEditId?: string } = {}): Promise<void> {
  if (!confirmed) throw new Error("Conferma esplicita necessaria per modificare i profili editoriali.");
  const profiles = value === undefined ? undefined : parseEditorialProfiles(withStandardReaders(value));
  if (!navigator.locks?.request) throw new Error("Web Locks non disponibile: modifica dei profili bloccata.");
  await navigator.locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new Error("Un'altra scheda sta scrivendo il libro: metti prima in pausa l'autopilot.");
    await navigator.locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outbox => {
      if (!outbox) throw new Error("Sincronizzazione GitHub in corso: riprova al termine.");
      const db = await getDb();
      const tx = db.transaction(["books", "activities", "outbox"], "readwrite");
      void tx.done.catch(() => undefined);
      try {
        const book = await tx.objectStore("books").get(bookId) as BookProject | undefined;
        if (!book || !expectedUpdatedAt || book.updatedAt !== expectedUpdatedAt) throw new BookRevisionConflict();
        if (book.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
        if (book.phase === "audience" && book.audienceReviews.length)
          throw new Error("Completa il panel delle idee già avviato prima di cambiare i profili dei lettori.");
        const before = book.editorialProfiles ? JSON.stringify(book.editorialProfiles) : null;
        if (profiles) book.editorialProfiles = bumpProfileVersions(book.editorialProfiles, profiles); else delete book.editorialProfiles;
        const after = book.editorialProfiles ? JSON.stringify(book.editorialProfiles) : null;
        if (book.remote) book.remote.autoSync = false;
        const now = new Date(Math.max(Date.now(), Date.parse(book.updatedAt) + 1)).toISOString();
        book.updatedAt = now;
        if (before !== after) book.edits = pruneEdits([...(book.edits ?? []), newEdit({ at: now, target: { kind: "profiles", id: "book" },
          label: "Agenti della redazione", field: options.restoredEditId ? "ripristino" : "profili", origin: "manual", before, after,
          changeKind: "behavior", related: [], stampAfter: contentStamp(after ?? "null") })]);
        const activity: Activity = { id: crypto.randomUUID(), bookId, runId: crypto.randomUUID(), phase: book.phase,
          title: options.restoredEditId ? "Profili editoriali ripristinati" : "Profili editoriali aggiornati", reason: "Configurazione esplicita dell'autore; nessuna chiamata AI.",
          nextStep: "I nuovi cicli useranno i profili salvati; quelli già iniziati conservano le proprie istruzioni.",
          status: "succeeded", aiRequested: false, createdAt: now, endedAt: now };
        if (!isCurrent()) throw new Error("Configurazione dei profili superata: ripeti il salvataggio.");
        await tx.objectStore("books").put(book, bookId);
        await tx.objectStore("activities").add(activity, activity.id);
        await tx.objectStore("outbox").delete(bookId);
        await tx.done;
      } catch (error) {
        try { tx.abort(); } catch { /* already finished */ }
        await tx.done.catch(() => undefined);
        throw error;
      }
    });
  });
}
