import { markHistoricalEvidenceChanged } from "../domain/cross-chapter-continuity";
import { createEditorialCycle } from "../domain/editorial-board";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import { extendWikisourceDossier, normalizeWikisourceQueries } from "../domain/wikisource-excerpts";
import type { Activity, BookProject } from "../domain/types";
import { getBook, getDb } from "../infrastructure/db";
import { searchWikisource } from "../infrastructure/wikisource";

export interface WikisourceSearchResult {
  excerptCount:number;
  missingQueries:string[];
  reopened:boolean;
}
/** Called only AFTER showing and confirming the exact author-supplied public queries. */
export async function attachWikisourceResearch(
  bookId:string,chapterId:string,expectedUpdatedAt:string,
  approvedQueries:readonly string[], signal?:AbortSignal,
):Promise<WikisourceSearchResult>{
  const queries=normalizeWikisourceQueries(approvedQueries);
  const before=await getBook(bookId);
  if(!before || before.updatedAt!==expectedUpdatedAt)
    throw new Error("Il libro è cambiato: aggiorna prima della ricerca Wikisource.");
  if(before.status==="running" || before.editorialCycle)
    throw new Error("Concludi la redazione in corso prima di aggiornare le fonti.");
  if(!before.chapters.some(ch=>ch.id===chapterId))
    throw new Error("Capitolo non disponibile.");
  // Fetch intentionally outside locks, then re-validate revision in the transaction.
  const found=await searchWikisource(queries,signal);
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)throw new Error("Web Locks obbligatorio per il dossier Wikisource.");
  return locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer)throw new Error("Il libro è già in uso da un'altra scheda.");
    return locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox)throw new Error("Sincronizzazione in corso: nessun dossier salvato.");
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const book=await tx.objectStore("books").get(bookId) as BookProject|undefined;
      if(!book || book.updatedAt!==expectedUpdatedAt ||
        book.status==="running" || book.editorialCycle){
        await tx.done;
        throw new Error("Libro modificato durante la ricerca: non è stato salvato nulla.");
      }
      const chapter=book.chapters.find(ch=>ch.id===chapterId);
      if(!chapter){await tx.done;throw new Error("Capitolo non disponibile.");}
      const now=new Date().toISOString();
      const dossier=extendWikisourceDossier(chapter.historicalDossier,queries,found,now);
      const reopened=!!chapter.frozenAt;
      const beforeSynopsis=reopened?synopsisBeforeChapter(book.chapters,chapter.number):undefined;
      chapter.historicalDossier=dossier;
      if(reopened){
        markHistoricalEvidenceChanged(book, chapter);
        for(const dependent of book.chapters)if(dependent.number>=chapter.number){
          dependent.frozenAt=undefined;
          dependent.summary=undefined;
          dependent.bookSummaryAtFreeze=undefined;
        }
        book.bookSummary=beforeSynopsis;
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
        book.currentSceneId=undefined;
        book.revision=undefined;
        book.previousError="Trascrizioni Wikisource aggiornate: rifai le review di questo capitolo e dei successivi.";
      }else if(book.status==="completed" && chapter.scenes.length &&
        chapter.scenes.every(s=>s.status==="canon" && s.text.trim())){
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
      }
      if(book.remote)book.remote.autoSync=false;
      await tx.objectStore("outbox").delete(bookId);
      book.updatedAt=new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      const activity:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        title:"Trascrizioni pubbliche Wikisource consultate con consenso",
        reason:"L'autore ha confermato le sole query inviate a Wikisource; nessun testo del romanzo è stato inviato.",
        nextStep:"Controlla il testo sulla revisione indicata, l'originale e i diritti; ripeti la review se necessario.",
        summary:found.length+" estratti di trascrizioni collaborative, "+
          dossier.wikisource!.missingQueries.length+" query senza riscontro. Non sono originali autenticati.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
      return {excerptCount:found.length,missingQueries:dossier.wikisource!.missingQueries,reopened};
    });
  });
}
