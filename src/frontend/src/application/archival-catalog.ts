import { markHistoricalEvidenceChanged } from "../domain/cross-chapter-continuity";
import { createEditorialCycle } from "../domain/editorial-board";
import { extendArchiveCatalog, normalizeArchiveQueries } from "../domain/archival-catalog";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import type { Activity, BookProject } from "../domain/types";
import { getBook, getDb } from "../infrastructure/db";
import { searchLibraryOfCongress } from "../infrastructure/library-of-congress";

export interface ArchiveLookupResult {
  itemCount: number;
  missingQueries: string[];
  reopened: boolean;
}

/** Called ONLY after the author sees and confirms each public search string. */
export async function attachArchiveCatalog(
  bookId: string, chapterId: string, expectedUpdatedAt: string,
  approvedQueries: readonly string[], signal?: AbortSignal,
): Promise<ArchiveLookupResult> {
  const queries = normalizeArchiveQueries(approvedQueries);
  const current = await getBook(bookId);
  if (!current || current.updatedAt !== expectedUpdatedAt)
    throw new Error("Il libro è cambiato: ricarica prima della ricerca archivistica.");
  if (current.status === "running" || current.editorialCycle)
    throw new Error("Concludi la redazione attiva prima di aggiornare gli archivi.");
  if (!current.chapters.some(ch => ch.id === chapterId))
    throw new Error("Capitolo non disponibile.");
  // These strings come solely from the author-confirmed input, not from private canon.
  const found = await searchLibraryOfCongress(queries, signal);
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks necessario per salvare il catalogo.");
  return locks.request("bookwriter:writer:" + bookId,{ifAvailable:true},async writer => {
    if (!writer) throw new Error("Il libro è già in uso da un'altra scheda.");
    return locks.request("bookwriter:github-outbox",{ifAvailable:true},async outbox => {
      if (!outbox) throw new Error("Sincronizzazione in corso: catalogo non salvato.");
      const db = await getDb();
      const tx = db.transaction(["books","activities","outbox"],"readwrite");
      const book = await tx.objectStore("books").get(bookId) as BookProject | undefined;
      if (!book || book.updatedAt !== expectedUpdatedAt ||
          book.status === "running" || book.editorialCycle) {
        await tx.done;
        throw new Error("Il libro è stato modificato durante la ricerca: catalogo non applicato.");
      }
      const chapter=book.chapters.find(ch => ch.id === chapterId);
      if (!chapter) { await tx.done;throw new Error("Capitolo non trovato."); }
      const now=new Date().toISOString();
      const dossier=extendArchiveCatalog(chapter.historicalDossier,queries,found,now);
      const reopened=!!chapter.frozenAt;
      // Validate the previous synopsis BEFORE any mutations or outbox removal.
      const priorSynopsis=reopened?synopsisBeforeChapter(book.chapters,chapter.number):undefined;
      chapter.historicalDossier=dossier;
      if (reopened) {
        markHistoricalEvidenceChanged(book, chapter);
        for (const later of book.chapters) if (later.number>=chapter.number) {
          later.frozenAt=undefined;
          later.summary=undefined;
          later.bookSummaryAtFreeze=undefined;
        }
        book.bookSummary=priorSynopsis;
        book.editorialCycle=createEditorialCycle(chapterId);
        book.phase="chapterReview";
        book.status="paused";
        book.currentSceneId=undefined;
        book.revision=undefined;
        book.previousError="Catalogo archivistico aggiornato: ripeti la redazione del capitolo e dei successivi.";
      } else if (book.status==="completed" && chapter.scenes.length &&
          chapter.scenes.every(scene => scene.status==="canon" && scene.text.trim())) {
        book.editorialCycle=createEditorialCycle(chapterId);
        book.phase="chapterReview";
        book.status="paused";
      }
      if (book.remote) book.remote.autoSync=false;
      await tx.objectStore("outbox").delete(bookId);
      book.updatedAt=new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      const activity: Activity = {
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        title:"Catalogo archivistico autorizzato dall'autore",
        reason:"Ricerca di sole query approvate nel catalogo pubblico Library of Congress.",
        nextStep:"Consulta i documenti digitalizzati e verifica contenuto, provenienza e diritti; riesegui la redazione se necessario.",
        summary:found.length+" schede archivistiche; "+dossier.archiveCatalog!.missingQueries.length+
          " ricerche senza riscontri. Le schede non costituiscono prove testuali.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(activity,activity.id);
      await tx.done;
      return {
        itemCount:found.length,
        missingQueries:dossier.archiveCatalog!.missingQueries,
        reopened,
      };
    });
  });
}
