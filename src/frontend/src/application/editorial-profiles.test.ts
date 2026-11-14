import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { profileBook } from "../domain/__fixtures__/editorial-profiles";
import { createEditorialCycle } from "../domain/editorial-board";
import { bumpProfileVersions } from "../domain/editorial-profiles";
import { saveEditorialProfiles } from "./editorial-profiles";
import { getBook, getDb, listActivities, saveBook } from "../infrastructure/db";

const locks: string[] = [];
beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta"]) await db.clear(store);
  locks.length = 0;
  vi.stubGlobal("navigator", { locks: { request: async (name: string, options: { ifAvailable: boolean }, action: (lock: object) => Promise<void>) => {
    expect(options.ifAvailable).toBe(true); locks.push(name); return action({});
  } } });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network expected"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Salvataggio autore dei profili", () => {
  it("è atomico, non avvia AI, conserva canone e ciclo esatto, spegne autosync e svuota outbox", async () => {
    const book = profileBook();
    book.remote = { owner: "demo", repository: "novel", branch: "main", autoSync: true };
    book.editorialCycle = createEditorialCycle(book.chapters[0]!.id, book);
    await saveBook(book, false);
    await (await getDb()).put("outbox", { bookId: book.id, operationId: crypto.randomUUID(), state: "pending", revision: 1,
      attempts: 0, requestedAt: book.updatedAt }, book.id);
    const before = await getBook(book.id);
    const draft = structuredClone(book.editorialProfiles!);
    draft.writers[0]!.writingPrompt = "Una direttiva diversa per le scene future: mostra, senza spiegare troppo.";
    await saveEditorialProfiles(book.id, book.updatedAt, draft, true);
    const after = (await getBook(book.id))!;
    expect(after.editorialProfiles).toEqual(bumpProfileVersions(book.editorialProfiles, draft));
    expect(after.editorialProfiles!.writers[0]!.version).toBe(2);
    expect(after.editorialProfiles!.readers[0]!.version).toBe(1);
    expect(after.editorialCycle).toEqual(before!.editorialCycle);
    expect(after.chapters).toEqual(before!.chapters);
    expect(after.memory).toEqual(before!.memory);
    expect(after.remote?.autoSync).toBe(false);
    expect(await (await getDb()).get("outbox", book.id)).toBeUndefined();
    expect(await (await getDb()).getAllKeys("meta")).toEqual([]);
    const activities = await listActivities(book.id);
    expect(activities).toHaveLength(1);
    expect(activities[0]!.aiRequested).toBe(false);
    expect(JSON.stringify(activities)).not.toContain("WRITER_ONLY");
    expect(JSON.stringify(activities)).not.toContain("Scrittore essenziale");
    expect(locks).toEqual(["bookwriter:writer:" + book.id, "bookwriter:github-outbox"]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("richiede conferma, supporto lock e revisione attuale senza perdere il draft", async () => {
    const book = profileBook(); await saveBook(book, false);
    const before = await getBook(book.id), draft = structuredClone(book.editorialProfiles!);
    await expect(saveEditorialProfiles(book.id, book.updatedAt, draft, false)).rejects.toThrow(/Conferma/);
    await expect(saveEditorialProfiles(book.id, "stale", draft, true)).rejects.toThrow(/cambiato/);
    await expect(saveEditorialProfiles(book.id, book.updatedAt, draft, true, () => false)).rejects.toThrow(/superata/);
    vi.stubGlobal("navigator", {});
    await expect(saveEditorialProfiles(book.id, book.updatedAt, draft, true)).rejects.toThrow(/Web Locks/);
    expect(await getBook(book.id)).toEqual(before);
    expect(await listActivities(book.id)).toEqual([]);
    expect(draft).toEqual(book.editorialProfiles);
  });
  it.each(["writer", "outbox"])("non aspetta né scrive con lock %s occupato", async kind => {
    const book = profileBook(); await saveBook(book, false);
    vi.stubGlobal("navigator", { locks: { request: async (name: string, _options: unknown, action: (lock: object | null) => Promise<void>) =>
      action((kind === "writer" ? name.includes("writer:") : name.endsWith("github-outbox")) ? null : {}) } });
    await expect(saveEditorialProfiles(book.id, book.updatedAt, book.editorialProfiles, true)).rejects.toThrow();
    expect(await listActivities(book.id)).toEqual([]);
    expect((await getBook(book.id))?.updatedAt).toBe(book.updatedAt);
  });
  it("blocca running e un panel delle idee parziale, ma permette il ritorno esplicito allo standard", async () => {
    const book = profileBook(); book.status = "running"; await saveBook(book, false);
    await expect(saveEditorialProfiles(book.id, book.updatedAt, book.editorialProfiles, true)).rejects.toThrow(/pausa/);
    book.status = "paused"; book.phase = "audience"; book.audienceReviews = ["Prima lettura già fatta"];
    await saveBook(book, false);
    await expect(saveEditorialProfiles(book.id, book.updatedAt, book.editorialProfiles, true)).rejects.toThrow(/panel/);
    book.phase = "prose"; await saveBook(book, false);
    await saveEditorialProfiles(book.id, book.updatedAt, undefined, true);
    expect((await getBook(book.id))!.editorialProfiles).toBeUndefined();
  });
});
