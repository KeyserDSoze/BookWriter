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
  it("un profilo cambiato nel ciclo durante la risposta scarta la risposta (con usage) e rifà il passo", async () => {
    const book = profileBook(), chapter = book.chapters[0]!, cycle = createEditorialCycle(chapter.id, book), segment = chapterSegments(chapter)[0]!;
    for (const role of cycleRoles(book, cycle).slice(0, -1)) cycle.reports.push(validateReport(cycle, role, segment, 1, pass, chapter, book));
    book.phase = "chapterReview"; book.editorialCycle = cycle; await saveBook(book, false);
    const runner = new AutopilotRunner();
    modelCall.mockImplementation(async () => {
      if (modelCall.mock.calls.length === 1) {
        const current = (await getBook(book.id))!;
        current.editorialCycle!.profileSettings!.writers[0]!.reviewPrompt = "Una direttiva sostitutiva non letta dal revisore.";
        await (await getDb()).put("books", current, current.id);
      } else runner.stopAfterCurrent();
      return answer(pass);
    });
    await runner.run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(modelCall).toHaveBeenCalledTimes(2);
    expect(saved.editorialCycle!.reports).toHaveLength(14);
    expect(saved.editorialCycle!.profileSettings!.writers[0]!.reviewPrompt).toContain("sostitutiva");
    expect(saved.chapters).toEqual(book.chapters);
    expect(saved.chapters[0]!.frozenAt).toBeUndefined();
    const attempts = (await listActivities(book.id)).filter(a => a.aiRequested);
    expect(attempts.find(a => a.status === "cancelled")).toMatchObject({ inputTokens: 123, outputTokens: 45 });
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
  it("il giudice non applica una risposta letta con un altro scrittore: la scarta e decide di nuovo", async () => {
    const book = profileBook(), chapter = book.chapters[0]!;
    book.editorialProfiles!.writers[0]!.reviewEnabled = false;
    const cycle = createEditorialCycle(chapter.id, book), segment = chapterSegments(chapter)[0]!;
    for (const role of cycleRoles(book, cycle)) cycle.reports.push(validateReport(cycle, role, segment, 1, pass, chapter, book));
    cycle.stage = "adjudicate"; book.phase = "chapterReview"; book.editorialCycle = cycle;
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    const prompts: string[] = [];
    modelCall.mockImplementation(async (_kind: string, system: string, prompt: string) => {
      prompts.push(system + prompt);
      if (modelCall.mock.calls.length === 1) {
        const current = (await getBook(book.id))!;
        current.editorialCycle!.profileSettings!.writers[0]!.writingPrompt = "Un criterio diverso, cambiato mentre il giudice risponde.";
        await (await getDb()).put("books", current, current.id);
      } else runner.stopAfterCurrent();
      return answer(JSON.stringify({ reasoning: "Nessuna modifica necessaria dopo aver letto tutti i rapporti.", decisions: [] }));
    });
    await runner.run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(modelCall).toHaveBeenCalledTimes(2);
    // The applied verdict was read with the current writer criteria.
    expect(prompts[1]).toContain("cambiato mentre il giudice risponde");
    expect(saved.editorialCycle!.judgment?.verdict).toBe("freeze");
    expect(saved.chapters).toEqual(book.chapters);
    expect((await listActivities(book.id)).find(a => a.status === "cancelled")).toMatchObject({ aiRequested: true, inputTokens: 123, outputTokens: 45 });
  });
  it("la prosa letta con un profilo superato viene scartata e riscritta con il profilo nuovo", async () => {
    const book = profileBook();
    book.chapters[0]!.scenes[0]!.status = "planned"; book.chapters[0]!.scenes[0]!.text = "";
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    modelCall.mockImplementation(async (_kind: string, _system: string, prompt: string) => {
      if (modelCall.mock.calls.length === 1) {
        const current = (await getBook(book.id))!;
        current.editorialProfiles!.writers[0]!.strength = "gentle";
        await (await getDb()).put("books", current, current.id);
        return answer("Mara attraversa il molo. La nave resta immobile davanti a lei.");
      }
      expect(prompt).toContain("Preferenza flessibile");
      runner.stopAfterCurrent();
      return answer("Mara attraversa il molo con calma. La nave aspetta, immobile, davanti a lei.");
    });
    await runner.run(book.id, async () => undefined);
    expect(modelCall).toHaveBeenCalledTimes(2);
    expect((await getBook(book.id))!.chapters[0]!.scenes[0]!.text).toContain("con calma");
    expect((await listActivities(book.id)).find(a => a.status === "cancelled")).toMatchObject({ aiRequested: true, inputTokens: 123, outputTokens: 45 });
  });
});
