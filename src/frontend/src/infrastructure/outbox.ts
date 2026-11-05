import type { BookProject, SyncOutboxItem } from "../domain/types";
import { getDb } from "./db";

// All outbox writes happen within an IndexedDB readwrite transaction owned by the caller.
export async function enqueueCheckpoint(
  book: BookProject,
  store: { get: (key: string) => Promise<unknown>; put: (value: SyncOutboxItem, key: string) => Promise<unknown> },
): Promise<void> {
  if (!book.remote?.autoSync || book.editorialCycle || book.phase === "revision" ||
      book.editorialReviewSceneIds?.length || book.chapters.some(ch =>
        !ch.frozenAt && ch.scenes.some(scene => scene.status !== "planned"))) return;
  const previous = await store.get(book.id) as SyncOutboxItem | undefined;
  const next: SyncOutboxItem = previous ? {
    ...previous,
    revision: previous.revision + 1,
    requestedAt: new Date().toISOString(),
    // A blocked conflict or permission error is NOT cleared by further writing.
    state: previous.state === "blocked" ? "blocked" : "pending",
  } : {
    bookId: book.id,
    operationId: crypto.randomUUID(),
    revision: 1,
    requestedAt: new Date().toISOString(),
    state: "pending",
    attempts: 0,
  };
  await store.put(next, book.id);
}

export async function getOutbox(bookId: string): Promise<SyncOutboxItem | undefined> {
  return await (await getDb()).get("outbox", bookId) as SyncOutboxItem | undefined;
}

export async function listOutbox(): Promise<SyncOutboxItem[]> {
  return await (await getDb()).getAll("outbox") as SyncOutboxItem[];
}

export async function markAttempt(item: SyncOutboxItem): Promise<boolean> {
  const db = await getDb();
  const tx = db.transaction("outbox", "readwrite");
  const store = tx.objectStore("outbox");
  const actual = await store.get(item.bookId) as SyncOutboxItem | undefined;
  if (!actual || actual.operationId !== item.operationId ||
      actual.state === "blocked" ||
      (actual.retryAfter && Date.parse(actual.retryAfter) > Date.now())) {
    await tx.done;
    return false;
  }
  actual.state = "syncing";
  actual.attempts++;
  actual.lastAttemptAt = new Date().toISOString();
  await store.put(actual, item.bookId);
  await tx.done;
  return true;
}

export async function acknowledgeOutbox(
  bookId: string, operationId: string, syncedBookUpdatedAt: string,
): Promise<void> {
  const db = await getDb();
  // Verify the actual book timestamp atomically with outbox ACK. The user/AI
  // may have produced another checkpoint WHILE GitHub was receiving our commit.
  const tx = db.transaction(["books", "outbox"], "readwrite");
  const store = tx.objectStore("outbox");
  const current = await store.get(bookId) as SyncOutboxItem | undefined;
  if (current?.operationId === operationId) {
    const local = await tx.objectStore("books").get(bookId) as BookProject | undefined;
    if (local?.updatedAt === syncedBookUpdatedAt) await store.delete(bookId);
    else await store.put({
      ...current, operationId: crypto.randomUUID(),
      attempts: 0, retryAfter: undefined, lastError: undefined,
      state: "pending",
    }, bookId);
  }
  await tx.done;
}

export async function recordSyncFailure(
  bookId: string, operationId: string, error: string, blocked: boolean,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("outbox", "readwrite");
  const store = tx.objectStore("outbox");
  const entry = await store.get(bookId) as SyncOutboxItem | undefined;
  if (entry?.operationId === operationId) {
    const boundedAttempts = Math.min(entry.attempts, 6);
    const backoff = Math.min(5 * 60_000, 15_000 * 2 ** Math.max(0, boundedAttempts - 1));
    entry.state = blocked || entry.attempts >= 6 ? "blocked" : "pending";
    entry.retryAfter = entry.state === "blocked" ? undefined : new Date(Date.now() + backoff).toISOString();
    // Errors returned to the UI are sanitized by the GitHub client.
    entry.lastError = error.slice(0, 500);
    await store.put(entry, bookId);
  }
  await tx.done;
}

export async function retryBlockedSync(bookId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("outbox", "readwrite");
  const store = tx.objectStore("outbox");
  const item = await store.get(bookId) as SyncOutboxItem | undefined;
  if (item) {
    item.state = "pending";
    item.retryAfter = undefined;
    item.lastError = undefined;
    item.attempts = 0;
    await store.put(item, bookId);
  }
  await tx.done;
}

export async function disableSyncOutbox(bookId: string): Promise<void> {
  await (await getDb()).delete("outbox", bookId);
}
