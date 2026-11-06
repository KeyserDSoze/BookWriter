import { markHistoricalEvidenceChanged } from "../domain/cross-chapter-continuity";
import {createEditorialCycle} from "../domain/editorial-board";
import {synopsisBeforeChapter} from "../domain/editorial-summary";
import {activeLocOcrExcerpts} from "../domain/loc-ocr";
import {activeLocScanCollations} from "../domain/loc-scan-collation";
import {appendLocIiifReference,type LocIiifCandidate} from "../domain/loc-iiif";
import {getBook,getDb} from "../infrastructure/db";
import {inspectLocIiif} from "../infrastructure/loc-iiif";
import type {Activity,BookProject} from "../domain/types";

/** Author has already selected a candidate discovered from the same LoC item
 * and confirmed same-page and rights statements before invoking this use case.
 */
export async function attachLocIiifReference(
  bookId:string,chapterId:string,expectedUpdatedAt:string,collationId:string,
  candidate:LocIiifCandidate,samePageAttested:true,rightsAttested:true,
  signal?:AbortSignal,
):Promise<{reopened:boolean;referenceId:string}>{
  if(samePageAttested!==true||rightsAttested!==true)
    throw new Error("Conferma pagina osservata e diritti prima di associare IIIF.");
  const before=await getBook(bookId);
  if(!before||before.updatedAt!==expectedUpdatedAt||before.status==="running"||
    before.editorialCycle)
    throw new Error("Libro modificato o redazione in corso: ricarica prima di associare IIIF.");
  const chapter=before.chapters.find(x=>x.id===chapterId);
  const scan=activeLocScanCollations(chapter?.historicalDossier)
    .find(x=>x.id===collationId);
  const source=activeLocOcrExcerpts(chapter?.historicalDossier)
    .find(x=>x.id===scan?.ocrSourceId);
  if(!scan||!source)
    throw new Error("Collazione e OCR esatti non più attivi.");
  // Both GETs happen before obtaining a write transaction. The item identity
  // and selected resource are checked again, with no private book data sent.
  const entry=await inspectLocIiif(source,scan,candidate,signal);
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)throw new Error("Web Locks richiesti per il riferimento IIIF.");
  return locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Libro già in uso da un'altra scheda.");
    return locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("Sincronizzazione in corso: IIIF non archiviato.");
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const book=await tx.objectStore("books").get(bookId) as BookProject|undefined;
      if(!book||book.updatedAt!==expectedUpdatedAt||book.status==="running"||
        book.editorialCycle){
        await tx.done;throw new Error("Libro modificato durante la rete: IIIF non archiviato.");
      }
      const target=book.chapters.find(x=>x.id===chapterId);
      if(!target){
        await tx.done;throw new Error("Capitolo non disponibile.");
      }
      const dossier=appendLocIiifReference(target.historicalDossier,entry);
      const reopened=!!target.frozenAt;
      const oldSummary=reopened?synopsisBeforeChapter(book.chapters,target.number):undefined;
      target.historicalDossier=dossier;
      if(reopened){
        markHistoricalEvidenceChanged(book, target);
        for(const dependent of book.chapters)if(dependent.number>=target.number){
          dependent.frozenAt=undefined;
          dependent.summary=undefined;
          dependent.bookSummaryAtFreeze=undefined;
        }
        book.bookSummary=oldSummary;
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";book.phase="chapterReview";
        book.currentSceneId=undefined;book.revision=undefined;
        book.previousError="Riferimento IIIF aggiornato: riesamina il capitolo e i successivi.";
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
        title:"Risorsa immagine IIIF LoC associata a collazione OCR",
        reason:"Selezione esplicita dell'autore con conferma della pagina e dei diritti. Il software ha letto solo metadati istituzionali.",
        nextStep:"Confronta personalmente la pagina visuale e la frase prima di citare la fonte.",
        summary:"Salvato ID IIIF, dimensioni, fingerprint dei metadati e collazione LoC. Nessun pixel, testo originale, licenza o dato storico autenticato.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
      return {reopened,referenceId:entry.id};
    });
  });
}
