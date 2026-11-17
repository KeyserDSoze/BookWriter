import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook } from "../domain/types";
import { getDb, saveBook } from "../infrastructure/db";
import { isOwnWriterSession } from "../infrastructure/writer-sessions";

const lease = vi.hoisted(() => ({
  acquire: vi.fn(), verify: vi.fn(), renew: vi.fn(), release: vi.fn(),
}));
vi.mock("../infrastructure/github-lease", () => ({
  acquireWriterLease: lease.acquire, assertWriterLease: lease.verify,
  renewWriterLease: lease.renew, releaseWriterLease: lease.release,
  LEASE_RENEW_MS: 25_000,
  RemoteWriterLost: class RemoteWriterLost extends Error {},
  LeaseRenewalMissed: class LeaseRenewalMissed extends Error {
    constructor(public readonly current: unknown, detail: string) { super(detail); }
  },
}));
import { LeaseRenewalMissed, RemoteWriterLost } from "../infrastructure/github-lease";
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

  it("ricorda la sessione prima di acquisire e dichiara di tenere il lock del libro", async () => {
    const book = newBook("Idea", "Libro di prova", "", "");
    book.remote = { owner: "test-owner", repository: "book-repo", branch: "main" };
    await saveBook(book, false);
    const sessionId = crypto.randomUUID();
    const handle = { bookId: book.id, sessionId, remote: book.remote, expiresAt: new Date(Date.now() + 100_000).toISOString(), headSha: "a".repeat(40) };
    lease.acquire.mockImplementation(async () => {
      // At the moment of acquiring, the session is already remembered as ours.
      expect(await isOwnWriterSession(book.id, sessionId)).toBe(true);
      return handle;
    });
    lease.verify.mockResolvedValue(handle);
    await withWriterGuard(book.id, sessionId, new AbortController(), async guard => { await guard.assertActive(); });
    expect(lease.acquire).toHaveBeenCalledWith(book.remote, book.id, sessionId, false, { writerLockHeld: true });
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

  it("blocca fail-closed un libro locale senza Web Locks, prima di qualsiasi azione AI", async () => {
    const book = newBook("Idea", "Libro locale", "", "");
    await saveBook(book, false);
    vi.stubGlobal("navigator", {});
    const action = vi.fn();
    await expect(withWriterGuard(book.id, crypto.randomUUID(), new AbortController(), action))
      .rejects.toThrow(/Web Locks non disponibile.*libri locali/);
    expect(action).not.toHaveBeenCalled();
    expect(lease.acquire).not.toHaveBeenCalled();
    const stored = await getDb().then(db=>db.get("books",book.id));
    expect(stored).toEqual(book);
  });

  it("blocca fail-closed anche un libro remoto senza Web Locks e non acquisisce lease", async () => {
    const book = newBook("Idea", "Libro collegato", "", "");
    book.remote = { owner: "test-owner", repository: "book-repo", branch: "main" };
    await saveBook(book, false);
    vi.stubGlobal("navigator", {});
    const action = vi.fn();
    await expect(withWriterGuard(book.id, crypto.randomUUID(), new AbortController(), action))
      .rejects.toThrow("Web Locks non disponibile");
    expect(action).not.toHaveBeenCalled();
    expect(lease.acquire).not.toHaveBeenCalled();
    expect(await getDb().then(db=>db.get("books",book.id))).toEqual(book);
  });

  it("mantiene possibile la generazione per libro locale quando Web Locks è disponibile", async () => {
    const book = newBook("Idea", "Libro locale protetto", "", "");
    await saveBook(book, false);
    const action = vi.fn(async (guard: {assertActive:()=>Promise<void>})=>{
      await guard.assertActive();
      return "ok";
    });
    const result = await withWriterGuard(book.id, crypto.randomUUID(), new AbortController(), action);
    expect(result).toBe("ok");
    expect(action).toHaveBeenCalledOnce();
    expect(lease.acquire).not.toHaveBeenCalled();
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

  describe("battito del blocco durante il lavoro", () => {
    async function linkedBook() {
      const book = newBook("Idea", "Libro collegato", "", "");
      book.remote = { owner: "test-owner", repository: "book-repo", branch: "main" };
      await saveBook(book, false);
      const handle = { bookId: book.id, sessionId: crypto.randomUUID(), remote: book.remote, expiresAt: new Date(Date.now() + 100_000).toISOString(), headSha: "a".repeat(40) };
      lease.acquire.mockResolvedValue(handle);
      lease.verify.mockResolvedValue(handle);
      return { book, handle };
    }
    afterEach(() => vi.useRealTimers());

    it("un rinnovo accettato ma non ancora visibile non ferma il lavoro: si riprova al battito dopo", async () => {
      const { book, handle } = await linkedBook();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      lease.renew.mockRejectedValueOnce(new LeaseRenewalMissed(handle as never, "lettura in ritardo"));
      lease.renew.mockResolvedValue(handle);
      const controller = new AbortController();
      await withWriterGuard(book.id, handle.sessionId, controller, async guard => {
        await guard.assertActive();
        await vi.advanceTimersByTimeAsync(25_000); // first beat: not confirmed
        expect(guard.failure()).toBeUndefined();
        expect(controller.signal.aborted).toBe(false);
        await guard.assertActive();
        await vi.advanceTimersByTimeAsync(25_000); // second beat: confirmed
        expect(lease.renew).toHaveBeenCalledTimes(2);
        expect(controller.signal.aborted).toBe(false);
      });
      expect(lease.release).toHaveBeenCalled();
    });

    it("un blocco perso davvero ferma subito il lavoro e la richiesta AI in corso", async () => {
      const { book, handle } = await linkedBook();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      lease.renew.mockRejectedValueOnce(new RemoteWriterLost("Il blocco è passato a un'altra sessione"));
      const controller = new AbortController();
      const seen: { aborted?: boolean; failure?: string; assertError?: string } = {};
      await withWriterGuard(book.id, handle.sessionId, controller, async guard => {
        await guard.assertActive();
        await vi.advanceTimersByTimeAsync(25_000);
        seen.aborted = controller.signal.aborted;
        seen.failure = guard.failure()?.message;
        seen.assertError = await guard.assertActive().then(() => "nessun errore", e => (e as Error).message);
      });
      expect(seen.aborted).toBe(true);
      expect(seen.failure).toMatch(/un'altra sessione/);
      expect(seen.assertError).toMatch(/un'altra sessione/);
      expect(lease.release).toHaveBeenCalled();
    });
  });
});
