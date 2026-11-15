import { z } from "zod";
import type { BookProject, Chapter, Scene } from "./types";
import type { KnowledgeEntity, KnowledgeEvent } from "./knowledge";

/** One record per author change, manual or AI, on any element of the book.
 * Saving is not validating: every edit starts unreviewed and only an explicit
 * review (or the author's explicit "skip") changes that. Newer content than the
 * reviewed stamp is unreviewed again, whatever the old record says. */
export const EDIT_TARGET_KINDS = ["scene", "chapter", "entity", "event", "timeline", "structure", "profiles", "memory"] as const;
export type EditTargetKind = typeof EDIT_TARGET_KINDS[number];
export const REVIEW_STATES = ["clean", "modified_unreviewed", "impact_pending", "review_pending", "review_in_progress",
  "review_passed", "review_failed", "review_skipped"] as const;
export type ReviewState = typeof REVIEW_STATES[number];
export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  clean: "Nessuna modifica", modified_unreviewed: "Da rivedere", impact_pending: "Analisi in coda", review_pending: "Review in coda",
  review_in_progress: "Review in corso", review_passed: "Review superata", review_failed: "Problemi trovati", review_skipped: "Review saltata",
};
export const REVIEW_STATE_TONES: Record<ReviewState, "neutral" | "amber" | "sky" | "violet" | "emerald" | "rose"> = {
  clean: "neutral", modified_unreviewed: "amber", impact_pending: "sky", review_pending: "sky", review_in_progress: "violet",
  review_passed: "emerald", review_failed: "rose", review_skipped: "neutral",
};
/** What kind of consequence a change can have; drives what a review must check. */
export const CHANGE_KINDS = ["style", "descriptive", "behavior", "event", "structural"] as const;
export type EditChangeKind = typeof CHANGE_KINDS[number];
export const CHANGE_KIND_LABELS: Record<EditChangeKind, string> = {
  style: "Stile", descriptive: "Dati descrittivi", behavior: "Comportamento", event: "Eventi narrativi", structural: "Struttura",
};
export const MAX_EDITS = 300;
export const MAX_EDIT_SNAPSHOT_CHARS = 3_000_000;
const iso = z.string().max(40).refine(value => Number.isFinite(Date.parse(value)));
export const bookEditSchema = z.object({
  id: z.string().uuid(), at: iso,
  target: z.object({ kind: z.enum(EDIT_TARGET_KINDS), id: z.string().min(1).max(200) }).strict(),
  label: z.string().max(200), field: z.string().min(1).max(60),
  origin: z.enum(["manual", "ai"]), prompt: z.string().max(4000).optional(), aiActivityId: z.string().max(300).optional(),
  /** Serialized content before/after (null: created/deleted). Pruned when the history grows. */
  before: z.string().max(2_000_000).nullable(), after: z.string().max(2_000_000).nullable(),
  changeKind: z.enum(CHANGE_KINDS), reviewState: z.enum(REVIEW_STATES),
  related: z.array(z.string().min(1).max(200)).max(200),
  stampAfter: z.string().max(40),
  /** Content stamp the last passed/skipped review looked at. */
  reviewedStamp: z.string().max(40).optional(),
  reviewId: z.string().uuid().optional(),
  pruned: z.boolean().optional(),
}).strict();
export type BookEdit = z.infer<typeof bookEditSchema>;
export interface EditTarget { kind: EditTargetKind; id: string }
export const reviewStaleSchema = z.object({ since: iso, editIds: z.array(z.string().uuid()).max(50) }).strict();

/** Deterministic local fingerprint: detects changed content, it is not a signature. */
export function contentStamp(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return value.length + ":" + (hash >>> 0).toString(16).padStart(8, "0");
}
const sceneContent = (scene: Scene) => JSON.stringify({ title: scene.title, objective: scene.objective, text: scene.text, summary: scene.summary ?? "", status: scene.status });
const chapterContent = (chapter: Chapter) => JSON.stringify({ title: chapter.title, purpose: chapter.purpose, summary: chapter.summary ?? "", scenes: chapter.scenes.map(s => s.id) });
export function entityContent(entity: KnowledgeEntity): string {
  const { version: _v, updatedAt: _u, history: _h, origin: _o, ...rest } = entity;
  return JSON.stringify(rest);
}
export function eventContent(event: KnowledgeEvent): string {
  const { version: _v, updatedAt: _u, history: _h, origin: _o, ...rest } = event;
  return JSON.stringify(rest);
}
export function structureContent(book: BookProject): string {
  return JSON.stringify([...book.chapters].sort((a, b) => a.number - b.number).map(ch => [ch.id, ...ch.scenes.map(s => s.id)]));
}
/** The narrative memory is edited by part: `state`, `timeline`, or `<folder>:<name>` for one entry. */
export const MEMORY_FOLDERS = ["characters", "locations", "factions", "items", "secrets"] as const;
export type MemoryFolder = typeof MEMORY_FOLDERS[number];
export function parseMemoryId(id: string): { part: "state" } | { part: "timeline" } | { part: "entry"; folder: MemoryFolder; name: string } | undefined {
  if (id === "state") return { part: "state" };
  if (id === "timeline") return { part: "timeline" };
  const cut = id.indexOf(":");
  const folder = id.slice(0, cut) as MemoryFolder, name = id.slice(cut + 1);
  return cut > 0 && MEMORY_FOLDERS.includes(folder) && name ? { part: "entry", folder, name } : undefined;
}
/** Text of one part of the memory; undefined when that entry does not exist. */
export const MEMORY_PART_LABELS = { state: "Stato corrente", timeline: "Cronologia della memoria",
  characters: "Personaggi", locations: "Luoghi", factions: "Fazioni", items: "Oggetti", secrets: "Segreti" } as const;
export function memoryLabel(id: string): string {
  const parsed = parseMemoryId(id);
  if (!parsed) return id;
  return parsed.part === "entry" ? `${MEMORY_PART_LABELS[parsed.folder]} · ${parsed.name}` : MEMORY_PART_LABELS[parsed.part];
}
export function memoryValue(book: BookProject, id: string): string | undefined {
  const parsed = parseMemoryId(id);
  if (!parsed) return undefined;
  if (parsed.part === "state") return book.memory.currentState;
  if (parsed.part === "timeline") return book.memory.timeline.join("\n");
  const entries = book.memory[parsed.folder];
  return Object.hasOwn(entries, parsed.name) ? entries[parsed.name] : undefined;
}
export function findScene(book: BookProject, sceneId: string): { chapter: Chapter; scene: Scene } | undefined {
  for (const chapter of book.chapters) {
    const scene = chapter.scenes.find(s => s.id === sceneId);
    if (scene) return { chapter, scene };
  }
  return undefined;
}
/** The current serialized content of a target; undefined when it no longer exists. */
export function currentContent(book: BookProject, target: EditTarget): string | undefined {
  switch (target.kind) {
    case "scene": { const found = findScene(book, target.id); return found ? sceneContent(found.scene) : undefined; }
    case "chapter": { const chapter = book.chapters.find(c => c.id === target.id); return chapter ? chapterContent(chapter) : undefined; }
    case "entity": { const entity = book.knowledge?.entities.find(e => e.id === target.id); return entity ? entityContent(entity) : undefined; }
    case "event": { const event = book.knowledge?.events.find(e => e.id === target.id); return event ? eventContent(event) : undefined; }
    case "timeline": { const timeline = book.knowledge?.timelines.find(t => t.id === target.id); return timeline ? JSON.stringify(timeline) : undefined; }
    case "structure": return structureContent(book);
    case "profiles": return JSON.stringify(book.editorialProfiles ?? null);
    case "memory": { const value = memoryValue(book, target.id); return value === undefined ? undefined : JSON.stringify({ value }); }
  }
}
export function currentStamp(book: BookProject, target: EditTarget): string {
  const content = currentContent(book, target);
  return content === undefined ? "deleted" : contentStamp(content);
}
const sameTarget = (a: EditTarget, b: EditTarget) => a.kind === b.kind && a.id === b.id;

/** The review state the author sees for one element. A validation is only valid
 * for the exact content it looked at: any newer change makes it unreviewed. */
export function elementReviewState(book: BookProject, target: EditTarget): ReviewState {
  const latest = [...(book.edits ?? [])].reverse().find(edit => sameTarget(edit.target, target));
  if (!latest) return "clean";
  if (target.kind === "profiles") return "clean";
  if ((latest.reviewState === "review_passed" || latest.reviewState === "review_skipped") &&
      latest.reviewedStamp !== undefined && latest.reviewedStamp !== currentStamp(book, target)) return "modified_unreviewed";
  return latest.reviewState;
}
const SETTLED: ReadonlySet<ReviewState> = new Set(["clean", "review_passed", "review_skipped"]);
export interface PendingElement { target: EditTarget; label: string; state: ReviewState; edits: BookEdit[]; changeKinds: EditChangeKind[]; origins: Array<"manual" | "ai">; lastAt: string }
/** Elements with changes still to review, newest first, one entry per element. */
export function pendingElements(book: BookProject): PendingElement[] {
  const groups = new Map<string, BookEdit[]>();
  for (const edit of book.edits ?? []) {
    if (edit.target.kind === "profiles") continue;
    const key = edit.target.kind + "\u0000" + edit.target.id;
    groups.set(key, [...(groups.get(key) ?? []), edit]);
  }
  const out: PendingElement[] = [];
  for (const edits of groups.values()) {
    const latest = edits.at(-1)!;
    const state = elementReviewState(book, latest.target);
    if (SETTLED.has(state)) continue;
    // Only the edits after the last settled review belong to the pending change.
    const lastSettled = edits.map(e => SETTLED.has(e.reviewState)).lastIndexOf(true);
    const open = edits.slice(lastSettled + 1);
    const relevant = open.length ? open : [latest];
    out.push({ target: latest.target, label: latest.label, state, edits: relevant,
      changeKinds: [...new Set(relevant.map(e => e.changeKind))], origins: [...new Set(relevant.map(e => e.origin))], lastAt: latest.at });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** Keep the newest records whole; older ones keep metadata but lose their copies. */
export function pruneEdits(edits: BookEdit[]): BookEdit[] {
  const kept = edits.slice(-MAX_EDITS);
  let budget = MAX_EDIT_SNAPSHOT_CHARS;
  for (let i = kept.length - 1; i >= 0; i--) {
    const edit = kept[i]!;
    const size = (edit.before?.length ?? 0) + (edit.after?.length ?? 0);
    if (size <= budget) { budget -= size; continue; }
    kept[i] = { ...edit, before: null, after: null, pruned: true };
  }
  return kept;
}

export function newEdit(input: Omit<BookEdit, "id" | "at" | "reviewState" | "stampAfter"> & { at: string; stampAfter: string }): BookEdit {
  return bookEditSchema.parse({ id: crypto.randomUUID(), reviewState: "modified_unreviewed", ...input,
    label: input.label.slice(0, 200), related: [...new Set(input.related)].slice(0, 200) });
}
/** Mark the given elements' latest edits with a new state (review start/end, skip). */
export function setReviewState(book: BookProject, targets: readonly EditTarget[], state: ReviewState, reviewId?: string): void {
  for (const target of targets) {
    const edits = (book.edits ?? []).filter(edit => sameTarget(edit.target, target));
    const latest = edits.at(-1);
    if (!latest) continue;
    for (const edit of edits) if (!SETTLED.has(edit.reviewState) || edit === latest) {
      edit.reviewState = state;
      if (reviewId) edit.reviewId = reviewId;
      if (state === "review_passed" || state === "review_skipped") edit.reviewedStamp = currentStamp(book, target);
    }
  }
}
/** Derived data was rewritten from unchanged content (a scene summary written from the same
 * text): a review that validated the previous content still holds, so its stamp follows. */
export function carryReviewedStamp(book: BookProject, target: EditTarget, previousStamp: string): void {
  const now = currentStamp(book, target);
  if (now === previousStamp) return;
  for (const edit of book.edits ?? [])
    if (sameTarget(edit.target, target) && edit.reviewedStamp === previousStamp &&
      (edit.reviewState === "review_passed" || edit.reviewState === "review_skipped")) edit.reviewedStamp = now;
}
/** The editorial board has just frozen this chapter on its current text: the author's edits to
 * the chapter and its scenes still waiting for a review are validated by it, bound to the exact
 * content it read. Edits owned by a running review are left to that review. */
export function settleChapterEdits(book: BookProject, chapter: Chapter): void {
  const targets: EditTarget[] = [{ kind: "chapter", id: chapter.id }, ...chapter.scenes.map(s => ({ kind: "scene" as const, id: s.id }))];
  const running = new Set((book.manualReviews ?? []).filter(r => r.status === "pending" || r.status === "in_progress").map(r => r.id));
  const owned = (edit: BookEdit) => !!edit.reviewId && running.has(edit.reviewId) && !SETTLED.has(edit.reviewState) && edit.reviewState !== "modified_unreviewed";
  for (const target of targets) {
    if (!["modified_unreviewed", "review_failed"].includes(elementReviewState(book, target))) continue;
    const edits = (book.edits ?? []).filter(edit => sameTarget(edit.target, target));
    const latest = edits.at(-1);
    const stamp = currentStamp(book, target);
    for (const edit of edits) if ((!SETTLED.has(edit.reviewState) || edit === latest) && !owned(edit)) {
      edit.reviewState = "review_passed"; edit.reviewedStamp = stamp;
    }
  }
}
