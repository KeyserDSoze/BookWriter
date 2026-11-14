import { describe, expect, it } from "vitest";
import { profileBook } from "./__fixtures__/editorial-profiles";
import { bumpProfileVersions, defaultEditorialProfiles, defaultWriterRules, directorInstructions, newWriterProfile,
  parseEditorialProfiles, readEditorialProfileDocuments, writerInstructions, type WriterRule } from "./editorial-profiles";
import { assertEditorialReviewCoverage, assertSavedEditorialFreezeJudgmentIntegrity, assertWriterChecklist, adjudicationPrompt,
  beginNextRound, blockOnMandatoryRules, chapterSegments, createEditorialCycle, cycleRoles, mandatoryRuleRejections,
  reviewerPrompt, validateJudgment, validateReport, type ChapterEditorialCycle } from "./editorial-board";
import { projectBook } from "./narrarium";
import type { BookProject } from "./types";

const pass = JSON.stringify({ verdict: "pass", summary: "Nessun problema concreto nel segmento letto.", memoryNote: "", findings: [] });
const RULES: WriterRule[] = [
  { id: "show-dont-tell", label: "Mostra, non spiegare", description: "Niente emozioni dichiarate.", mandatory: true },
  { id: "no-redundancy", label: "Niente ridondanze", description: "", mandatory: false },
];
function ruleBook(rules = RULES): BookProject {
  const book = profileBook();
  book.editorialProfiles!.writers[0]!.rules = structuredClone(rules);
  return book;
}
function writerReply(outcome: "pass" | "fail", opts: { ruleId?: string; withFinding?: boolean } = {}) {
  const fail = outcome === "fail";
  return JSON.stringify({
    verdict: fail ? "issues" : "pass", summary: "Rilettura secondo la checklist.", memoryNote: "",
    checklist: [{ ruleId: "show-dont-tell", outcome, note: "" }, { ruleId: "no-redundancy", outcome: "pass", note: "" }],
    findings: fail && opts.withFinding !== false ? [{ sceneId: "scene:001:001", category: "show", severity: "major",
      evidence: "Mara attraversa il porto", reason: "Il passaggio spiega invece di mostrare.",
      remediation: "Mostrare con un gesto concreto.", ruleId: opts.ruleId ?? "show-dont-tell" }] : [],
  });
}
/** Every reviewer passes except the writer, whose reply is given. */
function fullCycle(book: BookProject, writer: string): ChapterEditorialCycle {
  const chapter = book.chapters[0]!, cycle = createEditorialCycle(chapter.id, book), segment = chapterSegments(chapter)[0]!;
  for (const role of cycleRoles(book, cycle))
    cycle.reports.push(validateReport(cycle, role, segment, 1, role === "writerReview" ? writer : pass, chapter, book));
  return cycle;
}
const judgment = (action: "accept" | "reject") => JSON.stringify({ reasoning: "Valutazione indipendente della checklist.", decisions: [
  { findingId: "1:writerReview:0:0", action, rationale: "Valutato sul testo del segmento.", remediation: "Mostrare con un gesto concreto." }] });

describe("Checklist dello scrittore", () => {
  it("la scrittura riceve le regole; la rilettura deve verificarle tutte", () => {
    const book = ruleBook();
    const writing = writerInstructions(book.editorialProfiles);
    expect(writing).toContain("[OBBLIGATORIA] show-dont-tell");
    expect(writing).toContain("[consultiva] no-redundancy");
    expect(writing).not.toContain("WRITER_REVIEW_ONLY");
    const chapter = book.chapters[0]!, cycle = createEditorialCycle(chapter.id, book);
    const prompt = reviewerPrompt(book, cycle, "writerReview", chapterSegments(chapter)[0]!, 1).system;
    expect(prompt).toContain("checklist:[");
    expect(prompt).toContain("una regola OBBLIGATORIA respinta");
    expect(reviewerPrompt(book, cycle, "readerGenre", chapterSegments(chapter)[0]!, 1).system).not.toContain("checklist:[");
  });
  it("registra rispettate e violate, rifiuta checklist incomplete, ripetute o incongruenti", () => {
    const book = ruleBook(), cycle = fullCycle(book, writerReply("fail"));
    const writer = cycle.reports.at(-1)!;
    expect(writer.checklist).toEqual([{ ruleId: "show-dont-tell", outcome: "fail", note: "" }, { ruleId: "no-redundancy", outcome: "pass", note: "" }]);
    expect(writer.findings[0]!.ruleId).toBe("show-dont-tell");
    const chapter = book.chapters[0]!, segment = chapterSegments(chapter)[0]!;
    const fresh = createEditorialCycle(chapter.id, book);
    const bad = (raw: unknown) => () => validateReport(fresh, "writerReview", segment, 1, JSON.stringify(raw), chapter, book);
    const base = JSON.parse(writerReply("pass"));
    expect(bad({ ...base, checklist: base.checklist.slice(0, 1) })).toThrow(/incompleta/);
    expect(bad({ ...base, checklist: [...base.checklist, base.checklist[0]] })).toThrow(/sconosciute o ripetute/);
    expect(bad({ ...base, checklist: [...base.checklist, { ruleId: "invented", outcome: "pass" }] })).toThrow(/sconosciute/);
    expect(() => validateReport(fresh, "writerReview", segment, 1,
      writerReply("fail", { withFinding: false }).replace('"verdict":"issues"', '"verdict":"pass"'), chapter, book)).toThrow(/rilievo con prova/);
    expect(() => validateReport(fresh, "writerReview", segment, 1, writerReply("pass").replace('"findings":[]',
      '"verdict":"issues","findings":[{"sceneId":"scene:001:001","category":"x1","severity":"minor","evidence":"Mara attraversa il porto","reason":"Una ragione","remediation":"Una correzione","ruleId":"no-redundancy"}]').replace('"verdict":"pass",', ""), chapter, book))
      .toThrow(/non dichiara violata/);
    expect(() => assertWriterChecklist({ role: "readerGenre", findings: [{ ruleId: "show-dont-tell" }] }, RULES)).toThrow(/Solo la rilettura/);
  });
  it("una checklist manomessa dopo l'import blocca la copertura", () => {
    const book = ruleBook(), cycle = fullCycle(book, writerReply("pass"));
    expect(() => assertEditorialReviewCoverage(book, cycle, true)).not.toThrow();
    delete cycle.reports.at(-1)!.checklist;
    expect(() => assertEditorialReviewCoverage(book, cycle, true)).toThrow(/Checklist dello scrittore/);
  });
  it("respingere una regola OBBLIGATORIA blocca: niente freeze silenzioso, né dopo l'import", () => {
    const book = ruleBook(), chapter = book.chapters[0]!, cycle = fullCycle(book, writerReply("fail"));
    cycle.judgment = validateJudgment(cycle, judgment("reject"), chapter, book);
    expect(cycle.judgment.verdict).toBe("freeze");
    expect(mandatoryRuleRejections(cycle)).toEqual([{ findingId: "1:writerReview:0:0", ruleId: "show-dont-tell", label: "Mostra, non spiegare" }]);
    cycle.stage = "summary"; cycle.summaryCursor = 0;
    expect(() => assertSavedEditorialFreezeJudgmentIntegrity(book, cycle)).toThrow(/regola obbligatoria/);
    expect(blockOnMandatoryRules(cycle)).toBe(true);
    expect(cycle.stage).toBe("blocked");
    expect(cycle.blockedReason).toContain("Mostra, non spiegare");
    expect(chapter.frozenAt).toBeUndefined();
  });
  it("accettare la correzione o violare una regola consultiva non blocca", () => {
    const book = ruleBook(), chapter = book.chapters[0]!;
    const accepted = fullCycle(book, writerReply("fail"));
    accepted.judgment = validateJudgment(accepted, judgment("accept"), chapter, book);
    expect(accepted.judgment.verdict).toBe("repair");
    expect(blockOnMandatoryRules(accepted)).toBe(false);
    const advisory = ruleBook(RULES.map(rule => ({ ...rule, mandatory: false })));
    const cycle = fullCycle(advisory, writerReply("fail"));
    cycle.judgment = validateJudgment(cycle, judgment("reject"), advisory.chapters[0]!, advisory);
    expect(blockOnMandatoryRules(cycle)).toBe(false);
  });
  it("una regola obbligatoria richiede la rilettura e id univoci", () => {
    const profiles = ruleBook().editorialProfiles!;
    profiles.writers[0]!.reviewEnabled = false;
    expect(() => parseEditorialProfiles(profiles)).toThrow();
    profiles.writers[0]!.reviewEnabled = true;
    profiles.writers[0]!.rules = [RULES[0]!, RULES[0]!];
    expect(() => parseEditorialProfiles(profiles)).toThrow();
    expect(newWriterProfile("w1").rules).toEqual(defaultWriterRules());
  });
});

describe("Direttore, cicli e versioni", () => {
  it("le linee guida del direttore si aggiungono al contratto, solo nel giudice", () => {
    const book = ruleBook();
    book.editorialProfiles!.director = { instructions: "DIRECTOR_GUIDE: privilegia ritmo e tensione." };
    expect(directorInstructions(book.editorialProfiles)).toContain("non le sostituiscono");
    const cycle = fullCycle(book, writerReply("pass"));
    const judge = adjudicationPrompt(book, cycle);
    expect(judge.system).toContain("DIRECTOR_GUIDE");
    expect(judge.system).toContain("Decidi UNA VOLTA ogni findingId");
    const chapter = book.chapters[0]!;
    for (const role of cycleRoles(book, cycle))
      expect(reviewerPrompt(book, cycle, role, chapterSegments(chapter)[0]!, 1).system).not.toContain("DIRECTOR_GUIDE");
  });
  it("il numero massimo di cicli è configurabile da 1 a 3", () => {
    const book = profileBook();
    book.editorialProfiles!.maxRounds = 1;
    const cycle = fullCycle(book, pass);
    cycle.judgment = validateJudgment(cycle, JSON.stringify({ reasoning: "Nessun rilievo da valutare in questo ciclo.", decisions: [] }), book.chapters[0]!, book);
    beginNextRound(cycle);
    expect(cycle.stage).toBe("blocked");
    expect(cycle.blockedReason).toContain("Un ciclo non ha");
    expect(() => parseEditorialProfiles({ ...defaultEditorialProfiles(), maxRounds: 4 })).toThrow();
    const standard = fullCycle(profileBook(), pass);
    standard.judgment = validateJudgment(standard, JSON.stringify({ reasoning: "Nessun rilievo da valutare in questo ciclo.", decisions: [] }), book.chapters[0]!, profileBook());
    beginNextRound(standard);
    expect(standard.stage).toBe("review");
  });
  it("le versioni crescono solo per gli agenti modificati e non cambiano l'impronta", () => {
    const first = bumpProfileVersions(undefined, profileBook().editorialProfiles!);
    expect(first.readers.every(r => r.version === 1)).toBe(true);
    const edited = structuredClone(first);
    edited.writers[0]!.writingPrompt = "Una direttiva di scrittura rivista dall'autore.";
    const second = bumpProfileVersions(first, edited);
    expect(second.writers[0]!.version).toBe(2);
    expect(second.readers[0]!.version).toBe(1);
    const book = profileBook(), chapter = book.chapters[0]!;
    book.editorialProfiles = first;
    const cycle = createEditorialCycle(chapter.id, book);
    const report = validateReport(cycle, "readerGenre", chapterSegments(chapter)[0]!, 1, pass, chapter, book);
    book.editorialProfiles = bumpProfileVersions(first, { ...first, readers: first.readers.map(r => ({ ...r, version: 9 })) });
    expect(report.profileStamp).toBeDefined();
  });
  it("regole, direttore e cicli tornano dai Markdown solo come bozza valida", () => {
    const book = ruleBook();
    book.editorialProfiles!.director = { instructions: "Linee guida del direttore per il libro." };
    book.editorialProfiles!.maxRounds = 2;
    const files = projectBook(book, []).files;
    expect(files["profiles/writers/bookwriter-show-writer.md"]).toContain("show-dont-tell | obbligatoria | Mostra, non spiegare");
    expect(files["profiles/director/bookwriter-director.md"]).toContain("Linee guida del direttore");
    expect(files["profiles/board.md"]).toContain("max_rounds: 2");
    const draft = readEditorialProfileDocuments(files);
    expect(draft.writers[0]!.rules).toEqual(RULES);
    expect(draft.director?.instructions).toBe("Linee guida del direttore per il libro.");
    expect(draft.maxRounds).toBe(2);
    const broken = { ...files, "profiles/writers/bookwriter-show-writer.md": files["profiles/writers/bookwriter-show-writer.md"]!.replace("| obbligatoria |", "| forse |") };
    expect(() => readEditorialProfileDocuments(broken)).toThrow(/Profili editoriali/);
  });
});
