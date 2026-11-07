import { appendAuthorEventDecision, authorEventStatus,
  type AuthorEventVerdict } from "../domain/author-event-decisions";
import { createEditorialCycle } from "../domain/editorial-board";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import { markDownstreamContinuity } from "../domain/cross-chapter-continuity";
import type { NarrativeEventCandidate } from "../domain/narrative-event-candidates";
import type { Activity, BookProject } from "../domain/types";
import { getDb } from "../infrastructure/db";

/** Explicit local author decision, atomic with activity and remote-outbox hygiene.
 * A changed canonical interpretation reopens downstream review, never prose. */
export async function decideAuthorNarrativeEvent(
  bookId: string, expectedUpdatedAt: string,
  candidate: NarrativeEventCandidate, verdict: AuthorEventVerdict,
  note: string, authorConfirmed: true,
): Promise<{decisionId:string;downstreamReopened:number}> {
  if(authorConfirmed!==true)throw new Error("Serve la conferma esplicita dell'autore.");
  const locks = typeof navigator==="undefined" ? undefined : navigator.locks;
  if(!locks?.request)throw new Error("Web Locks necessario per le decisioni sul canone.");
  return locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Libro in uso da un'altra scheda.");
    return locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("Sincronizzazione remota in corso: decisione non salvata.");
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const book=await tx.objectStore("books").get(bookId) as BookProject|undefined;
      if(!book||book.updatedAt!==expectedUpdatedAt||book.status==="running"||
        !!book.editorialCycle||!!book.editorialReviewSceneIds?.length){
        await tx.done;
        throw new Error("Il libro è cambiato o una review è in corso: decisione non salvata.");
      }
      const chapter=book.chapters.find(ch=>ch.id===candidate.chapterId);
      if(!chapter?.frozenAt) {
        await tx.done;
        throw new Error("È possibile attestare solo eventi di capitoli congelati.");
      }
      const previousStatus=authorEventStatus(chapter,candidate);
      const now=new Date().toISOString();
      // Compute the prior full synopsis before changing any freeze; fail closed.
      const willChangeCanon=(previousStatus==="confirmed") !== (verdict==="confirmed");
      const priorSummary=willChangeCanon?
        synopsisBeforeChapter(book.chapters,chapter.number+1):undefined;
      const decision=appendAuthorEventDecision(chapter,candidate,verdict,note,now);
      let downstreamReopened=0;
      if(willChangeCanon){
        downstreamReopened=markDownstreamContinuity(book,chapter,
          "author_event_attestation",[candidate.sceneId]);
        for(const dependent of book.chapters){
          if(dependent.number<=chapter.number)continue;
          dependent.frozenAt=undefined;
          dependent.summary=undefined;
          dependent.bookSummaryAtFreeze=undefined;
        }
        if(downstreamReopened>0){
          book.bookSummary=priorSummary;
          const first=[...book.chapters]
            .filter(ch=>ch.number>chapter.number&&ch.scenes.some(s=>s.text.trim()))
            .sort((a,b)=>a.number-b.number)[0];
          if(first){
            book.editorialCycle=createEditorialCycle(first.id);
            book.status="paused";
            book.phase="chapterReview";
            book.currentSceneId=undefined;
            book.revision=undefined;
            book.previousError="Evento attestato dall'autore: i capitoli successivi richiedono nuova verifica.";
          }
        }
      }
      if(book.remote)book.remote.autoSync=false;
      book.updatedAt=new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      await tx.objectStore("outbox").delete(bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        createdAt:now,endedAt:now,
        title:"Decisione autore su menzione narrativa",
        reason:"Conferma esplicita dell'autore. La menzione testuale non è prova automatica di eventi reali.",
        nextStep:downstreamReopened>0
          ?"Riprendi la redazione dei capitoli successivi; non pubblicare freeze precedenti."
          :"Puoi esaminare altre menzioni. Il canone narrativo non è stato riscritto.",
        summary:"Decisione "+verdict+" su "+chapter.id+"/"+candidate.sceneId+
          " (offset "+candidate.offset+"); "+downstreamReopened+
          " capitoli successivi da rivalidare. Autosync disattivato.",
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
      return {decisionId:decision.id,downstreamReopened};
    });
  });
}
