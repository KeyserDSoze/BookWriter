import type { Activity, BookProject } from "../domain/types";
import { acceptedRepairs, assertEditorialReviewCoverage, createEditorialCycle, repairPrompt } from "../domain/editorial-board";
import { synopsisBeforeChapter } from "../domain/editorial-summary";
import { markDownstreamContinuity } from "../domain/cross-chapter-continuity";
import { getBook, getDb } from "../infrastructure/db";

/** Explicit author action. It can reopen a frozen chapter or rescue a blocked review.
 * Work remains local and autosync disabled until every dependent chapter is frozen.
 */
export async function reopenChapterReview(bookId: string, chapterId: string, instruction = ""): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks necessario per riaprire il capitolo.");
  await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new Error("Il libro è già in lavorazione in un'altra scheda.");
    await locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outbox => {
      if (!outbox) throw new Error("La sincronizzazione GitHub è in corso.");
      const book = await getBook(bookId);
      if (!book) throw new Error("Libro non trovato.");
      if (book.status === "running") throw new Error("Metti in pausa l'autopilot.");
      if (book.editorialReviewSceneIds?.length)
        throw new Error("Conferma prima le scene fuse nel Lettore.");
      const target = book.chapters.find(ch => ch.id === chapterId);
      if (!target || !target.scenes.length || target.scenes.some(s => !s.text.trim() || s.status === "planned"))
        throw new Error("Per revisionare un capitolo servono tutte le scene scritte.");
      if (book.editorialCycle && book.editorialCycle.stage !== "blocked")
        throw new Error("Un'altra redazione è già in corso: riprendi quella o mettila in pausa.");
      if (book.editorialCycle?.stage === "blocked" && book.editorialCycle.chapterId !== chapterId)
        throw new Error("Concludi prima la redazione bloccata dell'altro capitolo.");
      if (book.editorialCycle?.stage === "blocked" && instruction.trim().length < 12)
        throw new Error("Spiega come vuoi affrontare i rilievi irrisolti (almeno 12 caratteri).");
      if (book.editorialCycle?.stage === "blocked") {
        const previous = book.editorialCycle;
        const oldChapter = book.chapters.find(ch => ch.id === previous.chapterId);
        if (oldChapter?.editorialRounds) {
          // Keep all historical rounds, even ones that did not reach consensus.
          oldChapter.editorialRounds.push(...previous.priorRounds);
          if (previous.judgment) oldChapter.editorialRounds.push({
            round: previous.round, reports: previous.reports, judgment: previous.judgment,
          });
        } else if (oldChapter) {
          oldChapter.editorialRounds = [...previous.priorRounds,
            ...(previous.judgment ? [{
              round: previous.round, reports: previous.reports, judgment: previous.judgment,
            }] : [])];
        }
      }
      if (instruction.trim()) book.authorConstraints.push(instruction.trim());
      if (book.remote) book.remote.autoSync = false;
      const dependentCount = markDownstreamContinuity(book, target, "author_reopen",
        target.scenes.map(scene => scene.id));
      target.lastContinuityReview = undefined;
      for (const ch of book.chapters) if (ch.number >= target.number) {
        ch.frozenAt = undefined;
        ch.summary = undefined;
        ch.bookSummaryAtFreeze = undefined;
      }
      book.bookSummary = synopsisBeforeChapter(book.chapters, target.number);
      book.editorialCycle = createEditorialCycle(chapterId);
      book.status = "paused";
      book.phase = "chapterReview";
      book.revision = undefined;
      book.currentSceneId = undefined;
      book.previousError = "Redazione riaperta dall'autore: sette specialisti, cinque lettori e giudice editoriale.";
      const db = await getDb();
      const tx = db.transaction(["books","activities","outbox"],"readwrite");
      const latest = await tx.objectStore("books").get(bookId) as BookProject | undefined;
      if (!latest || latest.updatedAt !== book.updatedAt) {
        await tx.done;
        throw new Error("Il libro è stato modificato mentre avviavi la review.");
      }
      const now = new Date().toISOString();
      book.updatedAt = new Date(Math.max(Date.now(),Date.parse(book.updatedAt)+1)).toISOString();
      await tx.objectStore("books").put(book,bookId);
      await tx.objectStore("outbox").delete(bookId);
      const entry: Activity = {
        id:crypto.randomUUID(),bookId,runId:crypto.randomUUID(),
        phase:"chapterReview",status:"succeeded",
        title:"Riapertura redazione capitolo",
        reason:"Richiesta esplicita dell'autore o recupero di un ciclo senza consenso.",
        nextStep:"Riprendi l'autopilot per eseguire specialisti, panel lettori e giudice.",
        summary:"Capitolo " + target.number + " riaperto; " + dependentCount +
          " capitoli successivi contrassegnati per rivalidazione di continuità.",
        createdAt:now,endedAt:now,
      };
      await tx.objectStore("activities").put(entry,entry.id);
      await tx.done;
    });
  });
}

export const MAX_EDITORIAL_RECOVERY_ARCHIVES = 8;

/** The same local gate used by the autopilot. Only a genuinely invalid,
 * unfinished active checkpoint can be rescued; a healthy review must resume.
 */
export function editorialRecoveryProblem(book: BookProject): string | undefined {
  const cycle = book.editorialCycle;
  if (book.phase !== "chapterReview" || !cycle ||
      !["review", "adjudicate", "repair", "summary"].includes(cycle.stage)) return;
  try {
    if (cycle.stage === "repair") {
      if (!cycle.judgment || cycle.judgment.verdict !== "repair")
        throw new Error("Checkpoint di remediation senza giudizio di correzione valido.");
      if (!Number.isSafeInteger(cycle.repairCursor) || cycle.repairCursor < 0)
        throw new Error("Checkpoint di remediation con cursore non valido.");
      const scenes = [...new Set(acceptedRepairs(cycle).map(fix => fix.sceneId))];
      const nextSceneId = scenes[cycle.repairCursor];
      if (!nextSceneId)
        throw new Error("Checkpoint di remediation senza prossima scena valida.");
      // Reports must match the source prose BEFORE the first rewrite. Later
      // the rewritten scenes intentionally have different text stamps: only
      // the same live repairPrompt guard used by the runner can decide
      // whether the next pending correction is still safe to apply.
      if (cycle.repairCursor === 0)
        assertEditorialReviewCoverage(book, cycle, true);
      repairPrompt(book, cycle, nextSceneId);
    } else {
      assertEditorialReviewCoverage(book, cycle, cycle.stage !== "review");
    }
    return;
  } catch (error) {
    return error instanceof Error ? error.message : "Checkpoint editoriale non valido.";
  }
}

/** Explicit author-confirmed local restart for an invalid checkpoint.
 * Keep the exact old cycle as an audit snapshot; no fake judge or freeze.
 * Writer and outbox locks + optimistic timestamp prevent cross-tab races.
 */
export async function recoverEditorialCheckpoint(bookId: string, confirmed: boolean): Promise<void> {
  if (!confirmed) throw new Error("Conferma esplicita dell'autore necessaria per recuperare la redazione.");
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks necessario per il recupero del checkpoint.");
  await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new Error("Il libro è già in lavorazione in un'altra scheda.");
    await locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outbox => {
      if (!outbox) throw new Error("La sincronizzazione GitHub è in corso.");
      const book = await getBook(bookId);
      if (!book) throw new Error("Libro non trovato.");
      if (book.status === "running") throw new Error("Metti prima in pausa l'autopilot.");
      if (book.editorialReviewSceneIds?.length)
        throw new Error("Conferma prima le scene fuse nel Lettore.");
      const reason = editorialRecoveryProblem(book);
      const previous = book.editorialCycle;
      if (!reason || !previous)
        throw new Error("Checkpoint attivo valido o fase non recuperabile: riprendi la review esistente.");
      if ((book.editorialRecoveryArchives?.length ?? 0) >= MAX_EDITORIAL_RECOVERY_ARCHIVES)
        throw new Error("Archivio dei recuperi pieno: conserva il backup ZIP e chiedi un intervento manuale.");
      const oldTimestamp = book.updatedAt;
      const now = new Date().toISOString();
      book.editorialRecoveryArchives = [...(book.editorialRecoveryArchives ?? []), {
        chapterId: previous.chapterId, archivedAt: now,
        reason: reason.slice(0, 1000), cycle: structuredClone(previous),
      }];
      book.editorialCycle = createEditorialCycle(previous.chapterId);
      book.status = "paused";
      book.phase = "chapterReview";
      book.previousError = "Checkpoint precedente archiviato. Riavvia la redazione dal primo revisore.";
      book.currentSceneId = undefined;
      if (book.remote) book.remote.autoSync = false;

      const db = await getDb();
      const tx = db.transaction(["books", "activities", "outbox"], "readwrite");
      const latest = await tx.objectStore("books").get(bookId) as BookProject | undefined;
      if (!latest || latest.updatedAt !== oldTimestamp) {
        await tx.done;
        throw new Error("Il libro è stato modificato mentre recuperavi la redazione.");
      }
      book.updatedAt = new Date(Math.max(Date.now(), Date.parse(oldTimestamp) + 1)).toISOString();
      await tx.objectStore("books").put(book, bookId);
      await tx.objectStore("outbox").delete(bookId);
      const activity: Activity = {
        id: crypto.randomUUID(), bookId, runId: crypto.randomUUID(),
        phase: "chapterReview", status: "succeeded",
        title: "Recupero supervisionato del checkpoint editoriale",
        reason: "Conferma esplicita dell'autore: checkpoint non corrente o incompleto.",
        nextStep: "Riprendi la redazione dal primo revisore; conserva il vecchio rapporto nell'archivio.",
        summary: "Tornata " + previous.round + " del capitolo " + previous.chapterId +
          " archiviata con " + previous.reports.length + " rapporti. " +
          "Autosync disabilitato; canone e capitoli congelati invariati.",
        createdAt: now, endedAt: now,
      };
      await tx.objectStore("activities").put(activity, activity.id);
      await tx.done;
    });
  });
}

