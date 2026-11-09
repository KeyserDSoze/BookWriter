import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { getDb, saveBook, saveSettings } from "../infrastructure/db";
import { acknowledgeOutbox, getOutbox } from "../infrastructure/outbox";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("../infrastructure/github-sync", () => ({
  pushGitHubBook: pushMock,
  RemoteConflict: class RemoteConflict extends Error {},
}));
import { drainGitHubOutbox } from "./auto-sync";

beforeEach(async () => {
  pushMock.mockReset();
  const db = await getDb();
  await db.clear("outbox");
  await db.clear("books");
  await saveSettings({
    ...structuredClone(DEFAULT_SETTINGS),
    githubToken: { iv: "placeholder", data: "placeholder" },
  });
  vi.stubGlobal("navigator", {
    onLine: true,
    locks: {
      request: async (_name: string, _opts: unknown, callback: (lock: object) => Promise<unknown>) =>
        callback({ name: "bookwriter:github-outbox" }),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

async function queuedBook() {
  const book = newBook("Una trama", "Il libro", "Drammatico", "Adulti");
  book.remote = {
    owner: "test-owner", repository: "book-repo", branch: "main",
    autoSync: true, lastSyncedCommit: "a".repeat(40),
  };
  book.status = "running";
  await saveBook(book);
  return book;
}

describe("Coordinatore di autosync", () => {
  it("conferma la coda quando il commit è salvato, anche con autopilot in esecuzione", async () => {
    const book = await queuedBook();
    const operation = await getOutbox(book.id);
    // pushGitHubBook now owns the atomic book+outbox ACK. The mocked
    // client must simulate its queue decision, not the caller.
    pushMock.mockImplementation(async () => {
      await acknowledgeOutbox(book.id, operation!.operationId, book.updatedAt);
      return {
        commit: "b".repeat(40), operationId: operation!.operationId,
        sourceRevision: book.updatedAt,
      };
    });
    await drainGitHubOutbox();
    expect(pushMock).toHaveBeenCalledWith(book.id, false, {
      automatic: true, operationId: operation!.operationId,
    });
    expect(await getOutbox(book.id)).toBeUndefined();
  });

  it("ferma la coda in caso di conflitto remoto, senza retry automatici", async () => {
    const book = await queuedBook();
    pushMock.mockRejectedValue(new Error("Repository PUBBLICA non autorizzata"));
    await drainGitHubOutbox();
    expect((await getOutbox(book.id))?.state).toBe("blocked");
    await drainGitHubOutbox();
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it("conserva un altro checkpoint aggiunto durante il commit e lo invia con nuova operazione", async () => {
    const book = await queuedBook();
    const original = await getOutbox(book.id);
    const priorUpdatedAt = book.updatedAt;
    pushMock.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 3));
      await saveBook(book);
      await acknowledgeOutbox(book.id, original!.operationId, priorUpdatedAt);
      return { commit: "b".repeat(40), sourceRevision: priorUpdatedAt };
    });
    await drainGitHubOutbox();
    const pending = await getOutbox(book.id);
    expect(pending?.state).toBe("pending");
    expect(pending?.operationId).not.toBe(original?.operationId);
  });

  it("non invia token in assenza del blocco Web Locks", async () => {
    const book = await queuedBook();
    vi.stubGlobal("navigator", { onLine: true });
    await drainGitHubOutbox();
    expect(pushMock).not.toHaveBeenCalled();
    expect((await getOutbox(book.id))?.state).toBe("pending");
  });
});
