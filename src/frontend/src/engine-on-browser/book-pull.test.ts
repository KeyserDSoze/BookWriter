import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook, type Activity, type BookProject } from "@engine/domain/types";
import { getBook, getDb, listActivities, saveBook } from "../infrastructure/db";
import { RemoteConflict } from "@engine/infrastructure/github-sync";
import { getOutbox } from "@engine/infrastructure/outbox";

const { readSnapshot, isAncestor, confirmHead } = vi.hoisted(() => ({
  readSnapshot: vi.fn(), isAncestor: vi.fn(), confirmHead: vi.fn(),
}));
vi.mock("@engine/infrastructure/github-sync", async importOriginal => ({
  ...await importOriginal<typeof import("@engine/infrastructure/github-sync")>(),
  readGitHubSnapshot: readSnapshot, isGitHubAncestor: isAncestor, confirmGitHubHead: confirmHead,
}));
import { pullBookFastForward } from "../application/book-pull";

const BASE = "a".repeat(40), HEAD = "b".repeat(40);
const T1 = "2026-11-10T10:00:00.000Z", T2 = "2026-11-12T10:00:00.000Z";

function localBook(): BookProject {
  const book = newBook("Brief locale", "Il faro", "Sobrio", "Adulti");
  book.status = "paused"; book.updatedAt = T1;
  book.remote = { owner: "demo", repository: "faro", branch: "main", autoSync: true, allowPublicSync: true,
    lastSyncedCommit: BASE, lastSyncedLocalUpdatedAt: T1, lastSyncAt: T1 };
  return book;
}
function remoteVersion(local: BookProject, patch: Partial<BookProject> = {}): BookProject {
  return { ...structuredClone(local), title: "Il faro (continuato sul portatile)",
    updatedAt: new Date(Date.parse(local.updatedAt) + 60_000).toISOString(),
    chapters: [{ id: "c1", number: 1, title: "Nuovo capitolo", purpose: "p", scenes: [] }],
    remote: { owner: "ALTRO", repository: "ALTRO", branch: "altro" }, ...patch };
}
const activity = (id: string, bookId: string, status: Activity["status"] = "succeeded"): Activity => ({
  id, bookId, runId: "r", phase: "prose", title: "T", reason: "r", nextStep: "n", status, createdAt: T1 });

async function seed(book: BookProject, ...activities: Activity[]) {
  const db = await getDb();
  for (const name of ["books", "activities", "outbox", "meta"]) await db.clear(name);
  await saveBook(book, false);
  for (const item of activities) await db.put("activities", item, item.id);
  // saveBook stamps a new revision; keep the clean baseline of the test.
  const stored = (await getBook(book.id))!;
  stored.remote = { ...book.remote!, lastSyncedLocalUpdatedAt: stored.updatedAt };
  await db.put("books", stored, stored.id);
  return stored;
}

beforeEach(() => {
  vi.stubGlobal("navigator", { locks: { request: async (_n: string, _o: unknown, cb: (lock: object) => unknown) => cb({}) } });
  readSnapshot.mockReset(); isAncestor.mockReset(); confirmHead.mockReset();
  isAncestor.mockResolvedValue("ancestor"); confirmHead.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("aggiornamento da GitHub di un libro senza modifiche locali", () => {
  it("porta il libro al commit dell'altro dispositivo e avanza solo la baseline", async () => {
    const local = await seed(localBook(), activity("a-1", "x"), activity("solo-locale", "x"));
    await (await getDb()).put("activities", activity("solo-locale", local.id), "solo-locale");
    const remote = remoteVersion(local, { status: "running" });
    readSnapshot.mockResolvedValue({ book: remote, head: HEAD, activities: [
      activity("a-2", local.id), activity("in-corso", local.id, "running")] });

    const result = await pullBookFastForward(local.id);
    expect(result).toEqual({ status: "pulled", commit: HEAD, title: "Il faro (continuato sul portatile)" });
    const after = (await getBook(local.id))!;
    expect(after.title).toBe("Il faro (continuato sul portatile)");
    expect(after.chapters[0]!.title).toBe("Nuovo capitolo");
    // Destination and sync policy of THIS device are kept; the remote one is not trusted.
    expect(after.remote).toMatchObject({ owner: "demo", repository: "faro", branch: "main", autoSync: true,
      allowPublicSync: true, lastSyncedCommit: HEAD, lastSyncedLocalUpdatedAt: remote.updatedAt });
    expect(after.updatedAt).toBe(remote.updatedAt);
    // Nothing is running on this device: a book left «running» elsewhere is paused here.
    expect(after.status).toBe("paused");
    expect(after.previousError).toMatch(/altro dispositivo/);
    // The pull is not a local edit: nothing to push back.
    expect(await getOutbox(local.id)).toBeUndefined();
    const ids = (await listActivities(local.id)).map(item => item.id).sort();
    expect(ids).toEqual(["a-2", "in-corso", "solo-locale"]);
    expect((await listActivities(local.id)).find(item => item.id === "in-corso")!.status).toBe("cancelled");
  });
  it("già aggiornato: non tocca nulla", async () => {
    const local = await seed(localBook());
    readSnapshot.mockResolvedValue({ book: remoteVersion(local), head: BASE, activities: [] });
    expect(await pullBookFastForward(local.id)).toMatchObject({ status: "up_to_date", commit: BASE });
    expect(isAncestor).not.toHaveBeenCalled();
    expect((await getBook(local.id))!.title).toBe("Il faro");
  });
  it("la revisione non torna mai indietro, anche se l'orologio dell'altro PC era indietro", async () => {
    const local = await seed(localBook());
    readSnapshot.mockResolvedValue({ book: remoteVersion(local, { updatedAt: "2020-01-01T00:00:00.000Z" }), head: HEAD, activities: [] });
    await pullBookFastForward(local.id);
    const after = (await getBook(local.id))!;
    expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(local.updatedAt));
    expect(after.remote!.lastSyncedLocalUpdatedAt).toBe(after.updatedAt);
  });

  const refusal = (label: string, setup: () => Promise<{ id: string }>, message: RegExp) =>
    it("rifiuta: " + label, async () => {
      const { id } = await setup();
      const before = JSON.stringify(await getBook(id));
      const error = await pullBookFastForward(id).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(message);
      expect(JSON.stringify(await getBook(id))).toBe(before);
    });
  refusal("modifiche locali non ancora su GitHub", async () => {
    const book = await seed(localBook());
    await (await getDb()).put("books", { ...book, remote: { ...book.remote!, lastSyncedLocalUpdatedAt: "2020-01-01T00:00:00.000Z" } }, book.id);
    return book;
  }, /modifiche locali/);
  refusal("autopilot in esecuzione", async () => {
    const book = await seed(localBook());
    await (await getDb()).put("books", { ...book, status: "running" }, book.id);
    return book;
  }, /pausa/);
  refusal("sincronizzazione in coda", async () => {
    const book = await seed(localBook());
    await (await getDb()).put("outbox", { bookId: book.id, operationId: "op", revision: 1, requestedAt: T1, state: "pending", attempts: 0 }, book.id);
    return book;
  }, /in coda/);
  refusal("push manuale sospeso", async () => {
    const book = await seed(localBook());
    await (await getDb()).put("meta", { bookId: book.id, operationId: "op" }, "manual-github-push:" + book.id);
    return book;
  }, /sospeso/);
  refusal("libro mai sincronizzato", async () => {
    const book = await seed(localBook());
    await (await getDb()).put("books", { ...book, remote: { owner: "demo", repository: "faro", branch: "main" } }, book.id);
    return book;
  }, /mai stato sincronizzato/);
  refusal("libro non collegato a GitHub", async () => {
    const book = await seed(localBook());
    const { remote: _remote, ...unlinked } = book;
    await (await getDb()).put("books", unlinked, book.id);
    return book;
  }, /Collega prima/);

  it("rifiuta se la repository contiene un altro libro", async () => {
    const local = await seed(localBook());
    readSnapshot.mockResolvedValue({ book: { ...remoteVersion(local), id: crypto.randomUUID() }, head: HEAD, activities: [] });
    await expect(pullBookFastForward(local.id)).rejects.toBeInstanceOf(RemoteConflict);
    expect((await getBook(local.id))!.title).toBe("Il faro");
  });
  it.each([["not_found", /riscritta o divergente/], ["too_far", /1\.000 commit/]])(
    "storia non lineare (%s): rimanda al confronto e non tocca il libro", async (ancestry, message) => {
      const local = await seed(localBook());
      readSnapshot.mockResolvedValue({ book: remoteVersion(local), head: HEAD, activities: [] });
      isAncestor.mockResolvedValue(ancestry);
      const error = await pullBookFastForward(local.id).catch((e: unknown) => e) as Error;
      expect(error).toBeInstanceOf(RemoteConflict);
      expect(error.message).toMatch(message);
      expect(error.message).toMatch(/Confronto e recupero/);
      expect((await getBook(local.id))!.title).toBe("Il faro");
    });
  it("il branch si è spostato durante il controllo: nessuna modifica", async () => {
    const local = await seed(localBook());
    readSnapshot.mockResolvedValue({ book: remoteVersion(local), head: HEAD, activities: [] });
    confirmHead.mockRejectedValue(new RemoteConflict("La repository è cambiata durante il confronto."));
    await expect(pullBookFastForward(local.id)).rejects.toBeInstanceOf(RemoteConflict);
    expect((await getBook(local.id))!.title).toBe("Il faro");
  });
  it("il libro cambia in un'altra scheda proprio mentre si legge GitHub: la scrittura viene annullata", async () => {
    const local = await seed(localBook());
    readSnapshot.mockImplementation(async () => {
      const stored = (await getBook(local.id))!;
      await saveBook({ ...stored, title: "Modificato in un'altra scheda" }, false);
      return { book: remoteVersion(local), head: HEAD, activities: [] };
    });
    await expect(pullBookFastForward(local.id)).rejects.toMatchObject({ message: expect.stringMatching(/cambiato durante/) });
    expect((await getBook(local.id))!.title).toBe("Modificato in un'altra scheda");
  });
  it("un'altra scheda sta scrivendo o sincronizzando: rifiuta senza leggere GitHub", async () => {
    const local = await seed(localBook());
    vi.stubGlobal("navigator", { locks: { request: async (_n: string, _o: unknown, cb: (lock: null) => unknown) => cb(null) } });
    await expect(pullBookFastForward(local.id)).rejects.toBeInstanceOf(RemoteConflict);
    expect(readSnapshot).not.toHaveBeenCalled();
  });
  it("senza Web Locks non parte", async () => {
    const local = await seed(localBook());
    vi.stubGlobal("navigator", {});
    await expect(pullBookFastForward(local.id)).rejects.toThrow(/Web Locks/);
  });
});
