import type {Activity} from "../domain/types";
import {createNarrativeKnowledgeTopicDecision,
  type NarrativeKnowledgeTopicDecision}
  from "../domain/narrative-knowledge-topic-decisions";
import {getBook,getDb} from "../infrastructure/db";

/** Local author-only declaration with the same writer/outbox and CAS guards.
 * No AI call, no remote push, no update to canon or old sharing permissions. */
export async function recordNarrativeKnowledgeTopicDecision(
  bookId:string,expectedUpdatedAt:string,firstId:string,secondId:string,
  verdict:NarrativeKnowledgeTopicDecision["verdict"],rationale:string,
):Promise<void>{
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)
    throw new Error("Web Locks necessario per confrontare conoscenze.");
  await locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Il libro è già in lavorazione in un'altra scheda.");
    await locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("La sincronizzazione GitHub è in corso.");
      const book=await getBook(bookId);
      if(!book||book.updatedAt!==expectedUpdatedAt)
        throw new Error("Il libro è cambiato: aggiorna prima di confermare la relazione.");
      if(book.status==="running")throw new Error("Metti prima in pausa l'autopilot.");
      if(book.editorialCycle&&book.editorialCycle.stage!=="blocked")
        throw new Error("Concludi o blocca la redazione prima di confrontare conoscenze.");
      const now=new Date().toISOString();
      const decision=createNarrativeKnowledgeTopicDecision(book,firstId,secondId,
        verdict,rationale,crypto.randomUUID(),now);
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const latest=await tx.objectStore("books").get(bookId) as typeof book|undefined;
      if(!latest||latest.updatedAt!==expectedUpdatedAt){
        await tx.done;
        throw new Error("Un'altra scheda ha modificato il libro: relazione non salvata.");
      }
      book.narrativeKnowledgeTopicDecisions=[
        ...(book.narrativeKnowledgeTopicDecisions??[]),decision];
      if(book.remote)book.remote.autoSync=false;
      book.updatedAt=new Date(Math.max(Date.now(),
        Date.parse(expectedUpdatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      await tx.objectStore("outbox").delete(bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",createdAt:now,endedAt:now,
        title:"Relazione tra conoscenze annotata dall'autore",
        reason:"Confronto esplicito di due attestazioni, senza inferenza automatica.",
        nextStep:"Controlla le due fonti: non è stata certificata alcuna trasmissione.",
        summary:"Relazione privata registrata; canone e consensi AI invariati.",
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
    });
  });
}
