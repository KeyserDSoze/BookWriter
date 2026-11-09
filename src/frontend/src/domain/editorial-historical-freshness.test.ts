import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import {
  EDITORIAL_ROLES, adjudicationPrompt, assertCurrentHistoricalReviewSources,
  assertEditorialReviewCoverage, chapterSegments, createEditorialCycle,
  nextReviewSlot, repairPrompt, validateJudgment, validateReport,
} from "./editorial-board";
import { editorialRecoveryProblem } from "../application/editorial-control";
import { extendHistoricalDossier, type HistoricalSource } from "./historical-research";

const query = "Telegrafo elettrico nel 1848";
const sourceExcerpt = "Il telegrafo elettrico cominciò a diffondersi in Europa durante il XIX secolo.";
const quote = "Il telegrafo elettrico cominciò a diffondersi";
const narrative = "Nel 1848 Mara usa il telegrafo per mandare un messaggio.";
const evidence = "Mara usa il telegrafo";
function source(revisionId: number): HistoricalSource {
  return {
    id: "itwiki:42:" + revisionId, pageId: 42, revisionId,
    provider: "it.wikipedia.org", title: "Telegrafo",
    url: "https://it.wikipedia.org/wiki/Telegrafo",
    query, excerpt: sourceExcerpt, retrievedAt: "2026-11-08T12:00:00.000Z",
  };
}
function reportWithClaim(assessment: "consistent_with_excerpt" | "unverified") {
  return JSON.stringify({
    verdict: "issues", summary: "La ricostruzione storica necessita di una valutazione.",
    memoryNote: "Accertamento documentale fallibile.",
    findings: [{
      sceneId: "s1", category: "storia", severity: "minor",
      evidence,
      reason: "Il riferimento all'uso del telegrafo va contestualizzato.",
      remediation: "Specificare una formulazione prudente del contesto storico.",
      historical: {
        claim: "La diffusione del telegrafo in Europa va verificata con attenzione.",
        assessment,
        sourceIds: assessment === "unverified" ? [] : ["itwiki:42:210"],
        ...(assessment === "unverified" ? {} : { sourceQuote: quote }),
      },
    }],
  });
}
function bookFixture(): BookProject {
  const book = newBook("Mara usa un mezzo di comunicazione nel 1848.", "Il telegrafo", "Sobrio", "Adulti");
  book.chapters = [{
    id: "c1", number: 1, title: "Il messaggio", purpose: "Avviare la scena",
    scenes: [{ id: "s1", number: 1, title: "Il telegrafo", objective: "Comunicare",
      text: narrative, status: "canon" }],
    historicalDossier: extendHistoricalDossier(undefined, [query], [source(210)],
      "2026-11-09T15:00:00.000Z"),
  }];
  return book;
}
function buildReports(book: BookProject, unverified = false) {
  const chapter = book.chapters[0]!;
  const segment = chapterSegments(chapter)[0]!;
  const cycle = createEditorialCycle("c1");
  for (const role of EDITORIAL_ROLES) {
    cycle.reports.push(validateReport(cycle, role, segment, 1,
      role === "historical" ? reportWithClaim(unverified ? "unverified" : "consistent_with_excerpt") :
        JSON.stringify({ verdict: "pass", summary: "Nessuna criticità verificabile nel segmento.",
          memoryNote: "", findings: [] }),
      chapter, book));
  }
  return cycle;
}
function retireSource(book: BookProject): void {
  book.chapters[0]!.historicalDossier = extendHistoricalDossier(
    book.chapters[0]!.historicalDossier, [query], [source(211)],
    "2026-11-09T17:00:00.000Z");
}
function judgeJson(findingId: string, action: "accept" | "reject"): string {
  return JSON.stringify({
    reasoning: "La citazione storica non dimostra da sola che il fatto narrato sia inesatto.",
    decisions: [{
      findingId, action,
      rationale: "Serve distinguere un dato documentato dall'interpretazione proposta.",
      remediation: action === "accept" ? "Formulare un passaggio più prudente." : "",
    }],
  });
}

describe("Rivalidazione live del dossier storico della redazione", () => {
  it("accetta la fonte ancora attiva e la matrice completa dei 12 revisori", () => {
    const book = bookFixture(), cycle = buildReports(book);
    expect(assertEditorialReviewCoverage(book, cycle, true)).toMatchObject({
      reportCount: 12, expectedCount: 12, segmentCount: 1,
    });
    expect(nextReviewSlot(book, cycle)).toBeUndefined();
    expect(adjudicationPrompt(book, cycle).prompt).toContain(quote);
    const id = cycle.reports[3]!.findings[0]!.id;
    expect(validateJudgment(cycle, judgeJson(id, "reject"), book.chapters[0]!, book).verdict).toBe("freeze");
  });
  it("blocca i 12 rapporti ancora integri se una revisione citata diventa inattiva", () => {
    const book = bookFixture(), cycle = buildReports(book);
    const before = structuredClone(cycle.reports);
    retireSource(book);
    expect(book.chapters[0]!.historicalDossier?.sources).toHaveLength(2);
    expect(() => assertEditorialReviewCoverage(book, cycle, true)).toThrow(/Fonte storica.*non più corrente/);
    expect(() => nextReviewSlot(book, cycle)).toThrow(/Fonte storica/);
    expect(() => adjudicationPrompt(book, cycle)).toThrow(/Fonte storica/);
    expect(() => validateJudgment(cycle,
      judgeJson(cycle.reports[3]!.findings[0]!.id, "accept"), book.chapters[0]!, book))
      .toThrow(/Fonte storica/);
    book.phase = "chapterReview";
    cycle.stage = "adjudicate";
    book.editorialCycle = cycle;
    expect(editorialRecoveryProblem(book)).toMatch(/Fonte storica/);
    expect(cycle.reports).toEqual(before);
    expect(book.chapters[0]!.scenes[0]!.text).toBe(narrative);
  });
  it("blocca anche un estratto alterato sullo stesso sourceId ancora attivo", () => {
    const book = bookFixture(), cycle = buildReports(book);
    book.chapters[0]!.historicalDossier!.sources[0]!.excerpt = "Una fonte ora non include la citazione originaria.";
    expect(() => assertCurrentHistoricalReviewSources(book.chapters[0]!, cycle))
      .toThrow(/non compare/);
  });
  it("blocca remediation riprese/importate quando una fonte viene ritirata", () => {
    const book = bookFixture(), cycle = buildReports(book);
    const id = cycle.reports[3]!.findings[0]!.id;
    cycle.judgment = validateJudgment(cycle, judgeJson(id, "accept"), book.chapters[0]!, book);
    cycle.stage = "repair";
    expect(repairPrompt(book, cycle, "s1").prompt).toContain("Formulare un passaggio più prudente");
    retireSource(book);
    expect(() => repairPrompt(book, cycle, "s1")).toThrow(/Fonte storica/);
    expect(cycle.judgment.verdict).toBe("repair");
    expect(book.chapters[0]!.scenes[0]!.text).toBe(narrative);
  });
  it("mantiene report senza fonte marcati unverified come ipotesi e non attestazioni", () => {
    const book = bookFixture(), cycle = buildReports(book, true);
    retireSource(book);
    expect(assertEditorialReviewCoverage(book, cycle, true).reportCount).toBe(12);
    const finding = cycle.reports[3]!.findings[0]!;
    expect(finding.historical?.assessment).toBe("unverified");
    expect(finding.historical?.sourceIds).toHaveLength(0);
    expect(validateJudgment(cycle, judgeJson(finding.id, "reject"),
      book.chapters[0]!, book).verdict).toBe("freeze");
  });
  it("rifiuta fonti introdotte a posteriori da ruoli diversi da historical", () => {
    const book = bookFixture(), cycle = buildReports(book);
    cycle.reports[0]!.findings.push(structuredClone(cycle.reports[3]!.findings[0]!));
    expect(() => assertCurrentHistoricalReviewSources(book.chapters[0]!, cycle))
      .toThrow(/solo il revisore storico/);
  });
});
