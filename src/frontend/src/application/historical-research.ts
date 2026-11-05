import { createEditorialCycle } from "../domain/editorial-board";
import { extendHistoricalDossier, normalizeResearchQueries, type HistoricalSource } from "../domain/historical-research";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import type { BookProject, Activity } from "../domain/types";
import { searchHistoricalWikipedia } from "../infrastructure/historical-sources";
import { getBook, getDb } from "../infrastructure/db";

export interface HistoricalSearchResult {
  sourceCount: number; missingQueries: string[]; restartedReview: boolean;
}

/** The UI must explicitly show and confirm the exact public search strings
 * before calling this use case. Never derive queries from a manuscript.
 */
export async function researchHistoricalChapter(
  bookId: string, chapterId: string, originalRevision: string,
  authorQueries: readonly string[], signal?: AbortSignal,
): Promise<HistoricalSearchResult> {
  const queries = normalizeResearchQueries(authorQueries);
  const before = await getBook(bookId);
  if (!before || before.updatedAt !== originalRevision)
    throw new Error("Il libro è cambiato. Aggiorna la schermata prima di cercare fonti.");
  if (before.status === "running" || before.editorialCycle)
    throw new Error("Concludi o interrompi il ciclo editoriale attivo prima di aggiornare le fonti.");
  if (!before.chapters.some(ch => ch.id === chapterId))
    throw new Error("Capitolo non disponibile.");
  // External fetch happens only after the author confirms the query set.
  const retrieved = await searchHistoricalWikipedia(queries, signal);
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks necessario per il salvataggio delle fonti.");
  return locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Il libro è già in scrittura da un'altra scheda.");
    return locks.request("bookwriter:github-outbox", { ifAvailable: true }, async sync => {
      if (!sync) throw new Error("Sincronizzazione GitHub in corso; dossier non salvato.");
      const db = await getDb();
      const tx = db.transaction(["books", "activities", "outbox"], "readwrite");
      const book = await tx.objectStore("books").get(bookId) as BookProject | undefined;
      if (!book || book.updatedAt !== originalRevision || book.status === "running" || book.editorialCycle) {
        tx.abort();
        throw new Error("Libro modificato durante la ricerca: il dossier non è stato applicato.");
      }
      const chapter = book.chapters.find(ch => ch.id === chapterId);
      if (!chapter) { tx.abort(); throw new Error("Capitolo non disponibile."); }
      const searchedAt = new Date().toISOString();
      const dossier = extendHistoricalDossier(chapter.historicalDossier, queries, retrieved, searchedAt);
      // Recompute the previous public synopsis BEFORE invalidating any freeze.
      const restart = !!chapter.frozenAt;
      const priorSynopsis = restart ? synopsisBeforeChapter(book.chapters, chapter.number) : undefined;
      chapter.historicalDossier = dossier;
      // New evidence invalidates previously frozen approval (and later chapters).
      if (restart) {
        for (const later of book.chapters) if (later.number >= chapter.number) {
          later.frozenAt = undefined;
          later.summary = undefined;
          later.bookSummaryAtFreeze = undefined;
        }
        book.bookSummary = priorSynopsis;
        book.editorialCycle = createEditorialCycle(chapterId);
        book.phase = "chapterReview";
        book.status = "paused";
        book.currentSceneId = undefined;
        book.previousError = "Fonti storiche aggiornate: capitolo e successivi devono essere rivalutati dalla redazione.";
      } else if (book.status === "completed" && chapter.scenes.length &&
        chapter.scenes.every(scene => scene.status === "canon" && scene.text.trim())) {
        book.editorialCycle = createEditorialCycle(chapterId);
        book.phase = "chapterReview";
        book.status = "paused";
      }
      if (book.remote) book.remote.autoSync = false;
      await tx.objectStore("outbox").delete(bookId);
      book.updatedAt = new Date(Math.max(Date.now(), Date.parse(book.updatedAt) + 1)).toISOString();
      await tx.objectStore("books").put(book, bookId);
      const activity: Activity = {
        id: crypto.randomUUID(), bookId, runId: crypto.randomUUID(),
        phase: "chapterReview", status: "succeeded",
        title: "Ricerca storica approvata dall'autore",
        reason: "Consultazione esterna di sole query storiche pubbliche confermate dall'autore.",
        nextStep: "Rivedi estratti e fonti; riprendi la redazione del capitolo quando necessario.",
        summary: retrieved.length + " riferimenti enciclopedici salvati. " +
          dossier.unansweredQueries.length + " ricerche senza risultato; non sono fatti storici certificati.",
        createdAt: searchedAt, endedAt: searchedAt,
      };
      await tx.objectStore("activities").put(activity, activity.id);
      await tx.done;
      return {
        sourceCount: retrieved.length, missingQueries: dossier.unansweredQueries,
        restartedReview: restart,
      };
    });
  });
}
