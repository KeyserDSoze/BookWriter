import { installHostRuntime, type HostBookRecord, type HostRuntime, type LockResult } from "@engine/core/host";
import { BookNotFound, LocksUnavailable } from "@engine/core/errors";
import { assertLocalBook, isServerBook } from "@engine/domain/execution-authority";
import { migrateBook } from "@engine/domain/book-format";
import { DEFAULT_SETTINGS, type Activity, type AppSettings, type BookProject, type SyncOutboxItem } from "@engine/domain/types";
import type { ManualPushIntent } from "@engine/infrastructure/manual-push-intent";
import { retrySettingsEpochSchema, type RetrySchedule } from "@engine/core/retry-policy";
import {
  getBook, getDb, getLocalBook, listActivities, listBooks, loadSettings, saveActivity, saveBook,
  saveBookAndActivity, saveBookWithAuthorActivity, saveSettings,
} from "../infrastructure/db";
import { decryptLocal, encryptLocal } from "../infrastructure/crypto";
import { createTraceStore } from "../infrastructure/ai-trace-store";
import { RETRY_SETTINGS_EPOCH_KEY } from "../infrastructure/retry-settings-epoch";

const intentKey = (bookId: string) => "manual-github-push:" + bookId;
const retryKey = (bookId: string) => "retry-schedule:v1:" + bookId;
const json = (value: unknown) => JSON.stringify(value ?? null);

/** What `change` may have altered in one book's durable state, compared with what was read. */
async function transaction<T>(
  bookId: string, change: (record: HostBookRecord) => Promise<T> | T, options?: { activities?: boolean },
): Promise<T> {
  const db = await getDb();
  // The book, its queue, its manual-push intent, its retry wait and (on request) its log commit
  // together or not at all. Nothing is written until `change` has finished: it may only await
  // in-memory work, otherwise IndexedDB would close the transaction under it.
  const tx = db.transaction(["books", "activities", "outbox", "meta"], "readwrite");
  void tx.done.catch(() => undefined);
  try {
    const stored = await tx.objectStore("books").get(bookId) as BookProject | undefined;
    if (!stored) throw new BookNotFound();
    const book = migrateBook(stored);
    const replica = isServerBook(book);
    const meta = tx.objectStore("meta");
    const outbox = await tx.objectStore("outbox").get(bookId) as SyncOutboxItem | undefined;
    const intent = await meta.get(intentKey(bookId)) as ManualPushIntent | undefined;
    // A replica of a server-owned book carries no local retry wait.
    const retry = replica ? undefined : await meta.get(retryKey(bookId)) as RetrySchedule | undefined;
    const activities = options?.activities
      ? (await tx.objectStore("activities").getAll() as Activity[]).filter(a => a.bookId === bookId) : [];
    const record: HostBookRecord = { version: 1, revision: 0, book, activities, commands: {} };
    if (outbox) record.outbox = outbox;
    if (intent) record.manualPushIntent = intent;
    if (retry) record.retrySchedule = retry;
    const before = {
      book: json(book), outbox: json(outbox), intent: json(intent), retry: json(retry),
      activities: new Map(activities.map(a => [a.id, json(a)] as const)),
    };
    const result = await change(record);

    const changedActivities = record.activities.filter(activity => before.activities.get(activity.id) !== json(activity));
    const activityStore = tx.objectStore("activities");
    const changedIds = new Set<string>();
    for (const activity of changedActivities) {
      const previous = await activityStore.get(activity.id) as Activity | undefined;
      if (activity.bookId !== bookId || previous && previous.bookId !== bookId || changedIds.has(activity.id))
        throw new Error("Attività duplicata o di un altro libro nella transazione.");
      changedIds.add(activity.id);
    }
    const changed = {
      book: json(record.book) !== before.book, outbox: json(record.outbox) !== before.outbox,
      intent: json(record.manualPushIntent) !== before.intent, retry: json(record.retrySchedule) !== before.retry,
    };
    // A read-only replica may not accumulate audits through a back door even when the caller
    // only changes HostBookRecord.activities. The same fail-closed rule applies to every activity write.
    if (replica && changedActivities.length) assertLocalBook(stored);
    // A replica is read-only here. Removing a local artefact is allowed, writing a new one is not.
    if (changed.book || record.outbox && changed.outbox || record.manualPushIntent && changed.intent ||
        record.retrySchedule && changed.retry) {
      assertLocalBook(stored); assertLocalBook(record.book);
    }
    if (changed.book) await tx.objectStore("books").put(record.book, bookId);
    if (changed.outbox) {
      if (record.outbox) await tx.objectStore("outbox").put(record.outbox, bookId);
      else await tx.objectStore("outbox").delete(bookId);
    }
    if (changed.intent) {
      if (record.manualPushIntent) await meta.put(record.manualPushIntent, intentKey(bookId));
      else await meta.delete(intentKey(bookId));
    }
    if (changed.retry) {
      if (record.retrySchedule) await meta.put(record.retrySchedule, retryKey(bookId));
      else await meta.delete(retryKey(bookId));
    }
    // The log is append-only: a changed or new entry is stored, an entry left out is never deleted.
    for (const activity of changedActivities)
      await activityStore.put(activity, activity.id);
    await tx.done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* the transaction already ended */ }
    throw error;
  }
}

async function tryLock<T>(name: string, action: () => Promise<T>): Promise<LockResult<T>> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new LocksUnavailable();
  let outcome: LockResult<T> = { held: false };
  await locks.request(name, { ifAvailable: true }, async lock => {
    if (!lock) return;
    outcome = { held: true, value: await action() };
  });
  return outcome;
}

/** IndexedDB, WebCrypto and Web Locks, presented to the shared engine as the one place it runs in. */
export function createBrowserHost(): HostRuntime {
  return {
    kind: "browser",
    getBook, getBookForMutation: getLocalBook, listBooks,
    listBookIds: async () => (await (await getDb()).getAllKeys("books")).map(String),
    loadSettings, saveSettings, saveBook, saveActivity, saveBookAndActivity, saveBookWithAuthorActivity, listActivities,
    loadRetrySettings: async bookId => {
      const tx = (await getDb()).transaction(bookId ? ["settings", "meta", "books"] : ["settings", "meta"], "readonly");
      const settings = await tx.objectStore("settings").get("global") as AppSettings | undefined;
      const meta = tx.objectStore("meta");
      const rawEpoch = await meta.get(RETRY_SETTINGS_EPOCH_KEY);
      const stored = bookId ? await tx.objectStore("books").get(bookId) as BookProject | undefined : undefined;
      const plan = stored && !isServerBook(stored) ? await meta.get(retryKey(bookId!)) as RetrySchedule | undefined : undefined;
      await tx.done;
      return { settings: settings ?? structuredClone(DEFAULT_SETTINGS), epoch: retrySettingsEpochSchema.parse(rawEpoch ?? null),
        book: stored && migrateBook(stored), plan };
    },
    transaction,
    readOutbox: async id => await (await getDb()).get("outbox", id) as SyncOutboxItem | undefined,
    listOutbox: async () => await (await getDb()).getAll("outbox") as SyncOutboxItem[],
    readManualPushIntent: async id => await (await getDb()).get("meta", intentKey(id)) as ManualPushIntent | undefined,
    readRetrySchedule: async id => {
      const db = await getDb();
      const book = await db.get("books", id) as BookProject | undefined;
      if (!book || isServerBook(book)) return undefined;
      return await db.get("meta", retryKey(id)) as RetrySchedule | undefined; // validated by the engine
    },
    encrypt: text => encryptLocal(text), decrypt: value => decryptLocal(value),
    getMeta: async key => (await getDb()).get("meta", key),
    putMeta: async (key, value) => { await (await getDb()).put("meta", value, key); },
    tryLock,
    withBookScope: (_id, action) => action(),
    admission: { assert: async book => assertLocalBook(book), owns: book => !isServerBook(book) },
    online: () => typeof navigator === "undefined" || navigator.onLine !== false,
    traces: createTraceStore(),
  };
}

export function installBrowserHost(): () => void {
  return installHostRuntime(createBrowserHost());
}
