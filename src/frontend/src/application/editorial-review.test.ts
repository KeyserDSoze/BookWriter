import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook } from "../domain/types";
import { getBook, getDb, listActivities, saveBook } from "../infrastructure/db";
import { confirmEditorialScene } from "./editorial-review";
import { AutopilotRunner, requestRevision } from "./autopilot";

beforeEach(async () => {
  const db = await getDb();
  await db.clear("books"); await db.clear("activities"); await db.clear("outbox");
  vi.stubGlobal("navigator", {
    locks: { request: async (_name: string, _options: unknown,
      callback: (lock: object) => Promise<unknown>) => callback({ name: "mock" }) },
  });
});
afterEach(() => vi.unstubAllGlobals());

async function readyBook() {
  const book = newBook("Idea", "Libro fuso", "Stile", "Adulti");
  book.status = "paused";
  book.remote = { owner: "owner", repository: "repo", branch: "main",
    autoSync: false, lastSyncedCommit: "a".repeat(40) };
  book.chapters = [{
    id: "chapter1", number: 1, title: "Capitolo", purpose: "Introduzione",
    scenes: [
      { id: "scene1", number: 1, title: "Fusione editoriale",
        objective: "Un incontro", text: "Testo fuso dopo confronto.", status: "draft" },
    ],
  }];
  book.editorialReviewSceneIds = ["scene1"];
  await saveBook(book, false);
  return book;
}

describe("Conferma umana delle proposte di scena", () => {
  it("promuove solo la scena riletta a canon, lasciando invariato il remoto e senza outbox", async () => {
    const book = await readyBook();
    await confirmEditorialScene(book.id, "scene1", book.updatedAt);
    const result = await getBook(book.id);
    expect(result?.chapters[0]?.scenes[0]?.status).toBe("canon");
    expect(result?.chapters[0]?.scenes[0]?.text).toBe("Testo fuso dopo confronto.");
    expect(result?.editorialReviewSceneIds).toEqual([]);
    expect(result?.status).toBe("paused");
    expect(result?.remote?.autoSync).toBe(false);
    expect(await (await getDb()).get("outbox", book.id)).toBeUndefined();
    expect((await listActivities(book.id)).some(x => x.title === "Conferma editoriale della scena")).toBe(true);
  });

  it("rifiuta una conferma obsoleta dopo modifica del libro", async () => {
    const book = await readyBook();
    const revision = book.updatedAt;
    const latest = await getBook(book.id);
    latest!.chapters[0]!.scenes[0]!.text = "L'autore ha modificato di nuovo.";
    await saveBook(latest!, false);
    await expect(confirmEditorialScene(book.id, "scene1", revision)).rejects.toThrow(/cambiato/);
    expect((await getBook(book.id))?.chapters[0]?.scenes[0]?.status).toBe("draft");
  });

  it("non promuove scene non selezionate o già canoniche", async () => {
    const book = await readyBook();
    await expect(confirmEditorialScene(book.id, "sconosciuta", book.updatedAt))
      .rejects.toThrow(/non richiede/);
    const latest = await getBook(book.id);
    latest!.chapters[0]!.scenes[0]!.status = "canon";
    await saveBook(latest!, false);
    await expect(confirmEditorialScene(book.id, "scene1", latest!.updatedAt))
      .rejects.toThrow(/non puoi/i);
  });

  it("non avvia il runner AI o una revisione prima della canonizzazione, anche bypassando la UI", async () => {
    const book = await readyBook();
    book.remote = undefined; // Local book avoids remote test networking.
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    const update = vi.fn(async () => undefined);
    await expect(runner.run(book.id, update)).rejects.toThrow(/Rileggi e conferma/);
    const latest = await getBook(book.id);
    await expect(requestRevision(book.id, "Riscrivi tutto", latest!.updatedAt))
      .rejects.toThrow(/Conferma le scene/);
    const untouched = await getBook(book.id);
    expect(untouched?.status).toBe("paused");
    expect(untouched?.chapters[0]?.scenes[0]?.status).toBe("draft");
  });

  it("rifiuta conferma mentre un'altra scheda scrive il libro", async () => {
    const book = await readyBook();
    vi.stubGlobal("navigator", {
      locks: { request: async (_key: string, _opts: unknown,
        callback: (lock: null) => Promise<unknown>) => callback(null) },
    });
    await expect(confirmEditorialScene(book.id, "scene1", book.updatedAt))
      .rejects.toThrow(/Un'altra scheda/);
  });
});
