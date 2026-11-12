import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type TaskKind } from "../domain/types";

const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("../infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("./writer-guard", () => ({ withWriterGuard: writerGuard }));
import { getBook, getDb, saveBook, saveSettings } from "../infrastructure/db";
import { AutopilotRunner } from "./autopilot";

type Call = { kind: TaskKind; prompt: string };
const calls: Call[] = [];
beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta"]) await db.clear(store);
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  calls.length = 0;
  modelCall.mockReset(); writerGuard.mockReset();
  writerGuard.mockImplementation(async (_b, _r, _c, callback) =>
    callback({ assertActive: async () => {}, failure: () => undefined }));
});
function script(runner: AutopilotRunner, replies: string[]) {
  modelCall.mockImplementation(async (kind: TaskKind, _system: string, prompt: string) => {
    calls.push({ kind, prompt });
    const next = replies[calls.length - 1];
    if (next === undefined) throw new Error("Chiamata AI inattesa: " + kind);
    if (calls.length >= replies.length) runner.stopAfterCurrent();
    return { text: next, endpointId: "openai", modelId: "m", inputTokens: 1, outputTokens: 1 };
  });
}
const list = (n: number) => JSON.stringify({ chapters: Array.from({ length: n }, (_, i) => ({
  title: "Capitolo " + (i + 1), purpose: "Scopo del capitolo " + (i + 1) })) });
const scenes = (n: number) => JSON.stringify({ scenes: Array.from({ length: n }, (_, i) => ({
  title: "Scena " + (i + 1), objective: "Obiettivo della scena " + (i + 1) })) });
function outlineBook(chapters: number, pause = false) {
  const book = newBook("Un lungo viaggio.", "Il viaggio", "Sobrio", "Adulti", { startMode: "idea", targetChapterCount: chapters, pauseAfterOutline: pause });
  book.phase = "outline"; book.status = "paused";
  return book;
}

describe("Piano dei capitoli in più passi per i libri lunghi", () => {
  it("elenca i capitoli e poi pianifica le scene un capitolo per volta", async () => {
    const book = outlineBook(7, true);
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [list(7), ...Array.from({ length: 7 }, () => scenes(2))]);
    await runner.run(book.id, async () => undefined);
    expect(calls).toHaveLength(8);
    expect(calls[0]!.prompt).toContain("Elenca SOLO i capitoli");
    expect(calls[1]!.prompt).toContain("Pianifica le scene SOLO del capitolo 1 «Capitolo 1»");
    expect(calls[7]!.prompt).toContain("capitolo 7 «Capitolo 7»");
    const saved = (await getBook(book.id))!;
    expect(saved.chapters).toHaveLength(7);
    expect(saved.chapters.every(ch => ch.scenes.length === 2)).toBe(true);
    expect(saved.chapters[6]!.scenes[1]!.id).toBe("scene:007:002");
    expect(saved.phase).toBe("prose");
    expect(saved.status).toBe("paused");
  });

  it("riprende dal capitolo mancante dopo un errore, senza rifare l'elenco", async () => {
    const book = outlineBook(7);
    await saveBook(book, false);
    let runner = new AutopilotRunner();
    script(runner, [list(7), scenes(2), "non è JSON"]);
    await runner.run(book.id, async () => undefined);
    let saved = (await getBook(book.id))!;
    expect(saved.status).toBe("error");
    expect(saved.chapters[0]!.scenes).toHaveLength(2);
    expect(saved.chapters[1]!.scenes).toHaveLength(0);
    expect(saved.phase).toBe("outline");
    calls.length = 0;
    saved.status = "paused";
    await saveBook(saved, false);
    runner = new AutopilotRunner();
    script(runner, Array.from({ length: 6 }, () => scenes(1)));
    await runner.run(book.id, async () => undefined);
    expect(calls[0]!.prompt).toContain("capitolo 2 «Capitolo 2»");
    saved = (await getBook(book.id))!;
    expect(saved.chapters.every(ch => ch.scenes.length > 0)).toBe(true);
    expect(saved.phase).toBe("prose");
  });

  it("rifiuta un elenco con il numero sbagliato di capitoli e accetta ancora il piano completo in una risposta", async () => {
    const wrong = outlineBook(7);
    await saveBook(wrong, false);
    let runner = new AutopilotRunner();
    script(runner, [list(5)]);
    await runner.run(wrong.id, async () => undefined);
    expect((await getBook(wrong.id))!.status).toBe("error");
    expect((await getBook(wrong.id))!.chapters).toEqual([]);

    calls.length = 0;
    const full = outlineBook(7);
    await saveBook(full, false);
    runner = new AutopilotRunner();
    script(runner, [JSON.stringify({ chapters: Array.from({ length: 7 }, (_, i) => ({
      title: "C" + (i + 1), purpose: "Scopo del capitolo " + (i + 1),
      scenes: [{ title: "Scena", objective: "Obiettivo della scena" }] })) })]);
    await runner.run(full.id, async () => undefined);
    const saved = (await getBook(full.id))!;
    expect(saved.phase).toBe("prose");
    expect(saved.chapters).toHaveLength(7);
    expect(calls).toHaveLength(1);
  });

  it("i libri brevi restano pianificati con una sola chiamata", async () => {
    const book = outlineBook(3);
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [JSON.stringify({ chapters: Array.from({ length: 3 }, (_, i) => ({
      title: "C" + (i + 1), purpose: "Scopo del capitolo " + (i + 1),
      scenes: [{ title: "Scena", objective: "Obiettivo della scena" }] })) })]);
    await runner.run(book.id, async () => undefined);
    expect(calls[0]!.prompt).toContain("Crea un piano completo");
    expect((await getBook(book.id))!.phase).toBe("prose");
  });
});
