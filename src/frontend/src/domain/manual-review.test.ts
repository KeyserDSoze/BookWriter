import { describe, expect, it } from "vitest";
import { knowledgeBook } from "./__fixtures__/knowledge";
import type { BookProject } from "./types";
import { elementReviewState, pendingElements, settleChapterEdits } from "./book-edits";
import { editEntity, editScene } from "./book-editing";
import { activeManualReview, buildReviewUnits, estimateBoardCalls, estimateReviewCalls, MAX_REVIEW_UNITS, validateImpactReply, validateReviewReply } from "./manual-review";
import { cancelManualReview, createManualReview, decideReviewProposal, describeManualReview, interruptImportedReviews,
  ManualReviewChanged, nextManualReviewStep, type ManualReviewAiStep, type ManualReviewRequest } from "./manual-review-flow";
import { describeNextAutopilotStep } from "./autopilot-step";

const NOW = "2026-11-14T10:00:00.000Z";
const ctx = { now: NOW, origin: "manual" as const };
const pass = JSON.stringify({ verdict: "pass", summary: "Coerente con schede e scene vicine.", findings: [] });
const issue = (sceneId: string, evidence: string) => JSON.stringify({ verdict: "issues", summary: "Una incongruenza.", findings: [
  { sceneId, severity: "major", category: "continuity", evidence, issue: "Il porto contraddice il molo della scena precedente.", suggestion: "Riporta il molo." }] });
/** Runs the review like the runner would: local steps applied, AI steps answered by `reply`. */
function run(book: BookProject, reply: (step: ManualReviewAiStep) => string): ManualReviewAiStep[] {
  const asked: ManualReviewAiStep[] = [];
  for (let guard = 0; guard < 200; guard++) {
    const step = nextManualReviewStep(book);
    if (!step) return asked;
    if (step.type === "local") step.run(book, NOW);
    else { asked.push(step); step.apply(book, reply(step), NOW); }
  }
  throw new Error("La review non termina.");
}
/** Runs the next step, which must be local, and returns its summary. */
function runLocal(book: BookProject): string {
  const step = nextManualReviewStep(book);
  if (step?.type !== "local") throw new Error("Atteso un passo locale.");
  return step.run(book, NOW);
}
function edited(): BookProject {
  const book = knowledgeBook();
  editScene(book, "scene:002:001", { text: "Markus aspetta sul molo al tramonto. Dice di conoscere il Consiglio cittadino." }, ctx);
  editEntity(book, "character:markus", { summary: "Informatore che teme il Consiglio." }, ctx);
  return book;
}
const request = (patch: Partial<ManualReviewRequest> = {}): ManualReviewRequest =>
  ({ scope: "targeted", mode: "check", targets: [{ kind: "scene", id: "scene:002:001" }], ...patch });

describe("Review controllata dall'autore", () => {
  it("si può rivedere solo una parte delle modifiche di un elemento: le altre restano da rivedere", () => {
    const book = edited();
    editScene(book, "scene:002:001", { text: "Markus aspetta sul molo al tramonto, nervoso. Dice di conoscere il Consiglio cittadino." }, { ...ctx, now: "2026-11-14T11:00:00.000Z" });
    const [first, second] = (book.edits ?? []).filter(e => e.target.id === "scene:002:001");
    expect(() => createManualReview(book, request({ editIds: [] }), NOW)).toThrow(/almeno una modifica/);
    expect(() => createManualReview(book, request({ editIds: ["00000000-0000-4000-8000-000000000000"] }), NOW)).toThrow(/non è più da rivedere/);
    const review = createManualReview(book, request({ editIds: [first!.id] }), NOW);
    expect(review.editIds).toEqual([first!.id]);
    expect(first!.reviewState).toBe("review_pending");
    expect(second!.reviewState).toBe("modified_unreviewed");
    book.status = "running";
    const asked = run(book, () => pass);
    expect(asked[0]!.prompt).toContain("MODIFICHE DA VERIFICARE");
    expect(first!.reviewState).toBe("review_passed");
    // The latest change was left out: the element is still to review.
    expect(second!.reviewState).toBe("modified_unreviewed");
    expect(elementReviewState(book, { kind: "scene", id: "scene:002:001" })).toBe("modified_unreviewed");
  });
  it("la review completa con la redazione riapre i capitoli revisionati e finisce quando sono congelati di nuovo", () => {
    const book = edited();
    book.status = "paused";
    expect(estimateBoardCalls(book)).toBeGreaterThanOrEqual(2 * (12 + 2));
    expect(() => createManualReview(book, request({ scope: "targeted", engine: "board" }), NOW)).toThrow(/review completa/);
    const review = createManualReview(book, request({ scope: "full", mode: "auto", engine: "board", targets: [] }), NOW);
    expect(review).toMatchObject({ engine: "board", units: [{ kind: "chapter", targetId: "chapter:001" }, { kind: "chapter", targetId: "chapter:002" }] });
    expect(book.chapters.every(c => !c.frozenAt)).toBe(true);
    expect(book.editorialCycle?.chapterId).toBe("chapter:001");
    expect(book.phase).toBe("chapterReview");
    book.status = "running";
    runLocal(book);
    expect(activeManualReview(book)?.status).toBe("in_progress");
    // While the board works the review asks for nothing: the runner does the board steps.
    expect(nextManualReviewStep(book)).toBeUndefined();
    expect(describeManualReview(book, activeManualReview(book)!).headline).toContain("0 di 2");
    for (const chapter of book.chapters) chapter.frozenAt = NOW;
    book.editorialCycle = undefined; book.phase = "prose";
    expect(runLocal(book)).toMatch(/congelat/);
    expect(book.manualReviews!.at(-1)).toMatchObject({ status: "completed", outcome: "passed" });
    expect(pendingElements(book)).toEqual([]);
    expect(book.status).toBe("completed");
  });
  it("il congelamento della redazione chiude le modifiche ancora da rivedere del capitolo", () => {
    const book = edited();
    const chapter = book.chapters[1]!;
    settleChapterEdits(book, chapter);
    expect(elementReviewState(book, { kind: "scene", id: "scene:002:001" })).toBe("review_passed");
    // A change to a sheet is not part of the chapter's text: it stays to review.
    expect(elementReviewState(book, { kind: "entity", id: "character:markus" })).toBe("modified_unreviewed");
  });
  it("costruisce gli elementi da controllare per ambito, con stima delle chiamate", () => {
    const book = edited();
    const targets = [{ kind: "scene" as const, id: "scene:002:001" }, { kind: "entity" as const, id: "character:markus" }];
    expect(buildReviewUnits(book, "targeted", targets).map(u => u.key)).toEqual(["scene|scene:002:001", "entity|character:markus"]);
    const extended = buildReviewUnits(book, "extended", targets);
    expect(extended.filter(u => u.edited)).toHaveLength(2);
    expect(extended.some(u => u.key === "scene|scene:002:002")).toBe(true);
    expect(buildReviewUnits(book, "full", []).filter(u => u.kind === "scene")).toHaveLength(4);
    expect(estimateReviewCalls(book, "impact", targets)).toBe(1);
    expect(MAX_REVIEW_UNITS).toBe(400);
  });
  it("in solo controllo legge e non cambia nulla; l'esito vale per la versione letta e il libro torna in pausa", () => {
    const book = edited();
    book.status = "paused";
    const review = createManualReview(book, request(), NOW);
    expect(review).toMatchObject({ status: "pending", pauseAfter: true, mode: "check" });
    expect(elementReviewState(book, { kind: "scene", id: "scene:002:001" })).toBe("review_pending");
    expect(describeNextAutopilotStep(book).headline).toMatch(/^Review richiesta da te/);
    expect(() => createManualReview(book, request(), NOW)).toThrow(/già una review/);
    const chapters = JSON.stringify(book.chapters);
    book.status = "running"; // the runner sets it
    const asked = run(book, () => pass);
    expect(asked.map(s => s.kind)).toEqual(["chapterAudit"]);
    expect(asked[0]!.prompt).toContain("MODIFICHE DA VERIFICARE");
    expect(asked[0]!.prompt).toContain("FINE DELLA SCENA PRECEDENTE");
    expect(asked[0]!.system).toContain("verificatore editoriale");
    const done = book.manualReviews![0]!;
    expect(done).toMatchObject({ status: "completed", outcome: "passed", stage: "done" });
    expect(elementReviewState(book, { kind: "scene", id: "scene:002:001" })).toBe("review_passed");
    expect(JSON.stringify(book.chapters.map(c => ({ ...c, reviewStale: undefined })))).toBe(JSON.stringify(JSON.parse(chapters).map((c: object) => ({ ...c, reviewStale: undefined }))));
    // Chapter 2 uses Markus: his card changed and is still to review, so the chapter stays stale for that change only.
    expect(book.chapters[1]!.reviewStale!.editIds).toEqual(book.edits!.filter(e => e.target.kind === "entity").map(e => e.id));
    expect(book.status).toBe("paused");
    expect(pendingElements(book).map(p => p.target.id)).toEqual(["character:markus"]);
  });
  it("le prove devono essere citazioni letterali della scena fornita, le regole devono esistere", () => {
    const book = edited();
    const unit = buildReviewUnits(book, "targeted", [{ kind: "scene", id: "scene:002:001" }])[0]!;
    expect(() => validateReviewReply(book, unit, ["scene:002:001"], JSON.parse(issue("scene:002:001", "una frase che non esiste nel testo")))).toThrow(/letteralmente/);
    expect(() => validateReviewReply(book, unit, ["scene:002:001"], JSON.parse(issue("scene:001:001", "Elena ricorda la notte")))).toThrow(/non fornita/);
    expect(() => validateReviewReply(book, unit, ["scene:002:001"], { verdict: "pass", summary: "x", findings: JSON.parse(issue("scene:002:001", "aspetta sul molo")).findings })).toThrow(/pass/);
    const ok = validateReviewReply(book, unit, ["scene:002:001"], JSON.parse(issue("scene:002:001", "Markus aspetta sul molo")));
    expect(ok.findings[0]).toMatchObject({ sceneId: "scene:002:001", severity: "major", unitKey: unit.key });
    expect(() => validateReviewReply(book, unit, ["scene:002:001"], { ...JSON.parse(issue("scene:002:001", "Markus aspetta sul molo")),
      findings: [{ ...JSON.parse(issue("scene:002:001", "Markus aspetta sul molo")).findings[0], ruleId: "inventata" }] })).toThrow(/sconosciuta/);
  });
  it("una modifica fatta durante la review lascia l'elemento da rivedere", () => {
    const book = edited();
    createManualReview(book, request({ targets: [{ kind: "scene", id: "scene:002:001" }, { kind: "entity", id: "character:markus" }] }), NOW);
    run(book, step => {
      if (step.title.includes("Markus")) editScene(book, "scene:002:001", { title: "Il molo al tramonto" }, ctx);
      return pass;
    });
    expect(elementReviewState(book, { kind: "scene", id: "scene:002:001" })).toBe("modified_unreviewed");
    expect(elementReviewState(book, { kind: "entity", id: "character:markus" })).toBe("review_passed");
    expect(book.chapters[1]!.reviewStale!.editIds.length).toBeGreaterThan(0);
  });
  it("con proposte: prepara la scena corretta, che applichi tu; una proposta superata non si applica", () => {
    const book = edited();
    createManualReview(book, request({ mode: "propose" }), NOW);
    const asked = run(book, step => step.kind === "chapterAudit" ? issue("scene:002:001", "Markus aspetta sul molo")
      : "Markus aspetta sul molo, come sempre. Dice di conoscere il Consiglio cittadino.");
    expect(asked.map(s => s.kind)).toEqual(["chapterAudit", "chapterRepair"]);
    const review = book.manualReviews![0]!;
    expect(review.outcome).toBe("failed");
    expect(review.summary).toMatch(/1 correzione da approvare/);
    expect(elementReviewState(book, { kind: "scene", id: "scene:002:001" })).toBe("review_failed");
    const proposal = review.proposals[0]!;
    expect(book.chapters[1]!.scenes[0]!.text).not.toContain("come sempre");
    const applied = decideReviewProposal(book, review.id, proposal.id, true, NOW)!;
    expect(applied).toMatchObject({ origin: "ai", reviewState: "modified_unreviewed" });
    expect(book.chapters[1]!.scenes[0]!.text).toContain("come sempre");
    expect(() => decideReviewProposal(book, review.id, proposal.id, true, NOW)).toThrow(/non più disponibile/);
    const second = edited();
    createManualReview(second, request({ mode: "propose" }), NOW);
    run(second, step => step.kind === "chapterAudit" ? issue("scene:002:001", "Markus aspetta sul molo") : "Markus aspetta sul molo, come sempre. Dice di conoscere il Consiglio.");
    editScene(second, "scene:002:001", { title: "Cambiata dopo" }, ctx);
    const r2 = second.manualReviews![0]!;
    expect(() => decideReviewProposal(second, r2.id, r2.proposals[0]!.id, true, NOW)).toThrow(/cambiata dopo la proposta/);
  });
  it("con correzioni automatiche applica la correzione alla sola scena controllata, che resta da rivedere", () => {
    const book = edited();
    createManualReview(book, request({ mode: "auto" }), NOW);
    run(book, step => step.kind === "chapterAudit" ? issue("scene:002:001", "Markus aspetta sul molo") : "Markus aspetta sul molo, immobile. Dice di conoscere il Consiglio cittadino.");
    const review = book.manualReviews![0]!;
    expect(review.proposals[0]!.status).toBe("applied");
    expect(book.chapters[1]!.scenes[0]!.text).toContain("immobile");
    expect(book.edits!.at(-1)).toMatchObject({ origin: "ai", reviewState: "modified_unreviewed" });
    expect(book.edits!.at(-1)!.prompt).toMatch(/Correzione automatica della review/);
    expect(elementReviewState(book, { kind: "scene", id: "scene:002:001" })).toBe("modified_unreviewed");
  });
  it("l'analisi d'impatto usa solo ID esistenti, aggiorna il tipo di modifica e non valida nulla", () => {
    const book = edited();
    const review = createManualReview(book, request({ scope: "impact", mode: "auto", targets: [{ kind: "entity", id: "character:markus" }] }), NOW);
    expect(review.mode).toBe("check");
    expect(elementReviewState(book, { kind: "entity", id: "character:markus" })).toBe("impact_pending");
    expect(() => validateImpactReply(book, review, { summary: "Analisi breve.", impacts: [{ targetId: "scene:999", risk: "high", reason: "Non esiste affatto." }] })).toThrow(/non esiste/);
    const editId = review.editIds[0]!;
    const asked = run(book, () => JSON.stringify({ summary: "Il nuovo Markus cambia il dialogo del molo.", editKinds: [{ editId, changeKind: "behavior" }],
      impacts: [{ targetId: "scene:002:001", risk: "high", reason: "Markus parla con troppa sicurezza." }, { targetId: "event:incontro-con-l-informatore", risk: "low", reason: "La prospettiva resta valida." }] }));
    expect(asked.map(s => s.kind)).toEqual(["revision"]);
    const done = book.manualReviews![0]!;
    expect(done).toMatchObject({ outcome: "analysis", status: "completed" });
    expect(done.impacts!.map(i => i.targetKind)).toEqual(["scene", "event"]);
    expect(book.edits!.find(e => e.id === editId)!.changeKind).toBe("behavior");
    expect(elementReviewState(book, { kind: "entity", id: "character:markus" })).toBe("modified_unreviewed");
  });
  it("annullare riporta le modifiche da rivedere; una risposta in arrivo viene scartata; l'importazione interrompe", () => {
    const book = edited();
    book.status = "running";
    const review = createManualReview(book, request(), NOW);
    expect(review.pauseAfter).toBe(false);
    nextManualReviewStep(book); // pending → local start
    const start = nextManualReviewStep(book)!;
    if (start.type === "local") start.run(book, NOW);
    const step = nextManualReviewStep(book) as ManualReviewAiStep;
    cancelManualReview(book, review.id, NOW);
    expect(() => step.apply(book, pass, NOW)).toThrow(ManualReviewChanged);
    expect(elementReviewState(book, { kind: "scene", id: "scene:002:001" })).toBe("modified_unreviewed");
    expect(book.status).toBe("running");
    expect(activeManualReview(book)).toBeUndefined();
    const imported = edited();
    createManualReview(imported, request(), NOW);
    interruptImportedReviews(imported, NOW);
    expect(imported.manualReviews![0]).toMatchObject({ status: "cancelled" });
    expect(elementReviewState(imported, { kind: "scene", id: "scene:002:001" })).toBe("modified_unreviewed");
  });
  it("una scena troppo lunga non viene troncata: l'elemento è saltato con il motivo", () => {
    const book = edited();
    editScene(book, "scene:002:001", { text: "Lungo. ".repeat(10_000) }, ctx);
    createManualReview(book, request(), NOW);
    expect(run(book, () => pass)).toHaveLength(0);
    const review = book.manualReviews![0]!;
    expect(review.units[0]).toMatchObject({ status: "failed" });
    expect(review.units[0]!.note).toMatch(/troppo lunga/);
    expect(elementReviewState(book, { kind: "scene", id: "scene:002:001" })).toBe("modified_unreviewed");
    expect(describeManualReview(book, review).headline).toBeTruthy();
  });
});
