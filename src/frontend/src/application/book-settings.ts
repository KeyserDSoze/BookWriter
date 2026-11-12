import type { TaskKind, TaskReasoning } from "../domain/types";
import { validateTaskReasoning } from "../domain/task-reasoning";
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

/** Manual book-level override with writer Web Lock and optimistic book CAS. */
export async function updateBookTaskReasoning(
  bookId:string,expectedUpdatedAt:string,task:TaskKind,
  reasoning:TaskReasoning|undefined,
):Promise<void>{
  if(reasoning!==undefined)validateTaskReasoning(reasoning);
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)throw new Error("Web Locks non disponibile: modifica reasoning bloccata.");
  await locks.request("bookwriter:writer:"+bookId,{ifAvailable:true},async lock=>{
    if(!lock)throw new Error("Un'altra scheda sta scrivendo questo libro: metti in pausa prima di modificare il reasoning.");
    const stored=await getBook(bookId);
    if(!stored || stored.updatedAt!==expectedUpdatedAt)throw new BookRevisionConflict();
    if(stored.status==="running")throw new Error("Metti prima in pausa l'autopilot e ricarica il libro.");
    const next=structuredClone(stored);
    const current={...next.taskReasoningEfforts};
    if(reasoning===undefined)delete current[task];
    else current[task]=reasoning;
    next.taskReasoningEfforts=current;
    await saveBook(next,true,expectedUpdatedAt);
  });
}
