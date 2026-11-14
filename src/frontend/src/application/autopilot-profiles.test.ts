import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { profileBook } from "../domain/__fixtures__/editorial-profiles";
import { DEFAULT_SETTINGS } from "../domain/types";
import { chapterSegments, createEditorialCycle, cycleRoles, validateReport } from "../domain/editorial-board";
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("../infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("./writer-guard", () => ({ withWriterGuard: writerGuard }));
import { AutopilotRunner } from "./autopilot";
const pass = JSON.stringify({ verdict: "pass", summary: "Nessun difetto concreto nel segmento letto.", memoryNote: "", findings: [] });
const answer = (text: string) => ({ text, endpointId: "openai", modelId: "synthetic", inputTokens: 123, outputTokens: 45 });
beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta"]) await db.clear(store);
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  modelCall.mockReset(); writerGuard.mockReset();
  writerGuard.mockImplementation(async (_bookId, _runId, _controller, callback) => callback({ assertActive: async () => {}, failure: () => undefined }));
});
describe("Profili nel runner", () => {
  it("esegue 14 review isolate più giudice e sinossi, archiviando i template usati", async () => {
    const book = profileBook(); await saveBook(book, false);
    const calls: Array<{ kind: string; system: string; prompt: string }> = [];
    modelCall.mockImplementation(async (kind: string, system: string, prompt: string) => {
      calls.push({ kind, system, prompt });
      return answer(kind === "chapterJudge" ? JSON.stringify({ reasoning: "Tutti i rapporti sono stati esaminati in modo critico.", decisions: [] }) :
        kind === "summarize" ? JSON.stringify({ chapterSummary: "Mara raggiunge il porto e osserva una nave ancora silenziosa.",
          bookSummary: "All'inizio del libro Mara raggiunge il porto e osserva la nave." }) : pass);
    });
    await new AutopilotRunner().run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(saved.status).toBe("completed");
    expect(saved.chapters[0]!.editorialRounds![0]!.reports).toHaveLength(14);
    expect(saved.chapters[0]!.editorialRounds![0]!.profileSettings).toEqual(book.editorialProfiles);
    expect(saved.chapters[0]!.editorialMode).toBeUndefined();
    expect(calls).toHaveLength(16);
    expect(calls.filter(c => c.kind === "chapterReaders")).toHaveLength(6);
    const writer = calls.find(c => c.system.includes("WRITER_REVIEW_ONLY"))!;
    expect(writer.prompt).not.toContain("PRIVATE_CANON_SENTINEL");
    expect(writer.system).toContain("WRITER_ONLY");
    expect(calls.find(c => c.kind === "chapterJudge")!.prompt).toContain("WRITER_ONLY");
  });
  it("il profilo scelto entra nella scrittura e la forza è esplicita", async () => {
    const book = profileBook();
    book.chapters[0]!.scenes[0]!.status = "planned"; book.chapters[0]!.scenes[0]!.text = "";
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    modelCall.mockImplementation(async (_kind: string, _system: string, prompt: string) => {
      expect(prompt).toContain("WRITER_ONLY"); expect(prompt).toContain("Vincolo stilistico forte");
      expect(prompt).not.toContain("WRITER_REVIEW_ONLY"); expect(prompt).not.toContain("READER_ONE_ONLY");
      runner.stopAfterCurrent(); return answer("Mara attraversa il molo. Il vento muove le corde della nave.");
    });
    await runner.run(book.id, async () => undefined);
    expect((await getBook(book.id))!.phase).toBe("review");
    expect(modelCall).toHaveBeenCalledTimes(1);
  });
  it("un profilo cambiato nel ciclo durante la risposta è rifiutato, conservando usage e prosa", async () => {
    const book = profileBook(), chapter = book.chapters[0]!, cycle = createEditorialCycle(chapter.id, book), segment = chapterSegments(chapter)[0]!;
    for (const role of cycleRoles(book, cycle).slice(0, -1)) cycle.reports.push(validateReport(cycle, role, segment, 1, pass, chapter, book));
    book.phase = "chapterReview"; book.editorialCycle = cycle; await saveBook(book, false);
    modelCall.mockImplementation(async () => {
      const current = (await getBook(book.id))!;
      current.editorialCycle!.profileSettings!.writers[0]!.reviewPrompt = "Una direttiva sostitutiva non letta dal revisore.";
      await (await getDb()).put("books", current, current.id);
      return answer(pass);
    });
    await new AutopilotRunner().run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(saved.editorialCycle!.reports).toHaveLength(13);
    expect(saved.chapters).toEqual(book.chapters);
    expect(saved.chapters[0]!.frozenAt).toBeUndefined();
    expect((await listActivities(book.id)).find(a => a.aiRequested)).toMatchObject({ status: "failed", inputTokens: 123, outputTokens: 45 });
    expect(modelCall).toHaveBeenCalledTimes(1);
  });
  it("il panel delle idee usa il numero dei profili attivi, senza passare rapporti altrui", async () => {
    const book = profileBook(); book.phase = "audience";
    book.editorialProfiles!.readers.forEach((p, i) => { p.enabled = i < 2; });
    book.audienceReviews = ["OTHER_AUDIENCE_SENTINEL"]; await saveBook(book, false);
    const runner = new AutopilotRunner();
    modelCall.mockImplementation(async (kind: string, _system: string, prompt: string) => {
      expect(kind).toBe("audience"); expect(prompt).not.toContain("OTHER_AUDIENCE_SENTINEL");
      runner.stopAfterCurrent(); return answer("Una valutazione sintetica del secondo lettore.");
    });
    await runner.run(book.id, async () => undefined);
    expect((await getBook(book.id))!.phase).toBe("adversarial");
    expect((await listActivities(book.id)).find(a => a.aiRequested)?.title).toBe("Audience review 2/2");
  });
  it("il giudice non applica una risposta letta con un altro scrittore, anche senza writerReview", async () => {
    const book = profileBook(), chapter = book.chapters[0]!;
    book.editorialProfiles!.writers[0]!.reviewEnabled = false;
    const cycle = createEditorialCycle(chapter.id, book), segment = chapterSegments(chapter)[0]!;
    for (const role of cycleRoles(book, cycle)) cycle.reports.push(validateReport(cycle, role, segment, 1, pass, chapter, book));
    cycle.stage = "adjudicate"; book.phase = "chapterReview"; book.editorialCycle = cycle;
    await saveBook(book, false);
    modelCall.mockImplementation(async () => {
      const current = (await getBook(book.id))!;
      current.editorialCycle!.profileSettings!.writers[0]!.writingPrompt = "Un criterio diverso, cambiato mentre il giudice risponde.";
      await (await getDb()).put("books", current, current.id);
      return answer(JSON.stringify({ reasoning: "Nessuna modifica necessaria dopo aver letto tutti i rapporti.", decisions: [] }));
    });
    await new AutopilotRunner().run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(saved.editorialCycle!.judgment).toBeUndefined();
    expect(saved.chapters).toEqual(book.chapters);
    expect((await listActivities(book.id)).find(a => a.aiRequested)).toMatchObject({ status: "failed", inputTokens: 123, outputTokens: 45 });
    expect(modelCall).toHaveBeenCalledTimes(1);
  });
  it("la prosa generata non viene applicata se il profilo live cambia senza avanzare updatedAt", async () => {
    const book = profileBook();
    book.chapters[0]!.scenes[0]!.status = "planned"; book.chapters[0]!.scenes[0]!.text = "";
    await saveBook(book, false);
    modelCall.mockImplementation(async () => {
      const current = (await getBook(book.id))!;
      current.editorialProfiles!.writers[0]!.strength = "gentle";
      await (await getDb()).put("books", current, current.id);
      return answer("Mara attraversa il molo. La nave resta immobile davanti a lei.");
    });
    await new AutopilotRunner().run(book.id, async () => undefined);
    expect((await getBook(book.id))!.chapters).toEqual(book.chapters);
    expect((await listActivities(book.id)).find(a => a.aiRequested)).toMatchObject({ status: "cancelled", inputTokens: 123, outputTokens: 45 });
    expect(modelCall).toHaveBeenCalledTimes(1);
  });
});
