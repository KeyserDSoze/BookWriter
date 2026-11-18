import type { Activity } from "../domain/types";
import { forceCloseCycle } from "../domain/editorial-board";
import type { BlockedReviewDraft, ItemChoice } from "../domain/blocked-review";
import { emptyDraft } from "../domain/blocked-review";
import { BookRevisionConflict, getBook, getDb, saveBookAndActivity } from "../infrastructure/db";

const CHOICES: readonly ItemChoice[] = ["follow_director", "accept_as_is", "custom"];
const draftKey = (bookId: string, chapterId: string, round: number) => `blocked-review:v1:${bookId}:${chapterId}:${round}`;

/** Parse a stored draft defensively: anything unexpected is treated as «no draft». */
function parseDraft(value: unknown, chapterId: string, round: number): BlockedReviewDraft | undefined {
  if (!value || typeof value !== "object") return;
  const raw = value as Record<string, unknown>;
  if (raw.chapterId !== chapterId || raw.round !== round || typeof raw.generalNote !== "string" ||
      typeof raw.updatedAt !== "string" || !raw.decisions || typeof raw.decisions !== "object") return;
  const decisions: BlockedReviewDraft["decisions"] = {};
  for (const [id, entry] of Object.entries(raw.decisions as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const { choice, note } = entry as Record<string, unknown>;
    if (typeof note !== "string" || !CHOICES.includes(choice as ItemChoice)) continue;
    decisions[id] = { choice: choice as ItemChoice, note };
  }
  return { chapterId, round, decisions, generalNote: raw.generalNote, updatedAt: raw.updatedAt };
}

/** Work in progress stays on THIS device (never in the ZIP, GitHub or the cloud profile). */
export async function loadBlockedDraft(bookId: string, chapterId: string, round: number): Promise<BlockedReviewDraft> {
  const db = await getDb();
  const stored = await db.get("meta", draftKey(bookId, chapterId, round));
  return parseDraft(stored, chapterId, round) ?? emptyDraft(chapterId, round);
}

export async function saveBlockedDraft(bookId: string, draft: BlockedReviewDraft): Promise<BlockedReviewDraft> {
  const saved = { ...draft, updatedAt: new Date().toISOString() };
  const db = await getDb();
  await db.put("meta", saved, draftKey(bookId, draft.chapterId, draft.round));
  return saved;
}

export async function clearBlockedDraft(bookId: string, chapterId: string, round: number): Promise<void> {
  const db = await getDb();
  await db.delete("meta", draftKey(bookId, chapterId, round));
}

/** Explicit author decision: close the blocked chapter WITHOUT another verification round.
 * The note is recorded on the cycle, the chapter (once frozen) and the activity log. */
export async function closeBlockedChapterByAuthor(bookId: string, expectedUpdatedAt: string, note: string): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks necessario per chiudere il capitolo.");
  await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new Error("Il libro è già in lavorazione in un'altra scheda.");
    await locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outbox => {
      if (!outbox) throw new Error("La sincronizzazione GitHub è in corso.");
      const book = await getBook(bookId);
      if (!book) throw new Error("Libro non trovato.");
      if (book.updatedAt !== expectedUpdatedAt) throw new BookRevisionConflict();
      if (book.status === "running") throw new Error("Metti in pausa l'autopilot.");
      const cycle = book.editorialCycle;
      if (!cycle || cycle.stage !== "blocked") throw new Error("La redazione non è bloccata.");
      const chapter = book.chapters.find(ch => ch.id === cycle.chapterId);
      const now = new Date().toISOString();
      const clean = note.trim() || "Chiuso dall'autore senza un'altra tornata di verifica.";
      forceCloseCycle(cycle, "author", clean, now);
      book.status = "paused";
      book.previousError = "Capitolo chiuso dall'autore senza altra verifica: riprendi l'autopilot per la sinossi e il congelamento.";
      const entry: Activity = {
        id: crypto.randomUUID(), bookId, runId: crypto.randomUUID(), phase: "chapterReview", status: "succeeded",
        title: "Capitolo " + (chapter?.number ?? "") + " chiuso dall'autore",
        reason: "L'autore ha deciso di non rifare la tornata di revisione e di congelare il capitolo.",
        nextStep: "Riprendi l'autopilot: sinossi del capitolo e congelamento, poi il capitolo successivo.",
        summary: clean.length > 340 ? clean.slice(0, 337) + "…" : clean,
        aiRequested: false, createdAt: now, endedAt: now,
      };
      await saveBookAndActivity(book, entry, expectedUpdatedAt);
    });
  });
}
