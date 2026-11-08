import type {Activity} from "../domain/types";
import {createNarrativeTransferShareDecision,
  type NarrativeTransferShareDecision,type TransferShareRecipient}
  from "../domain/narrative-transfer-sharing";
import {getBook,getDb} from "../infrastructure/db";

/** A new, separate author action is required to send any transfer assessment
 * to an external AI. Old permissions for knowledge quotes do not apply. */
export async function recordNarrativeTransferShareDecision(
  bookId:string,expectedUpdatedAt:string,assessmentId:string,
  status:NarrativeTransferShareDecision["status"],
  recipients:TransferShareRecipient[],rationale:string,
):Promise<void> {
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)
    throw new Error("Web Locks necessario per i consensi sulle piste.");
  await locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Il libro è già in lavorazione in un'altra scheda.");
    await locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("La sincronizzazione GitHub è in corso.");
      const book=await getBook(bookId);
      if(!book||book.updatedAt!==expectedUpdatedAt)
        throw new Error("Il libro è cambiato: aggiorna prima di modificare il consenso.");
      if(book.status==="running")throw new Error("Metti prima in pausa l'autopilot.");
      if(book.editorialCycle&&book.editorialCycle.stage!=="blocked")
        throw new Error("Concludi o blocca la redazione prima di cambiare permessi.");
      const now=new Date().toISOString();
      const decision=createNarrativeTransferShareDecision(
        book,assessmentId,status,recipients,rationale,crypto.randomUUID(),now);
      const db=await getDb(),tx=db.transaction(["books","activities","outbox"],"readwrite");
      const latest=await tx.objectStore("books").get(bookId) as typeof book|undefined;
      if(!latest||latest.updatedAt!==expectedUpdatedAt){
        await tx.done;
        throw new Error("Un'altra scheda ha modificato il libro: consenso non registrato.");
      }
      book.narrativeTransferShareDecisions=[
        ...(book.narrativeTransferShareDecisions??[]),decision];
      if(book.remote)book.remote.autoSync=false;
      book.updatedAt=new Date(Math.max(Date.now(),Date.parse(expectedUpdatedAt)+1))
        .toISOString();
      await tx.objectStore("books").put(book,bookId);
      await tx.objectStore("outbox").delete(bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",createdAt:now,endedAt:now,
        title:"Consenso sulle piste comunicative aggiornato dall'autore",
        reason:"Scelta separata per divulgazione futura o revoca.",
        nextStep:"Verifica prima di un nuovo invio: la prosa e il canone non cambiano.",
        summary:"Consenso locale aggiornato; sincronizzazione automatica disabilitata.",
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
    });
  });
}
