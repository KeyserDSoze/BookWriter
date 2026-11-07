import type { Activity } from "../domain/types";
import { createNarrativeKnowledgeDecision,
  type NarrativeKnowledgeDecision } from "../domain/narrative-knowledge-decisions";
import { getBook,getDb } from "../infrastructure/db";

/** Explicit local author action. No AI calls, canon update, or automatic push. */
export async function recordNarrativeKnowledgeDecision(
  bookId:string,expectedUpdatedAt:string,sourceEventDecisionId:string,
  verdict:NarrativeKnowledgeDecision["verdict"],rationale:string,
):Promise<void>{
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if (!locks?.request) throw new Error("Web Locks necessario per annotare le conoscenze.");
  await locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Il libro è già in lavorazione in un'altra scheda.");
    await locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("La sincronizzazione GitHub è in corso.");
      const book=await getBook(bookId);
      if(!book || book.updatedAt!==expectedUpdatedAt)
        throw new Error("Il libro è cambiato: aggiorna la pagina prima di decidere.");
      if(book.status==="running")throw new Error("Metti prima in pausa l'autopilot.");
      if(book.editorialCycle && book.editorialCycle.stage!=="blocked")
        throw new Error("Concludi o blocca la redazione prima di annotare le conoscenze.");
      const now=new Date().toISOString();
      const decision=createNarrativeKnowledgeDecision(book,sourceEventDecisionId,
        verdict,rationale,crypto.randomUUID(),now);
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const latest=await tx.objectStore("books").get(bookId) as typeof book|undefined;
      if(!latest || latest.updatedAt!==expectedUpdatedAt){
        await tx.done;
        throw new Error("Un'altra scheda ha modificato il libro: conoscenza non salvata.");
      }
      book.narrativeKnowledgeDecisions=[...(book.narrativeKnowledgeDecisions??[]),decision];
      if(book.remote)book.remote.autoSync=false;
      book.updatedAt=new Date(Math.max(Date.now(),Date.parse(expectedUpdatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      await tx.objectStore("outbox").delete(bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",title:"Interpretazione autore su conoscenza",
        reason:"Classificazione motivata di una menzione attestata e ancora congelata.",
        nextStep:"Consultare il registro privato. Nessun canone o segreto è stato aggiornato.",
        status:"succeeded",createdAt:now,endedAt:now,
        // Keep author rationale/private secret wording OUT of activity logs.
        summary:decision.verdict+" · fonte "+decision.sourceEventDecisionId+
          " (nessuna modifica al canone, nessuna richiesta AI).",
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
    });
  });
}
