import type { Activity, BookProject } from "../domain/types";
import { BookRevisionConflict, getBookForMutation as getBook, saveBookWithAuthorActivity, withExclusiveLock } from "../core/store";

export type AuthorActivity = Pick<Activity, "title" | "reason" | "nextStep"> & { summary?: string };

const withAuthorLock = <T>(bookId: string, action: () => Promise<T>): Promise<T> =>
  withExclusiveLock("bookwriter:author:" + bookId, {
    unsupported: "Web Locks non disponibile: modifica bloccata per evitare scritture concorrenti.",
    busy: "Stai già salvando una modifica di questo libro in un'altra scheda: riprova fra un attimo.",
  }, action);
function auditOf(book: BookProject, activity: AuthorActivity, now: string): Activity {
  return { id: crypto.randomUUID(), bookId: book.id, runId: crypto.randomUUID(), phase: book.phase, status: "succeeded",
    aiRequested: false, createdAt: now, endedAt: now, ...activity };
}

/** Author-side mutation that is allowed while the autopilot works.
 * The author's change always wins: it is CAS-checked against the revision the
 * author saw, in the same IndexedDB transaction as its audit entry. A running
 * task that read an older revision discards its reply and redoes the step
 * (the runner checks the revision before committing). No AI call is made here.
 * A per-book author lock serialises edits typed in several tabs. */
export async function mutateAsAuthor(
  bookId: string, expectedUpdatedAt: string, activity: AuthorActivity,
  change: (book: BookProject, now: string) => void,
): Promise<BookProject> {
  if (!expectedUpdatedAt) throw new BookRevisionConflict();
  return withAuthorLock(bookId, async () => {
    const book = await getBook(bookId);
    if (!book) throw new Error("Libro non trovato.");
    if (book.updatedAt !== expectedUpdatedAt) throw new BookRevisionConflict();
    const now = new Date().toISOString();
    change(book, now);
    await saveBookWithAuthorActivity(book, auditOf(book, activity, now), expectedUpdatedAt);
    return book;
  });
}

/** Like mutateAsAuthor, but guarded by what the change itself checks (an element's
 * content stamp, a review still active…) instead of the whole book's revision: the
 * autopilot may commit elsewhere in the book meanwhile. The read-check-change-save
 * sequence is CAS-protected and retried on a concurrent commit, never merged blindly. */
export async function mutateCurrentAsAuthor<R>(
  bookId: string, activity: AuthorActivity | ((result: R, book: BookProject) => AuthorActivity),
  change: (book: BookProject, now: string) => R,
): Promise<{ book: BookProject; result: R }> {
  return withAuthorLock(bookId, async () => {
    for (let attempt = 0; ; attempt++) {
      const book = await getBook(bookId);
      if (!book) throw new Error("Libro non trovato.");
      const token = book.updatedAt;
      const now = new Date().toISOString();
      const result = change(book, now);
      const audit = typeof activity === "function" ? activity(result, book) : activity;
      try {
        await saveBookWithAuthorActivity(book, auditOf(book, audit, now), token);
        return { book, result };
      } catch (error) {
        if (!(error instanceof BookRevisionConflict) || attempt >= 4) throw error;
      }
    }
  });
}
