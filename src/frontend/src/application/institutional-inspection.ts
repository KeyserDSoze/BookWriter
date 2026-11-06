import { createEditorialCycle } from "../domain/editorial-board";
import { activeArchivalItems } from "../domain/archival-catalog";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import { appendInstitutionalInspection } from "../domain/institutional-inspection";
import type { Activity, BookProject } from "../domain/types";
import { getBook,getDb } from "../infrastructure/db";
import { inspectLocItem } from "../infrastructure/loc-item-inspection";

export async function attachInstitutionalInspection(
  bookId:string,chapterId:string,expectedUpdatedAt:string,
  catalogItemId:string,signal?:AbortSignal,
):Promise<{reopened:boolean}>{
  const current=await getBook(bookId);
  if(!current||current.updatedAt!==expectedUpdatedAt)
    throw new Error("Il libro è cambiato: aggiorna prima dell'ispezione.");
  if(current.status==="running"||current.editorialCycle)
    throw new Error("Concludi la redazione prima di esaminare il documento.");
  const chapter=current.chapters.find(c=>c.id===chapterId);
  const source=activeArchivalItems(chapter?.historicalDossier)
    .find(item=>item.id===catalogItemId);
  if(!source)throw new Error("La scheda selezionata non è più attiva.");
  // The single network request includes only the PUBLIC item ID; no manuscript,
  // search query, AI key or GitHub credential travels to the institution.
  const result=await inspectLocItem(source.itemId,source.id,signal);
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)throw new Error("Web Locks necessari per salvare l'ispezione.");
  return locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Il libro è già in uso da un'altra scheda.");
    return locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("Sincronizzazione in corso: nessuna ispezione salvata.");
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const book=await tx.objectStore("books").get(bookId) as BookProject|undefined;
      if(!book||book.updatedAt!==expectedUpdatedAt||
        book.status==="running"||book.editorialCycle){
        await tx.done;throw new Error("Libro modificato durante il controllo: nulla è stato salvato.");
      }
      const target=book.chapters.find(c=>c.id===chapterId);
      if(!target || !activeArchivalItems(target.historicalDossier)
        .some(i=>i.id===source.id)){
        await tx.done;throw new Error("Scheda LoC non più attiva.");
      }
      const dossier=appendInstitutionalInspection(target.historicalDossier,result);
      const reopened=!!target.frozenAt;
      const oldSummary=reopened?synopsisBeforeChapter(book.chapters,target.number):undefined;
      target.historicalDossier=dossier;
      if(reopened){
        for(const dependent of book.chapters)if(dependent.number>=target.number){
          dependent.frozenAt=undefined;
          dependent.summary=undefined;
          dependent.bookSummaryAtFreeze=undefined;
        }
        book.bookSummary=oldSummary;
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
        book.currentSceneId=undefined;
        book.revision=undefined;
        book.previousError="Metadati LoC di accesso e diritti aggiornati: riesamina capitolo e successivi.";
      }else if(book.status==="completed"&&target.scenes.length&&
        target.scenes.every(s=>s.status==="canon"&&s.text.trim())){
        book.editorialCycle=createEditorialCycle(chapterId);
        book.phase="chapterReview";
        book.status="paused";
      }
      if(book.remote)book.remote.autoSync=false;
      await tx.objectStore("outbox").delete(bookId);
      const now=new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      book.updatedAt=now;
      await tx.objectStore("books").put(book,bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        title:"Ispezione dei metadati di accesso e diritti Library of Congress",
        reason:"Autore ha confermato la consultazione del dettaglio pubblico della scheda; nessun originale scaricato.",
        nextStep:"Consulta il documento originale e le indicazioni sui diritti prima di citarlo o pubblicarlo.",
        summary:"Salvato un avviso istituzionale descrittivo; la licenza e il contenuto non sono stati verificati.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
      return {reopened};
    });
  });
}
