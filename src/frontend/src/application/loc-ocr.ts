import { markHistoricalEvidenceChanged } from "../domain/cross-chapter-continuity";
import { createEditorialCycle } from "../domain/editorial-board";
import { activeArchivalItems } from "../domain/archival-catalog";
import { activeInstitutionalInspections } from "../domain/institutional-inspection";
import { appendLocOcrExcerpt,type LocOcrRights } from "../domain/loc-ocr";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import type { Activity,BookProject } from "../domain/types";
import { getBook,getDb } from "../infrastructure/db";
import { fetchLocOcrExcerpt } from "../infrastructure/loc-ocr";

/** Only called AFTER the author has explicitly attested rights and approved the
 * precise LoC item ID and the possible downstream AI/GitHub/backup transfer.
 */
export async function attachLocOcrExcerpt(
  bookId:string,chapterId:string,expectedUpdatedAt:string,
  catalogItemId:string,inspectionId:string,rights:LocOcrRights,
  signal?:AbortSignal,
):Promise<{reopened:boolean;sourceId:string}>{
  const before=await getBook(bookId);
  if(!before||before.updatedAt!==expectedUpdatedAt)
    throw new Error("Il libro è cambiato: ricarica prima dell'acquisizione OCR.");
  if(before.status==="running"||before.editorialCycle)
    throw new Error("Concludi la redazione prima di acquisire l'OCR.");
  const chapter=before.chapters.find(c=>c.id===chapterId);
  const item=activeArchivalItems(chapter?.historicalDossier)
    .find(x=>x.id===catalogItemId);
  const inspection=activeInstitutionalInspections(chapter?.historicalDossier)
    .find(x=>x.id===inspectionId&&x.catalogItemId===catalogItemId);
  if(!item||!inspection||inspection.accessRestricted===true||
    !inspection.hasTextResourceLink)
    throw new Error("Occorre una scheda e un'ispezione testuale attive senza accesso ristretto.");
  const found=await fetchLocOcrExcerpt(
    item.itemId,item.id,inspection.id,item.title,rights,signal);
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)throw new Error("Web Locks necessari per archiviare l'OCR.");
  return locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Libro già in uso da un'altra scheda.");
    return locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("Sincronizzazione in corso: OCR non archiviato.");
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const book=await tx.objectStore("books").get(bookId) as BookProject|undefined;
      if(!book||book.updatedAt!==expectedUpdatedAt||
        book.status==="running"||book.editorialCycle){
        await tx.done;
        throw new Error("Libro modificato durante la rete: OCR non archiviato.");
      }
      const target=book.chapters.find(ch=>ch.id===chapterId);
      if(!target){await tx.done;throw new Error("Capitolo non disponibile.");}
      const dossier=appendLocOcrExcerpt(target.historicalDossier,found);
      const reopened=!!target.frozenAt;
      const prior=reopened?synopsisBeforeChapter(book.chapters,target.number):undefined;
      target.historicalDossier=dossier;
      if(reopened){
        markHistoricalEvidenceChanged(book, target);
        for(const dependent of book.chapters)if(dependent.number>=target.number){
          dependent.frozenAt=undefined;
          dependent.summary=undefined;
          dependent.bookSummaryAtFreeze=undefined;
        }
        book.bookSummary=prior;
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";book.phase="chapterReview";
        book.currentSceneId=undefined;book.revision=undefined;
        book.previousError="Estratto OCR istituzionale aggiornato: riesamina il capitolo e i successivi.";
      }else if(book.status==="completed"&&target.scenes.length&&
        target.scenes.every(s=>s.status==="canon"&&s.text.trim())){
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";book.phase="chapterReview";
      }
      if(book.remote)book.remote.autoSync=false;
      await tx.objectStore("outbox").delete(bookId);
      const now=new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      book.updatedAt=now;
      await tx.objectStore("books").put(book,bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        title:"Estratto OCR LoC acquisito con attestazione dei diritti",
        reason:"L'autore ha approvato la lettura di un file .txt istituzionale e attestato la propria base di utilizzo.",
        nextStep:"Controlla l'originale, errori OCR, licenze e attribuzioni prima di pubblicare; esegui la review.",
        summary:"Conservata una citazione letterale dell'OCR recuperato con hash, offset e URL di provenienza. Documento non autenticato, diritti non verificati.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
      return {reopened,sourceId:found.id};
    });
  });
}
