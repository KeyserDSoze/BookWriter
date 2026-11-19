import { openDB, type IDBPDatabase } from "idb";
import { BookRevisionConflict } from "@engine/core/errors";
import { assertLocalBook, isServerBook } from "@engine/domain/execution-authority";
import { retryStamp } from "@engine/core/retry-policy";
import { retryScheduleKey } from "@engine/infrastructure/retry-schedule";
import { rotateRetrySettingsEpoch } from "./retry-settings-epoch";
import { narrativeStateJson } from "@engine/core/narrative-state";
import type { Activity, AppSettings, BookProject } from "@engine/domain/types";
import { DEFAULT_SETTINGS } from "@engine/domain/types";
import { bookFormatVersion, migrateBook } from "@engine/domain/book-format";
import { enqueueCheckpoint } from "@engine/infrastructure/outbox";
import { markCloudProfileDirty } from "./cloud/cloud-dirty";
import { createTaskStructuralCheckpoint } from "@engine/domain/task-structural-checkpoint";
import { createTaskProseCheckpoint } from "@engine/domain/task-prose-checkpoint";
import { taskProseConsentKey, taskProseKey, taskProseUsageKey } from "./task-prose-checkpoint";
import { taskProseLimitKey } from "./task-prose-storage";
import {
  taskBookConsentKey, taskBookKey, taskBookUsageKey,
} from "./task-book-checkpoint";
import {
  createTaskBookCheckpoint, estimatedTaskBookBytes,
  TASK_BOOK_PAIR_LIMIT_BYTES, TASK_BOOK_TOTAL_LIMIT_BYTES,
  TaskBookStorageLimitExceeded, validTaskBookUsage,
} from "@engine/domain/task-book-checkpoint";
import {
  estimateProsePayloadBytes, TaskProseQuotaExceeded, PROSE_MIB,
  validProseLimitMiB, validTaskProseUsageLedger,
  type TaskProseUsageLedger,
} from "@engine/domain/task-prose-storage";

const DB_NAME = "bookwriter";
const DB_VERSION = 2;
let database: Promise<IDBPDatabase> | undefined;

function revisionTimestamp(previous?: BookProject): string {
  const previousTime = previous ? Date.parse(previous.updatedAt) : NaN;
  // Strictly monotonic even for multiple writes during the same millisecond.
  const milliseconds = Number.isFinite(previousTime) ? Math.max(Date.now(), previousTime + 1) : Date.now();
  return new Date(milliseconds).toISOString();
}

export { BookRevisionConflict };

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
  // The settings and the «cloud profile has local changes» marker commit together.
  const tx = db.transaction(["settings", "meta"], "readwrite");
  void tx.done.catch(() => undefined);
  const store = tx.objectStore("settings");
  const previous = await store.get("global") as AppSettings | undefined;
  // Recheck after opening IndexedDB; no await between fence and put.
  if (isCurrent && !isCurrent()) {
    tx.abort();
    throw new Error("Impostazioni cambiate durante il salvataggio: nessuna scrittura eseguita.");
  }
  const written = store.put(settings, "global");
  await rotateRetrySettingsEpoch(tx.objectStore("meta"), previous, settings);
  await markCloudProfileDirty(tx.objectStore("meta"), previous, settings);
  await written;
  await tx.done;
}

export async function listBooks(): Promise<BookProject[]> {
  const db = await getDb();
  const all = (await db.getAll("books")) as BookProject[];
  // A book from a newer app stays listed as stored; reading or saving it fails with an explanation.
  for (const book of all) try { migrateBook(book); } catch { /* left untouched */ }
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The book in the current data format (migrations run in memory; the next save stores them). */
export async function getBook(id: string): Promise<BookProject | undefined> {
  const db = await getDb();
  const book = (await db.get("books", id)) as BookProject | undefined;
  return book && migrateBook(book);
}
/** Mutation preflight, separate from the read-only getter used by replica views.
 * Never silently route an unsupported browser action into a server-owned book. */
export async function getLocalBook(id: string): Promise<BookProject | undefined> {
  const book = await getBook(id);
  if (book) assertLocalBook(book);
  return book;
}
/** Older code must never overwrite a book saved by a newer app. */
function assertWritable(book: BookProject, stored: BookProject | undefined): void {
  assertLocalBook(book);
  if (stored) assertLocalBook(stored);
  bookFormatVersion(book);
  if (stored) bookFormatVersion(stored);
}
async function invalidateChangedRetry(book: BookProject, meta: {
  get(key: string): Promise<unknown>; delete(key: string): Promise<unknown>;
}): Promise<void> {
  const key = "retry-schedule:v1:" + book.id;
  const plan = await meta.get(key) as { bookStamp?: string } | undefined;
  if (plan && plan.bookStamp !== retryStamp(narrativeStateJson(book))) await meta.delete(key);
}

export async function saveBook(
  book: BookProject, queueSync = true, expectedUpdatedAt?: string,
): Promise<void> {
  const db = await getDb();
  // The read, revision comparison, book update and optional outbox enqueue
  // share one IndexedDB readwrite transaction: no stale snapshot can win
  // between the revision check and the actual save.
  const tx = db.transaction(["books", "outbox", "meta"], "readwrite");
  const books = tx.objectStore("books");
  const stored = await books.get(book.id) as BookProject | undefined;
  if (expectedUpdatedAt !== undefined && stored?.updatedAt !== expectedUpdatedAt) {
    await tx.done; // Commit an unchanged transaction, without touching outbox.
    throw new BookRevisionConflict();
  }
  assertWritable(book, stored);
  await invalidateChangedRetry(book, tx.objectStore("meta"));
  book.updatedAt = revisionTimestamp(stored);
  await books.put(book, book.id);
  if (queueSync) await enqueueCheckpoint(book, tx.objectStore("outbox"));
  await tx.done;
}

export async function saveActivity(activity: Activity): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["books", "activities"], "readwrite");
  void tx.done.catch(() => undefined);
  const book = await tx.objectStore("books").get(activity.bookId) as BookProject | undefined;
  if (book) {
    try { assertLocalBook(book); } catch (error) { tx.abort(); throw error; }
  }
  await tx.objectStore("activities").put(activity, activity.id);
  await tx.done;
}

/** Author-side change plus its log entry, CAS-checked in one transaction.
 * Unlike AI tasks it creates no structural/prose checkpoint: a note must
 * never be refused because of the opt-in prose snapshot quota. */
export async function saveBookWithAuthorActivity(
  book: BookProject, activity: Activity, expectedUpdatedAt: string,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["books", "activities", "outbox", "meta"], "readwrite");
  void tx.done.catch(() => {});
  const books = tx.objectStore("books");
  const stored = await books.get(book.id) as BookProject | undefined;
  if (!stored || stored.updatedAt !== expectedUpdatedAt) {
    await tx.done;
    throw new BookRevisionConflict();
  }
  assertWritable(book, stored);
  await invalidateChangedRetry(book, tx.objectStore("meta"));
  book.updatedAt = revisionTimestamp(stored);
  await books.put(book, book.id);
  await tx.objectStore("activities").put(activity, activity.id);
  await enqueueCheckpoint(book, tx.objectStore("outbox"));
  await tx.done;
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
  assertWritable(book, stored);
  await invalidateChangedRetry(book, tx.objectStore("meta"));
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
  // Keep a durable sync request in the same transaction as the narrative result: every task that
  // succeeded asks for a GitHub save (one queue item per book, the worker spaces the pushes out).
  if (activity.status === "succeeded") {
    await enqueueCheckpoint(book, tx.objectStore("outbox"));
    const key = "retry-schedule:v1:" + book.id;
    const plan = await tx.objectStore("meta").get(key) as { runId?: string } | undefined;
    if (plan?.runId === activity.runId) await tx.objectStore("meta").delete(key);
  }
  await tx.done;
}

export async function listActivities(bookId: string): Promise<Activity[]> {
  const db = await getDb();
  const items = (await db.getAll("activities")) as Activity[];
  return items.filter(item => item.bookId === bookId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A book whose runner was lost (page reloaded or closed) and that recovery has just paused. */
export interface InterruptedRun {
  bookId: string; title: string;
  /** Last sign of life: the book's last commit or the start of the call that was lost. */
  lastActivityAt: string;
}

/** Pauses what a lost page left «running». Returns only the books that really were running,
 * so the app can offer (or, for a reload, perform) the resumption. */
export async function recoverInterruptedRuns(): Promise<InterruptedRun[]> {
  // Every new tab calls this on mount. A still-running tab owns this exact
  // Web Lock for the whole AI session: never mark its work as interrupted.
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return []; // Fail closed; we cannot prove the writer stopped.

  const db = await getDb();
  const books = (await db.getAll("books")) as BookProject[];
  const activities = (await db.getAll("activities")) as Activity[];
  const retryPrefix = retryScheduleKey("");
  const retryKeys = await db.getAllKeys("meta", IDBKeyRange.bound(retryPrefix, retryPrefix + "\uffff"));
  const candidates = new Set(books.filter(book => book.status === "running" && !isServerBook(book)).map(book => book.id));
  for (const key of retryKeys) candidates.add(String(key).slice(retryPrefix.length));
  for (const activity of activities) {
    if (activity.status === "running") candidates.add(activity.bookId);
  }

  const recovered: InterruptedRun[] = [];
  for (const bookId of candidates) {
    await locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async lock => {
      if (!lock) return; // A different tab is still writing this book.
      // Open the transaction only *after* taking the lock. Re-read the
      // records under the transaction, not from the earlier candidate scan.
      const tx = db.transaction(["books", "activities", "meta"], "readwrite");
      void tx.done.catch(() => undefined);
      const bookStore = tx.objectStore("books");
      const book = await bookStore.get(bookId) as BookProject | undefined;
      if (book && isServerBook(book)) { await tx.done; return; }
      const retryStore = tx.objectStore("meta");
      const retry = await retryStore.get(retryScheduleKey(bookId)) as { state?: string } | undefined;
      const interruptedRetry = retry?.state === "claimed" || !!retry && book?.status === "running";
      if (interruptedRetry) await retryStore.delete(retryScheduleKey(bookId));
      let wasRunning = false;
      let lastActivityAt = book?.updatedAt ?? "";
      if (book && (book.status === "running" || interruptedRetry)) {
        wasRunning = book.status === "running" && !interruptedRetry;
        book.status = "paused";
        book.previousError = interruptedRetry
          ? "Ripartenza long-term interrotta: controlla l'attività e gli eventuali addebiti prima di riprendere. Nessuna nuova richiesta automatica."
          : "La pagina è stata interrotta. Riprendi dall'ultimo checkpoint.";
        await bookStore.put(book, bookId);
      }
      const activityStore = tx.objectStore("activities");
      let cursor = await activityStore.openCursor();
      while (cursor) {
        const activity = cursor.value as Activity;
        if (activity.bookId === bookId && activity.status === "running") {
          if (Date.parse(activity.createdAt) > Date.parse(lastActivityAt || "0")) lastActivityAt = activity.createdAt;
          activity.status = "cancelled";
          activity.error = "Browser interrotto prima della conclusione: attività non confermata.";
          activity.endedAt = new Date().toISOString();
          await cursor.update(activity);
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      if (wasRunning && book && lastActivityAt) recovered.push({ bookId, title: book.title, lastActivityAt });
    });
  }
  return recovered;
}
