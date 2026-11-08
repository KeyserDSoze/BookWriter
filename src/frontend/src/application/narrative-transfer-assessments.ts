import type {Activity} from "../domain/types";
import {
  createNarrativeTransferAssessment,type NarrativeTransferVerdict,
} from "../domain/narrative-transfer-assessments";
import {getBook,getDb} from "../infrastructure/db";

/** A manual, private annotation of a CURRENT literal witness.
 * The existing writer/outbox lock and optimistic CAS guard all commits. */
export async function recordNarrativeTransferAssessment(
  bookId:string,expectedUpdatedAt:string,
  topicId:string,senderId:string,recipientId:string,candidateId:string,
  verdict:NarrativeTransferVerdict,rationale:string,
):Promise<void> {
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)throw new Error("Web Locks necessario per annotare comunicazioni.");
  await locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Il libro è in lavorazione in un'altra scheda.");
    await locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("La sincronizzazione GitHub è in corso.");
      const book=await getBook(bookId);
      if(!book||book.updatedAt!==expectedUpdatedAt)
        throw new Error("Il libro è cambiato: aggiorna prima di valutare la pista.");
      if(book.status==="running")throw new Error("Metti prima in pausa l'autopilot.");
      if(book.editorialCycle&&book.editorialCycle.stage!=="blocked")
        throw new Error("Concludi o blocca la redazione prima di annotare la pista.");
      const now=new Date().toISOString();
      const decision=createNarrativeTransferAssessment(book,topicId,
        senderId,recipientId,candidateId,verdict,rationale,crypto.randomUUID(),now);
      const db=await getDb(),tx=db.transaction(["books","activities","outbox"],"readwrite");
      const latest=await tx.objectStore("books").get(bookId) as typeof book|undefined;
      if(!latest||latest.updatedAt!==expectedUpdatedAt){
        await tx.done;
        throw new Error("Un'altra scheda ha modificato il libro: giudizio non salvato.");
      }
      book.narrativeTransferAssessments=[
        ...(book.narrativeTransferAssessments??[]),decision,
      ];
      if(book.remote)book.remote.autoSync=false;
      book.updatedAt=new Date(Math.max(Date.now(),Date.parse(expectedUpdatedAt)+1))
        .toISOString();
      await tx.objectStore("books").put(book,bookId);
      await tx.objectStore("outbox").delete(bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",createdAt:now,endedAt:now,
        title:"Pista comunicativa valutata dall'autore",
        reason:"Classificazione locale motivata di una citazione esistente.",
        nextStep:"Rileggi la fonte se cambia il capitolo: nessuna comunicazione certificata.",
        summary:"Giudizio privato salvato; canone e consensi AI invariati.",
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
    });
  });
}
