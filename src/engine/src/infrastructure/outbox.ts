import type { BookProject, SyncOutboxItem } from "../domain/types";
import { githubPublicationBlocker } from "../domain/github-publication";
import { host } from "../core/host";

/**
 * Appends a save request to a book's queue. `store` is the outbox of a transaction that the
 * caller (a host) already owns, so the request commits together with the book it describes.
 */
export async function enqueueCheckpoint(
  book: BookProject,
  store: { get: (key: string) => Promise<unknown>; put: (value: SyncOutboxItem, key: string) => Promise<unknown> },
): Promise<void> {
  if (!book.remote?.autoSync || githubPublicationBlocker(book)) return;
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

export const getOutbox = (bookId: string): Promise<SyncOutboxItem | undefined> => host().readOutbox(bookId);
export const listOutbox = (): Promise<SyncOutboxItem[]> => host().listOutbox();

/** `force`: the author asked to save now, so a back-off delay is ignored (a blocked item never is). */
export async function markAttempt(item: SyncOutboxItem, force = false): Promise<boolean> {
  return host().transaction(item.bookId, record => {
    const actual = record.outbox;
    if (!actual || actual.operationId !== item.operationId || actual.state === "blocked" ||
        !force && actual.retryAfter && Date.parse(actual.retryAfter) > Date.now()) return false;
    actual.state = "syncing"; actual.attempts++; actual.lastAttemptAt = new Date().toISOString();
    return true;
  });
}

/**
 * The remote accepted a commit: settle the queue against the book as it is NOW. The user or the AI
 * may have produced another checkpoint WHILE GitHub was receiving ours, so the item is deleted only
 * when the stored book is exactly the one that was sent.
 */
export async function acknowledgeOutbox(
  bookId: string, operationId: string, syncedBookUpdatedAt: string,
): Promise<void> {
  await host().transaction(bookId, record => {
    const current = record.outbox;
    if (current?.operationId !== operationId) return;
    if (record.book.updatedAt === syncedBookUpdatedAt) delete record.outbox;
    else record.outbox = {
      ...current, operationId: crypto.randomUUID(),
      attempts: 0, retryAfter: undefined, lastError: undefined, state: "pending",
    };
  });
}

/** The attempt did not reach GitHub through no fault of the remote (the book changed under it):
 * give the attempt back, without counting it as a failure, and try again shortly. */
export async function deferAttempt(bookId: string, operationId: string, delayMs: number): Promise<void> {
  await host().transaction(bookId, record => {
    const entry = record.outbox;
    if (entry?.operationId === operationId && entry.state === "syncing") {
      entry.state = "pending"; entry.attempts = Math.max(0, entry.attempts - 1);
      entry.retryAfter = new Date(Date.now() + delayMs).toISOString();
    }
  });
}

export async function recordSyncFailure(
  bookId: string, operationId: string, error: string, blocked: boolean,
): Promise<void> {
  await host().transaction(bookId, record => {
    const entry = record.outbox;
    if (entry?.operationId !== operationId) return;
    const boundedAttempts = Math.min(entry.attempts, 6);
    const backoff = Math.min(5 * 60_000, 15_000 * 2 ** Math.max(0, boundedAttempts - 1));
    entry.state = blocked || entry.attempts >= 6 ? "blocked" : "pending";
    entry.retryAfter = entry.state === "blocked" ? undefined : new Date(Date.now() + backoff).toISOString();
    // Errors returned to the UI are sanitized by the GitHub client.
    entry.lastError = error.slice(0, 500);
  });
}

/** Queue a save of the current book if there is something GitHub does not have yet (or force a fresh
 * one). Same transaction as the read, so it cannot race a task that is being committed. */
export type EnqueueResult = "queued" | "already_saved" | "not_linked" | "autosync_off" | "first_push_needed" | "blocked";
export async function enqueueIfUnsaved(bookId: string): Promise<EnqueueResult> {
  return host().transaction(bookId, async record => {
    const book = record.book;
    if (!book.remote) return "not_linked";
    if (!book.remote.autoSync) return "autosync_off";
    if (!book.remote.lastSyncedCommit) return "first_push_needed";
    if (githubPublicationBlocker(book)) return "blocked";
    if (book.remote.lastSyncedLocalUpdatedAt === book.updatedAt && !record.outbox) return "already_saved";
    await enqueueCheckpoint(book, { get: async () => record.outbox, put: async value => { record.outbox = value; } });
    return "queued" as const;
  });
}

export async function retryBlockedSync(bookId: string): Promise<void> {
  await host().transaction(bookId, record => {
    if (record.outbox) Object.assign(record.outbox, { state: "pending", retryAfter: undefined, lastError: undefined, attempts: 0 });
  });
}

export async function disableSyncOutbox(bookId: string): Promise<void> {
  await host().transaction(bookId, record => { delete record.outbox; });
}
