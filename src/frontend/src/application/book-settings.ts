import type { TaskKind } from "../domain/types";
import { BookRevisionConflict, getBook, saveBook } from "../infrastructure/db";

/**
 * Manual per-book model routing must never save a stale whole-book snapshot.
 * Coordinate with the AI writer in other tabs and compare the book revision
 * again inside saveBook's IndexedDB books+outbox transaction.
 *
 * This is local fencing only: GitHub lease + SHA conflict handling still
 * govern cross-device canonical synchronization.
 */
export async function updateBookModelRoute(
  bookId: string, expectedUpdatedAt: string,
  task: TaskKind, endpointId: string, modelId: string,
): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request)
    throw new Error("Web Locks non disponibile: modifica modello bloccata per evitare scritture concorrenti.");
  await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async lock => {
    if (!lock)
      throw new Error("Un'altra scheda sta scrivendo questo libro: riprova quando l'autopilot è fermo.");
    const stored = await getBook(bookId);
    if (!stored || stored.updatedAt !== expectedUpdatedAt)
      throw new BookRevisionConflict();
    if (stored.status === "running")
      throw new Error("Metti prima in pausa l'autopilot e ricarica il libro.");
    const next = structuredClone(stored);
    next.modelRoutes = {
      ...next.modelRoutes, [task]: { endpointId, modelId },
    };
    // Compare inside IndexedDB again: a non-cooperating writer or sync
    // may have committed after getBook, despite the Web Lock.
    await saveBook(next, true, expectedUpdatedAt);
  });
}
