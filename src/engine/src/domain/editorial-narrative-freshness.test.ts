import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import {
  EDITORIAL_ROLES, assertCurrentNarrativeReviewWitnesses,
  assertEditorialReviewCoverage, chapterSegments, createEditorialCycle,
  nextReviewSlot, validateReport, type ChapterEditorialCycle,
} from "./editorial-board";
import { extractNarrativeEventCandidates } from "./narrative-event-candidates";
import { createNarrativeEventDecision } from "./narrative-event-decisions";
import { buildUnattestedSceneContext } from "./unattested-scene-context";

const currentText = "Mara porta la chiave alla torre e ripensa alle azioni della notte.";
const priorText = "Mara nasconde la chiave nel pozzo durante la notte. Mara parte.";
function sample(): BookProject {
  const book = newBook("Una storia di chiavi.", "La torre", "Sobrio", "Adulti");
  book.chapters = [
    { id: "c1", number: 1, title: "Il passato", purpose: "Nascondere",
      frozenAt: "2026-11-08T10:00:00.000Z",
      scenes: [{id:"s1",number:1,title:"Il pozzo",objective:"Nascondere",
        text:priorText,status:"canon"}] },
    { id: "c2", number: 2, title: "Il presente", purpose: "Spostarsi",
      scenes: [{id:"s2",number:1,title:"La torre",objective:"Arrivare",
        text:currentText,status:"canon"}] },
  ];
  return book;
}
const pass = JSON.stringify({
  verdict: "pass", summary: "Nessun rilievo documentabile nel segmento.",
  memoryNote: "", findings: [],
});
function reports(book: BookProject, conflict: Record<string, unknown>): ChapterEditorialCycle {
  const ch = book.chapters[1]!, segment = chapterSegments(ch)[0]!;
  const cycle = createEditorialCycle(ch.id);
  for (const role of EDITORIAL_ROLES) {
    const raw = role === "continuity" ? JSON.stringify({
      verdict: "issues", summary: "Un passaggio richiede una lettura critica.",
      memoryNote: "", findings: [{
        sceneId: "s2", category: "continuità", severity: "major",
        evidence: "Mara porta la chiave alla torre",
        reason: "Il movimento della chiave merita un controllo.",
        remediation: "Riesaminare il passaggio senza assumere che sia un errore.",
        ...conflict,
      }],
    }) : pass;
    cycle.reports.push(validateReport(cycle,role,segment,1,raw,ch,book));
  }
  return cycle;
}
function unconfirmed(book: BookProject): Record<string, unknown> {
  const ch = book.chapters[1]!;
  const source = buildUnattestedSceneContext(book,ch,currentText).witnesses[0]!;
  return {priorSceneConflict: {
    chapterId: source.chapterId, sceneId: source.sceneId,
    sourceFrozenAt: source.sourceFrozenAt, sourceTextStamp: source.sourceTextStamp,
    offset: source.offset, quote: source.text.slice(0,32),
    dimension: "causality",
    hypothesis: "La chiave potrebbe non trovarsi nello stesso luogo nelle due scene.",
  }};
}
function attested(book: BookProject): Record<string, unknown> {
  const ch = book.chapters[0]!, candidate = extractNarrativeEventCandidates(ch,ch.scenes[0]!)[0]!;
  const d = createNarrativeEventDecision(book,candidate,"affirmed",
    "L'autore attesta questa menzione senza certificare il fatto.",
    crypto.randomUUID(),"2026-11-09T18:00:00.000Z");
  book.narrativeEventDecisions = [d];
  return {narrativeConflict: {
    priorEventDecisionId: d.id, dimension: "causality",
    hypothesis: "La collocazione della chiave sembra differire fra gli episodi.",
  }};
}
describe("Freschezza dei testimoni precedenti nella review 12×N", () => {
  it("accetta testimoni attuali di entrambi i tipi senza modificare il checkpoint", () => {
    for (const kind of ["unconfirmed","attested"] as const) {
      const book = sample(), cycle = reports(book,
        kind === "unconfirmed" ? unconfirmed(book) : attested(book));
      const before = structuredClone(cycle);
      expect(assertEditorialReviewCoverage(book,cycle,true).reportCount).toBe(12);
      expect(nextReviewSlot(book,cycle)).toBeUndefined();
      expect(cycle).toEqual(before);
    }
  });
  it("blocca il prefisso completo quando la fonte non attestata è scongelata o modificata", () => {
    const book = sample(), cycle = reports(book,unconfirmed(book));
    const before = structuredClone(cycle);
    book.chapters[0]!.frozenAt = "2026-11-09T20:00:00.000Z";
    expect(() => nextReviewSlot(book,cycle)).toThrow(/Testimone narrativo precedente non più corrente/);
    book.chapters[0]!.frozenAt = "2026-11-08T10:00:00.000Z";
    book.chapters[0]!.scenes[0]!.text += " Una nuova versione.";
    expect(() => assertEditorialReviewCoverage(book,cycle,true))
      .toThrow(/Testimone narrativo precedente non più corrente/);
    expect(cycle).toEqual(before);
    expect(book.chapters[1]!.scenes[0]!.text).toBe(currentText);
  });
  it("blocca una attestazione revocata benché la scena revisionata non sia cambiata", () => {
    const book = sample(), cycle = reports(book,attested(book));
    book.narrativeEventDecisions = [];
    expect(() => assertCurrentNarrativeReviewWitnesses(book,book.chapters[1]!,cycle))
      .toThrow(/attestazione ritirata/);
    expect(() => assertEditorialReviewCoverage(book,cycle,true))
      .toThrow(/Testimone narrativo precedente non più corrente/);
  });
  it("blocca una marca importata in un rapporto di ruolo non autorizzato", () => {
    const book = sample(), cycle = reports(book,unconfirmed(book));
    cycle.reports[5]!.verdict = "issues";
    cycle.reports[5]!.findings = [{
      ...structuredClone(cycle.reports[0]!.findings[0]!),
      id: "1:style:0:0",
    }];
    expect(() => assertCurrentNarrativeReviewWitnesses(book,book.chapters[1]!,cycle))
      .toThrow(/quattro specialisti/);
    expect(() => assertEditorialReviewCoverage(book,cycle,true))
      .toThrow(/quattro specialisti/);
  });
  it("rifiuta un finding che inventa due testimoni incompatibili", () => {
    const book = sample(), cycle = reports(book,unconfirmed(book));
    cycle.reports[0]!.findings[0]!.narrativeConflict = {
      priorEventDecisionId:"inventato",dimension:"causality",
      hypothesis:"L'autore non ha attestato questo episodio precedente.",
    };
    expect(() => assertCurrentNarrativeReviewWitnesses(book,book.chapters[1]!,cycle))
      .toThrow(/un'unica fonte/);
  });
});
