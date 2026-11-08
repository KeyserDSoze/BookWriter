import type {Activity} from "../domain/types";
import {createNarrativeKnowledgeTimingDecision,
  type KnowledgeAccessMoment,type NarrativeTemporalOrder}
  from "../domain/narrative-knowledge-timing";
import {getBook,getDb} from "../infrastructure/db";

/** Explicit author-only action, serialized with writer and sync.
 * No model call, no automatic publication or modification of canonical memory. */
export async function recordNarrativeKnowledgeTimingDecision(
  bookId:string,expectedUpdatedAt:string,knowledgeDecisionId:string,
  accessMoment:KnowledgeAccessMoment,narrativeOrder:NarrativeTemporalOrder,
  rationale:string,
):Promise<void>{
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)
    throw new Error("Web Locks necessario per aggiornare i tempi delle conoscenze.");
  await locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Il libro è già in lavorazione in un'altra scheda.");
    await locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("La sincronizzazione GitHub è in corso.");
      const book=await getBook(bookId);
      if(!book||book.updatedAt!==expectedUpdatedAt)
        throw new Error("Il libro è cambiato: aggiorna la pagina prima di annotare.");
      if(book.status==="running")throw new Error("Metti prima in pausa l'autopilot.");
      if(book.editorialCycle && book.editorialCycle.stage!=="blocked")
        throw new Error("Concludi o blocca la redazione prima di annotare la timeline.");
      const now=new Date().toISOString();
      const decision=createNarrativeKnowledgeTimingDecision(book,knowledgeDecisionId,
        accessMoment,narrativeOrder,rationale,crypto.randomUUID(),now);
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const latest=await tx.objectStore("books").get(bookId) as typeof book|undefined;
      if(!latest||latest.updatedAt!==expectedUpdatedAt){
        await tx.done;
        throw new Error("Un'altra scheda ha modificato il libro: tempo non registrato.");
      }
      book.narrativeKnowledgeTimingDecisions=[
        ...(book.narrativeKnowledgeTimingDecisions??[]),decision];
      if(book.remote)book.remote.autoSync=false;
      book.updatedAt=new Date(Math.max(Date.now(),Date.parse(expectedUpdatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      await tx.objectStore("outbox").delete(bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        title:"Tempo della conoscenza annotato dall'autore",
        reason:"Confronto fra posizione nel manoscritto e cronologia della storia.",
        nextStep:"Consulta le posizioni narrative: non sono una timeline canonica.",
        summary:"Annotazione temporale locale registrata: nessuna modifica al canone.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
    });
  });
}
