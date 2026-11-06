import { markHistoricalEvidenceChanged } from "../domain/cross-chapter-continuity";
import { createEditorialCycle } from "../domain/editorial-board";
import { normalizeDois, extendChapterBibliography } from "../domain/bibliography";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import type { Activity, BookProject } from "../domain/types";
import { getBook, getDb } from "../infrastructure/db";
import { lookupCrossrefDois } from "../infrastructure/crossref";

export interface BibliographyLookupResult {
  sourceCount:number; missingDois:string[]; reopened:boolean;
}

/** Author-confirmed DOI-only retrieval; it never sends chapters, secrets or
 * free text from the manuscript to Crossref. */
export async function attachBibliographyToChapter(
  bookId:string, chapterId:string, expectedUpdatedAt:string,
  approvedDois:readonly string[], signal?:AbortSignal,
):Promise<BibliographyLookupResult>{
  const dois=normalizeDois(approvedDois);
  const current=await getBook(bookId);
  if(!current||current.updatedAt!==expectedUpdatedAt)
    throw new Error("Il libro è cambiato. Aggiorna la schermata prima di cercare DOI.");
  if(current.status==="running"||current.editorialCycle)
    throw new Error("Concludi o interrompi la redazione in corso prima di aggiornare la bibliografia.");
  if(!current.chapters.some(ch=>ch.id===chapterId))
    throw new Error("Capitolo non disponibile.");
  // Only the normalized DOIs are sent to api.crossref.org, and only after UI consent.
  const works=await lookupCrossrefDois(dois,signal);
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request) throw new Error("Web Locks necessario per salvare la bibliografia.");
  return locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async writer=>{
    if(!writer) throw new Error("Il libro è in uso in un'altra scheda.");
    return locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox=>{
      if(!outbox) throw new Error("Sincronizzazione GitHub in corso: bibliografia non salvata.");
      const db=await getDb();
      const tx=db.transaction(["books","activities","outbox"],"readwrite");
      const book=await tx.objectStore("books").get(bookId) as BookProject|undefined;
      if(!book||book.updatedAt!==expectedUpdatedAt||book.status==="running"||book.editorialCycle){
        await tx.done;
        throw new Error("Libro modificato durante la ricerca DOI: nessuna bibliografia applicata.");
      }
      const chapter=book.chapters.find(ch=>ch.id===chapterId);
      if(!chapter) {await tx.done;throw new Error("Capitolo non trovato.");}
      const now=new Date().toISOString();
      const dossier=extendChapterBibliography(chapter.historicalDossier,dois,works,now);
      const reopen=!!chapter.frozenAt;
      // If lossless rewind is impossible for a legacy novel, reject BEFORE writes.
      const previousSynopsis=reopen?synopsisBeforeChapter(book.chapters,chapter.number):undefined;
      chapter.historicalDossier=dossier;
      if(reopen){
        markHistoricalEvidenceChanged(book, chapter);
        for(const dependent of book.chapters) if(dependent.number>=chapter.number){
          dependent.frozenAt=undefined;
          dependent.summary=undefined;
          dependent.bookSummaryAtFreeze=undefined;
        }
        book.bookSummary=previousSynopsis;
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";
        book.phase="chapterReview";
        book.currentSceneId=undefined;
        book.revision=undefined;
        book.previousError="Bibliografia aggiornata: capitolo e successivi richiedono una nuova revisione.";
      } else if(book.status==="completed"&&chapter.scenes.length&&chapter.scenes.every(
        scene=>scene.status==="canon"&&scene.text.trim())) {
        book.editorialCycle=createEditorialCycle(chapterId);
        book.status="paused";book.phase="chapterReview";
      }
      if(book.remote) book.remote.autoSync=false;
      await tx.objectStore("outbox").delete(bookId);
      book.updatedAt=new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      const record:Activity={
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        title:"Riferimenti Crossref approvati dall'autore",
        reason:"Consultazione metadati DOI pubblici con consenso esplicito dell'autore.",
        nextStep:"Apri le pubblicazioni, verifica le fonti e ripeti la review se richiesta.",
        summary:works.length+" riferimenti con DOI; "+dossier.bibliography!.missingDois.length+
          " non trovati. Metadati NON usati come prova storica.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(record,record.id);
      await tx.done;
      return {sourceCount:works.length,missingDois:dossier.bibliography!.missingDois,
        reopened:reopen};
    });
  });
}
