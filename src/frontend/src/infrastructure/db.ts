import { openDB, type IDBPDatabase } from "idb";
import type { Activity, AppSettings, BookProject } from "../domain/types";
import { DEFAULT_SETTINGS } from "../domain/types";
import { enqueueCheckpoint } from "./outbox";
import { createTaskStructuralCheckpoint } from "../domain/task-structural-checkpoint";
import { createTaskProseCheckpoint } from "../domain/task-prose-checkpoint";
import { taskProseConsentKey, taskProseKey, taskProseUsageKey } from "./task-prose-checkpoint";
import { taskProseLimitKey } from "./task-prose-storage";
import {
  taskBookConsentKey, taskBookKey, taskBookUsageKey,
} from "./task-book-checkpoint";
import {
  createTaskBookCheckpoint, estimatedTaskBookBytes,
  TASK_BOOK_PAIR_LIMIT_BYTES, TASK_BOOK_TOTAL_LIMIT_BYTES,
  TaskBookStorageLimitExceeded, validTaskBookUsage,
} from "../domain/task-book-checkpoint";
import {
  estimateProsePayloadBytes, TaskProseQuotaExceeded, PROSE_MIB,
  validProseLimitMiB, validTaskProseUsageLedger,
  type TaskProseUsageLedger,
} from "../domain/task-prose-storage";

const DB_NAME = "bookwriter";
const DB_VERSION = 2;
let database: Promise<IDBPDatabase> | undefined;

function revisionTimestamp(previous?: BookProject): string {
  const previousTime = previous ? Date.parse(previous.updatedAt) : NaN;
  // Strictly monotonic even for multiple writes during the same millisecond.
  const milliseconds = Number.isFinite(previousTime) ? Math.max(Date.now(), previousTime + 1) : Date.now();
  return new Date(milliseconds).toISOString();
}

export function getDb(): Promise<IDBPDatabase> {
  database ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      for (const store of ["books", "activities", "settings", "meta", "outbox", "mergeDrafts"]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    },
  });
  return database;
}

export async function loadSettings(): Promise<AppSettings> {
  const db = await getDb();
  const stored = (await db.get("settings", "global")) as AppSettings | undefined;
  return stored ?? structuredClone(DEFAULT_SETTINGS);
}

export async function saveSettings(
  settings: AppSettings, isCurrent?: () => boolean,
): Promise<void> {
  const db = await getDb();
  // Recheck after opening IndexedDB; no await between fence and put.
  if (isCurrent && !isCurrent())
    throw new Error("Impostazioni cambiate durante il salvataggio: nessuna scrittura eseguita.");
  await db.put("settings", settings, "global");
}

export async function listBooks(): Promise<BookProject[]> {
  const db = await getDb();
  const all = (await db.getAll("books")) as BookProject[];
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBook(id: string): Promise<BookProject | undefined> {
  const db = await getDb();
  return (await db.get("books", id)) as BookProject | undefined;
}

/** A manual editor is submitting a snapshot that is no longer current. */
export class BookRevisionConflict extends Error {
  constructor() {
    super("Il libro è cambiato in un'altra scheda: aggiorna i dati prima di salvare.");
    this.name = "BookRevisionConflict";
  }
}

export async function saveBook(
  book: BookProject, queueSync = true, expectedUpdatedAt?: string,
): Promise<void> {
  const db = await getDb();
  // The read, revision comparison, book update and optional outbox enqueue
  // share one IndexedDB readwrite transaction: no stale snapshot can win
  // between the revision check and the actual save.
  const tx = db.transaction(["books", "outbox"], "readwrite");
  const books = tx.objectStore("books");
  const stored = await books.get(book.id) as BookProject | undefined;
  if (expectedUpdatedAt !== undefined && stored?.updatedAt !== expectedUpdatedAt) {
    await tx.done; // Commit an unchanged transaction, without touching outbox.
    throw new BookRevisionConflict();
  }
  book.updatedAt = revisionTimestamp(stored);
  await books.put(book, book.id);
  if (queueSync) await enqueueCheckpoint(book, tx.objectStore("outbox"));
  await tx.done;
}

export async function saveActivity(activity: Activity): Promise<void> {
  const db = await getDb();
  await db.put("activities", activity, activity.id);
}

export async function saveBookAndActivity(
  book: BookProject, activity: Activity, expectedUpdatedAt?: string,
): Promise<void> {
  const db = await getDb();
  // An editorial approval must not commit a stale canon AND a false audit.
  // Check the optional precondition in the SAME readwrite transaction that
  // writes the book, its activity, and potentially a sync checkpoint.
  const tx = db.transaction(["books", "activities", "outbox", "meta"], "readwrite");
  // A duplicate checkpoint ID rejects both the add request and tx.done.
  // Observe the transaction abort immediately, while propagating the request
  // error and ensuring no partial canon/audit/outbox commit becomes visible.
  void tx.done.catch(() => {});
  const books = tx.objectStore("books");
  const stored = await books.get(book.id) as BookProject | undefined;
  if (expectedUpdatedAt !== undefined && stored?.updatedAt !== expectedUpdatedAt) {
    await tx.done; // Read-only transaction: no book, activity or outbox writes.
    throw new BookRevisionConflict();
  }
  book.updatedAt = revisionTimestamp(stored);
  await books.put(book, book.id);
  await tx.objectStore("activities").put(activity, activity.id);
  // A structural witness is committed atomically with the canon+activity.
  // Only a new successful task with an existing book qualifies. The IDB
  // "add" rejects duplicate task IDs, preventing silent history rewrites.
  // No prose, memory, prompts, reasoning or secrets are copied.
  if (activity.status === "succeeded" && stored &&
      activity.bookId === book.id) {
    const meta = tx.objectStore("meta");
    await meta.add(createTaskStructuralCheckpoint(stored, book, activity),
      "task-structure:v1:" + activity.id);
    // Explicit consent is read inside the very same transaction as the
    // structural witness, book, audit and outbox. An opt-out serializes here.
    if ((await meta.get(taskProseConsentKey(book.id))) === true) {
      try {
        const prose = createTaskProseCheckpoint(stored, book, activity);
        const rawLimit = await meta.get(taskProseLimitKey(book.id)) as unknown;
        const rawLedger = await meta.get(taskProseUsageKey(book.id)) as unknown;
        if (rawLimit !== undefined && !validProseLimitMiB(rawLimit))
          throw new Error("Limite delle copie locali non valido: nessun risultato applicato.");
        if (rawLedger !== undefined && !validTaskProseUsageLedger(rawLedger,book.id))
          throw new Error("Indice dello spazio locale non verificabile: nessun risultato applicato.");
        const incoming = estimateProsePayloadBytes(prose);
        let ledger: TaskProseUsageLedger | null =
          rawLedger === undefined ? null : rawLedger as TaskProseUsageLedger;
        // A configured cap initializes its exact payload ledger once (legacy
        // copies included). Subsequent task commits update it in O(1).
        // The read and the write remain in the same IDB transaction as canon.
        if (rawLimit !== undefined && ledger === null) {
          const prefix = taskProseKey(book.id,"");
          let cursor = await meta.openCursor(IDBKeyRange.bound(prefix,prefix+"\uffff"));
          let estimatedBytes = 0, records = 0;
          while(cursor){
            estimatedBytes += estimateProsePayloadBytes(cursor.value);
            records++;
            cursor = await cursor.continue();
          }
          ledger={schemaVersion:1,bookId:book.id,estimatedBytes,records};
        }
        const total = (ledger?.estimatedBytes??0)+incoming;
        if (rawLimit !== undefined && total > rawLimit * PROSE_MIB)
          throw new TaskProseQuotaExceeded(total,rawLimit);
        await meta.add(prose,taskProseKey(book.id,activity.id));
        if (ledger) await meta.put({...ledger,estimatedBytes:total,
          records:ledger.records+1},taskProseUsageKey(book.id));
      } catch (error) {
        // An app-level quota error is not an IndexedDB request failure:
        // explicitly abort so earlier book/audit/structure puts cannot commit.
        try { tx.abort(); } catch { /* an IDB request may already have aborted */ }
        throw error;
      }
    }
    // Separate, explicit opt-in for WHOLE narrative BookProject pre/post.
    // This is not the narrower canonical-prose consent (#167). All checks
    // and the ledger update occur in the same IDB transaction as book/audit.
    if ((await meta.get(taskBookConsentKey(book.id))) === true) {
      try {
        const checkpoint=createTaskBookCheckpoint(stored,book,activity);
        const incoming=estimatedTaskBookBytes(checkpoint);
        if(incoming>TASK_BOOK_PAIR_LIMIT_BYTES)
          throw new TaskBookStorageLimitExceeded(incoming,TASK_BOOK_PAIR_LIMIT_BYTES);
        const ledger=await meta.get(taskBookUsageKey(book.id)) as unknown;
        if(!validTaskBookUsage(ledger,book.id))
          throw new Error("Contatore checkpoint narrativi non verificabile: task rifiutato.");
        const total=ledger.estimatedBytes+incoming;
        if(total>TASK_BOOK_TOTAL_LIMIT_BYTES)
          throw new TaskBookStorageLimitExceeded(total,TASK_BOOK_TOTAL_LIMIT_BYTES);
        await meta.add(checkpoint,taskBookKey(book.id,activity.id));
        await meta.put({...ledger,estimatedBytes:total,records:ledger.records+1},
          taskBookUsageKey(book.id));
      }catch(error){
        // A failed application quota is not an IDB request error: without
        // explicit abort earlier books/activities/checkpoints could commit.
        try{tx.abort();}catch{/* an IDB request may have aborted already */}
        throw error;
      }
    }
  }
  // Keep a durable sync request in the same transaction as the narrative result.
  // Do not create a GitHub commit for every intermediate AI planning operation.
  if (activity.status === "succeeded" &&
      ["outline", "chapterReview"].includes(activity.phase) && !book.editorialCycle) {
    await enqueueCheckpoint(book, tx.objectStore("outbox"));
  }
  await tx.done;
}

export async function listActivities(bookId: string): Promise<Activity[]> {
  const db = await getDb();
  const items = (await db.getAll("activities")) as Activity[];
  return items.filter(item => item.bookId === bookId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function recoverInterruptedRuns(): Promise<void> {
  // Every new tab calls this on mount. A still-running tab owns this exact
  // Web Lock for the whole AI session: never mark its work as interrupted.
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return; // Fail closed; we cannot prove the writer stopped.

  const db = await getDb();
  const books = (await db.getAll("books")) as BookProject[];
  const activities = (await db.getAll("activities")) as Activity[];
  const candidates = new Set(
    books.filter(book => book.status === "running").map(book => book.id),
  );
  for (const activity of activities) {
    if (activity.status === "running") candidates.add(activity.bookId);
  }

  for (const bookId of candidates) {
    await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async lock => {
      if (!lock) return; // A different tab is still writing this book.
      // Open the transaction only *after* taking the lock. Re-read the
      // records under the transaction, not from the earlier candidate scan.
      const tx = db.transaction(["books", "activities"], "readwrite");
      const bookStore = tx.objectStore("books");
      const book = await bookStore.get(bookId) as BookProject | undefined;
      if (book?.status === "running") {
        book.status = "paused";
        book.previousError = "La pagina è stata interrotta. Riprendi dall'ultimo checkpoint.";
        await bookStore.put(book, bookId);
      }
      const activityStore = tx.objectStore("activities");
      let cursor = await activityStore.openCursor();
      while (cursor) {
        const activity = cursor.value as Activity;
        if (activity.bookId === bookId && activity.status === "running") {
          activity.status = "cancelled";
          activity.error = "Browser interrotto prima della conclusione: attività non confermata.";
          activity.endedAt = new Date().toISOString();
          await cursor.update(activity);
        }
        cursor = await cursor.continue();
      }
      await tx.done;
    });
  }
}
