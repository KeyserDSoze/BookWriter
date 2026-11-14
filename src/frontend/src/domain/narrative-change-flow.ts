import type { BookProject, Chapter, Scene } from "./types";
import { archiveEditorialRound, type EditorialRound } from "./editorial-board";
import { markDownstreamContinuity } from "./cross-chapter-continuity";
import { synopsisBeforeChapter } from "./editorial-summary";
import { pruneChangeOperations, replaceEntitySheet, replaceEventSheet, sceneSnapshots,
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
  // A running review of the same or a later chapter can no longer pass the prior-freeze gate.
  const active = book.editorialCycle && book.chapters.find(c => c.id === book.editorialCycle!.chapterId);
  if (active && active.number >= earliest.number) {
    archiveJudgedRounds(book);
    book.editorialCycle = undefined;
  }
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
  }
  book.revision.affectedSceneIds = [...plan.rewriteSceneIds];
  book.revision.cursor = 0;
  book.revision.impactAnalysis = plan.rationale.trim() || "Piano della modifica senza motivazione.";
  const reopened = [...(op.target.kind === "scene" ? [op.target.id] : []), ...plan.rewriteSceneIds];
  reopenForRewrite(book, reopened, plan.changeKind === "style" ? "single" : "downstream");
  op.state = plan.rewriteSceneIds.length ? "rewriting" : "reviewing";
  op.updatedAt = now;
}

function chaptersTouched(book: BookProject, op: NarrativeChangeOperation): Chapter[] {
  const ids = new Set([...(op.plan?.rewriteSceneIds ?? []), ...(op.target.kind === "scene" ? [op.target.id] : [])]);
  return book.chapters.filter(ch => ch.scenes.some(s => ids.has(s.id)));
}
function captureAfter(book: BookProject, op: NarrativeChangeOperation): void {
  const ids = op.before.scenes.map(s => s.sceneId);
  op.after = {
    scenes: sceneSnapshots(book, ids).map(s => ({ sceneId: s.sceneId, text: s.text })),
    memoryJson: JSON.stringify(book.memory),
    ...(op.target.kind === "entity" ? { entityVersion: book.knowledge?.entities.find(e => e.id === op.target.id)?.version } : {}),
    ...(op.target.kind === "event" ? { eventVersion: book.knowledge?.events.find(e => e.id === op.target.id)?.version } : {}),
  };
}
/** Called when the revision phase ends (after book.revision is cleared): rewrites done, reviews may still run. */
export function settleAfterRewrite(book: BookProject, op: NarrativeChangeOperation | undefined, now: string): void {
  if (!op || ["completed", "failed", "cancelled", "reverted"].includes(op.state)) return;
  op.state = "reviewing"; op.updatedAt = now;
  captureAfter(book, op);
  settleChangeOperations(book, now);
}
/** Operations in review become completed once their chapters are frozen again. */
export function settleChangeOperations(book: BookProject, now: string): void {
  for (const op of book.changeOperations ?? []) {
    if (op.state !== "reviewing" || book.revision?.changeOperationId === op.id) continue;
    const touched = chaptersTouched(book, op);
    if (touched.some(ch => !ch.frozenAt)) continue;
    op.state = "completed"; op.completedAt = now; op.updatedAt = now;
    captureAfter(book, op);
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
  return undefined;
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
  const rewritten = op.before.scenes.map(s => s.sceneId);
  reopenForRewrite(book, rewritten, op.plan?.changeKind === "style" ? "single" : "downstream");
  op.state = "reverted"; op.revertedAt = now; op.updatedAt = now;
}

export function planSummary(plan: ChangePlan): string {
  return `${plan.direct.length} scene dirette, ${plan.indirect.length} indirette${plan.global ? ", impatto globale" : ""}; ${plan.rewriteSceneIds.length} da riscrivere.`;
}
