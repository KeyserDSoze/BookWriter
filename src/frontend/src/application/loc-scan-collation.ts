import { createEditorialCycle } from "../domain/editorial-board";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import { activeLocOcrExcerpts } from "../domain/loc-ocr";
import { appendLocScanCollation,type LocScanCollationInput } from "../domain/loc-scan-collation";
import type { Activity,BookProject } from "../domain/types";
import { getBook,getDb } from "../infrastructure/db";

/** Visual comparison is performed by the AUTHOR outside BookWriter.
 * This use case only compares two text strings and stores their attestation.
 * No image is downloaded and no network request occurs.
 */
export async function attachLocScanCollation(
  bookId:string,chapterId:string,expectedUpdatedAt:string,
  input:LocScanCollationInput,
):Promise<{reopened:boolean;comparison:"text_overlap"|"text_discrepancy"}>{
  if(!input||input.observedOriginalAttested!==true||
    input.excerptRightsAttested!==true)
    throw new Error("L'autore deve confermare scansione effettivamente vista e diritti di utilizzo.");
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)
    throw new Error("Web Locks necessari per registrare la collazione.");
  return locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Libro già in uso da un'altra scheda.");
    return locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("Sincronizzazione in corso: collazione non salvata.");
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const book=await tx.objectStore("books").get(bookId) as BookProject|undefined;
      if(!book||book.updatedAt!==expectedUpdatedAt||book.status==="running"||
        !!book.editorialCycle){
        await tx.done;
        throw new Error("Libro modificato o redazione in corso: nessuna collazione salvata.");
      }
      const chapter=book.chapters.find(ch=>ch.id===chapterId);
      const source=activeLocOcrExcerpts(chapter?.historicalDossier)
        .find(s=>s.id===input.ocrSourceId);
      if(!chapter||!source){
        await tx.done;
        throw new Error("Estratto OCR non più attivo: ricarica il capitolo.");
      }
      const now=new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      const dossier=appendLocScanCollation(chapter.historicalDossier,source,input,now);
      const latest=dossier.locOcr?.collations?.records.find(x=>
        x.ocrSourceId===source.id&&x.observedAt===now);
      if(!latest){await tx.done;throw new Error("Collazione non registrabile.");}
      const reopened=!!chapter.frozenAt;
      const oldSummary=reopened?synopsisBeforeChapter(book.chapters,chapter.number):undefined;
      chapter.historicalDossier=dossier;
      if(reopened){
        for(const ch of book.chapters)if(ch.number>=chapter.number){
          ch.frozenAt=undefined;
          ch.summary=undefined;
          ch.bookSummaryAtFreeze=undefined;
        }
        book.bookSummary=oldSummary;
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
        book.currentSceneId=undefined;
        book.revision=undefined;
        book.previousError="Collazione visiva dell'autore registrata: riesamina capitolo e successivi.";
      }else if(book.status==="completed"&&chapter.scenes.length&&
        chapter.scenes.every(s=>s.status==="canon"&&s.text.trim())){
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
      }
      if(book.remote)book.remote.autoSync=false;
      await tx.objectStore("outbox").delete(bookId);
      book.updatedAt=now;
      await tx.objectStore("books").put(book,bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        title:"Collazione OCR con scansione dichiarata dall'autore",
        reason:"L'autore ha dichiarato di aver osservato la scansione presso la scheda LoC e ha autorizzato una breve trascrizione.",
        nextStep:"Il giudice deve valutare eventuali discrepanze; esamina la scansione e i diritti prima di citare.",
        summary:"Testo OCR e testo digitato dall'autore: "+latest.comparison+
          ". Nessun pixel immagine è stato verificato dal software.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
      return {reopened,comparison:latest.comparison};
    });
  });
}
