import { host } from "../core/host";

/**
 * Manual pushes are recorded apart from the autosync outbox:
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

export const getManualPushIntent = (bookId: string): Promise<ManualPushIntent | undefined> =>
  host().readManualPushIntent(bookId);

/** Called ONLY under the book's writer and outbox locks, before any outbound push. */
export async function prepareManualPushIntent(bookId: string): Promise<ManualPushIntent> {
  return host().transaction(bookId, record => {
    const { book } = record;
    if (!book.remote) throw new Error("Collega prima il libro a una repository GitHub.");
    if (book.status === "running" || book.remote.autoSync)
      throw new Error("Metti in pausa l'autopilot e disattiva autosync prima del push manuale.");
    const old = record.manualPushIntent;
    if (old) {
      const sameDestination = old.bookId === bookId && old.owner === book.remote.owner &&
        old.repository === book.remote.repository && old.branch === book.remote.branch;
      if (!sameDestination || old.baseSha !== book.remote.lastSyncedCommit || !/^[0-9a-f-]{36}$/i.test(old.operationId))
        throw new Error("Push manuale sospeso per una diversa repository o baseline GitHub: verifica il conflitto prima di procedere.");
      return old;
    }
    const created: ManualPushIntent = {
      bookId, operationId: crypto.randomUUID(), owner: book.remote.owner,
      repository: book.remote.repository, branch: book.remote.branch,
      baseSha: book.remote.lastSyncedCommit, sourceRevision: book.updatedAt,
      preparedAt: new Date().toISOString(),
    };
    record.manualPushIntent = created;
    return created;
  });
}
