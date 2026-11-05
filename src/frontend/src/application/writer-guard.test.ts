import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook } from "../domain/types";
import { getDb, saveBook } from "../infrastructure/db";

const lease = vi.hoisted(() => ({
  acquire: vi.fn(), verify: vi.fn(), renew: vi.fn(), release: vi.fn(),
}));
vi.mock("../infrastructure/github-lease", () => ({
  acquireWriterLease: lease.acquire, assertWriterLease: lease.verify,
  renewWriterLease: lease.renew, releaseWriterLease: lease.release,
  LEASE_RENEW_MS: 25_000,
  RemoteWriterLost: class RemoteWriterLost extends Error {},
}));
import { withWriterGuard } from "./writer-guard";

beforeEach(async () => {
  const db = await getDb();
  await db.clear("books");
  lease.acquire.mockReset();
  lease.verify.mockReset();
  lease.renew.mockReset();
  lease.release.mockReset();
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_name: string, _options: unknown, fn: (lock: object) => Promise<unknown>) =>
        fn({ name: "bookwriter:writer" }),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Writer guard applicativa", () => {
  it("blocca una sessione concorrente prima dell'attività AI", async () => {
    const book = newBook("Idea", "Libro di prova", "", "");
    book.remote = { owner: "test-owner", repository: "book-repo", branch: "main" };
    await saveBook(book, false);
    lease.acquire.mockRejectedValue(new Error("Altro dispositivo in scrittura"));
    const action = vi.fn();
    await expect(withWriterGuard(book.id, crypto.randomUUID(), new AbortController(), action))
      .rejects.toThrow("Altro dispositivo");
    expect(action).not.toHaveBeenCalled();
  });

  it("ricontrolla il possesso prima e dopo una chiamata AI", async () => {
    const book = newBook("Idea", "Libro di prova", "", "");
    book.remote = { owner: "test-owner", repository: "book-repo", branch: "main" };
    await saveBook(book, false);
    const handle = { bookId: book.id, sessionId: crypto.randomUUID(), remote: book.remote, expiresAt: new Date(Date.now() + 100_000).toISOString(), headSha: "a".repeat(40) };
    lease.acquire.mockResolvedValue(handle);
    lease.verify.mockResolvedValueOnce(handle);
    lease.verify.mockResolvedValueOnce(handle);
    lease.verify.mockRejectedValueOnce(new Error("Lease perso durante il modello AI"));
    const controller = new AbortController();
    await expect(withWriterGuard(book.id, handle.sessionId, controller, async guard => {
      await guard.assertActive(); // pre-model
      await guard.assertActive(); // post-model
    })).rejects.toThrow("Lease perso");
    expect(controller.signal.aborted).toBe(true);
    expect(lease.release).toHaveBeenCalled();
  });

  it("esclude due tab contemporanee anche su un libro non collegato", async () => {
    const book = newBook("Idea", "Libro locale", "", "");
    await saveBook(book, false);
    vi.stubGlobal("navigator", {
      locks: {
        request: async (_name: string, _opts: unknown, fn: (lock: null) => Promise<unknown>) => fn(null),
      },
    });
    await expect(withWriterGuard(book.id, crypto.randomUUID(), new AbortController(), async () => {
      throw new Error("Non deve partire");
    })).rejects.toThrow("un'altra scheda");
  });
});
