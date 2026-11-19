import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeBook } from "@engine/domain/__fixtures__/knowledge";
import { DEFAULT_SETTINGS, type AppSettings, type BookProject } from "@engine/domain/types";
import { defaultWebResearchSettings, SEARCH_MODEL_SYSTEM } from "@engine/domain/web-research";
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("@engine/infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("@engine/application/writer-guard", () => ({ withWriterGuard: writerGuard }));
import { AutopilotRunner } from "@engine/application/autopilot";
import { testWebResearch, updateWebResearchSettings } from "@engine/application/web-research";

const answer = (text: string) => ({ text, endpointId: "openai", modelId: "synthetic", inputTokens: 90, outputTokens: 30 });
const request = (...queries: string[]) => JSON.stringify({ web_search: { queries, reason: "Dettaglio d'epoca da verificare." } });
const found = JSON.stringify({ research_summary: "A Vienna nel 1923 i tram erano rossi e bianchi, gestiti dal comune.",
  sources: [{ title: "Storia dei tram di Vienna", url: "https://example.org/tram-wien", excerpt: "rossi e bianchi" }] });
const calls: Array<{ kind: string; system: string; prompt: string; tools?: boolean }> = [];
function script(handler: (kind: string, system: string, prompt: string, index: number) => string) {
  modelCall.mockImplementation(async (kind: string, system: string, prompt: string, _settings: unknown, _book: unknown,
    _signal: unknown, options?: { structuredJson?: unknown }) => {
    calls.push({ kind, system, prompt, tools: options?.structuredJson !== undefined });
    return answer(handler(kind, system, prompt, calls.length));
  });
}
/** Chapter 2 gets a new planned scene so the next task is prose. */
function writingBook(): BookProject {
  const book = knowledgeBook();
  book.chapters[1]!.frozenAt = undefined;
  book.chapters[1]!.scenes.push({ id: "scene:002:003", number: 3, title: "Il tram", objective: "Elena segue Markus sul tram", text: "", status: "planned" });
  book.webResearch = defaultWebResearchSettings(new Date().toISOString());
  return book;
}
async function settingsWithSearchModel(): Promise<AppSettings> {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.taskRoutes.research = { endpointId: settings.endpoints[0]!.id, modelId: "sonar-sintetico" };
  await saveSettings(settings);
  return settings;
}

beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta"]) await db.clear(store);
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  modelCall.mockReset(); writerGuard.mockReset(); calls.length = 0;
  writerGuard.mockImplementation(async (_b, _r, _c, callback) => callback({ assertActive: async () => {}, failure: () => undefined }));
  vi.stubGlobal("navigator", { locks: { request: async (_n: string, _o: unknown, action: (lock: object) => Promise<void>) => action({}) } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Ricerca web nel flusso autonomo", () => {
  it("la scrittura chiede una ricerca, il modello di ricerca risponde e il task riparte con i risultati", async () => {
    await settingsWithSearchModel();
    const book = writingBook(); await saveBook(book, false);
    const runner = new AutopilotRunner();
    script((kind, system, prompt, index) => {
      if (index === 1) { expect(kind).toBe("prose"); expect(system).toContain("STRUMENTO DI RICERCA WEB"); return request("tram di Vienna nel 1923"); }
      if (index === 2) { expect(kind).toBe("research"); expect(system).toBe(SEARCH_MODEL_SYSTEM); expect(prompt).toBe("Domanda di ricerca: tram di Vienna nel 1923"); return found; }
      expect(kind).toBe("prose");
      expect(prompt).toContain("RISULTATI DELLA RICERCA WEB");
      expect(prompt).toContain("rossi e bianchi");
      expect(system).toContain("NON puoi più cercare");
      runner.stopAfterCurrent();
      return "Elena sale sul tram rosso e bianco. Markus non si volta.";
    });
    await runner.run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(calls).toHaveLength(3);
    expect(saved.chapters[1]!.scenes[2]!.text).toContain("tram rosso e bianco");
    expect(saved.webResearchLog).toHaveLength(1);
    expect(saved.webResearchLog![0]).toMatchObject({ query: "tram di Vienna nel 1923", status: "ok", provider: "model", modelId: "synthetic",
      sources: [{ url: "https://example.org/tram-wien" }] });
    const activities = await listActivities(book.id);
    expect(activities.find(a => a.summary?.startsWith("Ha chiesto una ricerca web"))).toMatchObject({ status: "succeeded", aiRequested: true, inputTokens: 90 });
    expect(activities.find(a => a.title === "Ricerca web: «tram di Vienna nel 1923»")).toMatchObject({ status: "succeeded", aiRequested: true });
    expect(activities.filter(a => a.status === "succeeded" && a.aiRequested)).toHaveLength(3);
  });
  it("con Wikipedia legge solo la query, senza cookie né chiamate AI aggiuntive", async () => {
    const book = writingBook(); book.webResearch!.provider = "wikipedia"; await saveBook(book, false);
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(new URL(url).hostname).toBe("it.wikipedia.org");
      expect(init).toMatchObject({ credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
      expect(new URL(url).searchParams.get("gsrsearch")).toBe("tram di Vienna nel 1923");
      return new Response(JSON.stringify({ query: { pages: [{ pageid: 1, index: 1, title: "Tram di Vienna", canonicalurl: "https://it.wikipedia.org/wiki/Tram_di_Vienna",
        extract: "La rete tranviaria di Vienna è una delle più estese." }, { pageid: 2, title: "Truffa", canonicalurl: "https://evil.example/wiki/x", extract: "no" }] } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const runner = new AutopilotRunner();
    script((_kind, _system, prompt, index) => {
      if (index === 1) return request("tram di Vienna nel 1923");
      expect(prompt).toContain("Tram di Vienna — https://it.wikipedia.org/wiki/Tram_di_Vienna");
      expect(prompt).not.toContain("evil.example");
      runner.stopAfterCurrent();
      return "Elena sale sul tram. La rete di Vienna si apre davanti a lei.";
    });
    await runner.run(book.id, async () => undefined);
    expect(calls.map(c => c.kind)).toEqual(["prose", "prose"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await getBook(book.id))!.webResearchLog![0]).toMatchObject({ provider: "wikipedia", status: "ok" });
  });
  it("le query con segreti non partono, un modello non configurato non blocca il libro e una seconda richiesta è rifiutata", async () => {
    const book = writingBook(); book.memory.secrets["Il patto del Consiglio"] = "segreto"; await saveBook(book, false);
    script((kind, _system, prompt, index) => {
      expect(kind).toBe("prose");
      if (index === 1) return request("Il patto del Consiglio e i rapimenti", "tram di Vienna nel 1923");
      expect(prompt).toContain("query bloccata sul dispositivo");
      expect(prompt).toContain("Modello di ricerca non configurato");
      return request("altra ricerca");
    });
    await new AutopilotRunner().run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(calls).toHaveLength(2);
    expect(saved.webResearchLog!.map(e => e.status)).toEqual(["blocked", "failed"]);
    expect(saved.status).toBe("error");
    expect(saved.previousError).toContain("Hai già usato le ricerche");
    expect(saved.chapters[1]!.scenes[2]!.text).toBe("");
  });
  it("i lettori ciechi non ricevono mai lo strumento; specialisti e direttore solo se autorizzati", async () => {
    await settingsWithSearchModel();
    const book = knowledgeBook();
    book.chapters[1]!.frozenAt = undefined;
    book.webResearch = { ...defaultWebResearchSettings(new Date().toISOString()), agents: ["specialists"] };
    await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(kind => {
      if (kind === "chapterJudge") { runner.stopAfterCurrent(); return JSON.stringify({ reasoning: "Rapporti valutati criticamente, nessun difetto.", decisions: [] }); }
      return JSON.stringify({ verdict: "pass", summary: "Nessun problema concreto nel segmento letto.", findings: [], memoryNote: "" });
    });
    await runner.run(book.id, async () => undefined);
    const readers = calls.filter(c => c.kind === "chapterReaders"), specialists = calls.filter(c => c.kind === "chapterAudit");
    expect(readers.length).toBeGreaterThan(0);
    expect(specialists.length).toBeGreaterThan(0);
    expect(readers.every(c => !c.system.includes("STRUMENTO DI RICERCA WEB"))).toBe(true);
    expect(specialists.every(c => c.system.includes("STRUMENTO DI RICERCA WEB"))).toBe(true);
    expect(calls.find(c => c.kind === "chapterJudge")!.system).not.toContain("STRUMENTO DI RICERCA WEB");
    // A role that can research answers in text ({"web_search":…}); the others get the result function.
    expect(readers.every(c => c.tools)).toBe(true);
    expect(specialists.every(c => !c.tools)).toBe(true);
    expect(calls.find(c => c.kind === "chapterJudge")!.tools).toBe(true);
  });
  it("cambiare le impostazioni durante una chiamata non spreca la risposta: è applicata lo stesso", async () => {
    const book = writingBook(); await saveBook(book, false);
    const runner = new AutopilotRunner();
    script(() => { runner.stopAfterCurrent(); return "Elena sale sul tram. Nessuno la nota."; });
    modelCall.mockImplementationOnce(async (kind: string, system: string, prompt: string) => {
      calls.push({ kind, system, prompt });
      const current = (await getBook(book.id))!;
      await updateWebResearchSettings(book.id, { ...current.webResearch!, maxQueriesPerTask: 5 }, current.updatedAt);
      runner.stopAfterCurrent();
      return answer("Elena sale sul tram. Nessuno la nota.");
    });
    await runner.run(book.id, async () => undefined);
    const saved = (await getBook(book.id))!;
    expect(calls).toHaveLength(1);
    expect(saved.chapters[1]!.scenes[2]!.text).toBe("Elena sale sul tram. Nessuno la nota.");
    expect(saved.webResearch!.maxQueriesPerTask).toBe(5);
    expect((await listActivities(book.id)).some(a => a.status === "cancelled")).toBe(false);
  });
  it("prova manuale: una query registrata, nessuna modifica al testo, rifiutata se la ricerca è spenta", async () => {
    await settingsWithSearchModel();
    const book = writingBook(); await saveBook(book, false);
    script((kind) => { expect(kind).toBe("research"); return found; });
    const entry = await testWebResearch(book.id, "tram di Vienna nel 1923", new AbortController());
    expect(entry).toMatchObject({ status: "ok", taskTitle: "Prova della ricerca" });
    const saved = (await getBook(book.id))!;
    expect(saved.webResearchLog).toHaveLength(1);
    expect(saved.chapters).toEqual(book.chapters);
    // Same query again: served from the cache, no new paid call.
    await testWebResearch(book.id, "Tram di  Vienna nel 1923", new AbortController());
    expect(calls).toHaveLength(1);
    expect((await getBook(book.id))!.webResearchLog!.at(-1)!.status).toBe("cached");
    await updateWebResearchSettings(book.id, undefined, (await getBook(book.id))!.updatedAt);
    await expect(testWebResearch(book.id, "tram", new AbortController())).rejects.toThrow(/Attiva prima/);
  });
});
