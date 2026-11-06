import { createEditorialCycle } from "../domain/editorial-board";
import { appendHistoricalSourceRelation, type HistoricalSourceRelationKind } from "../domain/historical-research";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import type { Activity, BookProject } from "../domain/types";
import { getDb } from "../infrastructure/db";

/** Purely local author statement about documentary lineage, never verification of original texts. */
export async function attestHistoricalSourceRelation(
  bookId: string, chapterId: string, expectedUpdatedAt: string,
  sourceIdA: string, sourceIdB: string,
  kind: HistoricalSourceRelationKind, note: string, authorConfirmed: true,
): Promise<{reopened: boolean; relationId: string}> {
  if (authorConfirmed !== true)
    throw new Error("Conferma esplicita dell'autore obbligatoria.");
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks necessario per modificare la provenienza delle fonti.");
  return locks.request("bookwriter:writer:" + bookId, {ifAvailable:true}, async writer => {
    if (!writer) throw new Error("Libro in uso da un'altra scheda.");
    return locks.request("bookwriter:github-outbox", {ifAvailable:true}, async outbox => {
      if (!outbox) throw new Error("Sincronizzazione GitHub in corso: nessuna relazione archiviata.");
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const book=await tx.objectStore("books").get(bookId) as BookProject|undefined;
      if (!book || book.updatedAt!==expectedUpdatedAt ||
          book.status==="running" || !!book.editorialCycle) {
        await tx.done;
        throw new Error("Libro modificato o redazione in corso: nessuna dichiarazione salvata.");
      }
      const chapter=book.chapters.find(ch=>ch.id===chapterId);
      if (!chapter || !chapter.historicalDossier) {
        await tx.done;
        throw new Error("Dossier storico non presente per il capitolo.");
      }
      const now=new Date().toISOString();
      const dossier=appendHistoricalSourceRelation(chapter.historicalDossier,
        sourceIdA,sourceIdB,kind,note,now);
      const reopened=!!chapter.frozenAt;
      const priorSynopsis=reopened?synopsisBeforeChapter(book.chapters,chapter.number):undefined;
      chapter.historicalDossier=dossier;
      if (reopened) {
        for (const dependent of book.chapters) if(dependent.number>=chapter.number){
          dependent.frozenAt=undefined;
          dependent.summary=undefined;
          dependent.bookSummaryAtFreeze=undefined;
        }
        book.bookSummary=priorSynopsis;
        book.editorialCycle=createEditorialCycle(chapterId);
        book.phase="chapterReview";
        book.status="paused";
        book.currentSceneId=undefined;
        book.revision=undefined;
        book.previousError="Dipendenza documentale dichiarata: il capitolo e i successivi richiedono nuova verifica.";
      } else if(book.status==="completed" && chapter.scenes.length &&
          chapter.scenes.every(scene=>scene.status==="canon"&&scene.text.trim())){
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
      }
      if(book.remote)book.remote.autoSync=false;
      await tx.objectStore("outbox").delete(bookId);
      book.updatedAt=new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      const last=dossier.sourceRelations!.at(-1)!;
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),phase:"chapterReview",
        status:"succeeded",createdAt:now,endedAt:now,
        title:"Dipendenza fra fonti registrata dall'autore",
        reason:"Dichiarazione locale esplicita sulla relazione fra due snapshot citabili; nessuna verifica automatica dell'originale.",
        nextStep:"Verifica personalmente la provenienza dei documenti, poi riprendi la redazione quando richiesto.",
        summary:"Relazione "+kind+" fra "+last.sourceAId+" e "+last.sourceBId+
          "; storico preservato. Non costituisce attestazione tecnica di autenticità o licenza.",
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
      return {reopened,relationId:last.id};
    });
  });
}
