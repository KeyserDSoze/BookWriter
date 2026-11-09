import type { BookProject } from "../domain/types";
import { getDb } from "./db";

/**
 * Manual pushes use the existing meta store rather than the autosync outbox:
 * disabling autosync must not erase or reinterpret pending checkpoint requests.
 * No database schema upgrade and no PAT/API key in this durable record.
 */
export interface ManualPushIntent {
  bookId: string;
  operationId: string;
  owner: string;
  repository: string;
  branch: string;
  baseSha?: string;
  sourceRevision: string;
  preparedAt: string;
}
const key = (bookId: string) => "manual-github-push:" + bookId;

export async function getManualPushIntent(bookId: string): Promise<ManualPushIntent | undefined> {
  return await (await getDb()).get("meta", key(bookId)) as ManualPushIntent | undefined;
}

/** Called ONLY under writer + outbox Web Locks, before any outbound push. */
export async function prepareManualPushIntent(bookId: string): Promise<ManualPushIntent> {
  const db = await getDb();
  const tx = db.transaction(["books", "meta"], "readwrite");
  const book = await tx.objectStore("books").get(bookId) as BookProject | undefined;
  if (!book?.remote) {
    await tx.done;
    throw new Error("Collega prima il libro a una repository GitHub.");
  }
  if (book.status === "running" || book.remote.autoSync) {
    await tx.done;
    throw new Error("Metti in pausa l'autopilot e disattiva autosync prima del push manuale.");
  }
  const existing = await tx.objectStore("meta").get(key(bookId)) as ManualPushIntent | undefined;
  if (existing) {
    const sameDestination = existing.bookId === bookId &&
      existing.owner === book.remote.owner &&
      existing.repository === book.remote.repository &&
      existing.branch === book.remote.branch;
    const sameBaseline = existing.baseSha === book.remote.lastSyncedCommit;
    if (!sameDestination || !sameBaseline ||
        !/^[0-9a-f-]{36}$/i.test(existing.operationId)) {
      await tx.done;
      throw new Error("Push manuale sospeso per una diversa repository o baseline GitHub: verifica il conflitto prima di procedere.");
    }
    await tx.done;
    return existing;
  }
  const created: ManualPushIntent = {
    bookId, operationId: crypto.randomUUID(), owner: book.remote.owner,
    repository: book.remote.repository, branch: book.remote.branch,
    baseSha: book.remote.lastSyncedCommit, sourceRevision: book.updatedAt,
    preparedAt: new Date().toISOString(),
  };
  await tx.objectStore("meta").put(created, key(bookId));
  await tx.done;
  return created;
}
