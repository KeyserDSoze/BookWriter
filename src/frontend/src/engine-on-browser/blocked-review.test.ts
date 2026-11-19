import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type BookProject } from "@engine/domain/types";
import { BookRevisionConflict, getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("@engine/infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("@engine/application/writer-guard", () => ({ withWriterGuard: writerGuard }));
import { createEditorialCycle } from "@engine/domain/editorial-board";
import { AutopilotRunner } from "@engine/application/autopilot";
import { clearBlockedDraft, closeBlockedChapterByAuthor, loadBlockedDraft, saveBlockedDraft } from "../application/blocked-review";
import { updateDirectorDecidesWhenBlocked } from "../application/book-settings";
import { reopenChapterReview } from "../application/editorial-control";

function blocked(autonomous: boolean): BookProject {
  const b = newBook("Mara protegge la chiave di un castello.", "Romanzo", "Sobrio", "Adulti");
  b.phase = "chapterReview"; b.status = "paused";
  if (autonomous) b.directorDecidesWhenBlocked = true;
  b.chapters = [{ id: "ch-1", number: 1, title: "Il castello", purpose: "Presentazione",
    scenes: [{ id: "scene-1", number: 1, title: "Ingresso", objective: "Aprire la trama",
      text: "Mara saluta il guardiano e passa la porta.", status: "canon", summary: "Mara entra." }] }];
  const cycle = createEditorialCycle("ch-1");
  cycle.stage = "blocked"; cycle.round = 4; cycle.blockedReason = "Tre cicli non hanno risolto i problemi: serve una decisione umana.";
  cycle.priorRounds = [{ round: 3, reports: [], judgment: { reasoning: "Un problema rimasto aperto.", decisions: [], verdict: "repair", createdAt: new Date().toISOString() } }];
  b.editorialCycle = cycle;
  return b;
}
const synopsis = JSON.stringify({
  chapterSummary: "Mara entra al castello dopo una breve conversazione con il guardiano.",
  bookSummary: "All'inizio del romanzo Mara entra al castello custodendo la propria chiave.",
});

beforeEach(async () => {
  const db = await getDb();
  await db.clear("books"); await db.clear("activities"); await db.clear("outbox"); await db.clear("meta");
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  modelCall.mockReset(); writerGuard.mockReset();
  writerGuard.mockImplementation(async (_bookId, _runId, _ctrl, callback) =>
    callback({ assertActive: async () => {}, failure: () => undefined }));
  vi.stubGlobal("navigator", { locks: { request: async (_n: string, _o: unknown, cb: (lock: object) => Promise<unknown>) => cb({ name: "lock" }) } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Il direttore decide da solo a fine cicli", () => {
  it("chiude il capitolo senza altre revisioni, scrive la sinossi e registra la decisione", async () => {
    const source = blocked(true); await saveBook(source, false);
    const kinds: string[] = [];
    modelCall.mockImplementation(async (kind: string) => {
      kinds.push(kind);
      return { text: synopsis, endpointId: "test", modelId: "Astra", inputTokens: 100, outputTokens: 30 };
    });
    await new AutopilotRunner().run(source.id, async () => undefined);
    const saved = (await getBook(source.id))!;
    expect(kinds).toEqual(["summarize"]);
    expect(saved.chapters[0]!.frozenAt).toBeDefined();
    expect(saved.chapters[0]!.forcedFreeze).toMatchObject({ by: "director", frozenAt: saved.chapters[0]!.frozenAt });
    expect(saved.chapters[0]!.editorialRounds).toHaveLength(1);
    expect(saved.editorialCycle).toBeUndefined();
    const history = await listActivities(source.id);
    expect(history.some(a => a.title.startsWith("Il direttore chiude il capitolo 1") && a.aiRequested === false)).toBe(true);
  });
  it("senza la delega il libro resta fermo sul blocco e non chiama il modello", async () => {
    const source = blocked(false); await saveBook(source, false);
    modelCall.mockResolvedValue({ text: synopsis, endpointId: "test", modelId: "Astra" });
    await expect(new AutopilotRunner().run(source.id, async () => undefined)).rejects.toThrow(/serve una decisione umana/);
    const saved = (await getBook(source.id))!;
    expect(modelCall).not.toHaveBeenCalled();
    expect(saved.editorialCycle?.stage).toBe("blocked");
    expect(saved.chapters[0]!.frozenAt).toBeUndefined();
  });
  it("l'impostazione si cambia con libro fermo e revisione aggiornata", async () => {
    const source = blocked(false); await saveBook(source, false);
    const stored = (await getBook(source.id))!;
    await updateDirectorDecidesWhenBlocked(source.id, stored.updatedAt, true);
    expect((await getBook(source.id))!.directorDecidesWhenBlocked).toBe(true);
    await expect(updateDirectorDecidesWhenBlocked(source.id, stored.updatedAt, false)).rejects.toBeInstanceOf(BookRevisionConflict);
  });
});

describe("Chiusura decisa dall'autore", () => {
  it("manda il capitolo alla sinossi con la nota dell'autore e lo registra nel log", async () => {
    const source = blocked(false); await saveBook(source, false);
    const stored = (await getBook(source.id))!;
    await closeBlockedChapterByAuthor(source.id, stored.updatedAt, "Il ritmo mi piace così.");
    const saved = (await getBook(source.id))!;
    expect(saved.editorialCycle).toMatchObject({ stage: "summary", summaryCursor: 0, forcedClose: { by: "author", note: "Il ritmo mi piace così." } });
    expect(saved.status).toBe("paused");
    expect((await listActivities(source.id)).some(a => a.title === "Capitolo 1 chiuso dall'autore")).toBe(true);
    modelCall.mockImplementation(async () => ({ text: synopsis, endpointId: "test", modelId: "Astra" }));
    await new AutopilotRunner().run(source.id, async () => undefined);
    const done = (await getBook(source.id))!;
    expect(done.chapters[0]!.forcedFreeze).toMatchObject({ by: "author", note: "Il ritmo mi piace così." });
  });
  it("rifiuta se la revisione è cambiata o la redazione non è bloccata", async () => {
    const source = blocked(false); await saveBook(source, false);
    await expect(closeBlockedChapterByAuthor(source.id, "2000-01-01T00:00:00.000Z", "")).rejects.toBeInstanceOf(BookRevisionConflict);
    const stored = (await getBook(source.id))!;
    stored.editorialCycle!.stage = "review"; await saveBook(stored, false);
    const again = (await getBook(source.id))!;
    await expect(closeBlockedChapterByAuthor(source.id, again.updatedAt, "")).rejects.toThrow(/non è bloccata/);
  });
});

describe("Bozza dell'autore sul dispositivo", () => {
  it("si salva, si rilegge, e una bozza di un'altra tornata non vale", async () => {
    const draft = { chapterId: "ch-1", round: 3, decisions: { "3:style:0:0": { choice: "custom" as const, note: "Una nota molto lunga. ".repeat(400) } }, generalNote: "Ok", updatedAt: "" };
    await saveBlockedDraft("b1", draft);
    expect((await loadBlockedDraft("b1", "ch-1", 3)).decisions["3:style:0:0"]?.note.length).toBeGreaterThan(8000);
    expect((await loadBlockedDraft("b1", "ch-1", 4)).decisions).toEqual({});
    await clearBlockedDraft("b1", "ch-1", 3);
    expect((await loadBlockedDraft("b1", "ch-1", 3)).generalNote).toBe("");
  });
});

describe("Vincoli del libro: limite condiviso", () => {
  it("una nota che farebbe superare il limite non entra nei vincoli", async () => {
    const source = blocked(false);
    source.authorConstraints = ["z".repeat(7000)];
    await saveBook(source, false);
    await expect(reopenChapterReview(source.id, "ch-1", "w".repeat(2000))).rejects.toThrow(/superano 8000 caratteri/);
    expect((await getBook(source.id))!.authorConstraints).toHaveLength(1);
  });
});
