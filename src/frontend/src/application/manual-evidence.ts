import { createEditorialCycle } from "../domain/editorial-board";
import { appendManualEvidence, type ManualExcerptInput } from "../domain/manual-evidence";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import type { Activity, BookProject } from "../domain/types";
import { getDb } from "../infrastructure/db";

/** Local-only submission. No external fetch, OCR or ingestion of private documents. */
export async function attachManualEvidence(
  bookId: string, chapterId: string, expectedUpdatedAt: string,
  approved: ManualExcerptInput,
): Promise<{reopened:boolean; excerptId:string}> {
  if (!approved || approved.rightsAttested !== true)
    throw new Error("Il consenso esplicito sui diritti è obbligatorio.");
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks necessario per archiviare la trascrizione.");
  return locks.request("bookwriter:writer:" + bookId, {ifAvailable:true}, async writer => {
    if (!writer) throw new Error("Libro già modificato in un'altra scheda.");
    return locks.request("bookwriter:github-outbox", {ifAvailable:true}, async outbox => {
      if (!outbox) throw new Error("La sincronizzazione GitHub è in corso.");
      const db = await getDb();
      const tx = db.transaction(["books","activities","outbox"],"readwrite");
      const book = await tx.objectStore("books").get(bookId) as BookProject | undefined;
      if (!book || book.updatedAt !== expectedUpdatedAt ||
          book.status === "running" || !!book.editorialCycle) {
        await tx.done;
        throw new Error("Libro modificato o redazione in corso: nessuna trascrizione salvata.");
      }
      const chapter = book.chapters.find(ch => ch.id === chapterId);
      if (!chapter) { await tx.done; throw new Error("Capitolo non disponibile."); }
      const now = new Date().toISOString();
      const dossier=appendManualEvidence(chapter.historicalDossier,approved,now);
      const reopened=!!chapter.frozenAt;
      // This may throw for legacy books; do not modify the canon until it succeeds.
      const previousSummary=reopened?synopsisBeforeChapter(book.chapters,chapter.number):undefined;
      chapter.historicalDossier=dossier;
      if (reopened) {
        for(const dependent of book.chapters) if (dependent.number>=chapter.number) {
          dependent.frozenAt=undefined;
          dependent.summary=undefined;
          dependent.bookSummaryAtFreeze=undefined;
        }
        book.bookSummary=previousSummary;
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
        book.currentSceneId=undefined;
        book.revision=undefined;
        book.previousError="Trascrizione documentale aggiornata: riesegui la review del capitolo e dei successivi.";
      } else if (book.status==="completed" && chapter.scenes.length &&
          chapter.scenes.every(scene => scene.status==="canon" && scene.text.trim())) {
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
      }
      if (book.remote) book.remote.autoSync=false;
      await tx.objectStore("outbox").delete(bookId);
      book.updatedAt=new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        title:"Trascrizione archivistica attestata dall'autore",
        reason:"L'autore ha dichiarato riferimento, collocazione, estratto e base dei diritti; nessun documento scaricato.",
        nextStep:"Confronta personalmente la trascrizione con l'originale e riesegui la redazione se richiesta.",
        summary:"Una trascrizione locale salvata con provenienza dichiarata e controllo citazioni testuali. Non autenticata.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
      return {
        reopened,
        excerptId:dossier.manualEvidence!.activeExcerptIds.at(-1)!,
      };
    });
  });
}
