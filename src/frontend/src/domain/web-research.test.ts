import { describe, expect, it } from "vitest";
import { knowledgeBook } from "./__fixtures__/knowledge";
import { appendResearchLog, cachedResearch, defaultWebResearchSettings, formatResearchResults, isSafeSourceUrl, MAX_RESEARCH_LOG,
  parseResearchRequest, parseSearchModelReply, researchAgentForKind, researchEnabledFor, researchLogSchema, researchRule,
  screenQueries, webResearchSettingsSchema, type ResearchEntry } from "./web-research";

const settings = defaultWebResearchSettings("2026-11-14T10:00:00.000Z");
const entry = (patch: Partial<ResearchEntry> = {}): ResearchEntry => ({ id: crypto.randomUUID(), at: "2026-11-14T10:00:00.000Z",
  query: "uniformi polizia Vienna 1923", provider: "model", taskTitle: "Scena 3", status: "ok",
  summary: "Le uniformi erano verde scuro con bottoni dorati.", sources: [{ title: "Archivio", url: "https://example.org/a", excerpt: "verde scuro" }], ...patch });

describe("Ricerca web: protocollo e regole", () => {
  it("riconosce solo una richiesta completa e valida; il resto è una risposta normale", () => {
    expect(parseResearchRequest('{"web_search":{"queries":["  tram   Milano 1910 "],"reason":"dettaglio d\'epoca"}}', settings))
      .toEqual({ queries: ["tram Milano 1910"], reason: "dettaglio d'epoca" });
    expect(parseResearchRequest('```json\n{"web_search":{"queries":["a1b","a1b"]}}\n```', settings)).toEqual({ queries: ["a1b"], reason: "" });
    expect(parseResearchRequest("Elena entra nell'archivio.", settings)).toBeUndefined();
    expect(parseResearchRequest('{"verdict":"pass","findings":[]}', settings)).toBeUndefined();
    expect(() => parseResearchRequest('{"web_search":{"queries":[]}}', settings)).toThrow(/non valida/);
    expect(() => parseResearchRequest('{"web_search":{"queries":["uno","due","tre","quattro"]}}', settings)).toThrow(/massimo 3/);
    expect(() => parseResearchRequest(JSON.stringify({ web_search: { queries: ["x".repeat(201)] } }), settings)).toThrow(/troppo lunga/);
    expect(() => parseResearchRequest('{"web_search":{"queries":["ok query"]},"extra":1}', settings)).toThrow(/non valida/);
  });
  it("chi può cercare: mai lettori ciechi, riassunti o memoria; solo se l'autore lo attiva", () => {
    expect(researchAgentForKind("prose")).toBe("writing");
    expect(researchAgentForKind("outline")).toBe("planning");
    expect(researchAgentForKind("chapterJudge")).toBe("director");
    for (const kind of ["audience", "chapterReaders", "summarize", "consolidate", "merge", "chapterAudit"] as const)
      expect(researchAgentForKind(kind)).toBeUndefined();
    const book = knowledgeBook();
    expect(researchEnabledFor(book, "writing")).toBe(false);
    book.webResearch = { ...settings, agents: ["planning"] };
    expect(researchEnabledFor(book, "writing")).toBe(false);
    expect(researchEnabledFor(book, "planning")).toBe(true);
    book.webResearch.enabled = false;
    expect(researchEnabledFor(book, "planning")).toBe(false);
  });
  it("blocca sul dispositivo le query che citano i segreti dell'autore", () => {
    const book = knowledgeBook();
    book.memory.secrets["Il patto del Consiglio"] = "Il Consiglio rapisce i testimoni.";
    expect(screenQueries(["Il patto del Consiglio e i testimoni", "tram di Vienna nel 1923", "rivelazione del complotto storia"], book))
      .toEqual({ allowed: ["tram di Vienna nel 1923"], blocked: ["Il patto del Consiglio e i testimoni", "rivelazione del complotto storia"] });
  });
  it("legge la risposta del modello di ricerca senza fidarsi di indirizzi o campi strani", () => {
    const parsed = parseSearchModelReply(JSON.stringify({ summary: "  Il tram   elettrico arrivò nel 1893. ", sources: [
      { title: "Storia dei trasporti", url: "https://example.org/tram", excerpt: "Il primo tram elettrico" },
      { title: "Falsa", url: "javascript:alert(1)" }, { url: "https://user:pw@example.org/x" }, { url: "https://example.org/tram" },
      { url: "https://second.example/" },
    ] }));
    expect(parsed.summary).toBe("Il tram elettrico arrivò nel 1893.");
    expect(parsed.sources).toEqual([{ title: "Storia dei trasporti", url: "https://example.org/tram", excerpt: "Il primo tram elettrico" },
      { title: "second.example", url: "https://second.example/", excerpt: "" }]);
    expect(parseSearchModelReply("Risposta libera senza JSON ma con contenuti.").sources).toEqual([]);
    expect(() => parseSearchModelReply("ok")).toThrow(/non ha restituito/);
    expect(isSafeSourceUrl("ftp://example.org")).toBe(false);
  });
  it("i risultati per il prompt sono dati non verificati, limitati e con le fonti", () => {
    const text = formatResearchResults([entry(), entry({ status: "blocked", query: "segreto" }), entry({ status: "failed", error: "HTTP 500" })], 1, 2);
    expect(text).toContain("NON verificati");
    expect(text).toContain("round 1/2");
    expect(text).toContain("Archivio — https://example.org/a: verde scuro");
    expect(text).toContain("query bloccata sul dispositivo");
    expect(text).toContain("ricerca non riuscita (HTTP 500)");
    expect(formatResearchResults(Array.from({ length: 40 }, () => entry({ summary: "x".repeat(900) })), 1, 1).length).toBeLessThan(9100);
    expect(researchRule(settings, false)).toContain('{"web_search"');
    expect(researchRule(settings, true)).toContain("NON puoi più cercare");
  });
  it("cache per query identica, registro limitato e schemi rigidi", () => {
    const log = [entry({ at: new Date(Date.now() - 5 * 86_400_000).toISOString() })];
    expect(cachedResearch(log, "Uniformi  polizia vienna 1923", "model", new Date(), 30)?.summary).toContain("verde scuro");
    expect(cachedResearch(log, "uniformi polizia vienna 1923", "wikipedia", new Date(), 30)).toBeUndefined();
    expect(cachedResearch(log, "uniformi polizia vienna 1923", "model", new Date(), 3)).toBeUndefined();
    expect(cachedResearch(log, "uniformi polizia vienna 1923", "model", new Date(), 0)).toBeUndefined();
    expect(appendResearchLog(Array.from({ length: MAX_RESEARCH_LOG }, () => entry()), [entry({ query: "ultima" })]).at(-1)!.query).toBe("ultima");
    expect(researchLogSchema.safeParse([entry({ sources: [{ title: "x", url: "javascript:1", excerpt: "" }] })]).success).toBe(false);
    expect(webResearchSettingsSchema.safeParse({ ...settings, maxQueriesPerTask: 7 }).success).toBe(false);
    expect(webResearchSettingsSchema.safeParse({ ...settings, agents: ["writing", "writing"] }).success).toBe(false);
    expect(webResearchSettingsSchema.safeParse({ ...settings, apiKey: "x" }).success).toBe(false);
  });
});
