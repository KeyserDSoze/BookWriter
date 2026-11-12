import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook } from "../domain/types";
import { BookRevisionConflict, getBook, getDb, saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import { updateBookModelRoute,updateBookTaskReasoning } from "./book-settings"; 


const locksUnavailable = new Set<string>();
const request = vi.fn(async (
  name: string, options: { ifAvailable?: boolean },
  fn: (lock: { name: string } | null) => Promise<unknown>,
) => {
  expect(options.ifAvailable).toBe(true);
  return fn(locksUnavailable.has(name) ? null : { name });
});

beforeEach(async () => {
  const db = await getDb();
  await db.clear("books");
  await db.clear("outbox");
  locksUnavailable.clear();
  request.mockClear();
  vi.stubGlobal("navigator", { locks: { request } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Reasoning per libro: CAS, writer lock e isolamento del canone",()=>{
  it("salva soltanto l'override del task e preserva le route esistenti",async()=>{
    const book=newBook("Una trama","Titolo","Prosa","Bambini");
    book.taskReasoningEfforts={prose:"medium"};
    book.modelRoutes={brainstorm:{endpointId:"e",modelId:"m"}};
    await saveBook(book,false);
    await updateBookTaskReasoning(book.id,book.updatedAt,"brainstorm","low");
    const saved=(await getBook(book.id))!;
    expect(saved.taskReasoningEfforts).toEqual({prose:"medium",brainstorm:"low"});
    expect(saved.modelRoutes).toEqual(book.modelRoutes);
    expect(saved.brief).toBe(book.brief);
    expect(saved.updatedAt).not.toBe(book.updatedAt);
    await updateBookTaskReasoning(book.id,saved.updatedAt,"brainstorm",undefined);
    expect((await getBook(book.id))?.taskReasoningEfforts?.brainstorm).toBeUndefined();
  });
  it("rifiuta valori non validi, revisioni stale, lock occupato e running",async()=>{
    const book=newBook("Una trama","Titolo","Prosa","Bambini");
    await saveBook(book,false);
    await expect(updateBookTaskReasoning(book.id,book.updatedAt,"brainstorm",
      "inventato" as "low")).rejects.toThrow(/reasoning del task/);
    locksUnavailable.add("bookwriter:writer:"+book.id);
    await expect(updateBookTaskReasoning(book.id,book.updatedAt,"brainstorm","high"))
      .rejects.toThrow(/Un'altra scheda/);
    locksUnavailable.clear();
    const updated=(await getBook(book.id))!;
    updated.title="Aggiornato altrove";await saveBook(updated,false);
    await expect(updateBookTaskReasoning(book.id,book.updatedAt,"brainstorm","low"))
      .rejects.toBeInstanceOf(BookRevisionConflict);
    updated.status="running";await saveBook(updated,false);
    await expect(updateBookTaskReasoning(book.id,updated.updatedAt,"brainstorm","low"))
      .rejects.toThrow(/Metti prima in pausa/);
  });
});
describe("Override modello: fencing manuale e CAS IndexedDB", () => {
  it("modifica soltanto la rotta del task e preserva canone e altri override", async () => {
    const book = newBook("Trama", "Romanzo", "", "");
    book.memory.characters["A"] = "Il segreto dell'autore";
    book.modelRoutes = { continuity: { endpointId: "test", modelId: "review" } };
    await saveBook(book, false);
    const before = book.updatedAt;

    await updateBookModelRoute(book.id, before, "prose", "provider", "new-model");
    const stored = await getBook(book.id);
    expect(stored?.updatedAt).not.toBe(before);
    expect(stored?.modelRoutes).toEqual({
      continuity: { endpointId: "test", modelId: "review" },
      prose: { endpointId: "provider", modelId: "new-model" },
    });
    expect(stored?.memory.characters["A"]).toBe("Il segreto dell'autore");
    expect(request).toHaveBeenCalledWith(
      "bookwriter:writer:" + book.id, { ifAvailable: true }, expect.any(Function),
    );
  });

  it("rifiuta una revisione stale senza alterare né libro né outbox", async () => {
    const book = newBook("Trama", "Romanzo", "", "");
    book.remote = {
      owner: "test-owner", repository: "test-book", branch: "main",
      lastSyncedCommit: "a".repeat(40), autoSync: true,
    };
    await saveBook(book, false);
    const staleRevision = book.updatedAt;
    const latest = (await getBook(book.id))!;
    latest.brief = "Nuova trama salvata in un'altra scheda";
    await saveBook(latest);
    const queued = await getOutbox(book.id);
    const actual = await getBook(book.id);

    await expect(updateBookModelRoute(book.id, staleRevision, "prose", "e", "stale"))
      .rejects.toBeInstanceOf(BookRevisionConflict);
    expect(await getBook(book.id)).toEqual(actual);
    expect(await getOutbox(book.id)).toEqual(queued);
  });

  it("verifica la revisione dentro la transazione anche senza Web Lock", async () => {
    const book = newBook("Trama", "Romanzo", "", "");
    await saveBook(book, false);
    const stale = structuredClone(book);
    const originalTimestamp = stale.updatedAt;
    const modified = (await getBook(book.id))!;
    modified.title = "Titolo aggiornato";
    await saveBook(modified, false);

    stale.title = "Dati obsoleti";
    await expect(saveBook(stale, true, originalTimestamp))
      .rejects.toBeInstanceOf(BookRevisionConflict);
    expect(stale.updatedAt).toBe(originalTimestamp);
    expect((await getBook(book.id))?.title).toBe("Titolo aggiornato");
    expect(await getOutbox(book.id)).toBeUndefined();
  });

  it("non salva mentre un'altra scheda detiene il Web Lock", async () => {
    const book = newBook("Trama", "Romanzo", "", "");
    await saveBook(book, false);
    locksUnavailable.add("bookwriter:writer:" + book.id);
    const before = await getBook(book.id);
    await expect(updateBookModelRoute(book.id, book.updatedAt, "prose", "p", "blocked"))
      .rejects.toThrow(/Un'altra scheda sta scrivendo/);
    expect(await getBook(book.id)).toEqual(before);
    expect(await getOutbox(book.id)).toBeUndefined();
  });

  it("non scrive senza Web Locks e non cambia libro running", async () => {
    const book = newBook("Trama", "Romanzo", "", "");
    await saveBook(book, false);
    vi.stubGlobal("navigator", {});
    await expect(updateBookModelRoute(book.id, book.updatedAt, "prose", "p", "no-lock"))
      .rejects.toThrow(/Web Locks non disponibile/);
    expect(await getBook(book.id)).toEqual(book);
    expect(request).not.toHaveBeenCalled();

    vi.stubGlobal("navigator", { locks: { request } });
    const running = (await getBook(book.id))!;
    running.status = "running";
    await saveBook(running, false);
    await expect(updateBookModelRoute(book.id, running.updatedAt, "prose", "p", "running"))
      .rejects.toThrow(/Metti prima in pausa l'autopilot/);
    expect((await getBook(book.id))?.modelRoutes).toBeUndefined();
  });

  it("due edit con la stessa revisione non possono entrambi sovrascrivere il libro", async () => {
    const book = newBook("Trama", "Romanzo", "", "");
    await saveBook(book, false);
    const results = await Promise.allSettled([
      updateBookModelRoute(book.id, book.updatedAt, "prose", "a", "first"),
      updateBookModelRoute(book.id, book.updatedAt, "continuity", "b", "second"),
    ]);
    expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(x => x.status === "rejected")).toHaveLength(1);
    const routes = (await getBook(book.id))?.modelRoutes;
    expect(Object.keys(routes ?? {})).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
