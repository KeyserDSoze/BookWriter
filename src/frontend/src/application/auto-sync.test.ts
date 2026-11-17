import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { getBook, getDb, saveBook, saveSettings } from "../infrastructure/db";
import { acknowledgeOutbox, getOutbox, recordSyncFailure } from "../infrastructure/outbox";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("../infrastructure/github-sync", () => ({
  pushGitHubBook: pushMock,
  RemoteConflict: class RemoteConflict extends Error {},
}));
import { AUTO_SAVE_MIN_INTERVAL_MS, drainGitHubOutbox, saveToGitHubNow } from "./auto-sync";
import { LocalBookChanged } from "../infrastructure/sync-errors";

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

  describe("salvataggio dopo ogni compito", () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    async function savedRecently(book: Awaited<ReturnType<typeof queuedBook>>, ms: number) {
      const stored = (await getBook(book.id))!;
      stored.remote!.lastSyncAt = ago(ms);
      await saveBook(stored, false);
    }
    const acknowledging = (bookId: string) => async () => {
      const item = (await getOutbox(bookId))!;
      await acknowledgeOutbox(bookId, item.operationId, (await getBook(bookId))!.updatedAt);
      return { commit: "b".repeat(40), operationId: item.operationId, sourceRevision: "x" };
    };

    it("non invia più di un salvataggio ogni due minuti, ma non lo perde", async () => {
      const book = await queuedBook();
      await savedRecently(book, AUTO_SAVE_MIN_INTERVAL_MS / 4);
      pushMock.mockImplementation(acknowledging(book.id));
      await drainGitHubOutbox();
      expect(pushMock).not.toHaveBeenCalled();
      expect((await getOutbox(book.id))?.state).toBe("pending");
      await savedRecently(book, AUTO_SAVE_MIN_INTERVAL_MS + 1_000);
      await drainGitHubOutbox();
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(await getOutbox(book.id)).toBeUndefined();
    });

    it("una data di ultimo salvataggio nel futuro (orologio sfasato) non blocca il salvataggio", async () => {
      const book = await queuedBook();
      await savedRecently(book, -60 * 60_000);
      pushMock.mockImplementation(acknowledging(book.id));
      await drainGitHubOutbox();
      expect(pushMock).toHaveBeenCalledTimes(1);
    });

    it("con «salva ora» salta la distanza e l'attesa dopo un errore, ma non sblocca una coda bloccata", async () => {
      const book = await queuedBook();
      await savedRecently(book, 5_000);
      pushMock.mockImplementation(acknowledging(book.id));
      await drainGitHubOutbox({ force: true });
      expect(pushMock).toHaveBeenCalledTimes(1);

      pushMock.mockClear();
      await saveBook((await getBook(book.id))!); // a new change
      const item = (await getOutbox(book.id))!;
      await recordSyncFailure(book.id, item.operationId, "rete", false); // back-off pending
      expect((await getOutbox(book.id))?.retryAfter).toBeDefined();
      await drainGitHubOutbox();
      expect(pushMock).not.toHaveBeenCalled();
      await drainGitHubOutbox({ force: true });
      expect(pushMock).toHaveBeenCalledTimes(1);

      pushMock.mockClear();
      await saveBook((await getBook(book.id))!);
      const next = (await getOutbox(book.id))!;
      await recordSyncFailure(book.id, next.operationId, "HTTP 403", true);
      await drainGitHubOutbox({ force: true });
      expect(pushMock).not.toHaveBeenCalled();
      expect((await getOutbox(book.id))?.state).toBe("blocked");
    });

    it("se il libro cambia mentre si prepara il salvataggio riprova dopo pochi secondi, senza errore né blocco", async () => {
      const book = await queuedBook();
      pushMock.mockRejectedValueOnce(new LocalBookChanged());
      await drainGitHubOutbox();
      const item = (await getOutbox(book.id))!;
      expect(item).toMatchObject({ state: "pending", attempts: 0 });
      expect(item.lastError).toBeUndefined();
      const wait = Date.parse(item.retryAfter!) - Date.now();
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(5_000);
      await drainGitHubOutbox(); // still waiting
      expect(pushMock).toHaveBeenCalledTimes(1);
      pushMock.mockImplementation(acknowledging(book.id));
      await drainGitHubOutbox({ force: true });
      expect(await getOutbox(book.id)).toBeUndefined();
    });

    it("un «salva ora» chiesto mentre un invio è in corso non si perde: parte subito dopo", async () => {
      const book = await queuedBook();
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      pushMock.mockImplementationOnce(async () => {
        await gate;
        await saveBook((await getBook(book.id))!); // the autopilot committed another task meanwhile
        return { commit: "b".repeat(40), operationId: "x", sourceRevision: "x" };
      });
      pushMock.mockImplementation(acknowledging(book.id));
      const first = drainGitHubOutbox();
      const unforced = drainGitHubOutbox();
      const forced = drainGitHubOutbox({ force: true });
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(pushMock).toHaveBeenCalledTimes(1); // the second one waits for the first
      release();
      await Promise.all([first, unforced, forced]);
      expect(pushMock).toHaveBeenCalledTimes(2);
      expect(await getOutbox(book.id)).toBeUndefined();
    });

    it("saveToGitHubNow accoda ciò che GitHub non ha e lo invia mentre l'autopilot lavora; senza novità non invia nulla", async () => {
      const book = await queuedBook(); // status running
      pushMock.mockImplementation(acknowledging(book.id));
      expect(await saveToGitHubNow(book.id)).toBe("attempted");
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith(book.id, false, expect.objectContaining({ automatic: true }));

      // The last push marks the exact revision as saved (the real client does this in its ACK).
      const synced = (await getBook(book.id))!;
      synced.remote!.lastSyncedLocalUpdatedAt = synced.updatedAt;
      await (await getDb()).put("books", synced, synced.id);
      pushMock.mockClear();
      expect(await saveToGitHubNow(book.id)).toBe("already_saved");
      expect(pushMock).not.toHaveBeenCalled();

      const manual = (await getBook(book.id))!;
      manual.remote!.autoSync = false;
      await saveBook(manual, false);
      expect(await saveToGitHubNow(book.id)).toBe("autosync_off");
      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
