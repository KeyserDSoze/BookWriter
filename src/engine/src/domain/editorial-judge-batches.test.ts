import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import {
  EDITORIAL_ROLES, adjudicationPrompt, allFindings, chapterSegments, createEditorialCycle,
  judgeBatchesOf, judgeFindingsPerOutput, judgeToolSchema, nextJudgmentScope, recordJudgeBatch, validateJudgment, validateReport,
  type ChapterEditorialCycle,
} from "./editorial-board";
import { estimateTextTokens } from "./model-token-limits";

const SENTENCES = [
  "Mara attraversa il cortile deserto con passo lento.",
  "Il guardiano controlla la lanterna accanto al portone.",
  "Una campana lontana rompe il silenzio del mattino.",
  "Il vento muove le foglie secche lungo il muro nord.",
  "Mara ricorda la promessa fatta alla nonna morente.",
  "Il cancello cigola sotto la mano del guardiano.",
  "Nella torre una finestra si illumina all'improvviso.",
  "Il cane del castello abbaia verso la strada vuota.",
];
const FINDING_ROLES = ["style", "narrative", "readerGenre", "readerCasual", "readerSkeptic", "readerMystery", "readerCharacters", "characterVoice"] as const;

function fixture(): { book: BookProject; cycle: ChapterEditorialCycle } {
  const book = newBook("Mara incontra il guardiano del castello.", "Il segreto del portone", "Sobrio", "Adulti");
  book.phase = "chapterReview"; book.status = "paused";
  book.chapters = [{ id: "c1", number: 1, title: "Il portone", purpose: "Incontrare il guardiano",
    scenes: [{ id: "s1", number: 1, title: "L'arrivo", objective: "Introdurre il mistero",
      text: SENTENCES.join(" "), status: "canon" }] }];
  const chapter = book.chapters[0]!;
  const cycle = createEditorialCycle(chapter.id);
  const segments = chapterSegments(chapter);
  for (const role of EDITORIAL_ROLES) for (const segment of segments) {
    const index = FINDING_ROLES.indexOf(role as typeof FINDING_ROLES[number]);
    const raw = JSON.stringify(index >= 0 ? {
      verdict: "issues", summary: "Un punto del testo merita un controllo di " + role + ".", memoryNote: "",
      findings: [{ sceneId: segment.sceneId, category: "stile", severity: "minor", evidence: SENTENCES[index]!.slice(0, -1),
        reason: "Questa frase ha un effetto sul ritmo che il revisore vuole far verificare al direttore con attenzione, in modo motivato.",
        remediation: "Valutare una variazione di ritmo senza cambiare i fatti del capitolo né la voce dei personaggi." }],
    } : { verdict: "pass", summary: "Nessun problema narrativo dimostrato.", memoryNote: "", findings: [] });
    cycle.reports.push(validateReport(cycle, role, segment, segments.length, raw, chapter, book));
  }
  cycle.stage = "adjudicate"; book.editorialCycle = cycle;
  return { book, cycle };
}
const reply = (ids: string[]) => JSON.stringify({
  reasoning: "Il lotto è stato valutato criticamente, senza dare per corretti i rapporti dei revisori.",
  decisions: ids.map(findingId => ({ findingId, action: "reject",
    rationale: "Il ritmo della frase è intenzionale e non richiede alcun intervento.", remediation: "" })),
});
const tokens = (book: BookProject, cycle: ChapterEditorialCycle, ids?: string[]) => {
  const p = adjudicationPrompt(book, cycle, ids ? { findingIds: new Set(ids), critique: false, ruleChecks: false } : undefined);
  return estimateTextTokens(p.system, p.prompt);
};

describe("Direttore editoriale a lotti con limite di input", () => {
  it("senza limite, o se tutto entra, resta una sola chiamata", () => {
    const { book, cycle } = fixture();
    expect(nextJudgmentScope(book, cycle, undefined)).toBeUndefined();
    expect(nextJudgmentScope(book, cycle, tokens(book, cycle) + 10)).toBeUndefined();
  });
  it("con un limite basso decide tutti i rilievi in più lotti che entrano nel limite e fonde il giudizio completo", () => {
    const { book, cycle } = fixture();
    const chapter = book.chapters[0]!;
    const all = allFindings(cycle).map(f => f.id);
    expect(all).toHaveLength(8);
    const limit = Math.floor((tokens(book, cycle, [all[0]!]) + tokens(book, cycle)) / 2);
    const seen: string[][] = [];
    let judgment;
    for (let guard = 0; guard < 20 && !judgment; guard++) {
      const scope = nextJudgmentScope(book, cycle, limit);
      expect(scope).toBeDefined();
      const ids = [...scope!.findingIds];
      expect(tokens(book, cycle, ids)).toBeLessThanOrEqual(limit);
      const prompt = adjudicationPrompt(book, cycle, scope).prompt;
      for (const other of all.filter(id => !ids.includes(id))) expect(prompt).not.toContain(other);
      expect(ids.every(id => !seen.flat().includes(id))).toBe(true);
      seen.push(ids);
      judgment = recordJudgeBatch(book, cycle, chapter, scope!, reply(ids));
      if (!judgment) expect(judgeBatchesOf(cycle).length).toBe(seen.length);
    }
    expect(seen.length).toBeGreaterThan(1);
    expect(judgment?.decisions.map(d => d.findingId).sort()).toEqual([...all].sort());
    expect(judgment?.verdict).toBe("freeze");
    expect(cycle.judgeBatches).toBeUndefined();
    expect(() => validateJudgment(cycle, reply(all), chapter, book)).not.toThrow();
  });
  it("un lotto non può decidere rilievi di altri lotti né ometterne di suoi", () => {
    const { book, cycle } = fixture();
    const chapter = book.chapters[0]!;
    const all = allFindings(cycle).map(f => f.id);
    const scope = { findingIds: new Set(all.slice(0, 2)), critique: false, ruleChecks: false };
    expect(() => validateJudgment(cycle, reply(all.slice(0, 3)), chapter, book, scope)).toThrow();
    expect(() => validateJudgment(cycle, reply(all.slice(0, 1)), chapter, book, scope)).toThrow(/non ha valutato/);
    expect(() => validateJudgment(cycle, reply(all.slice(0, 2)), chapter, book, scope)).not.toThrow();
  });
  it("la funzione del direttore elenca gli ID esatti dei rilievi ed è la stessa per tutti i lotti", () => {
    const { book, cycle } = fixture();
    const schema = judgeToolSchema(book, cycle) as {
      required: string[]; properties: { decisions: { description: string; items: { required: string[]; properties: Record<string, { enum?: string[] }> } } } };
    expect(schema.required).toEqual(["reasoning", "decisions"]);
    expect(schema.properties.decisions.description).toContain("OGNI rilievo");
    expect(schema.properties.decisions.items.required).toEqual(["findingId", "action", "rationale"]);
    expect(schema.properties.decisions.items.properties.findingId!.enum).toEqual(allFindings(cycle).map(f => f.id));
    // No finding of this cycle needs the optional structured reviews.
    expect(schema.properties.decisions.items.properties.narrativeReview).toBeUndefined();
    expect(judgeToolSchema(book, cycle)).toEqual(schema);
  });
  it("dichiara l'impossibilità quando nemmeno un gruppo indivisibile entra nel limite, senza troncare", () => {
    const { book, cycle } = fixture();
    expect(() => nextJudgmentScope(book, cycle, 500)).toThrow(/nemmeno con un solo gruppo/);
  });
  it("con un limite di output dichiarato divide i rilievi in lotti che lasciano metà output al ragionamento", () => {
    const { book, cycle } = fixture();
    const chapter = book.chapters[0]!;
    const all = allFindings(cycle).map(f => f.id);
    expect(judgeFindingsPerOutput(8192)).toBe(20);
    expect(nextJudgmentScope(book, cycle, undefined, 8192)).toBeUndefined();
    const sizes: number[] = [];
    let judgment;
    for (let guard = 0; guard < 20 && !judgment; guard++) {
      const scope = nextJudgmentScope(book, cycle, undefined, 1200);
      expect(scope).toBeDefined();
      sizes.push(scope!.findingIds.size);
      judgment = recordJudgeBatch(book, cycle, chapter, scope!, reply([...scope!.findingIds]));
    }
    expect(Math.max(...sizes)).toBeLessThanOrEqual(judgeFindingsPerOutput(1200));
    expect(sizes.length).toBeGreaterThan(1);
    expect(judgment?.decisions.map(d => d.findingId).sort()).toEqual([...all].sort());
  });
  it("ignora lotti salvati incoerenti e ricomincia", () => {
    const { cycle } = fixture();
    cycle.judgeBatches = [{ findingIds: ["inesistente"], raw: "{}", critique: false, ruleChecks: false }];
    expect(judgeBatchesOf(cycle)).toEqual([]);
    cycle.judgeBatches = [{ findingIds: ["x"], raw: 5 as never, critique: false, ruleChecks: false }];
    expect(judgeBatchesOf(cycle)).toEqual([]);
  });
});
