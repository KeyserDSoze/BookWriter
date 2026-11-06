import { createEditorialCycle } from "../domain/editorial-board";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import { activeWikisourceExcerpts } from "../domain/wikisource-excerpts";
import type { Activity, BookProject } from "../domain/types";
import { getDb } from "../infrastructure/db";

/** Explicit author decision AFTER remote mismatch. This does not delete source
 * snapshots or old reports, but removes the compromised ID from future review.
 * No network call takes place in this transaction.
 */
export async function quarantineWikisourceSource(
  bookId:string, chapterId:string, expectedUpdatedAt:string, sourceId:string,
):Promise<{reopened:boolean}>{
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)throw new Error("Web Locks necessario per escludere la fonte Wikisource.");
  return locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Il libro è già in uso da un'altra scheda.");
    return locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("Sincronizzazione in corso: impossibile escludere la fonte.");
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const book=await tx.objectStore("books").get(bookId) as BookProject|undefined;
      if(!book || book.updatedAt!==expectedUpdatedAt || book.status==="running" ||
        !!book.editorialCycle){
        await tx.done;
        throw new Error("Libro modificato o redazione in corso: fonte non esclusa.");
      }
      const chapter=book.chapters.find(ch=>ch.id===chapterId);
      const d=chapter?.historicalDossier?.wikisource;
      if(!chapter || !d || !activeWikisourceExcerpts(chapter.historicalDossier)
        .some(item=>item.id===sourceId)){
        await tx.done;
        throw new Error("La fonte Wikisource non è più attiva: aggiorna il capitolo.");
      }
      const reopened=!!chapter.frozenAt;
      const oldSynopsis=reopened?synopsisBeforeChapter(book.chapters,chapter.number):undefined;
      d.activeExcerptIds=d.activeExcerptIds.filter(id=>id!==sourceId);
      if(reopened){
        for(const dependent of book.chapters)if(dependent.number>=chapter.number){
          dependent.frozenAt=undefined;
          dependent.summary=undefined;
          dependent.bookSummaryAtFreeze=undefined;
        }
        book.bookSummary=oldSynopsis;
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
        book.currentSceneId=undefined;
        book.revision=undefined;
        book.previousError="Fonte Wikisource esclusa per anomalia di provenienza: rivedi capitolo e successivi.";
      }else if(book.status==="completed" && chapter.scenes.length &&
          chapter.scenes.every(scene=>scene.status==="canon" && scene.text.trim())){
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
      }
      if(book.remote)book.remote.autoSync=false;
      await tx.objectStore("outbox").delete(bookId);
      const now=new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      book.updatedAt=now;
      await tx.objectStore("books").put(book,bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        title:"Fonte Wikisource esclusa dalla redazione",
        reason:"L'autore ha confermato l'esclusione dopo una verifica remota discordante. Nessun testo o riferimento storico eliminato.",
        nextStep:"Esamina l'originale, riacquisisci un'altra revisione con consenso e ripeti la review.",
        summary:"ID "+sourceId+" ritirato dalle fonti attive. Snapshot preservato per audit. Non implica che il documento storico sia falso.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
      return {reopened};
    });
  });
}
