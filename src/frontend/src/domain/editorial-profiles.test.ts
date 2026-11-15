import { describe, expect, it } from "vitest";
import { profileBook } from "./__fixtures__/editorial-profiles";
import { checklistEditorialProfiles, defaultEditorialProfiles, parseEditorialProfiles, profileSnapshotSchema, writerInstructions } from "./editorial-profiles";
import { EDITORIAL_ROLES, archiveEditorialRound, assertEditorialReviewCoverage, chapterSegments, createEditorialCycle,
  cycleRoles, nextReviewSlot, repairPrompt, reviewerPrompt, validateJudgment, validateReport } from "./editorial-board";
import { describeNextAutopilotStep } from "./autopilot-step";
import { describeHeadline } from "./live-progress";
import { projectBook } from "./narrarium";
import { readNarrarium } from "./narrarium-reader";
import { readMarkdownDocument } from "./markdown-document";

const pass = JSON.stringify({ verdict: "pass", summary: "Nessun problema concreto nel segmento letto.", memoryNote: "", findings: [] });

describe("Profili editoriali per libro", () => {
  it("un libro nuovo con la checklist ha lo scrittore-revisore con regole consultive", () => {
    const profiles = parseEditorialProfiles(checklistEditorialProfiles("w-1"));
    const writer = profiles.writers.find(item => item.id === profiles.selectedWriterId)!;
    expect(writer.reviewEnabled).toBe(true);
    expect(writer.rules?.length).toBeGreaterThan(0);
    expect(writer.rules?.every(rule => !rule.mandatory)).toBe(true);
    const book = profileBook(); book.editorialProfiles = profiles;
    expect(cycleRoles(book, createEditorialCycle(book.chapters[0]!.id, book)).at(-1)).toBe("writerReview");
  });
  it("senza configurazione mantiene esattamente il panel standard", () => {
    const book = profileBook(); delete book.editorialProfiles;
    expect(cycleRoles(book, createEditorialCycle(book.chapters[0]!.id, book))).toEqual(EDITORIAL_ROLES);
    expect(writerInstructions(book.editorialProfiles)).toBe("");
  });
  it("sei lettori e uno scrittore fanno 14 ruoli, senza perdere i sette specialisti", () => {
    const book = profileBook(), cycle = createEditorialCycle(book.chapters[0]!.id, book);
    const roles = cycleRoles(book, cycle);
    expect(roles).toHaveLength(14);
    expect(roles.slice(0, 7)).toEqual(EDITORIAL_ROLES.slice(0, 7));
    expect(roles.at(-1)).toBe("writerReview");
    expect(describeNextAutopilotStep(book).headline).toContain("14 revisori");
    book.editorialCycle = cycle; book.phase = "chapterReview";
    const chapter = book.chapters[0]!, segment = chapterSegments(chapter)[0]!;
    for (const role of roles.slice(0, -1)) cycle.reports.push(validateReport(cycle, role, segment, 1, pass, chapter, book));
    expect(nextReviewSlot(book, cycle)?.role).toBe("writerReview");
    expect(describeNextAutopilotStep(book).headline).toContain("Rilettura dello scrittore");
    expect(() => assertEditorialReviewCoverage(book, cycle, true)).toThrow(/incompleta/);
    cycle.reports.push(validateReport(cycle, "writerReview", segment, 1, pass, chapter, book));
    expect(assertEditorialReviewCoverage(book, cycle, true).expectedCount).toBe(14);
    expect(describeHeadline("Redazione: writerReview 14/14")).toContain("Rilettura dello scrittore");
  });
  it("nessun profilo o rapporto privato passa al lettore sbagliato, incluso lo scrittore-revisore", () => {
    const book = profileBook(), chapter = book.chapters[0]!, cycle = createEditorialCycle(chapter.id, book), segment = chapterSegments(chapter)[0]!;
    cycle.reports.push(validateReport(cycle, "continuity", segment, 1,
      JSON.stringify({ verdict: "pass", summary: "OTHER_REPORT_PRIVATE_SENTINEL", findings: [], memoryNote: "" }), chapter, book));
    const first = JSON.stringify(reviewerPrompt(book, cycle, "readerGenre", segment, 1));
    const extra = JSON.stringify(reviewerPrompt(book, cycle, "readerExtra1", segment, 1));
    const writer = JSON.stringify(reviewerPrompt(book, cycle, "writerReview", segment, 1));
    expect(first).toContain("READER_ONE_ONLY"); expect(first).not.toContain("EXTRA_READER_ONLY"); expect(first).not.toContain("WRITER_ONLY");
    expect(extra).toContain("EXTRA_READER_ONLY"); expect(extra).not.toContain("READER_ONE_ONLY");
    expect(writer).toContain("WRITER_ONLY"); expect(writer).toContain("WRITER_REVIEW_ONLY"); expect(writer).not.toContain("READER_ONE_ONLY");
    for (const text of [first, extra, writer]) {
      expect(text).not.toContain("PRIVATE_CANON_SENTINEL"); expect(text).not.toContain("OTHER_REPORT_PRIVATE_SENTINEL");
      expect(text).toContain("SCENA"); expect(text).toContain("NON hai i segreti");
    }
  });
  it("il ciclo conserva i template e i nomi mentre la libreria viene modificata", () => {
    const book = profileBook(), chapter = book.chapters[0]!, cycle = createEditorialCycle(chapter.id, book), segment = chapterSegments(chapter)[0]!;
    const before = reviewerPrompt(book, cycle, "writerReview", segment, 1).system;
    book.editorialProfiles!.writers[0]!.writingPrompt = "Una nuova direttiva per un ciclo successivo.";
    book.editorialProfiles!.readers[0]!.name = "Un nome nuovo";
    expect(reviewerPrompt(book, cycle, "writerReview", segment, 1).system).toBe(before);
    for (const role of cycleRoles(book, cycle).slice(0, 8)) cycle.reports.push(validateReport(cycle, role, segment, 1, pass, chapter, book));
    const report = cycle.reports.at(-1)!;
    expect(report.reviewerName).toBe("Lettrice attenta alla noia");
    expect(() => assertEditorialReviewCoverage(book, cycle)).not.toThrow();
    cycle.profileSettings!.readers[0]!.instructions = "Template del ciclo manomesso dopo la risposta.";
    expect(() => assertEditorialReviewCoverage(book, cycle)).toThrow(/profilo/);
  });
  it("il giudice può respingere il rilievo dello scrittore; accettarlo richiede il normale repair", () => {
    const book = profileBook(), chapter = book.chapters[0]!, cycle = createEditorialCycle(chapter.id, book), segment = chapterSegments(chapter)[0]!;
    for (const role of cycleRoles(book, cycle)) {
      const raw = role === "writerReview" ? JSON.stringify({ verdict: "issues", summary: "Un'informazione può essere ridondante.", memoryNote: "", findings: [
        { sceneId: segment.sceneId, category: "esposizione", severity: "minor", evidence: "Mara attraversa il porto", reason: "Valutare se il passaggio è necessario alla scena.", remediation: "Conservare soltanto il gesto narrativamente pertinente." },
      ] }) : pass;
      cycle.reports.push(validateReport(cycle, role, segment, 1, raw, chapter, book));
    }
    assertEditorialReviewCoverage(book, cycle, true);
    const findingId = cycle.reports.at(-1)!.findings[0]!.id;
    const judgment = (action: string) => JSON.stringify({ reasoning: "Valutazione indipendente della funzione narrativa della frase.", decisions: [
      { findingId, action, rationale: "La frase è utile nel contesto della scena.", remediation: "Eliminare soltanto la parte effettivamente ridondante." },
    ] });
    expect(validateJudgment(cycle, judgment("reject"), chapter, book).verdict).toBe("freeze");
    cycle.judgment = validateJudgment(cycle, judgment("accept"), chapter, book);
    cycle.stage = "repair";
    expect(repairPrompt(book, cycle, segment.sceneId).prompt).toContain("WRITER_ONLY");
    const removed = cycle.reports.splice(7, 1)[0]!;
    expect(() => repairPrompt(book, cycle, segment.sceneId)).toThrow(/Matrice/);
    cycle.reports.splice(7, 0, removed);
    expect(archiveEditorialRound(cycle).profileSettings).toEqual(cycle.profileSettings);
    expect(chapter.frozenAt).toBeUndefined();
  });
  it("la redazione leggera conserva i controlli core e usa il panel esplicitamente scelto", () => {
    const book = profileBook(); book.editorialMode = "light";
    const cycle = createEditorialCycle(book.chapters[0]!.id, book);
    expect(cycleRoles(book, cycle)).toHaveLength(11);
    expect(cycleRoles(book, cycle).slice(0, 4)).toEqual(["continuity", "secrets", "timeline", "style"]);
    cycle.roles = cycle.roles!.filter(role => role !== "secrets");
    expect(() => cycleRoles(book, cycle)).toThrow();
    expect(profileSnapshotSchema.safeParse(cycle).success).toBe(false);
  });
  it("esporta profili e rapporti in cartelle estensibili, senza attivarli nell'import solo Markdown", () => {
    const book = profileBook(), chapter = book.chapters[0]!, cycle = createEditorialCycle(chapter.id, book), segment = chapterSegments(chapter)[0]!;
    cycle.reports = [validateReport(cycle, "writerReview", segment, 1, pass, chapter, book)];
    book.editorialCycle = cycle;
    book.markdownSource = { "research/private/notes.md": "---\nanything:\n  nested: untrusted\n---\n\nEXTRA_DOCUMENT_ONLY" };
    const projection = projectBook(book, []);
    expect(readMarkdownDocument(projection.files["profiles/writers/bookwriter-show-writer.md"]!).body).toContain("WRITER_ONLY");
    expect(projection.files["reviews/chapters/001-il-molo/current-round-001.md"]).toContain("Scrittore essenziale");
    expect(projection.files["research/private/notes.md"]).toBe(book.markdownSource["research/private/notes.md"]);
    const markdown = Object.fromEntries(Object.entries(projection.files).filter(([p]) => p.endsWith(".md")));
    const imported = readNarrarium(markdown, crypto.randomUUID(), book.updatedAt);
    expect(imported.editorialProfiles).toBeUndefined();
    expect(imported.editorialCycle).toBeUndefined();
    expect(imported.markdownSource!["research/private/notes.md"]).toContain("EXTRA_DOCUMENT_ONLY");
  });
  it("valida profili, limiti, chiavi extra, ruoli e selezioni senza coercizioni", () => {
    const profiles = defaultEditorialProfiles();
    expect(parseEditorialProfiles(profiles).readers).toHaveLength(5);
    for (const change of [
      { ...profiles, selectedWriterId: "missing" }, { ...profiles, readers: [] },
      { ...profiles, readers: profiles.readers.map(p => ({ ...p, enabled: false })) },
      { ...profiles, readers: [...profiles.readers, profiles.readers[0]!] },
      { ...profiles, readers: [{ ...profiles.readers[0]!, role: "historical" }] },
      { ...profiles, apiKey: "not-permitted" },
    ]) expect(() => parseEditorialProfiles(change)).toThrow(/Profili editoriali non validi/);
  });
});
