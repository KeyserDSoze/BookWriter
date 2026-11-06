import { createEditorialCycle } from "../domain/editorial-board";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import { activeLocOcrExcerpts } from "../domain/loc-ocr";
import type { Activity,BookProject } from "../domain/types";
import { getDb } from "../infrastructure/db";

/** Explicit local quarantine of ONE active OCR evidence ID after a mismatch.
 * The remote audit is intentionally separate and does not mutate IndexedDB.
 * Historical snapshots, previously accepted reports and prose survive.
 */
export async function quarantineLocOcrSource(
  bookId:string,chapterId:string,expectedUpdatedAt:string,sourceId:string,
):Promise<{reopened:boolean}> {
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)
    throw new Error("Web Locks necessari per escludere la fonte OCR.");
  return locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Libro già in uso da un'altra scheda.");
    return locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("Sincronizzazione in corso: esclusione OCR bloccata.");
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const book=await tx.objectStore("books").get(bookId) as BookProject|undefined;
      if(!book||book.updatedAt!==expectedUpdatedAt||book.status==="running"||
        !!book.editorialCycle){
        await tx.done;
        throw new Error("Libro modificato o redazione in corso: fonte OCR non esclusa.");
      }
      const chapter=book.chapters.find(x=>x.id===chapterId);
      const dossier=chapter?.historicalDossier;
      if(!chapter||!dossier?.locOcr||
        !activeLocOcrExcerpts(dossier).some(x=>x.id===sourceId)){
        await tx.done;
        throw new Error("La fonte OCR non è più attiva: ricarica il capitolo.");
      }
      const reopened=!!chapter.frozenAt;
      const previousSynopsis=reopened?
        synopsisBeforeChapter(book.chapters,chapter.number):undefined;
      dossier.locOcr.activeExcerptIds=dossier.locOcr.activeExcerptIds
        .filter(id=>id!==sourceId);
      if(reopened){
        for(const ch of book.chapters)if(ch.number>=chapter.number){
          ch.frozenAt=undefined;
          ch.summary=undefined;
          ch.bookSummaryAtFreeze=undefined;
        }
        book.bookSummary=previousSynopsis;
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
        book.currentSceneId=undefined;
        book.revision=undefined;
        book.previousError="Fonte OCR LoC esclusa: riapprova questo capitolo e i successivi.";
      }else if(book.status==="completed"&&chapter.scenes.length&&
        chapter.scenes.every(s=>s.status==="canon"&&s.text.trim())){
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
      }
      if(book.remote)book.remote.autoSync=false;
      await tx.objectStore("outbox").delete(bookId);
      const now=new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      book.updatedAt=now;
      await tx.objectStore("books").put(book,bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        title:"Fonte OCR Library of Congress esclusa dalle nuove review",
        reason:"L'autore ha scelto di escludere l'OCR dopo un confronto remoto discordante.",
        nextStep:"Esamina la scansione originale, condizioni di accesso e diritti e riavvia la review.",
        summary:"ID "+sourceId+" ritirato dalle fonti attive; frammento, prosa e report precedenti preservati. Non prova che il documento originale sia falso.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
      return {reopened};
    });
  });
}
