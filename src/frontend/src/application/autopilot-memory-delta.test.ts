import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type TaskKind } from "../domain/types";

const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("../infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("./writer-guard", () => ({ withWriterGuard: writerGuard }));
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
import { AutopilotRunner } from "./autopilot";

type Call = { kind: TaskKind; system: string; prompt: string };
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
  modelCall.mockImplementation(async (kind: TaskKind, system: string, prompt: string) => {
    calls.push({ kind, system, prompt });
    const next = replies[calls.length - 1];
    if (next === undefined) throw new Error("Chiamata AI inattesa: " + kind);
    if (calls.length >= replies.length) runner.stopAfterCurrent();
    return { text: next, endpointId: "openai", modelId: "test-model", inputTokens: 10, outputTokens: 5 };
  });
}
function twoSceneBook(phase: "consolidate" | "prose") {
  const book = newBook("Il porto.", "Il porto", "Sobrio", "Adulti");
  book.phase = phase; book.status = "paused";
  book.memory.characters = { Mara: "Arriva al porto", Ivo: "Guardiano" };
  book.memory.timeline = ["Mara arriva"];
  book.chapters = [{ id: "ch-1", number: 1, title: "Il porto", purpose: "Inizio del libro",
    scenes: [
      { id: "s-1", number: 1, title: "Arrivo", objective: "Arrivare al porto", status: "canon",
        text: "Mara scende dalla nave e trova una lettera sul molo. ".repeat(10) },
      { id: "s-2", number: 2, title: "Lettera", objective: "Leggere la lettera", status: "planned", text: "" },
    ] }];
  if (phase === "consolidate") book.currentSceneId = "s-1";
  return book;
}

describe("Memoria narrativa a delta e compattazione", () => {
  it("il consolidamento applica solo il delta e salva il riassunto reale della scena", async () => {
    const book = twoSceneBook("consolidate");
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [JSON.stringify({ mode: "delta", sceneSummary: "Mara trova una lettera sul molo e la nasconde.",
      characters: { Mara: "Ha una lettera" }, timelineAdd: ["Mara trova la lettera"] })]);
    await runner.run(book.id, async () => undefined);
    expect(calls[0]!.kind).toBe("consolidate");
    expect(calls[0]!.prompt).toContain('"mode":"delta"');
    const saved = (await getBook(book.id))!;
    expect(saved.memory.characters).toEqual({ Mara: "Ha una lettera", Ivo: "Guardiano" });
    expect(saved.memory.timeline).toEqual(["Mara arriva", "Mara trova la lettera"]);
    expect(saved.chapters[0]!.scenes[0]!.summary).toBe("Mara trova una lettera sul molo e la nasconde.");
    expect(saved.phase).toBe("prose");
  });

  it("accetta ancora la memoria completa dei modelli che non usano il delta", async () => {
    const book = twoSceneBook("consolidate");
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [JSON.stringify({ characters: { Nuova: "x" }, locations: {}, factions: {}, items: {},
      secrets: {}, timeline: ["e1"], currentState: "ok" })]);
    await runner.run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(saved.memory.characters).toEqual({ Nuova: "x" });
    expect(saved.chapters[0]!.scenes[0]!.summary).toBeUndefined();
  });

  it("compatta da sola una memoria troppo grande prima di scrivere la scena successiva", async () => {
    const book = twoSceneBook("prose");
    book.memory.characters = Object.fromEntries(Array.from({ length: 70 }, (_, i) => ["P" + i, "x".repeat(450)]));
    book.authorInterventions = [{ id: "n1", createdAt: new Date().toISOString(), instruction: "Nota autore",
      scope: "next_step", phase: "prose", stepLabel: "Scrittura" }];
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [JSON.stringify({ characters: { Mara: "Sintesi" }, locations: {}, factions: {}, items: {},
      secrets: {}, timeline: ["Mara arriva"], currentState: "Inizio" })]);
    await runner.run(book.id, async () => undefined);
    expect(calls[0]!.prompt).toContain("Compatta la memoria narrativa");
    expect(calls[0]!.prompt).not.toContain("INDICAZIONI DELL'AUTORE");
    const saved = (await getBook(book.id))!;
    expect(Object.keys(saved.memory.characters)).toEqual(["Mara"]);
    expect(saved.authorInterventions![0]!.appliedAt).toBeUndefined();
    expect(saved.phase).toBe("prose");
  });

  it("una compattazione che non riduce abbastanza fallisce invece di ripetersi all'infinito", async () => {
    const book = twoSceneBook("prose");
    book.memory.characters = Object.fromEntries(Array.from({ length: 70 }, (_, i) => ["P" + i, "x".repeat(450)]));
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [JSON.stringify({ ...book.memory })]);
    await runner.run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(saved.status).toBe("error");
    expect(saved.previousError).toMatch(/15%/);
    expect(calls).toHaveLength(1);
    expect((await listActivities(book.id)).filter(a => a.aiRequested)).toHaveLength(1);
  });

  it("rifiuta come prosa un JSON o una scena vuota senza canonizzare nulla", async () => {
    const book = twoSceneBook("prose");
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, ['{"scena":"testo"}']);
    await runner.run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(saved.status).toBe("error");
    expect(saved.previousError).toMatch(/JSON invece della prosa/);
    expect(saved.chapters[0]!.scenes[1]!.status).toBe("planned");
  });
});
