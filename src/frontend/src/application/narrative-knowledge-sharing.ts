import type {Activity} from "../domain/types";
import {createNarrativeKnowledgeShareDecision,
  type NarrativeKnowledgeShareDecision,type KnowledgeShareRecipient}
  from "../domain/narrative-knowledge-sharing";
import {getBook,getDb} from "../infrastructure/db";

/** Explicit author-only consent action. Never automatically enables sync. */
export async function recordNarrativeKnowledgeShareDecision(
  bookId:string,expectedUpdatedAt:string,knowledgeDecisionId:string,
  status:NarrativeKnowledgeShareDecision["status"],
  recipients:KnowledgeShareRecipient[],rationale:string,
):Promise<void>{
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)throw new Error("Web Locks necessario per i consensi editoriali.");
  await locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Il libro è già in lavorazione in un'altra scheda.");
    await locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("La sincronizzazione GitHub è in corso.");
      const book=await getBook(bookId);
      if(!book||book.updatedAt!==expectedUpdatedAt)
        throw new Error("Il libro è cambiato: aggiorna la pagina prima di cambiare permessi.");
      if(book.status==="running")throw new Error("Metti prima in pausa l'autopilot.");
      if(book.editorialCycle&&book.editorialCycle.stage!=="blocked")
        throw new Error("Concludi o blocca la redazione prima di modificare permessi.");
      const now=new Date().toISOString();
      const decision=createNarrativeKnowledgeShareDecision(book,knowledgeDecisionId,
        status,recipients,rationale,crypto.randomUUID(),now);
      const db=await getDb(),tx=db.transaction(["books","activities","outbox"],"readwrite");
      const latest=await tx.objectStore("books").get(bookId) as typeof book|undefined;
      if(!latest||latest.updatedAt!==expectedUpdatedAt){
        await tx.done;
        throw new Error("Un'altra scheda ha modificato il libro: consenso non salvato.");
      }
      book.narrativeKnowledgeShareDecisions=[
        ...(book.narrativeKnowledgeShareDecisions??[]),decision,
      ];
      if(book.remote)book.remote.autoSync=false;
      book.updatedAt=new Date(Math.max(Date.now(),Date.parse(expectedUpdatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      await tx.objectStore("outbox").delete(bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",title:"Consenso autore sulle conoscenze",
        reason:"Scelta locale esplicita dei destinatari editoriali o revoca.",
        nextStep:"Nessun canone aggiornato. Verifica la redazione e le autorizzazioni prima del prossimo invio AI.",
        status:"succeeded",createdAt:now,endedAt:now,
        // Private notes, quotes and role lists must not leak into activity text.
        summary:decision.status+" · scelta salvata, autosync disabilitato.",
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
    });
  });
}
