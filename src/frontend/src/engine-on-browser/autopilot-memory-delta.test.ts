import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type TaskKind } from "@engine/domain/types";
import { emptyKnowledge, syncKnowledgeWithMemory } from "@engine/domain/knowledge";

const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("@engine/infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("@engine/application/writer-guard", () => ({ withWriterGuard: writerGuard }));
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
import { AutopilotRunner } from "@engine/application/autopilot";

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
  it("il consolidamento passa la funzione del risultato con i campi spiegati e quelli essenziali obbligatori", async () => {
    const book = twoSceneBook("consolidate");
    book.knowledge = syncKnowledgeWithMemory(emptyKnowledge(), book.memory, "2026-11-14T12:00:00.000Z");
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    const schemas: unknown[] = [];
    modelCall.mockImplementation(async (_k: TaskKind, _s: string, _p: string, _settings: unknown, _book: unknown,
      _signal: unknown, options?: { structuredJson?: unknown }) => {
      schemas.push(options?.structuredJson);
      runner.stopAfterCurrent();
      return { text: JSON.stringify({ mode: "delta", sceneSummary: "Mara trova una lettera sul molo e la nasconde.",
        currentState: "Mara ha la lettera e la tiene nascosta.", knowledge: {} }), endpointId: "openai", modelId: "test-model" };
    });
    await runner.run(book.id, async () => undefined);
    const schema = schemas[0] as { required: string[]; properties: Record<string, { description?: string; properties?: Record<string, unknown> }> };
    expect(schema.required).toEqual(expect.arrayContaining(["mode", "sceneSummary", "currentState", "knowledge"]));
    expect(schema.properties.mode!.description).toContain("delta");
    expect(schema.properties.characters!.description).toContain("Personaggi");
    expect(Object.keys(schema.properties.knowledge!.properties!)).toEqual(["entities", "events", "timelines"]);
    expect(schema.properties.sceneEntities).toBeDefined();
    expect(JSON.stringify(schema)).not.toMatch(/maxLength|\$schema/);
    expect((await getBook(book.id))!.memory.currentState).toBe("Mara ha la lettera e la tiene nascosta.");
  });

  it("con le schede attive il consolidamento deve dire cosa cambia nelle schede, anche quelle esistenti", async () => {
    const book = twoSceneBook("consolidate");
    book.knowledge = syncKnowledgeWithMemory(emptyKnowledge(), book.memory, "2026-11-14T12:00:00.000Z");
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [JSON.stringify({ mode: "delta", sceneSummary: "Mara trova una lettera sul molo e la nasconde.",
      characters: { Mara: "Ha una lettera" } })]);
    await runner.run(book.id, async () => undefined);
    expect(calls[0]!.prompt).toContain('aggiungi SEMPRE al JSON la chiave "knowledge"');
    let saved = (await getBook(book.id))!;
    expect(saved.status).toBe("error");
    expect(saved.previousError).toContain('"knowledge"');
    expect(saved.memory.characters.Mara).toBe("Arriva al porto");
    saved.status = "paused"; await saveBook(saved, false);
    const second = new AutopilotRunner();
    calls.length = 0;
    script(second, [JSON.stringify({ mode: "delta", sceneSummary: "Mara trova una lettera sul molo e la nasconde.",
      characters: { Mara: "Ha una lettera" },
      knowledge: { entities: [{ type: "character", name: "Ivo", relationships: [{ target: "Mara", type: "protettore" }] }] } })]);
    await second.run(book.id, async () => undefined);
    saved = (await getBook(book.id))!;
    const ivo = saved.knowledge!.entities.find(e => e.name === "Ivo")!, mara = saved.knowledge!.entities.find(e => e.name === "Mara")!;
    expect(ivo).toMatchObject({ version: 2, relationships: [{ targetId: mara.id, type: "protettore" }] });
    // The sheet created from the memory follows it; the history keeps the old text.
    expect(mara).toMatchObject({ version: 2, summary: "Ha una lettera" });
    expect(mara.history![0]!.snapshot.summary).toBe("Arriva al porto");
    expect(saved.phase).toBe("prose");
  });

  it("un personaggio nuovo della memoria può essere citato subito dagli eventi della stessa risposta", async () => {
    const book = twoSceneBook("consolidate");
    book.knowledge = syncKnowledgeWithMemory(emptyKnowledge(), book.memory, "2026-11-14T12:00:00.000Z");
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [JSON.stringify({ mode: "delta", sceneSummary: "Lena aiuta Mara a nascondere la lettera trovata sul molo.",
      characters: { Lena: "Pescatrice, nuova alleata di Mara" }, currentState: "Mara e Lena custodiscono la lettera.",
      knowledge: { events: [{ title: "Lena aiuta Mara", involves: ["Lena", "Mara"] }] }, sceneEntities: ["Lena", "Mara"] })]);
    await runner.run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(saved.status).not.toBe("error");
    const lena = saved.knowledge!.entities.find(e => e.name === "Lena")!;
    expect(saved.knowledge!.events.find(e => e.title === "Lena aiuta Mara")!.involves).toContain(lena.id);
  });

  it("un personaggio nuovo con nome completo e alias corto resta una sola scheda, anche se la memoria usa l'alias", async () => {
    const book = twoSceneBook("consolidate");
    book.knowledge = syncKnowledgeWithMemory(emptyKnowledge(), book.memory, "2026-11-14T12:00:00.000Z");
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [JSON.stringify({ mode: "delta", sceneSummary: "Lena aiuta Mara a nascondere la lettera trovata sul molo.",
      characters: { Lena: "Pescatrice, nuova alleata di Mara" }, currentState: "Mara e Lena custodiscono la lettera.",
      knowledge: { entities: [{ type: "character", name: "Lena Moro", aliases: ["Lena"], summary: "Pescatrice del porto." }],
        events: [{ title: "Lena aiuta Mara", involves: ["Lena", "Mara"] }] }, sceneEntities: ["Lena", "Mara"] })]);
    await runner.run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(saved.status).not.toBe("error");
    const names = saved.knowledge!.entities.filter(e => e.type === "character").map(e => e.name).sort();
    expect(names).toEqual(["Ivo", "Lena Moro", "Mara"]);
    const lena = saved.knowledge!.entities.find(e => e.name === "Lena Moro")!;
    expect(lena.aliases).toEqual(["Lena"]);
    expect(saved.knowledge!.events.find(e => e.title === "Lena aiuta Mara")!.involves).toContain(lena.id);
  });

  it("generando la knowledge base di un libro esistente, i nomi brevi della memoria diventano alias delle schede", async () => {
    const book = twoSceneBook("prose");
    book.knowledge = emptyKnowledge(true);
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [JSON.stringify({
      entities: [{ type: "character", name: "Mara Venturi", aliases: ["Mara"], importance: "main", summary: "Cerca il padre." },
        { type: "character", name: "Ivo il guardiano", aliases: ["Ivo"], summary: "Custodisce il porto." }],
      events: [{ title: "Mara arriva al porto", involves: ["Mara", "Ivo"], sceneIds: ["s-1"] }],
      timelines: [{ title: "Storia principale", kind: "global" }] })]);
    await runner.run(book.id, async () => undefined);
    expect(calls[0]!.kind).toBe("outline");
    const saved = (await getBook(book.id))!;
    expect(saved.status).not.toBe("error");
    expect(saved.knowledge!.pending).toBeUndefined();
    expect(saved.knowledge!.entities.map(e => e.name).sort()).toEqual(["Ivo il guardiano", "Mara Venturi"]);
  });

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

  it("toglie prima le copie degli eventi senza chiamare il modello, poi riprende a scrivere", async () => {
    const book = twoSceneBook("prose");
    const events = Array.from({ length: 70 }, (_, i) => `Evento ${i}: Mara attraversa il porto vecchio`);
    book.memory.timeline = [...events, ...events.slice(0, 15)];
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, ["Mara apre la lettera sul molo e legge il nome del padre. ".repeat(12)]);
    await runner.run(book.id, async () => undefined);
    expect(calls.map(call => call.kind)).toEqual(["prose"]);
    const saved = (await getBook(book.id))!;
    expect(saved.memory.timeline).toEqual(events);
    const local = (await listActivities(book.id)).find(a => a.title === "Compattazione locale della cronologia")!;
    expect(local).toMatchObject({ aiRequested: false, status: "succeeded" });
    expect(local.summary).toMatch(/15 eventi ripetuti/);
  });

  it("compatta da sola la cronologia troppo lunga con una risposta breve, senza riscrivere le schede", async () => {
    const book = twoSceneBook("prose");
    book.memory.timeline = Array.from({ length: 90 }, (_, i) => `Evento ${i}: Mara cerca il padre nel porto vecchio`);
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    const schemas: unknown[] = [];
    const compacted = ["Mara arriva al porto", "Mara cerca il padre fra i moli",
      ...Array.from({ length: 6 }, (_, i) => `Mara interroga il testimone ${i + 1} sul padre`)];
    modelCall.mockImplementation(async (kind: TaskKind, system: string, prompt: string, _settings: unknown, _book: unknown,
      _signal: unknown, options?: { structuredJson?: unknown }) => {
      calls.push({ kind, system, prompt });
      schemas.push(options?.structuredJson);
      runner.stopAfterCurrent();
      return { text: JSON.stringify({ timeline: compacted }), endpointId: "openai", modelId: "test-model" };
    });
    await runner.run(book.id, async () => undefined);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toContain("Compatta la cronologia narrativa: ora ha 90 eventi");
    expect(calls[0]!.prompt).not.toContain("MEMORIA ATTUALE");
    expect((schemas[0] as { required: string[] }).required).toEqual(["timeline"]);
    const saved = (await getBook(book.id))!;
    expect(saved.memory.timeline).toEqual(compacted);
    expect(saved.memory.characters).toEqual({ Mara: "Arriva al porto", Ivo: "Guardiano" });
    expect(saved.phase).toBe("prose");
  });

  it("la compattazione delle schede accetta solo le voci riscritte e non tocca la cronologia", async () => {
    const book = twoSceneBook("prose");
    book.memory.characters = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["P" + i, "x".repeat(650)]));
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    const remove = Array.from({ length: 50 }, (_, i) => "P" + (i + 10));
    script(runner, [JSON.stringify({ mode: "delta", characters: { P0: "Scheda compatta di P0" },
      remove: { characters: remove, timeline: ["Mara arriva"] }, timelineAdd: ["Evento inventato"], currentState: "Inizio" })]);
    await runner.run(book.id, async () => undefined);
    expect(calls[0]!.prompt).toContain("Compatta la memoria narrativa");
    expect(calls[0]!.prompt).toContain("VOCI DA ACCORCIARE");
    const saved = (await getBook(book.id))!;
    expect(Object.keys(saved.memory.characters)).toHaveLength(10);
    expect(saved.memory.characters.P0).toBe("Scheda compatta di P0");
    expect(saved.memory.timeline).toEqual(["Mara arriva"]);
  });

  it("una risposta senza \"mode\" e con la cronologia vuota non cancella eventi, segreti o voci non elencate", async () => {
    const book = twoSceneBook("prose");
    book.memory.characters = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["P" + i, "x".repeat(650)]));
    book.memory.secrets = { padre: "Il padre di Mara è vivo: si rivela nel capitolo 5" };
    book.memory.locations = { Molo: "Il molo vecchio del porto" };
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    const rewritten = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["P" + i, "Scheda compatta di P" + i]));
    // The template of the prompt without "mode", plus an empty timeline: it must not read as a whole memory.
    script(runner, [JSON.stringify({ characters: rewritten, locations: {}, factions: {}, items: {}, secrets: {},
      timeline: [], currentState: "Inizio" })]);
    await runner.run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(saved.memory.characters.P0).toBe("Scheda compatta di P0");
    expect(saved.memory.timeline).toEqual(["Mara arriva"]);
    expect(saved.memory.secrets).toEqual({ padre: "Il padre di Mara è vivo: si rivela nel capitolo 5" });
    expect(saved.memory.locations).toEqual({ Molo: "Il molo vecchio del porto" });
  });

  it("una memoria completa nel formato di prima resta accettata ma non cambia la cronologia", async () => {
    const book = twoSceneBook("prose");
    book.memory.characters = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["P" + i, "x".repeat(650)]));
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, [JSON.stringify({ characters: { Mara: "Sintesi" }, locations: {}, factions: {}, items: {}, secrets: {},
      timeline: ["Evento riscritto dal modello"], currentState: "Inizio" })]);
    await runner.run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(saved.memory.characters).toEqual({ Mara: "Sintesi" });
    expect(saved.memory.timeline).toEqual(["Mara arriva"]);
  });

  /** One frozen-ready chapter: the runner opens the editorial board on it. */
  function boardBook() {
    const book = twoSceneBook("prose");
    book.chapters[0]!.scenes = [{ ...book.chapters[0]!.scenes[0]!, summary: "Mara trova una lettera sul molo." }];
    return book;
  }

  it("un blocco del prompt troppo lungo che non è memoria ferma il libro con la sua causa, senza compattare", async () => {
    const book = boardBook();
    book.authorConstraints = ["Vincolo lunghissimo. ".repeat(500)];
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, []);
    await expect(runner.run(book.id, async () => undefined)).rejects.toThrow(/Vincoli troppo lungo per la redazione/);
    const saved = (await getBook(book.id))!;
    expect(calls).toHaveLength(0);
    expect(saved.status).toBe("error");
    expect(saved.previousError).toMatch(/Vincoli troppo lungo per la redazione/);
    expect(saved.previousError).not.toMatch(/compattare la memoria/);
    expect(saved.memory.characters).toEqual({ Mara: "Arriva al porto", Ivo: "Guardiano" });
    const stop = (await listActivities(book.id)).find(a => a.title === "Autopilot fermato prima del passo successivo");
    expect(stop?.error).toMatch(/Vincoli troppo lungo/);
  });

  it("se il passo successivo rifiuta ancora la memoria dopo quattro compattazioni, si ferma invece di consumarla", async () => {
    const book = boardBook();
    const names = Array.from({ length: 19 }, (_, i) => "Personaggio" + String.fromCharCode(65 + i));
    book.memory.characters = Object.fromEntries(names.map(name => [name, "Ruolo di " + name + " nella storia del porto."]));
    book.chapters[0]!.scenes[0]!.text = "Al molo arrivano " + names.join(", ") + ". " + "Mara li guarda. ".repeat(10);
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    // Every compaction really shortens one entry, but keeps all nineteen names in the scene.
    const replies = names.slice(0, 4).map(name => JSON.stringify({ mode: "delta", characters: { [name]: "Breve." }, currentState: "Inizio" }));
    modelCall.mockImplementation(async (kind: TaskKind, system: string, prompt: string) => {
      calls.push({ kind, system, prompt });
      const next = replies[calls.length - 1];
      if (next === undefined) throw new Error("Chiamata AI inattesa: " + kind);
      return { text: next, endpointId: "openai", modelId: "test-model" };
    });
    await expect(runner.run(book.id, async () => undefined)).rejects.toThrow(/compattata 4 volte di seguito/);
    const saved = (await getBook(book.id))!;
    expect(calls.map(call => call.kind)).toEqual(["consolidate", "consolidate", "consolidate", "consolidate"]);
    expect(saved.status).toBe("error");
    expect(saved.previousError).toMatch(/compattata 4 volte di seguito/);
    expect(Object.keys(saved.memory.characters)).toHaveLength(19);
  });
});
