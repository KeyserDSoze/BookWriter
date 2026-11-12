import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type BookProject, type TaskKind } from "../domain/types";
import { createEditorialCycle, type EditorialRound } from "../domain/editorial-board";

const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("../infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("./writer-guard", () => ({ withWriterGuard: writerGuard }));
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
import { AutopilotRunner } from "./autopilot";

type Call = { kind: TaskKind; system: string; prompt: string };
const calls: Call[] = [];
function reply(text: string) {
  return { text, endpointId: "openai", modelId: "test-model", inputTokens: 10, outputTokens: 5 };
}
function note(id: string, instruction: string) {
  return { id, createdAt: new Date().toISOString(), instruction, scope: "next_step" as const,
    phase: "brainstorm" as const, stepLabel: "Brainstorming" };
}
beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta"]) await db.clear(store);
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  calls.length = 0;
  modelCall.mockReset(); writerGuard.mockReset();
  writerGuard.mockImplementation(async (_bookId, _runId, _controller, callback) =>
    callback({ assertActive: async () => {}, failure: () => undefined }));
});
function script(runner: AutopilotRunner, replies: Array<(call: Call) => string>, stopAfter = replies.length) {
  modelCall.mockImplementation(async (kind: TaskKind, system: string, prompt: string) => {
    const call = { kind, system, prompt };
    calls.push(call);
    const next = replies[calls.length - 1];
    if (!next) throw new Error("Chiamata AI inattesa: " + kind);
    if (calls.length >= stopAfter) runner.stopAfterCurrent();
    return reply(next(call));
  });
}

describe("Indicazioni dell'autore nel runner", () => {
  it("invia la nota al prossimo task di scrittura e la marca applicata nello stesso commit", async () => {
    const book = newBook("Due scimmie e un leone.", "La favola", "Ironico", "Bambini");
    book.status = "paused";
    book.authorInterventions = [note("note-1", "Il leone deve essere vegetariano.")];
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [() => "Idee LONG MID SHORT con un leone vegetariano."]);
    await runner.run(book.id, async () => undefined);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe("brainstorm");
    expect(calls[0]!.prompt).toContain("INDICAZIONI DELL'AUTORE PER QUESTO PASSO");
    expect(calls[0]!.prompt).toContain("Il leone deve essere vegetariano.");
    const saved = (await getBook(book.id))!;
    expect(saved.phase).toBe("validate");
    expect(saved.status).toBe("paused");
    expect(saved.previousError).toBeUndefined();
    const task = (await listActivities(book.id)).find(a => a.aiRequested)!;
    expect(task.appliedInterventionIds).toEqual(["note-1"]);
    expect(saved.authorInterventions![0]).toMatchObject({
      appliedActivityId: task.id, appliedStepLabel: "Brainstorming su tre orizzonti",
    });
    expect(saved.authorInterventions![0]!.appliedAt).toBeTruthy();
  });

  it("i revisori indipendenti non ricevono note: restano in attesa", async () => {
    const book = newBook("Un castello.", "Romanzo", "Sobrio", "Adulti");
    book.phase = "chapterReview"; book.status = "paused";
    book.chapters = [{ id: "ch-1", number: 1, title: "Il castello", purpose: "Inizio",
      scenes: [{ id: "scene-1", number: 1, title: "Ingresso", objective: "Presentazione",
        text: "Mara saluta il guardiano e passa la porta.", status: "canon" }] }];
    book.editorialCycle = createEditorialCycle("ch-1");
    book.authorInterventions = [note("note-2", "Segreto: il guardiano è suo padre.")];
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [() => JSON.stringify({ verdict: "pass", summary: "Nessun rilievo nella scena letta.",
      memoryNote: "Scena letta senza osservazioni.", findings: [] })]);
    await runner.run(book.id, async () => undefined);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe("chapterAudit");
    expect(calls[0]!.prompt + calls[0]!.system).not.toContain("il guardiano è suo padre");
    const saved = (await getBook(book.id))!;
    expect(saved.editorialCycle?.reports).toHaveLength(1);
    expect(saved.authorInterventions![0]!.appliedAt).toBeUndefined();
    expect((await listActivities(book.id)).find(a => a.aiRequested)?.appliedInterventionIds).toBeUndefined();
  });

  it("un task fallito lascia la nota in attesa", async () => {
    const book = newBook("Un giallo.", "Il porto", "Sobrio", "Adulti");
    book.phase = "outline"; book.status = "paused";
    book.authorInterventions = [note("note-3", "Al massimo tre capitoli.")];
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [() => "Questo non è JSON"]);
    await runner.run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(saved.status).toBe("error");
    expect(saved.chapters).toEqual([]);
    expect(saved.authorInterventions![0]!.appliedAt).toBeUndefined();
    expect((await listActivities(book.id)).find(a => a.aiRequested)).toMatchObject({
      status: "failed", appliedInterventionIds: ["note-3"] });
  });

  it("stopAfterCurrent senza sessione attiva non ha effetto", () => {
    const runner = new AutopilotRunner();
    runner.stopAfterCurrent();
    expect(runner.stopAfterCurrentRequested).toBe(false);
  });
});

describe("Avvio da sinossi capitolo per capitolo", () => {
  function synopsisBook(): BookProject {
    const book = newBook("", "Il porto", "Sobrio", "Adulti", {
      startMode: "synopsis", pauseAfterOutline: true,
      authorChapterSynopses: [
        { title: "L'arrivo", synopsis: "Mara arriva al porto e trova una lettera." },
        { synopsis: "Mara scopre che il padre è vivo." },
      ],
    });
    book.phase = "outline"; book.status = "paused";
    return book;
  }
  const plan = (count: number) => JSON.stringify({ chapters: Array.from({ length: count }, (_, i) => ({
    title: "Titolo AI " + (i + 1), purpose: "Scopo del capitolo " + (i + 1),
    scenes: [{ title: "Scena " + (i + 1), objective: "Obiettivo della scena " + (i + 1) }],
  })) });

  it("rifiuta un piano con un numero di capitoli diverso dalla sinossi", async () => {
    const book = synopsisBook();
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [() => plan(3)]);
    await runner.run(book.id, async () => undefined);
    expect(calls[0]!.prompt).toContain("esattamente 2 capitoli");
    expect(calls[0]!.prompt).toContain("Mara arriva al porto e trova una lettera.");
    const saved = (await getBook(book.id))!;
    expect(saved.status).toBe("error");
    expect(saved.previousError).toMatch(/esattamente 2 capitoli/);
    expect(saved.chapters).toEqual([]);
  });

  it("applica i titoli dell'autore e si ferma per l'approvazione del piano", async () => {
    const book = synopsisBook();
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [() => plan(2)], 99);
    await runner.run(book.id, async () => undefined);
    expect(calls).toHaveLength(1);
    const saved = (await getBook(book.id))!;
    expect(saved.chapters.map(ch => ch.title)).toEqual(["L'arrivo", "Titolo AI 2"]);
    expect(saved.phase).toBe("prose");
    expect(saved.status).toBe("paused");
  });

  it("la scrittura riceve sinossi del capitolo, fine della scena precedente e contesto snello", async () => {
    const book = synopsisBook();
    book.phase = "prose";
    book.audienceReviews = ["[Persona 1] Critica che non serve alla scena."];
    book.chapters = [{ id: "chapter:001", number: 1, title: "L'arrivo", purpose: "Aprire",
      scenes: [
        { id: "scene:001:001", number: 1, title: "Molo", objective: "Arrivo",
          text: "Inizio. ".repeat(600) + "La porta della capitaneria si chiude alle sue spalle.", status: "canon" },
        { id: "scene:001:002", number: 2, title: "Lettera", objective: "Trovare la lettera", text: "", status: "planned" },
      ] }];
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [() => "Mara apre la lettera."]);
    await runner.run(book.id, async () => undefined);
    const prompt = calls[0]!.prompt;
    expect(calls[0]!.kind).toBe("prose");
    expect(prompt).toContain("Sinossi dell'autore per questo capitolo (VINCOLANTE): Mara arriva al porto e trova una lettera.");
    expect(prompt).toContain("Fine della scena precedente «Molo»");
    expect(prompt).toContain("La porta della capitaneria si chiude alle sue spalle.");
    expect(prompt).not.toContain("Critica che non serve alla scena.");
    expect(prompt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("Revisione retroattiva", () => {
  function writtenBook(): BookProject {
    const book = newBook("Un giallo.", "Il porto", "Sobrio", "Adulti");
    book.status = "paused"; book.phase = "revision";
    book.chapters = [
      { id: "chapter:001", number: 1, title: "Uno", purpose: "Inizio", frozenAt: "2026-01-01T00:00:00.000Z",
        scenes: [
          { id: "scene:001:001", number: 1, title: "A", objective: "a", text: "Testo uno.", status: "canon" },
          { id: "scene:001:002", number: 2, title: "B", objective: "b", text: "Testo due.", status: "canon" },
        ] },
      { id: "chapter:002", number: 2, title: "Due", purpose: "Seguito",
        scenes: [{ id: "scene:002:001", number: 1, title: "C", objective: "c", text: "Testo tre.", status: "canon" }] },
    ];
    book.revision = { id: "rev-1", instruction: "Mara arriva in treno.", beforePhase: "prose",
      affectedSceneIds: [], cursor: 0 };
    return book;
  }

  it("se nessuna scena è coinvolta non riscrive nulla e chiude senza chiamate AI aggiuntive", async () => {
    const book = writtenBook();
    book.chapters[1]!.scenes.push({ id: "scene:002:002", number: 2, title: "D", objective: "d", text: "", status: "planned" });
    book.chapters[1]!.frozenAt = undefined;
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [
      () => JSON.stringify({ rationale: "", affectedSceneIds: [] }),
      () => "Nuova scena D.",
    ]);
    await runner.run(book.id, async () => undefined);
    expect(calls.map(c => c.kind)).toEqual(["revision", "prose"]);
    const saved = (await getBook(book.id))!;
    expect(saved.revision).toBeUndefined();
    expect(saved.chapters[0]!.frozenAt).toBe("2026-01-01T00:00:00.000Z");
    expect(saved.chapters[0]!.scenes.map(s => s.text)).toEqual(["Testo uno.", "Testo due."]);
    const closed = (await listActivities(book.id)).find(a => a.title === "Revisione chiusa senza riscritture");
    expect(closed).toMatchObject({ aiRequested: false, status: "succeeded" });
  });

  it("riscrive dalla prima scena coinvolta, conserva le tornate giudicate e aggiorna la memoria", async () => {
    const book = writtenBook();
    const judged: EditorialRound = { round: 1, reports: [], judgment: {
      reasoning: "Correzioni necessarie.", decisions: [], verdict: "repair", createdAt: "2026-01-02T00:00:00.000Z" } };
    book.editorialCycle = { ...createEditorialCycle("chapter:002"), round: 2, priorRounds: [judged] };
    book.revision!.beforePhase = "chapterReview";
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    const memory = { characters: { Mara: "Arrivata in treno" }, locations: {}, factions: {}, items: {},
      secrets: {}, timeline: ["Mara arriva in treno"], currentState: "Mara è in città." };
    script(runner, [
      () => JSON.stringify({ rationale: "Cambia l'arrivo.", affectedSceneIds: ["scene:001:002"] }),
      () => "Testo due riscritto.",
      () => "Testo tre riscritto.",
      () => JSON.stringify(memory),
    ]);
    await runner.run(book.id, async () => undefined);
    expect(calls.map(c => c.kind)).toEqual(["revision", "revision", "revision", "consolidate"]);
    expect(calls[3]!.prompt).toContain("ULTIMA SCENA RISCRITTA");
    expect(calls[3]!.prompt).toContain("Testo tre riscritto.");
    const saved = (await getBook(book.id))!;
    expect(saved.revision).toBeUndefined();
    expect(saved.phase).toBe("prose");
    expect(saved.editorialCycle).toBeUndefined();
    expect(saved.chapters[1]!.editorialRounds).toEqual([judged]);
    expect(saved.chapters[0]!.frozenAt).toBeUndefined();
    expect(saved.chapters.flatMap(ch => ch.scenes.map(s => s.text)))
      .toEqual(["Testo uno.", "Testo due riscritto.", "Testo tre riscritto."]);
    expect(saved.memory).toEqual(memory);
  });
});
