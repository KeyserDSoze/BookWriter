import type { Activity } from "../domain/types";
import { createNarrativeAliasDecision, type NarrativeAliasDecision }
  from "../domain/narrative-alias-decisions";
import { getBook, getDb } from "../infrastructure/db";

/** Author-only annotation, not an identity fact or automatic change to narrative memory. */
export async function recordNarrativeAliasDecision(
  bookId: string, expectedUpdatedAt: string,
  firstName: string, secondName: string,
  verdict: NarrativeAliasDecision["verdict"], rationale: string,
): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks necessario per annotare alias.");
  await locks.request("bookwriter:writer:" + bookId, {ifAvailable:true}, async writer => {
    if (!writer) throw new Error("Il libro è già in lavorazione in un'altra scheda.");
    await locks.request("bookwriter:github-outbox", {ifAvailable:true}, async outbox => {
      if (!outbox) throw new Error("La sincronizzazione GitHub è in corso.");
      const book = await getBook(bookId);
      if (!book || book.updatedAt !== expectedUpdatedAt)
        throw new Error("Il libro è cambiato: aggiorna la pagina prima di decidere.");
      if (book.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
      if (book.editorialCycle && book.editorialCycle.stage !== "blocked")
        throw new Error("Concludi o blocca la redazione prima di annotare alias.");
      const now = new Date().toISOString();
      const decision = createNarrativeAliasDecision(book,firstName,secondName,verdict,rationale,
        crypto.randomUUID(),now);
      const db = await getDb();
      const tx = db.transaction(["books","activities","outbox"],"readwrite");
      const latest = await tx.objectStore("books").get(bookId) as typeof book | undefined;
      if (!latest || latest.updatedAt !== expectedUpdatedAt) {
        await tx.done;
        throw new Error("Un'altra scheda ha modificato il libro: decisione non salvata.");
      }
      book.narrativeAliasDecisions = [...(book.narrativeAliasDecisions ?? []),decision];
      if (book.remote) book.remote.autoSync = false;
      book.updatedAt = new Date(Math.max(Date.now(),Date.parse(expectedUpdatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      await tx.objectStore("outbox").delete(bookId);
      const activity: Activity = {
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",title:"Decisione autore su possibile alias",
        reason:"Confronto motivato di due nomi ancorato ad attestazioni correnti.",
        nextStep:"Controllare le tracce consultive; il canone si modifica solo in una revisione separata.",
        status:"succeeded",createdAt:now,endedAt:now,
        summary:decision.verdict+" · "+decision.firstName+" / "+decision.secondName+
          " · attestazioni "+decision.firstEventDecisionId+" / "+decision.secondEventDecisionId+
          " (nessuna modifica al canone).",
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
    });
  });
}
