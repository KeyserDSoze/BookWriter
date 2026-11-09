import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import {
  EDITORIAL_ROLES, assertEditorialReviewCoverage, chapterSegments,
  createEditorialCycle, editorialSegmentTextStamp, nextReviewSlot,
  validateReport, type ChapterEditorialCycle,
} from "./editorial-board";

const prose = "Mara vede il guardiano mentre apre il portone del castello.";

function sample(): BookProject {
  const book = newBook("Un incontro al castello.", "Il castello", "Sobrio", "Adulti");
  book.chapters = [{
    id: "ch-1", number: 1, title: "La porta", purpose: "Inizio",
    scenes: [
      { id: "scene-1", number: 1, title: "Ingresso", objective: "Entrare",
        text: prose, status: "canon" },
      { id: "scene-2", number: 2, title: "La stanza", objective: "Osservare",
        text: "Il guardiano resta immobile davanti alla porta chiusa.", status: "canon" },
    ],
  }];
  return book;
}
const pass = () => JSON.stringify({
  verdict: "pass", summary: "Non sono stati individuati problemi nel segmento.",
  findings: [], memoryNote: "Prosa pubblica letta.",
});
const issue = () => JSON.stringify({
  verdict: "issues", summary: "Un passaggio richiede verifica del contesto.",
  findings: [{
    sceneId: "scene-1", category: "voce", severity: "minor",
    evidence: "Mara vede il guardiano",
    reason: "La reazione del personaggio merita una lettura critica.",
    remediation: "Rivalutare le battute per chiarire le motivazioni del personaggio.",
  }], memoryNote: "Una nota narrativa.",
});
function fill(book: BookProject, cycle: ChapterEditorialCycle, count: number, withIssue = false): void {
  const chapter = book.chapters[0]!;
  const segments = chapterSegments(chapter);
  for (let slot = cycle.reports.length; slot < count; slot++) {
    const role = EDITORIAL_ROLES[Math.floor(slot / segments.length)]!;
    const segment = segments[slot % segments.length]!;
    cycle.reports.push(validateReport(
      cycle, role, segment, segments.length,
      withIssue && slot === 0 ? issue() : pass(), chapter, book,
    ));
  }
}

describe("Gate di copertura e freschezza della redazione a 12 agenti", () => {
  it("crea l'impronta locale deterministica per ogni segmento, compresi emoji", () => {
    expect(editorialSegmentTextStamp("Mara 👩‍💻")).toBe(editorialSegmentTextStamp("Mara 👩‍💻"));
    expect(editorialSegmentTextStamp("Mara 👩‍💻")).not.toBe(editorialSegmentTextStamp("Mara 👨‍💻"));
  });
  it("richiede 12 revisori per ciascun segmento prima del giudice", () => {
    const book = sample(), cycle = createEditorialCycle("ch-1");
    const total = EDITORIAL_ROLES.length * 2;
    expect(assertEditorialReviewCoverage(book, cycle)).toMatchObject({
      reportCount: 0, expectedCount: total, segmentCount: 2,
    });
    expect(() => assertEditorialReviewCoverage(book, cycle, true)).toThrow(/Redazione incompleta/);
    fill(book, cycle, 23);
    expect(nextReviewSlot(book, cycle)).toMatchObject({
      role: "readerMystery", segmentCount: 2,
      segment: { sceneId: "scene-2", index: 1 },
    });
    expect(() => assertEditorialReviewCoverage(book, cycle, true)).toThrow(/Redazione incompleta/);
    fill(book, cycle, total);
    expect(nextReviewSlot(book, cycle)).toBeUndefined();
    expect(assertEditorialReviewCoverage(book, cycle, true).reportCount).toBe(total);
  });
  it("respinge rapporti saltati, invertiti, replicati e con segmento o ruolo fasullo", () => {
    const book = sample(), cycle = createEditorialCycle("ch-1");
    fill(book, cycle, 4);
    const baseline = structuredClone(cycle.reports);
    const reject = () => expect(() => nextReviewSlot(book, cycle)).toThrow(/fuori ordine/);
    cycle.reports[0] = structuredClone(baseline[1]!);
    reject();
    cycle.reports = structuredClone(baseline);
    [cycle.reports[0], cycle.reports[1]] = [cycle.reports[1]!, cycle.reports[0]!];
    reject();
    cycle.reports = structuredClone(baseline);
    cycle.reports[2]!.segmentCount = 1;
    reject();
    cycle.reports = structuredClone(baseline);
    cycle.reports[0]!.role = "readerMystery";
    reject();
    cycle.reports = structuredClone(baseline);
    cycle.reports[0]!.segmentIndex = 9;
    reject();
  });
  it("blocca persino un report PASS diventato obsoleto dopo la modifica della prosa", () => {
    const book = sample(), cycle = createEditorialCycle("ch-1");
    fill(book, cycle, 24);
    book.chapters[0]!.scenes[1]!.text += " Una frase nuova.";
    expect(() => nextReviewSlot(book, cycle)).toThrow(/obsoleto/);
    expect(() => assertEditorialReviewCoverage(book, cycle, true)).toThrow(/obsoleto/);
    expect(cycle.reports).toHaveLength(24);
  });
  it("non promuove i report legacy senza impronta ma li conserva per lettura", () => {
    const book = sample(), cycle = createEditorialCycle("ch-1");
    fill(book, cycle, 1);
    delete cycle.reports[0]!.segmentTextStamp;
    expect(() => nextReviewSlot(book, cycle)).toThrow(/obsoleto/);
    expect(cycle.reports).toHaveLength(1);
  });
  it("rifiuta verdetto incongruente, finding duplicati o prova alterata", () => {
    const book = sample(), cycle = createEditorialCycle("ch-1");
    fill(book, cycle, 24, true);
    expect(assertEditorialReviewCoverage(book, cycle, true).reportCount).toBe(24);
    cycle.reports[0]!.verdict = "pass";
    expect(() => assertEditorialReviewCoverage(book, cycle, true)).toThrow(/obsoleto/);
    cycle.reports[0]!.verdict = "issues";
    cycle.reports[0]!.findings.push(structuredClone(cycle.reports[0]!.findings[0]!));
    expect(() => assertEditorialReviewCoverage(book, cycle, true)).toThrow(/finding duplicati/);
    cycle.reports[0]!.findings.pop();
    cycle.reports[0]!.findings[0]!.evidenceAnchor!.offset++;
    expect(() => assertEditorialReviewCoverage(book, cycle, true)).toThrow(/prova narrativa/);
  });
  it("rifiuta un numero di report superiore ai 12×segmenti, senza cancellarli", () => {
    const book = sample(), cycle = createEditorialCycle("ch-1");
    fill(book, cycle, 24);
    cycle.reports.push(structuredClone(cycle.reports[23]!));
    expect(() => nextReviewSlot(book, cycle)).toThrow(/rapporti extra/);
    expect(cycle.reports).toHaveLength(25);
  });
});
