import type { Activity, BookProject } from "../domain/types";
import { createEditorialCycle } from "../domain/editorial-board";
import { getBook, getDb } from "../infrastructure/db";

/** Explicit author action. It can reopen a frozen chapter or rescue a blocked review.
 * Work remains local and autosync disabled until every dependent chapter is frozen.
 */
export async function reopenChapterReview(bookId: string, chapterId: string, instruction = ""): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks necessario per riaprire il capitolo.");
  await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new Error("Il libro è già in lavorazione in un'altra scheda.");
    await locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outbox => {
      if (!outbox) throw new Error("La sincronizzazione GitHub è in corso.");
      const book = await getBook(bookId);
      if (!book) throw new Error("Libro non trovato.");
      if (book.status === "running") throw new Error("Metti in pausa l'autopilot.");
      if (book.editorialReviewSceneIds?.length)
        throw new Error("Conferma prima le scene fuse nel Lettore.");
      const target = book.chapters.find(ch => ch.id === chapterId);
      if (!target || !target.scenes.length || target.scenes.some(s => !s.text.trim() || s.status === "planned"))
        throw new Error("Per revisionare un capitolo servono tutte le scene scritte.");
      if (book.editorialCycle && book.editorialCycle.stage !== "blocked")
        throw new Error("Un'altra redazione è già in corso: riprendi quella o mettila in pausa.");
      if (book.editorialCycle?.stage === "blocked" && book.editorialCycle.chapterId !== chapterId)
        throw new Error("Concludi prima la redazione bloccata dell'altro capitolo.");
      if (book.editorialCycle?.stage === "blocked" && instruction.trim().length < 12)
        throw new Error("Spiega come vuoi affrontare i rilievi irrisolti (almeno 12 caratteri).");
      if (book.editorialCycle?.stage === "blocked") {
        const previous = book.editorialCycle;
        const oldChapter = book.chapters.find(ch => ch.id === previous.chapterId);
        if (oldChapter?.editorialRounds) {
          // Keep all historical rounds, even ones that did not reach consensus.
          oldChapter.editorialRounds.push(...previous.priorRounds);
          if (previous.judgment) oldChapter.editorialRounds.push({
            round: previous.round, reports: previous.reports, judgment: previous.judgment,
          });
        } else if (oldChapter) {
          oldChapter.editorialRounds = [...previous.priorRounds,
            ...(previous.judgment ? [{
              round: previous.round, reports: previous.reports, judgment: previous.judgment,
            }] : [])];
        }
      }
      if (instruction.trim()) book.authorConstraints.push(instruction.trim());
      if (book.remote) book.remote.autoSync = false;
      for (const ch of book.chapters) if (ch.number >= target.number) {
        ch.frozenAt = undefined;
        ch.summary = undefined;
      }
      book.bookSummary = book.chapters.filter(ch => ch.frozenAt)
        .map(ch => ch.summary ?? "").join("\n").slice(-8000);
      book.editorialCycle = createEditorialCycle(chapterId);
      book.status = "paused";
      book.phase = "chapterReview";
      book.revision = undefined;
      book.currentSceneId = undefined;
      book.previousError = "Redazione riaperta dall'autore: sette specialisti, cinque lettori e giudice editoriale.";
      const db = await getDb();
      const tx = db.transaction(["books","activities","outbox"],"readwrite");
      const latest = await tx.objectStore("books").get(bookId) as BookProject | undefined;
      if (!latest || latest.updatedAt !== book.updatedAt) {
        await tx.done;
        throw new Error("Il libro è stato modificato mentre avviavi la review.");
      }
      const now = new Date().toISOString();
      book.updatedAt = new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      await tx.objectStore("outbox").delete(bookId);
      const entry: Activity = {
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        title:"Riapertura redazione capitolo",
        reason:"Richiesta esplicita dell'autore o recupero di un ciclo senza consenso.",
        nextStep:"Riprendi l'autopilot per eseguire specialisti, panel lettori e giudice.",
        summary:"Capitolo " + target.number + " riaperto; tutti i capitoli successivi richiedono una nuova verifica.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(entry,entry.id);
      await tx.done;
    });
  });
}
