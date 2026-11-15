import { z } from "zod";
import type { BookProject, Chapter, Scene } from "./types";
import { ENTITY_ID, findEntity, type KnowledgeBase, type KnowledgeEntity, type KnowledgeEvent, knowledgeEntitySchema,
  knowledgeEventSchema, knowledgeReplySchema, knowledgeTimelineSchema, mergeKnowledgeReply, parseKnowledge, STANCES, NARRATION_MODES } from "./knowledge";
import { contentStamp } from "./book-edits";

/** A prompt-driven change to a sheet, an event, a timeline, a chapter or one scene,
 * tracked from the request to the re-frozen chapters. Snapshots allow a guarded restore. */
export const CHANGE_TARGET_KINDS = ["entity", "event", "scene", "chapter", "timeline"] as const;
export type ChangeTarget = { kind: typeof CHANGE_TARGET_KINDS[number]; id: string };
export const CHANGE_STATES = ["pending", "analyzing", "awaiting_confirmation", "rewriting", "reviewing", "completed", "failed", "cancelled", "reverted"] as const;
export type ChangeState = typeof CHANGE_STATES[number];
export const CHANGE_STATE_LABELS: Record<ChangeState, string> = {
  pending: "In attesa", analyzing: "Analisi", awaiting_confirmation: "Da confermare", rewriting: "Riscrittura",
  reviewing: "Revisione", completed: "Completata", failed: "Non riuscita", cancelled: "Annullata", reverted: "Ripristinata",
};
export const MAX_CHANGE_OPERATIONS = 60;
/** Snapshots of prose are capped so the book (and its GitHub snapshot) stays bounded. */
export const MAX_SNAPSHOT_CHARS = 3_000_000;
const sceneSnapshot = z.object({
  sceneId: z.string().min(1).max(200), chapterId: z.string().min(1).max(200), text: z.string().max(2_000_000),
  status: z.enum(["planned", "draft", "canon"]), summary: z.string().max(6000).optional(),
}).strict();
/** The analysis reply for an entity or event: new sheet + scenes to rewrite. */
const relation = z.object({ target: z.string().min(1).max(120), type: z.string().min(2).max(40), note: z.string().max(240).optional() });
const proposedEntity = z.object({
  name: z.string().min(1).max(120), aliases: z.array(z.string().min(1).max(120)).max(8).optional(),
  importance: z.enum(["main", "secondary", "minor"]).optional(), summary: z.string().max(600),
  attributes: z.record(z.string(), z.string().max(900)).optional(), relationships: z.array(relation).max(24).optional(),
});
const proposedEvent = z.object({
  title: z.string().min(2).max(160), summary: z.string().max(800), storyOrder: z.number().finite().min(0).max(100_000).optional(),
  when: z.string().max(80).optional(), narration: z.enum(NARRATION_MODES).optional(), involves: z.array(z.string()).max(20).optional(),
  causes: z.array(z.string()).max(12).optional(), secret: z.boolean().optional(),
  perspectives: z.array(z.object({ who: z.string(), stance: z.enum(STANCES), note: z.string().max(200).optional() })).max(12).optional(),
});
const proposedTimeline = z.object({
  title: z.string().min(2).max(120), kind: z.enum(["global", "arc", "event"]).optional(), summary: z.string().max(600).optional(),
  subjects: z.array(z.string().min(1).max(120)).max(12).optional(),
});
const proposedChapter = z.object({ title: z.string().trim().min(1).max(300).optional(), purpose: z.string().max(20_000).optional() });
/** A direct scene the analysis decided to leave as it is, and why. */
const keptScene = z.object({ sceneId: z.string().min(1).max(200), reason: z.string().trim().min(8).max(400) });
export const changeAnalysisSchema = z.object({
  interpretation: z.string().min(8).max(2000),
  rationale: z.string().min(8).max(3000),
  rewriteSceneIds: z.array(z.string()).max(400),
  /** Every direct scene is either rewritten or listed here with a reason. */
  unchangedDirect: z.array(keptScene).max(400).optional(),
  global: z.boolean().optional(),
  changedFacts: z.array(z.string().max(400)).max(30).optional(),
  entity: proposedEntity.optional(),
  event: proposedEvent.optional(),
  timeline: proposedTimeline.optional(),
  chapter: proposedChapter.optional(),
});
const planSchema = z.object({
  interpretation: z.string().max(2000), changeKind: z.enum(["style", "narrative"]), rationale: z.string().max(3000),
  direct: z.array(z.string()).max(400), indirect: z.array(z.string()).max(400), global: z.boolean(),
  rewriteSceneIds: z.array(z.string()).max(400), changedFacts: z.array(z.string().max(400)).max(30),
  drift: z.array(z.string().max(300)).max(30).optional(),
  /** Direct scenes left unchanged on purpose, with the analysis' reason. */
  kept: z.array(keptScene).max(400).optional(),
  /** New sheet proposed by the analysis; applied at once or after confirmation. */
  proposal: z.object({ entity: proposedEntity.optional(), event: proposedEvent.optional(), timeline: proposedTimeline.optional(),
    chapter: proposedChapter.optional(), sceneSummary: z.string().max(800).optional() }).optional(),
});
/** Validation state of a chapter when the change reopened it: restored as is when a revert
 * brings back exactly the same text (the old validation covers it again). */
const chapterFreezeSnapshot = z.object({
  chapterId: z.string().min(1).max(200), textStamp: z.string().max(40), frozenAt: z.string().max(40).optional(),
  summary: z.string().max(6000).optional(), bookSummaryAtFreeze: z.string().max(9000).optional(), hadRecheck: z.boolean(),
}).strict();
export const changeOperationSchema = z.object({
  id: z.string().uuid(), createdAt: z.string(), updatedAt: z.string(),
  target: z.object({ kind: z.enum(CHANGE_TARGET_KINDS), id: z.string().min(1).max(200) }).strict(),
  targetLabel: z.string().max(200), instruction: z.string().min(1).max(8000), mode: z.enum(["auto", "confirm"]),
  state: z.enum(CHANGE_STATES), plan: planSchema.optional(),
  before: z.object({
    entity: knowledgeEntitySchema.optional(), event: knowledgeEventSchema.optional(), timeline: knowledgeTimelineSchema.optional(),
    chapter: z.object({ title: z.string().max(300), purpose: z.string().max(20_000) }).strict().optional(),
    chapters: z.array(chapterFreezeSnapshot).max(60).optional(),
    scenes: z.array(sceneSnapshot).max(400), memoryJson: z.string().max(400_000).optional(), pruned: z.boolean().optional(),
  }).strict(),
  after: z.object({
    scenes: z.array(z.object({ sceneId: z.string(), text: z.string().max(2_000_000) }).strict()).max(400),
    memoryJson: z.string().max(400_000), entityVersion: z.number().int().optional(), eventVersion: z.number().int().optional(),
    /** Chapter details or timeline after the change: a later edit blocks the automatic restore. */
    sheetJson: z.string().max(40_000).optional(),
  }).strict().optional(),
  /** Confirm mode, scene target: the rewritten text waits here; the book keeps the old one until confirmed. */
  draftText: z.string().max(2_000_000).optional(),
  report: z.array(z.object({ sceneId: z.string(), at: z.string(), drift: z.array(z.string().max(300)).max(30), summary: z.string().max(800).optional() }).strict()).max(400),
  error: z.string().max(2000).optional(), completedAt: z.string().optional(), revertedAt: z.string().optional(),
}).strict();
export type NarrativeChangeOperation = z.infer<typeof changeOperationSchema>;
export type ChangePlan = z.infer<typeof planSchema>;

export function activeChange(book: BookProject): NarrativeChangeOperation | undefined {
  const id = book.revision?.changeOperationId;
  return id ? book.changeOperations?.find(op => op.id === id) : undefined;
}
export function changeById(book: BookProject, id: string): NarrativeChangeOperation | undefined {
  return book.changeOperations?.find(op => op.id === id);
}
function scenes(book: BookProject): Array<{ chapterId: string; chapterNumber: number; scene: Scene }> {
  return [...book.chapters].sort((a, b) => a.number - b.number).flatMap(chapter =>
    [...chapter.scenes].sort((a, b) => a.number - b.number).map(scene => ({ chapterId: chapter.id, chapterNumber: chapter.number, scene })));
}
export function sceneSnapshots(book: BookProject, ids: readonly string[]): NarrativeChangeOperation["before"]["scenes"] {
  const wanted = new Set(ids);
  return scenes(book).filter(x => wanted.has(x.scene.id)).map(({ chapterId, scene }) => ({
    sceneId: scene.id, chapterId, text: scene.text, status: scene.status, ...(scene.summary !== undefined ? { summary: scene.summary.slice(0, 6000) } : {}),
  }));
}
/** Keep the newest operations whole; drop the prose of older ones (metadata stays). */
export function pruneChangeOperations(ops: NarrativeChangeOperation[]): NarrativeChangeOperation[] {
  const kept = ops.slice(-MAX_CHANGE_OPERATIONS);
  let budget = MAX_SNAPSHOT_CHARS;
  for (let i = kept.length - 1; i >= 0; i--) {
    const op = kept[i]!;
    const size = op.before.scenes.reduce((n, s) => n + s.text.length, 0) + (op.after?.scenes.reduce((n, s) => n + s.text.length, 0) ?? 0) +
      (op.before.memoryJson?.length ?? 0) + (op.draftText?.length ?? 0) +
      (op.before.chapters ?? []).reduce((n, c) => n + (c.summary?.length ?? 0) + (c.bookSummaryAtFreeze?.length ?? 0), 0);
    if (size <= budget) { budget -= size; continue; }
    kept[i] = { ...op, before: { ...op.before, scenes: [], pruned: true, memoryJson: undefined, chapters: undefined }, after: undefined };
  }
  return kept;
}
/** Deterministic fingerprint of a chapter's prose (local, not a signature). */
export function chapterTextStamp(chapter: Chapter): string {
  return contentStamp(JSON.stringify([...chapter.scenes].sort((a, b) => a.number - b.number).map(s => [s.id, s.text])));
}

/** Capitalized words inside a sentence: in Italian prose almost always proper names. */
function properNouns(text: string): Set<string> {
  const out = new Set<string>();
  for (const sentence of text.split(/[.!?…]+[\s"»”)]*|\n+|[:;«“—–-]\s/u)) {
    const words = sentence.match(/[\p{L}\p{M}'’]+/gu) ?? [];
    for (const word of words.slice(1)) {
      const bare = word.replace(/^.*['’]/u, "");
      if (/^\p{Lu}[\p{Ll}\p{M}]{2,}$/u.test(bare)) out.add(bare);
    }
  }
  return out;
}

/** Local, AI-free guard: names of sheets, other proper names and numbers present in only one version. */
export function detectFactDrift(before: string, after: string, names: readonly string[]): string[] {
  const fold = (value: string) => value.normalize("NFC").toLocaleLowerCase("it");
  const a = fold(before), b = fold(after);
  const has = (text: string, name: string) => new RegExp("(?<![\\p{L}\\p{N}\\p{M}_])" + fold(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\p{L}\\p{N}\\p{M}_])", "u").test(text);
  const drift: string[] = [];
  const known = [...new Set(names.filter(n => n.trim().length >= 3))];
  for (const name of known) {
    const was = has(a, name), is = has(b, name);
    if (was && !is) drift.push("«" + name + "» non compare più nella scena.");
    else if (!was && is) drift.push("«" + name + "» compare ora nella scena.");
  }
  // Names without a sheet (a new character, a place) are caught by their capital letter.
  const knownFolded = new Set(known.flatMap(n => n.split(/\s+/)).map(fold));
  const pa = properNouns(before.normalize("NFC")), pb = properNouns(after.normalize("NFC"));
  const presentIn = (text: string, word: string) => has(text, word);
  const appeared = [...pb].filter(w => !pa.has(w) && !presentIn(a, w) && !knownFolded.has(fold(w)));
  const vanished = [...pa].filter(w => !pb.has(w) && !presentIn(b, w) && !knownFolded.has(fold(w)));
  if (appeared.length) drift.push("Nomi propri nuovi: " + appeared.slice(0, 6).join(", ") + ".");
  if (vanished.length) drift.push("Nomi propri spariti: " + vanished.slice(0, 6).join(", ") + ".");
  const numbers = (text: string) => new Set(text.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []);
  const na = numbers(a), nb = numbers(b);
  const changed = [...na].filter(n => !nb.has(n)).concat([...nb].filter(n => !na.has(n)));
  if (changed.length) drift.push("Numeri o date cambiati: " + [...new Set(changed)].slice(0, 6).join(", ") + ".");
  return drift.slice(0, 30);
}
export function knownNames(book: BookProject): string[] {
  const kb = book.knowledge;
  return [...(kb?.entities.flatMap(e => [e.name, ...e.aliases]) ?? []),
    ...Object.keys(book.memory.characters), ...Object.keys(book.memory.locations), ...Object.keys(book.memory.items), ...Object.keys(book.memory.factions)];
}

/** The comparison reply after a scene was rewritten on request. */
export const sceneComparisonSchema = z.object({
  changeKind: z.enum(["style", "narrative"]),
  changedFacts: z.array(z.string().min(3).max(400)).max(30),
  dependentSceneIds: z.array(z.string()).max(400),
  summary: z.string().trim().min(20).max(800),
  rationale: z.string().min(8).max(2000),
});

/** Replace an entity sheet with the analysed version: new version, history kept. */
export function replaceEntitySheet(kb: KnowledgeBase, entityId: string, sheet: NonNullable<z.infer<typeof changeAnalysisSchema>["entity"]>, now: string, reason: string): KnowledgeBase {
  const entity = kb.entities.find(e => e.id === entityId);
  if (!entity) throw new Error("La scheda da modificare non esiste più.");
  // Reuse the merge rules (relations by name, limits) on a clean copy of the sheet.
  const base: KnowledgeBase = structuredClone(kb);
  const target = base.entities.find(e => e.id === entityId)!;
  const snapshot = { name: target.name, aliases: target.aliases, importance: target.importance, summary: target.summary,
    attributes: target.attributes, relationships: target.relationships };
  target.history = [...(target.history ?? []), { version: target.version, at: now, reason: reason.slice(0, 300), snapshot }].slice(-8);
  target.version++;
  const clash = findEntity(base, target.type, sheet.name);
  if (clash && clash.id !== target.id) throw new Error("Esiste già una scheda chiamata «" + sheet.name + "».");
  target.name = sheet.name.trim();
  target.aliases = [...new Set(sheet.aliases ?? target.aliases)].filter(a => a.trim() && a !== target.name).slice(0, 8);
  target.importance = sheet.importance ?? target.importance;
  target.summary = sheet.summary.trim();
  target.attributes = Object.fromEntries(Object.entries(sheet.attributes ?? target.attributes)
    .filter(([key, value]) => /^[a-z][a-z0-9_]{0,39}$/.test(key) && value.trim()).slice(0, 12));
  target.origin = "author"; target.status = "validated"; target.updatedAt = now;
  if (sheet.relationships) {
    target.relationships = [];
    for (const r of sheet.relationships) {
      const other = findEntity(base, undefined, r.target);
      if (!other) throw new Error("Relazione verso «" + r.target + "», che non è una scheda.");
      if (other.id !== target.id && !target.relationships.some(x => x.targetId === other.id))
        target.relationships.push({ targetId: other.id, type: r.type, ...(r.note ? { note: r.note } : {}) });
    }
  }
  return parseKnowledge(base);
}
export function replaceEventSheet(kb: KnowledgeBase, eventId: string, sheet: NonNullable<z.infer<typeof changeAnalysisSchema>["event"]>, now: string, reason: string): KnowledgeBase {
  const original = kb.events.find(e => e.id === eventId);
  if (!original) throw new Error("L'evento da modificare non esiste più.");
  if (kb.events.some(e => e.id !== eventId && e.title.toLocaleLowerCase("it") === sheet.title.trim().toLocaleLowerCase("it")))
    throw new Error("Esiste già un evento intitolato «" + sheet.title.trim() + "».");
  const renamed = structuredClone(kb);
  renamed.events.find(e => e.id === eventId)!.title = sheet.title.trim();
  // Remaining fields resolve names exactly like an incremental update.
  const merged = mergeKnowledgeReply(renamed, knowledgeReplySchema.parse({ events: [{ title: sheet.title.trim(), summary: sheet.summary,
    ...(sheet.storyOrder !== undefined ? { storyOrder: sheet.storyOrder } : {}), ...(sheet.when !== undefined ? { when: sheet.when } : {}),
    ...(sheet.narration ? { narration: sheet.narration } : {}), ...(sheet.involves ? { involves: sheet.involves } : {}),
    ...(sheet.secret !== undefined ? { secret: sheet.secret } : {}),
    ...(sheet.perspectives ? { perspectives: sheet.perspectives } : {}) }] }), { origin: "author", reason, now });
  const target = merged.events.find(e => e.id === eventId)!;
  if (sheet.causes) target.causes = sheet.causes.map(label => {
    const found = merged.events.find(e => e.id === label || e.title.toLocaleLowerCase("it") === label.toLocaleLowerCase("it"));
    if (!found) throw new Error("Causa «" + label + "» non trovata fra gli eventi.");
    return found.id;
  }).filter(id => id !== eventId);
  // One version step for the author's change, whatever the merge did internally.
  const { id: _i, version: _v, origin: _o, updatedAt: _u, history: _h, ...snapshot } = original;
  target.history = [...(original.history ?? []), { version: original.version, at: now, reason: reason.slice(0, 300), snapshot }].slice(-8);
  target.version = original.version + 1; target.origin = "author"; target.updatedAt = now;
  return parseKnowledge(merged);
}

/** Rewrite targets must be written scenes; returned in book order without duplicates. */
export function validRewriteTargets(book: BookProject, ids: readonly string[], exclude?: string): string[] {
  const written = scenes(book).filter(x => x.scene.status !== "planned" && x.scene.text.trim()).map(x => x.scene.id);
  const known = new Set(written);
  const unknown = ids.filter(id => !known.has(id));
  if (unknown.length) throw new Error("Il piano cita scene inesistenti o non ancora scritte: " + unknown.slice(0, 5).join(", ") + ".");
  const wanted = new Set(ids);
  return written.filter(id => wanted.has(id) && id !== exclude);
}

export function targetLabel(book: BookProject, target: ChangeTarget): string {
  if (target.kind === "entity") return book.knowledge?.entities.find(e => e.id === target.id)?.name ?? target.id;
  if (target.kind === "event") return book.knowledge?.events.find(e => e.id === target.id)?.title ?? target.id;
  if (target.kind === "timeline") return book.knowledge?.timelines.find(t => t.id === target.id)?.title ?? target.id;
  if (target.kind === "chapter") {
    const chapter = book.chapters.find(c => c.id === target.id);
    return chapter ? `Capitolo ${chapter.number} «${chapter.title}»` : target.id;
  }
  const found = scenes(book).find(x => x.scene.id === target.id);
  return found ? `Capitolo ${found.chapterNumber}, scena ${found.scene.number} «${found.scene.title}»` : target.id;
}
/** The timeline as the analysis proposed it: names resolved to sheets, one global timeline. */
export function replaceTimelineSheet(kb: KnowledgeBase, timelineId: string, sheet: NonNullable<z.infer<typeof changeAnalysisSchema>["timeline"]>): KnowledgeBase {
  const base: KnowledgeBase = structuredClone(kb);
  const target = base.timelines.find(t => t.id === timelineId);
  if (!target) throw new Error("La timeline da modificare non esiste più.");
  const title = sheet.title.trim();
  if (base.timelines.some(t => t.id !== timelineId && t.title.toLocaleLowerCase("it") === title.toLocaleLowerCase("it")))
    throw new Error("Esiste già una timeline intitolata «" + title + "».");
  if (sheet.kind === "global" && target.kind !== "global" && base.timelines.some(t => t.id !== timelineId && t.kind === "global"))
    throw new Error("Esiste già una timeline globale: la modifica non può renderne globale una seconda.");
  target.title = title;
  if (sheet.kind) target.kind = sheet.kind;
  if (sheet.summary !== undefined) target.summary = sheet.summary.trim();
  if (sheet.subjects) {
    const ids = [...new Set(sheet.subjects.map(name => {
      const found = findEntity(base, undefined, name);
      if (!found) throw new Error("La timeline segue «" + name + "», che non è una scheda.");
      return found.id;
    }))].slice(0, 12);
    if (ids.length) target.subjectIds = ids; else delete target.subjectIds;
  }
  return parseKnowledge(base);
}
export function isEntityId(id: string): boolean { return ENTITY_ID.test(id); }
export type { KnowledgeEntity, KnowledgeEvent };
