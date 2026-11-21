import type { BookProject, Chapter, Scene } from "./types";
import { archiveEditorialRound, type EditorialRound } from "./editorial-board";
import { markDownstreamContinuity } from "./cross-chapter-continuity";
import { synopsisBeforeChapter } from "./editorial-summary";
import { parseKnowledge } from "./knowledge";
import { setReviewState, type EditTarget } from "./book-edits";
import { chapterTextStamp, pruneChangeOperations, replaceEntitySheet, replaceEventSheet, replaceTimelineSheet, sceneSnapshots,
  type ChangePlan, type NarrativeChangeOperation } from "./narrative-change";

/** Judged rounds of a discarded active review stay in the chapter history. */
export function archiveJudgedRounds(book: BookProject): void {
  const cycle = book.editorialCycle;
  if (!cycle) return;
  const chapter = book.chapters.find(ch => ch.id === cycle.chapterId);
  if (!chapter) return;
  const judged: EditorialRound[] = [...cycle.priorRounds];
  if (cycle.judgment) judged.push(archiveEditorialRound(cycle));
  if (judged.length) chapter.editorialRounds = [...(chapter.editorialRounds ?? []), ...judged];
}
function chapterOf(book: BookProject, sceneId: string): Chapter | undefined {
  return book.chapters.find(ch => ch.scenes.some(s => s.id === sceneId));
}

/** Reopen the editorial board where prose will change.
 * "downstream": the earliest touched chapter and every later one (facts changed).
 * "single": only that chapter — a purely stylistic edit keeps later freezes. */
export function reopenForRewrite(book: BookProject, sceneIds: readonly string[], scope: "downstream" | "single"): void {
  const chapters = [...new Set(sceneIds.map(id => chapterOf(book, id)).filter((c): c is Chapter => !!c))]
    .sort((a, b) => a.number - b.number);
  const earliest = chapters[0];
  if (!earliest) return;
  if (scope === "downstream") {
    markDownstreamContinuity(book, earliest, "retroactive_revision", earliest.scenes.filter(s => sceneIds.includes(s.id)).map(s => s.id));
    earliest.lastContinuityReview = undefined;
    for (const chapter of book.chapters) if (chapter.number >= earliest.number) {
      chapter.frozenAt = undefined; chapter.summary = undefined; chapter.bookSummaryAtFreeze = undefined;
    }
    archiveJudgedRounds(book);
    book.editorialCycle = undefined;
    book.bookSummary = synopsisBeforeChapter(book.chapters, earliest.number);
    return;
  }
  for (const chapter of chapters) { chapter.frozenAt = undefined; chapter.summary = undefined; chapter.bookSummaryAtFreeze = undefined; }
  // With no later frozen chapter the book synopsis was the one of a reopened chapter: back to the previous
  // snapshot, as every other reopening does. Later freezes (and their synopsis) stay as they are. Legacy
  // chapters without any snapshot keep the synopsis as it was: a style edit is never blocked by it.
  if (!book.chapters.some(chapter => chapter.number > earliest.number && chapter.frozenAt)) {
    try { book.bookSummary = synopsisBeforeChapter(book.chapters, earliest.number); } catch { /* legacy: unchanged */ }
  }
  // A running review of the same or a later chapter can no longer pass the prior-freeze gate.
  const active = book.editorialCycle && book.chapters.find(c => c.id === book.editorialCycle!.chapterId);
  if (active && active.number >= earliest.number) {
    archiveJudgedRounds(book);
    book.editorialCycle = undefined;
  }
}

/** Remember how the chapters about to be reopened were validated (first capture wins):
 * a revert that brings back exactly the same text can restore that validation. */
export function captureFreezeState(book: BookProject, op: NarrativeChangeOperation, sceneIds: readonly string[]): void {
  const captured = new Set((op.before.chapters ?? []).map(c => c.chapterId));
  const chapters = [...new Set(sceneIds.map(id => chapterOf(book, id)).filter((c): c is Chapter => !!c))];
  const next = [...(op.before.chapters ?? [])];
  for (const chapter of chapters) {
    if (captured.has(chapter.id) || next.length >= 60) continue;
    next.push({ chapterId: chapter.id, textStamp: chapterTextStamp(chapter), hadRecheck: !!chapter.continuityRecheck,
      ...(chapter.frozenAt ? { frozenAt: chapter.frozenAt } : {}), ...(chapter.summary !== undefined ? { summary: chapter.summary.slice(0, 6000) } : {}),
      ...(chapter.bookSummaryAtFreeze !== undefined ? { bookSummaryAtFreeze: chapter.bookSummaryAtFreeze.slice(0, 9000) } : {}) });
  }
  op.before = { ...op.before, chapters: next };
}

/** Effects of an accepted plan: new sheet version, scenes to rewrite, reopened board. */
export function applyChangePlan(book: BookProject, op: NarrativeChangeOperation, now: string): void {
  const plan = op.plan;
  if (!plan || !book.revision || book.revision.changeOperationId !== op.id) throw new Error("Piano della modifica non disponibile.");
  if (book.knowledge && plan.proposal) {
    if (op.target.kind === "entity" && plan.proposal.entity)
      book.knowledge = replaceEntitySheet(book.knowledge, op.target.id, plan.proposal.entity, now, "Modifica dell'autore: " + op.instruction);
    if (op.target.kind === "event" && plan.proposal.event)
      book.knowledge = replaceEventSheet(book.knowledge, op.target.id, plan.proposal.event, now, "Modifica dell'autore: " + op.instruction);
    if (op.target.kind === "timeline" && plan.proposal.timeline)
      book.knowledge = replaceTimelineSheet(book.knowledge, op.target.id, plan.proposal.timeline);
  }
  if (op.target.kind === "chapter" && plan.proposal?.chapter) {
    const chapter = book.chapters.find(c => c.id === op.target.id);
    if (!chapter) throw new Error("Il capitolo da modificare non esiste più.");
    if (plan.proposal.chapter.title) chapter.title = plan.proposal.chapter.title.trim();
    if (plan.proposal.chapter.purpose !== undefined) chapter.purpose = plan.proposal.chapter.purpose;
  }
  const reopened = [...(op.target.kind === "scene" ? [op.target.id] : []), ...plan.rewriteSceneIds];
  captureFreezeState(book, op, reopened);
  // Confirm mode on a scene: the rewritten text was kept aside until now.
  if (op.target.kind === "scene" && op.draftText !== undefined) {
    const scene = book.chapters.flatMap(c => c.scenes).find(s => s.id === op.target.id);
    const previous = op.before.scenes.find(s => s.sceneId === op.target.id);
    if (!scene || !previous || scene.text !== previous.text) throw new Error("La scena è cambiata dopo la proposta: annulla la modifica e richiedila di nuovo.");
    scene.text = op.draftText;
    if (plan.proposal?.sceneSummary) { scene.summary = plan.proposal.sceneSummary; delete scene.summaryStale; }
    else if (scene.summary !== undefined) scene.summaryStale = true;
    delete op.draftText;
  }
  book.revision.affectedSceneIds = [...plan.rewriteSceneIds];
  book.revision.cursor = 0;
  book.revision.impactAnalysis = plan.rationale.trim() || "Piano della modifica senza motivazione.";
  reopenForRewrite(book, reopened, plan.changeKind === "style" ? "single" : "downstream");
  op.state = plan.rewriteSceneIds.length ? "rewriting" : "reviewing";
  op.updatedAt = now;
}

function chaptersTouched(book: BookProject, op: NarrativeChangeOperation): Chapter[] {
  const ids = new Set([...(op.plan?.rewriteSceneIds ?? []), ...(op.target.kind === "scene" ? [op.target.id] : [])]);
  return book.chapters.filter(ch => ch.scenes.some(s => ids.has(s.id)));
}
function sheetJsonOf(book: BookProject, op: NarrativeChangeOperation): string | undefined {
  if (op.target.kind === "chapter") {
    const chapter = book.chapters.find(c => c.id === op.target.id);
    return chapter ? JSON.stringify({ title: chapter.title, purpose: chapter.purpose }) : undefined;
  }
  if (op.target.kind === "timeline") {
    const timeline = book.knowledge?.timelines.find(t => t.id === op.target.id);
    return timeline ? JSON.stringify(timeline) : undefined;
  }
  return undefined;
}
function captureAfter(book: BookProject, op: NarrativeChangeOperation): void {
  const ids = op.before.scenes.map(s => s.sceneId);
  const sheetJson = sheetJsonOf(book, op);
  op.after = {
    scenes: sceneSnapshots(book, ids).map(s => ({ sceneId: s.sceneId, text: s.text })),
    memoryJson: JSON.stringify(book.memory),
    ...(op.target.kind === "entity" ? { entityVersion: book.knowledge?.entities.find(e => e.id === op.target.id)?.version } : {}),
    ...(op.target.kind === "event" ? { eventVersion: book.knowledge?.events.find(e => e.id === op.target.id)?.version } : {}),
    ...(sheetJson !== undefined ? { sheetJson: sheetJson.slice(0, 40_000) } : {}),
  };
}
/** Called when the revision phase ends (after book.revision is cleared): rewrites done, reviews may still run. */
export function settleAfterRewrite(book: BookProject, op: NarrativeChangeOperation | undefined, now: string): void {
  if (!op || ["completed", "failed", "cancelled", "reverted"].includes(op.state)) return;
  op.state = "reviewing"; op.updatedAt = now;
  captureAfter(book, op);
  settleChangeOperations(book, now);
}
/** Edits the author saved by hand and then propagated follow the change: in review while it runs,
 * validated when it ends, open again if it is cancelled. Only the element's newest edit moves, and only
 * when it is one of the propagated ones: content the change never saw is never validated by it. */
export function followChangeEdits(book: BookProject, op: NarrativeChangeOperation, outcome: "started" | "passed" | "open"): void {
  if (!op.fromEdits?.length) return;
  const target: EditTarget = { kind: op.target.kind, id: op.target.id };
  const edits = (book.edits ?? []).filter(e => e.target.kind === target.kind && e.target.id === target.id);
  const latest = edits.at(-1);
  if (!latest || !op.fromEdits.includes(latest.id)) return;
  if (outcome === "started") setReviewState(book, [target], "review_in_progress", op.id);
  else if (outcome === "passed") setReviewState(book, [target], "review_passed", op.id);
  else if (latest.reviewState === "review_in_progress" && latest.reviewId === op.id) {
    for (const edit of edits) if (edit.reviewState === "review_in_progress" && edit.reviewId === op.id) { edit.reviewState = "modified_unreviewed"; delete edit.reviewId; }
  }
}

/** Operations in review become completed once their chapters are frozen again. */
export function settleChangeOperations(book: BookProject, now: string): void {
  for (const op of book.changeOperations ?? []) {
    if (op.state !== "reviewing" || book.revision?.changeOperationId === op.id) continue;
    const touched = chaptersTouched(book, op);
    if (touched.some(ch => !ch.frozenAt)) continue;
    op.state = "completed"; op.completedAt = now; op.updatedAt = now;
    captureAfter(book, op);
    followChangeEdits(book, op, "passed");
  }
  if (book.changeOperations) book.changeOperations = pruneChangeOperations(book.changeOperations);
}

/** A restore is only safe when nothing changed after the operation finished. */
export function revertProblem(book: BookProject, op: NarrativeChangeOperation): string | undefined {
  if (!["completed", "reviewing", "failed"].includes(op.state)) return "Si possono ripristinare solo modifiche concluse o in revisione.";
  if (op.before.pruned) return "Le copie di questa modifica sono state eliminate per spazio: non è più ripristinabile.";
  if (book.revision) return "Completa prima la revisione in corso.";
  if (!op.after) return "La modifica non ha ancora prodotto una versione da confrontare.";
  const current = new Map(book.chapters.flatMap(c => c.scenes.map(s => [s.id, s] as const)));
  for (const snap of op.after.scenes) if (current.get(snap.sceneId)?.text !== snap.text)
    return "Una scena coinvolta è cambiata dopo la modifica: ripristino automatico non sicuro. Usa le copie mostrate per intervenire a mano.";
  if (op.target.kind === "entity" && op.after.entityVersion !== undefined &&
      book.knowledge?.entities.find(e => e.id === op.target.id)?.version !== op.after.entityVersion)
    return "La scheda è stata modificata di nuovo dopo questa operazione.";
  if (op.target.kind === "event" && op.after.eventVersion !== undefined &&
      book.knowledge?.events.find(e => e.id === op.target.id)?.version !== op.after.eventVersion)
    return "L'evento è stato modificato di nuovo dopo questa operazione.";
  if ((op.target.kind === "chapter" || op.target.kind === "timeline") && op.after.sheetJson !== undefined && sheetJsonOf(book, op) !== op.after.sheetJson)
    return op.target.kind === "chapter" ? "Titolo o scopo del capitolo sono cambiati dopo questa operazione." : "La timeline è stata modificata di nuovo dopo questa operazione.";
  return undefined;
}
/** Chapters whose text is back to exactly what was validated get that validation back.
 * Downstream changes qualify only when every later written chapter is restored too. */
function restoreFreezes(book: BookProject, op: NarrativeChangeOperation, rewritten: readonly string[]): boolean {
  const snapshots = op.before.chapters ?? [];
  const touched = [...new Set(rewritten.map(id => chapterOf(book, id)).filter((c): c is Chapter => !!c))].sort((a, b) => a.number - b.number);
  if (!touched.length || !snapshots.length) return false;
  const byId = new Map(snapshots.map(s => [s.chapterId, s] as const));
  const exact = (chapter: Chapter) => { const snap = byId.get(chapter.id); return !!snap?.frozenAt && snap.textStamp === chapterTextStamp(chapter); };
  const earliest = touched[0]!;
  const scope = op.plan?.changeKind === "style" ? touched : book.chapters.filter(c => c.number >= earliest.number && c.scenes.some(s => s.text.trim()));
  if (!scope.every(exact)) return false;
  const cycle = book.editorialCycle && book.chapters.find(c => c.id === book.editorialCycle!.chapterId);
  if (cycle && cycle.number >= earliest.number) {
    archiveJudgedRounds(book);
    book.editorialCycle = undefined;
    if (book.phase === "chapterReview") book.phase = "prose";
  }
  for (const chapter of scope) {
    const snap = byId.get(chapter.id)!;
    chapter.frozenAt = snap.frozenAt; chapter.summary = snap.summary; chapter.bookSummaryAtFreeze = snap.bookSummaryAtFreeze;
    delete chapter.summaryStale; delete chapter.reviewStale;
    if (!snap.hadRecheck && chapter.continuityRecheck?.trigger === "retroactive_revision") delete chapter.continuityRecheck;
  }
  const lastFrozen = [...book.chapters].filter(c => c.frozenAt).sort((a, b) => b.number - a.number)[0];
  if (lastFrozen && scope.includes(lastFrozen) && lastFrozen.bookSummaryAtFreeze !== undefined) book.bookSummary = lastFrozen.bookSummaryAtFreeze;
  return true;
}
/** Restore scenes, sheet and (when untouched since) memory; the board re-checks the result. */
export function revertChange(book: BookProject, op: NarrativeChangeOperation, now: string): void {
  const problem = revertProblem(book, op);
  if (problem) throw new Error(problem);
  const byId = new Map(book.chapters.flatMap(c => c.scenes.map(s => [s.id, s] as const)));
  for (const snap of op.before.scenes) {
    const scene: Scene | undefined = byId.get(snap.sceneId);
    if (!scene) continue;
    scene.text = snap.text; scene.status = snap.status === "planned" ? "planned" : "canon"; scene.summary = snap.summary;
  }
  if (op.before.memoryJson && op.after && JSON.stringify(book.memory) === op.after.memoryJson) book.memory = JSON.parse(op.before.memoryJson);
  if (book.knowledge && op.target.kind === "entity" && op.before.entity) {
    const index = book.knowledge.entities.findIndex(e => e.id === op.target.id);
    const current = book.knowledge.entities[index];
    if (current) {
      const { name, aliases, importance, summary, attributes, relationships } = current;
      book.knowledge.entities[index] = { ...op.before.entity, version: current.version + 1, updatedAt: now,
        history: [...(current.history ?? []), { version: current.version, at: now, reason: "Ripristino della modifica", snapshot: { name, aliases, importance, summary, attributes, relationships } }].slice(-8) };
    }
  }
  if (book.knowledge && op.target.kind === "event" && op.before.event) {
    const index = book.knowledge.events.findIndex(e => e.id === op.target.id);
    const current = book.knowledge.events[index];
    if (current) book.knowledge.events[index] = { ...op.before.event, version: current.version + 1, updatedAt: now, history: current.history };
  }
  if (book.knowledge && op.target.kind === "timeline" && op.before.timeline) {
    const known = new Set(book.knowledge.entities.map(e => e.id));
    const restored = { ...op.before.timeline, subjectIds: (op.before.timeline.subjectIds ?? []).filter(id => known.has(id)) };
    if (!restored.subjectIds.length) delete (restored as { subjectIds?: string[] }).subjectIds;
    book.knowledge = parseKnowledge({ ...book.knowledge, timelines: book.knowledge.timelines.map(t => t.id === op.target.id ? restored : t) });
  }
  if (op.target.kind === "chapter" && op.before.chapter) {
    const chapter = book.chapters.find(c => c.id === op.target.id);
    if (chapter) { chapter.title = op.before.chapter.title; chapter.purpose = op.before.chapter.purpose; }
  }
  const rewritten = op.before.scenes.map(s => s.sceneId);
  if (!restoreFreezes(book, op, rewritten)) reopenForRewrite(book, rewritten, op.plan?.changeKind === "style" ? "single" : "downstream");
  op.state = "reverted"; op.revertedAt = now; op.updatedAt = now;
}

export function planSummary(plan: ChangePlan): string {
  return `${plan.direct.length} scene dirette, ${plan.indirect.length} indirette${plan.global ? ", impatto globale" : ""}; ${plan.rewriteSceneIds.length} da riscrivere.`;
}
