import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeBook } from "../domain/__fixtures__/knowledge";
import { DEFAULT_SETTINGS, newBook, type BookProject } from "../domain/types";
import { emptyKnowledge } from "../domain/knowledge";
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("../infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("./writer-guard", () => ({ withWriterGuard: writerGuard }));
import { AutopilotRunner } from "./autopilot";
import { confirmNarrativeChange, requestKnowledgeGeneration, requestNarrativeChange, revertNarrativeChange, saveEntitySheet, updateChangeMode } from "./narrative-change";

const answer = (text: string) => ({ text, endpointId: "openai", modelId: "synthetic", inputTokens: 100, outputTokens: 40 });
const pass = JSON.stringify({ verdict: "pass", summary: "Nessun problema concreto nel segmento letto.", memoryNote: "", findings: [] });
const calls: Array<{ kind: string; prompt: string }> = [];
function script(runner: AutopilotRunner, handler: (kind: string, prompt: string, system: string) => string | undefined, stopWhen?: (prompt: string) => boolean) {
  modelCall.mockImplementation(async (kind: string, system: string, prompt: string) => {
    calls.push({ kind, prompt });
    const reply = handler(kind, prompt, system);
    if (reply === undefined) throw new Error("Chiamata AI inattesa: " + kind + " " + prompt.slice(0, 80));
    if (stopWhen?.(prompt)) runner.stopAfterCurrent();
    return answer(reply);
  });
}
/** Every editorial call passes; freeze summaries are valid. */
function editorial(kind: string, prompt: string): string | undefined {
  if (kind === "chapterJudge") return JSON.stringify({ reasoning: "Tutti i rapporti sono stati valutati criticamente.", decisions: [] });
  if (kind === "summarize") return JSON.stringify({ chapterSummary: "Elena trova un indizio nell'archivio e ricorda il fratello.",
    bookSummary: "Elena cerca il fratello scomparso e trova un indizio nell'archivio." });
  if (kind === "chapterAudit" || kind === "chapterReaders") return pass;
  return prompt ? undefined : undefined;
}
async function stored(id: string): Promise<BookProject> { return (await getBook(id))!; }

beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta"]) await db.clear(store);
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  modelCall.mockReset(); writerGuard.mockReset(); calls.length = 0;
  writerGuard.mockImplementation(async (_b, _r, _c, callback) => callback({ assertActive: async () => {}, failure: () => undefined }));
  vi.stubGlobal("navigator", { locks: { request: async (_n: string, _o: unknown, action: (lock: object) => Promise<void>) => action({}) } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Knowledge base nel flusso autonomo", () => {
  it("dopo il piano genera schede, eventi e timeline; la scrittura le riceve come riferimento", async () => {
    const book = newBook("Un'investigatrice cerca il fratello.", "Le sparizioni", "Asciutto", "Adulti");
    book.phase = "prose"; book.status = "paused"; book.knowledge = emptyKnowledge(true);
    book.chapters = [{ id: "chapter:001", number: 1, title: "L'archivio", purpose: "Elena trova un indizio.", scenes: [
      { id: "scene:001:001", number: 1, title: "Il registro", objective: "Elena trova la firma", text: "", status: "planned" }] }];
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(runner, (kind, prompt) => {
      if (prompt.includes("Crea la knowledge base")) return JSON.stringify({
        entities: [{ type: "character", name: "Elena", importance: "main", summary: "Investigatrice.", attributes: { speech: "Frasi brevi" } }],
        events: [{ title: "La firma", summary: "Elena trova una firma cancellata.", storyOrder: 2, involves: ["Elena"], chapter: 1, sceneIds: ["scene:001:001"] }],
        timelines: [{ title: "Indagine", kind: "global" }] });
      if (kind === "prose") return "Elena apre il registro. Una firma cancellata la guarda dalla pagina ingiallita.";
      return undefined;
    }, prompt => prompt.includes("Scrivi SOLTANTO la scena"));
    await runner.run(book.id, async () => undefined);
    const saved = await stored(book.id);
    expect(saved.knowledge?.pending).toBeUndefined();
    expect(saved.knowledge?.generatedAt).toBeTruthy();
    expect(saved.knowledge?.entities.map(e => e.id)).toEqual(["character:elena"]);
    expect(calls[0]!.kind).toBe("outline");
    expect(calls[1]!.prompt).toContain("SCHEDE NARRATIVE PERTINENTI");
    expect(calls[1]!.prompt).toContain("Modo di parlare: Frasi brevi");
    expect(calls[1]!.prompt).toContain("EVENTI PREVISTI");
  });
  it("per un libro esistente la generazione si richiede e parte al prossimo avvio", async () => {
    const book = knowledgeBook(); delete book.knowledge; book.status = "completed"; book.phase = "completed";
    await saveBook(book, false);
    await requestKnowledgeGeneration(book.id, book.updatedAt);
    const queued = await stored(book.id);
    expect(queued.knowledge?.pending).toBe(true);
    expect(queued.status).toBe("paused");
    await expect(requestKnowledgeGeneration(book.id, "stale")).rejects.toThrow(/cambiato/);
  });
});

describe("Modifiche tramite prompt", () => {
  it("una scheda cambia in automatico: analisi, riscrittura mirata, memoria, poi nuova redazione", async () => {
    const book = knowledgeBook(); await saveBook(book, false);
    const op = await requestNarrativeChange(book.id, { kind: "entity", id: "character:elena" }, "Elena non è più fredda: è impulsiva ed emotiva. Obiettivo invariato.", book.updatedAt);
    expect(op).toMatchObject({ state: "pending", mode: "auto", targetLabel: "Elena" });
    const runner = new AutopilotRunner();
    script(runner, (kind, prompt) => {
      if (prompt.includes("L'autore chiede di modificare la scheda «Elena»")) {
        expect(prompt).toContain("SCENE DIRETTE");
        return JSON.stringify({ interpretation: "Elena reagisce d'istinto.", rationale: "Solo la scena dell'archivio mostra il suo carattere.",
          rewriteSceneIds: ["scene:001:002"], changedFacts: ["Elena è impulsiva"],
          unchangedDirect: [{ sceneId: "scene:001:001", reason: "Ricordo d'infanzia: il carattere adulto non conta." },
            { sceneId: "scene:002:002", reason: "Elena tace e riflette: nessuna reazione da cambiare." }],
          entity: { name: "Elena", aliases: ["Elena Voss"], importance: "main", summary: "Investigatrice impulsiva.", attributes: { personality: "Impulsiva ed emotiva", speech: "Esclamazioni" } } });
      }
      if (prompt.includes("Riscrivi SOLO la scena scene:001:002")) {
        expect(prompt).toContain("SCHEDA AGGIORNATA");
        return "Nell'archivio municipale Elena strappa il registro dallo scaffale e trova una firma cancellata.";
      }
      if (prompt.includes("Memoria narrativa") || prompt.includes("rifletta la NUOVA versione")) return JSON.stringify({ mode: "delta",
        characters: { Elena: "Investigatrice impulsiva, cerca il fratello." }, sceneSummaries: { "scene:001:002": "Elena, impulsiva, strappa il registro e trova la firma." }, knowledge: {} });
      return editorial(kind, prompt);
    }, prompt => prompt.includes("rifletta la NUOVA versione"));
    await runner.run(book.id, async () => undefined);
    const saved = await stored(book.id);
    const change = saved.changeOperations![0]!;
    expect(change.state).toBe("reviewing");
    expect(change.plan).toMatchObject({ changeKind: "narrative", rewriteSceneIds: ["scene:001:002"] });
    expect(change.before.scenes[0]!.text).toContain("sfoglia il registro");
    expect(saved.knowledge!.entities.find(e => e.id === "character:elena")).toMatchObject({ version: 2, summary: "Investigatrice impulsiva." });
    expect(saved.chapters[0]!.scenes[1]!.text).toContain("strappa il registro");
    expect(saved.chapters[0]!.scenes[1]!.summary).toBe("Elena, impulsiva, strappa il registro e trova la firma.");
    expect(saved.chapters[0]!.scenes[0]!.text).toBe(book.chapters[0]!.scenes[0]!.text);
    expect(saved.chapters.map(c => !!c.frozenAt)).toEqual([false, false]);
    expect(saved.revision).toBeUndefined();
    expect(saved.memory.characters.Elena).toContain("impulsiva");
    expect(calls.filter(c => c.kind === "revision")).toHaveLength(2);
  });
  it("in modalità con conferma si ferma sul piano; confermando riprende, annullando nulla cambia", async () => {
    const book = knowledgeBook(); book.changeMode = "confirm"; await saveBook(book, false);
    await requestNarrativeChange(book.id, { kind: "event", id: "event:primo-indizio" }, "L'indizio non è una firma ma una fotografia.", book.updatedAt);
    let runner = new AutopilotRunner();
    script(runner, (_kind, prompt) => prompt.includes("modificare l'evento") ? JSON.stringify({ interpretation: "Una fotografia.",
      rationale: "La scena dell'archivio e la rivelazione citano la firma.", rewriteSceneIds: ["scene:001:002", "scene:002:002"],
      event: { title: "Primo indizio", summary: "Una fotografia nascosta nel registro." } }) : undefined);
    await runner.run(book.id, async () => undefined);
    let saved = await stored(book.id);
    expect(saved.status).toBe("paused");
    expect(saved.changeOperations![0]!.state).toBe("awaiting_confirmation");
    expect(saved.knowledge!.events.find(e => e.id === "event:primo-indizio")!.version).toBe(1);
    expect(saved.chapters.every(c => c.frozenAt)).toBe(true);
    // Resuming without a decision makes no AI call.
    calls.length = 0; runner = new AutopilotRunner();
    script(runner, () => undefined);
    await runner.run(book.id, async () => undefined);
    expect(calls).toHaveLength(0);
    saved = await stored(book.id);
    await confirmNarrativeChange(book.id, saved.changeOperations![0]!.id, true, saved.updatedAt);
    saved = await stored(book.id);
    expect(saved.changeOperations![0]!.state).toBe("rewriting");
    expect(saved.knowledge!.events.find(e => e.id === "event:primo-indizio")).toMatchObject({ version: 2, summary: "Una fotografia nascosta nel registro." });
    expect(saved.revision!.affectedSceneIds).toEqual(["scene:001:002", "scene:002:002"]);

    const other = knowledgeBook(); other.changeMode = "confirm"; await saveBook(other, false);
    await requestNarrativeChange(other.id, { kind: "event", id: "event:primo-indizio" }, "Un indizio diverso, una fotografia.", other.updatedAt);
    runner = new AutopilotRunner();
    script(runner, (_kind, prompt) => prompt.includes("modificare l'evento") ? JSON.stringify({ interpretation: "Una fotografia.", rationale: "Archivio.",
      rewriteSceneIds: ["scene:001:002"], event: { title: "Primo indizio", summary: "Una fotografia." } }) : undefined);
    await runner.run(other.id, async () => undefined);
    let cancelled = await stored(other.id);
    await confirmNarrativeChange(other.id, cancelled.changeOperations![0]!.id, false, cancelled.updatedAt);
    cancelled = await stored(other.id);
    expect(cancelled.changeOperations![0]!.state).toBe("cancelled");
    expect(cancelled.revision).toBeUndefined();
    expect(cancelled.phase).toBe("prose");
    expect(cancelled.chapters).toEqual(other.chapters);
  });
  it("una scena modificata solo nello stile riapre soltanto il suo capitolo e poi si completa", async () => {
    const book = knowledgeBook(); await saveBook(book, false);
    await requestNarrativeChange(book.id, { kind: "scene", id: "scene:001:002" }, "Rendi il passaggio più teso, senza cambiare cosa accade.", book.updatedAt);
    const runner = new AutopilotRunner();
    script(runner, (kind, prompt) => {
      if (prompt.includes("Riscrivi la scena scene:001:002 secondo questa richiesta")) return "Nell'archivio municipale, nel silenzio, Elena sfoglia il registro. Una firma cancellata. Il respiro le si ferma.";
      if (prompt.includes("Confronta la versione PRECEDENTE")) {
        expect(prompt).toContain("non ha trovato nomi o numeri cambiati");
        return JSON.stringify({ changeKind: "style", changedFacts: [], dependentSceneIds: [], summary: "Elena trova, tesa, una firma cancellata nel registro.", rationale: "Cambia solo il ritmo." });
      }
      return editorial(kind, prompt);
    });
    await runner.run(book.id, async () => undefined);
    const saved = await stored(book.id);
    const change = saved.changeOperations![0]!;
    expect(change.plan).toMatchObject({ changeKind: "style", rewriteSceneIds: [] });
    expect(change.state).toBe("completed");
    expect(saved.status).toBe("completed");
    expect(saved.chapters.map(c => !!c.frozenAt)).toEqual([true, true]);
    // Chapter 2 was never reopened: its synopsis and the book synopsis are preserved.
    expect(saved.chapters[1]!.bookSummaryAtFreeze).toBe(book.chapters[1]!.bookSummaryAtFreeze);
    expect(saved.bookSummary).toBe(book.bookSummary);
    expect(calls.filter(c => c.prompt.includes("capitolo 2") || c.prompt.includes("Capitolo 2 L'informatore"))).toHaveLength(0);
    expect(saved.chapters[0]!.scenes[1]!.summary).toBe("Elena trova, tesa, una firma cancellata nel registro.");
    await revertNarrativeChange(book.id, change.id, saved.updatedAt);
    const reverted = await stored(book.id);
    expect(reverted.chapters[0]!.scenes[1]!.text).toBe(book.chapters[0]!.scenes[1]!.text);
    expect(reverted.changeOperations![0]!.state).toBe("reverted");
    // The text is back to exactly what was validated: the old validation is valid again, no new review.
    expect(reverted.chapters.map(c => c.frozenAt)).toEqual(book.chapters.map(c => c.frozenAt));
    expect(reverted.chapters[0]!.summary).toBe(book.chapters[0]!.summary);
    expect(reverted.bookSummary).toBe(book.bookSummary);
  });
  it("se cambiano i fatti (anche contro il giudizio «stile» del modello) riscrive le scene dipendenti", async () => {
    const book = knowledgeBook(); await saveBook(book, false);
    await requestNarrativeChange(book.id, { kind: "scene", id: "scene:001:002" }, "Sposta la scena nella biblioteca.", book.updatedAt);
    const runner = new AutopilotRunner();
    script(runner, (kind, prompt) => {
      if (prompt.includes("Riscrivi la scena scene:001:002 secondo questa richiesta")) return "In biblioteca Elena sfoglia il registro e trova una firma cancellata.";
      if (prompt.includes("Confronta la versione PRECEDENTE")) {
        expect(prompt).toContain("«Archivio municipale» non compare più");
        return JSON.stringify({ changeKind: "style", changedFacts: [], dependentSceneIds: ["scene:002:002", "scene:001:001"], summary: "Elena trova una firma in biblioteca.", rationale: "Cambio di ambientazione." });
      }
      return undefined;
    }, prompt => prompt.includes("Confronta la versione PRECEDENTE"));
    await runner.run(book.id, async () => undefined);
    const saved = await stored(book.id);
    const change = saved.changeOperations![0]!;
    expect(change.plan).toMatchObject({ changeKind: "narrative", rewriteSceneIds: ["scene:002:002"] });
    expect(change.plan!.drift).toContain("«Archivio municipale» non compare più nella scena.");
    expect(change.state).toBe("rewriting");
    expect(saved.revision!.affectedSceneIds).toEqual(["scene:002:002"]);
    expect(saved.chapters.map(c => !!c.frozenAt)).toEqual([false, false]);
  });
});

describe("Regole dei casi d'uso dell'autore", () => {
  it("ogni scena diretta va classificata: un piano che ne dimentica una non si applica", async () => {
    const book = knowledgeBook(); await saveBook(book, false);
    await requestNarrativeChange(book.id, { kind: "entity", id: "character:elena" }, "Elena diventa impulsiva ed emotiva.", book.updatedAt);
    const runner = new AutopilotRunner();
    script(runner, (_kind, prompt) => prompt.includes("modificare la scheda «Elena»") ? JSON.stringify({ interpretation: "Elena impulsiva.",
      rationale: "Solo l'archivio.", rewriteSceneIds: ["scene:001:002"], entity: { name: "Elena", summary: "Impulsiva." } }) : undefined);
    await runner.run(book.id, async () => undefined);
    const saved = await stored(book.id);
    expect(calls[0]!.prompt).toContain("unchangedDirect");
    expect(saved.status).toBe("error");
    expect(saved.previousError).toMatch(/2 scene dirette.*scene:001:001.*scene:002:002/);
    expect(saved.changeOperations![0]!.state).toBe("pending");
    expect(saved.knowledge!.entities.find(e => e.id === "character:elena")!.version).toBe(1);
  });
  it("un capitolo si modifica con un prompt: titolo e scopo proposti, scene scelte, le dirette lasciate dicono perché", async () => {
    const book = knowledgeBook(); await saveBook(book, false);
    const op = await requestNarrativeChange(book.id, { kind: "chapter", id: "chapter:002" }, "Markus non deve sapere del Consiglio: il capitolo diventa un incontro casuale.", book.updatedAt);
    expect(op.targetLabel).toBe("Capitolo 2 «L'informatore»");
    const runner = new AutopilotRunner();
    script(runner, (_kind, prompt) => {
      if (!prompt.includes("modificare il capitolo")) return undefined;
      expect(prompt).toContain("CAPITOLO ATTUALE: 2");
      return JSON.stringify({ interpretation: "Incontro casuale.", rationale: "Solo il molo cambia.", rewriteSceneIds: ["scene:002:001"],
        unchangedDirect: [{ sceneId: "scene:002:002", reason: "Elena ragiona da sola: nessun dialogo con Markus." }],
        chapter: { title: "L'incontro", purpose: "Un incontro casuale al molo." } });
    }, prompt => prompt.includes("modificare il capitolo"));
    await runner.run(book.id, async () => undefined);
    const saved = await stored(book.id);
    const change = saved.changeOperations![0]!;
    expect(change).toMatchObject({ state: "rewriting", target: { kind: "chapter", id: "chapter:002" } });
    expect(change.plan!.kept).toEqual([{ sceneId: "scene:002:002", reason: "Elena ragiona da sola: nessun dialogo con Markus." }]);
    expect(change.before.chapter).toEqual({ title: "L'informatore", purpose: "Un alleato ambiguo." });
    expect(saved.chapters[1]).toMatchObject({ title: "L'incontro", purpose: "Un incontro casuale al molo." });
    expect(saved.revision!.affectedSceneIds).toEqual(["scene:002:001"]);
  });
  it("una timeline si modifica con un prompt: nuova versione, eventi e scene coinvolte, una sola globale", async () => {
    const book = knowledgeBook(); await saveBook(book, false);
    await requestNarrativeChange(book.id, { kind: "timeline", id: "timeline:indagine-sulle-sparizioni" }, "La timeline segue anche Markus e il suo doppio gioco.", book.updatedAt);
    const runner = new AutopilotRunner();
    script(runner, (_kind, prompt) => prompt.includes("modificare la timeline") ? JSON.stringify({ interpretation: "Segue anche Markus.",
      rationale: "Nessuna scena cambia: cambia solo la timeline.", rewriteSceneIds: [],
      unchangedDirect: [{ sceneId: "scene:001:001", reason: "Il ricordo non riguarda Markus." }, { sceneId: "scene:001:002", reason: "L'archivio non riguarda Markus." }],
      timeline: { title: "Indagine sulle sparizioni", kind: "arc", summary: "L'indagine di Elena e il doppio gioco di Markus.", subjects: ["Elena", "Markus"] } }) : undefined,
    prompt => prompt.includes("modificare la timeline"));
    await runner.run(book.id, async () => undefined);
    const saved = await stored(book.id);
    expect(saved.knowledge!.timelines[0]).toMatchObject({ summary: "L'indagine di Elena e il doppio gioco di Markus.", subjectIds: ["character:elena", "character:markus"] });
    expect(saved.changeOperations![0]!.before.timeline).toMatchObject({ summary: "L'indagine di Elena." });
  });
  it("in modalità con conferma una scena riscritta resta da parte: il libro non cambia finché non confermi", async () => {
    const book = knowledgeBook(); book.changeMode = "confirm"; await saveBook(book, false);
    await requestNarrativeChange(book.id, { kind: "scene", id: "scene:001:002" }, "Rendi il passaggio più teso, senza cambiare cosa accade.", book.updatedAt);
    const tense = "Nell'archivio municipale, nel silenzio, Elena sfoglia il registro. Una firma cancellata. Il respiro le si ferma.";
    const runner = new AutopilotRunner();
    script(runner, (_kind, prompt) => {
      if (prompt.includes("Riscrivi la scena scene:001:002 secondo questa richiesta")) return tense;
      if (prompt.includes("Confronta la versione PRECEDENTE")) {
        expect(prompt).toContain("VERSIONE NUOVA:\n" + tense);
        return JSON.stringify({ changeKind: "style", changedFacts: [], dependentSceneIds: [], summary: "Elena trova, tesa, una firma cancellata nel registro.", rationale: "Cambia solo il ritmo." });
      }
      return undefined;
    });
    await runner.run(book.id, async () => undefined);
    let saved = await stored(book.id);
    const change = saved.changeOperations![0]!;
    expect(change.state).toBe("awaiting_confirmation");
    expect(change.draftText).toBe(tense);
    expect(saved.chapters).toEqual(book.chapters);
    await confirmNarrativeChange(book.id, change.id, true, saved.updatedAt);
    saved = await stored(book.id);
    expect(saved.chapters[0]!.scenes[1]).toMatchObject({ text: tense, summary: "Elena trova, tesa, una firma cancellata nel registro." });
    expect(saved.changeOperations![0]!.draftText).toBeUndefined();
    expect(saved.chapters[0]!.frozenAt).toBeUndefined();
    expect(saved.chapters[1]!.frozenAt).toBe(book.chapters[1]!.frozenAt);
  });
  it("rifiuta richieste concorrenti, in esecuzione, su scene pianificate o senza schede", async () => {
    const book = knowledgeBook(); await saveBook(book, false);
    await expect(requestNarrativeChange(book.id, { kind: "entity", id: "character:elena" }, "corta", book.updatedAt)).rejects.toThrow(/qualche parola/);
    const op = await requestNarrativeChange(book.id, { kind: "entity", id: "character:elena" }, "Elena diventa impulsiva.", book.updatedAt);
    const saved = await stored(book.id);
    await expect(requestNarrativeChange(book.id, { kind: "entity", id: "character:markus" }, "Markus diventa leale.", saved.updatedAt)).rejects.toThrow(/già una revisione/);
    await confirmNarrativeChange(book.id, op.id, false, saved.updatedAt);
    const legacy = knowledgeBook(); delete legacy.knowledge; await saveBook(legacy, false);
    await expect(requestNarrativeChange(legacy.id, { kind: "entity", id: "character:elena" }, "Elena diventa impulsiva.", legacy.updatedAt)).rejects.toThrow(/schede/);
    const running = knowledgeBook(); running.status = "running"; await saveBook(running, false);
    await expect(requestNarrativeChange(running.id, { kind: "scene", id: "scene:001:001" }, "Più tensione nel ricordo.", running.updatedAt)).rejects.toThrow(/pausa/);
    const planned = knowledgeBook(); planned.chapters[0]!.scenes[0]!.status = "planned"; await saveBook(planned, false);
    await expect(requestNarrativeChange(planned.id, { kind: "scene", id: "scene:001:001" }, "Più tensione nel ricordo.", planned.updatedAt)).rejects.toThrow(/già scritte/);
  });
  it("modifica diretta della scheda e modalità: versione nuova, storico, attività senza AI", async () => {
    const book = knowledgeBook(); await saveBook(book, false);
    await saveEntitySheet(book.id, "character:markus", { summary: "Informatore che lavora per il Consiglio.", attributes: { role: "Doppiogiochista" } }, book.updatedAt);
    let saved = await stored(book.id);
    const markus = saved.knowledge!.entities.find(e => e.id === "character:markus")!;
    expect(markus).toMatchObject({ version: 2, origin: "author", status: "validated", summary: "Informatore che lavora per il Consiglio." });
    expect(markus.history![0]!.snapshot.summary).toBe("Informatore.");
    await expect(saveEntitySheet(book.id, "character:markus", { name: "Elena" }, saved.updatedAt)).rejects.toThrow(/stesso nome|già una scheda/);
    await updateChangeMode(book.id, "confirm", saved.updatedAt);
    saved = await stored(book.id);
    expect(saved.changeMode).toBe("confirm");
    const activities = await listActivities(book.id);
    expect(activities.every(a => a.aiRequested === false)).toBe(true);
    expect(modelCall).not.toHaveBeenCalled();
  });
});
