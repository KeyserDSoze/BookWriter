import type { BookProject, Chapter, Scene } from "./types";
import { ENTITY_TYPES, findEntity, LIMITS, MEMORY_FOLDER, NARRATION_MODES, parseKnowledge, slug, STANCES,
  type EntityType, type KnowledgeEntity, type KnowledgeEvent, type KnowledgeTimeline } from "./knowledge";
import { relevantKnowledge } from "./knowledge-index";
import { detectFactDrift, knownNames } from "./narrative-change";
import { archiveJudgedRounds } from "./narrative-change-flow";
import { contentStamp, currentContent, entityContent, eventContent, findScene, newEdit, pruneEdits, structureContent,
  type BookEdit, type EditChangeKind, type EditTarget } from "./book-edits";

/** Pure, AI-free editing of every element. Each operation validates, applies, records
 * one BookEdit and invalidates what depended on the old content (chapter freeze →
 * "review stale", summaries → "not updated", a running review of the chapter →
 * restarted). It never starts a review and never marks content as approved. */
export interface EditContext { now: string; origin: "manual" | "ai"; prompt?: string; aiActivityId?: string }
const MAX_TITLE = 300, MAX_PURPOSE = 20_000, MAX_TEXT = 2_000_000, MAX_SUMMARY = 6000;
const clean = (value: string) => value.normalize("NFC");
function requireText(value: string, label: string, min: number, max: number): string {
  const text = clean(value);
  if (text.trim().length < min) throw new Error(`${label}: scrivi almeno ${min} caratteri.`);
  if (text.length > max) throw new Error(`${label}: massimo ${max.toLocaleString("it-IT")} caratteri.`);
  return text;
}
function randomId(prefix: string, taken: ReadonlySet<string>): string {
  for (;;) {
    const id = prefix + ":x" + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    if (!taken.has(id)) return id;
  }
}
const sceneIds = (book: BookProject) => new Set(book.chapters.flatMap(c => c.scenes.map(s => s.id)));
const sortedChapters = (book: BookProject) => [...book.chapters].sort((a, b) => a.number - b.number);

/** Content the autopilot is about to rewrite must not be edited underneath it. */
export function assertEditable(book: BookProject, sceneIdsTouched: readonly string[] = []): void {
  const rev = book.revision;
  if (rev && sceneIdsTouched.some(id => rev.affectedSceneIds.slice(rev.cursor).includes(id)))
    throw new Error("Questa scena sta per essere riscritta dalla revisione in corso: attendi la fine o annulla la modifica in corso.");
  const op = rev?.changeOperationId ? book.changeOperations?.find(o => o.id === rev.changeOperationId) : undefined;
  if (op && ["pending", "analyzing", "awaiting_confirmation"].includes(op.state) && op.target.kind === "scene" && sceneIdsTouched.includes(op.target.id))
    throw new Error("Una modifica via prompt su questa scena è in corso: completala o annullala prima.");
}
/** Validation of the frozen chapter is outdated; a running board restarts on the new text. */
function touchChapter(book: BookProject, chapter: Chapter, editId: string, textChanged: boolean, now: string): void {
  if (chapter.frozenAt) chapter.reviewStale = { since: chapter.reviewStale?.since ?? now, editIds: [...(chapter.reviewStale?.editIds ?? []), editId].slice(-50) };
  if (textChanged && chapter.summary !== undefined) chapter.summaryStale = true;
  const cycle = book.editorialCycle;
  const reviewed = cycle && book.chapters.find(c => c.id === cycle.chapterId);
  // The board of this chapter (or of a later one, which reads the earlier text) was
  // reading an older version: its judged rounds are archived and it restarts later.
  if (reviewed && (reviewed.id === chapter.id || (textChanged && reviewed.number > chapter.number))) {
    archiveJudgedRounds(book);
    // Scenes already corrected by the board but not yet reconciled are the current text.
    for (const scene of reviewed.scenes)
      if (scene.status === "draft" && !book.editorialReviewSceneIds?.includes(scene.id)) scene.status = "canon";
    book.editorialCycle = undefined;
    if (book.phase === "chapterReview") book.phase = "prose";
  }
}
/** The first scene the autopilot would write next (book order). */
function nextSceneToWrite(book: BookProject): Scene | undefined {
  for (const chapter of sortedChapters(book))
    for (const scene of [...chapter.scenes].sort((a, b) => a.number - b.number)) if (scene.status !== "canon") return scene;
  return undefined;
}
function record(book: BookProject, edit: BookEdit): BookEdit {
  book.edits = pruneEdits([...(book.edits ?? []), edit]);
  return edit;
}
function relatedOfText(book: BookProject, text: string, sceneId?: string, chapterNumber?: number): string[] {
  const kb = book.knowledge;
  if (!kb || kb.pending) return [];
  const found = relevantKnowledge(book, kb, text.slice(0, 60_000), sceneId, chapterNumber);
  return [...found.entities.map(e => e.id), ...found.events.map(e => e.id)];
}
function renumber(book: BookProject): void {
  sortedChapters(book).forEach((chapter, index) => {
    chapter.number = index + 1;
    chapter.scenes.forEach((scene, si) => { scene.number = si + 1; });
  });
  book.chapters = sortedChapters(book);
}

export type ScenePatch = Partial<Pick<Scene, "title" | "objective" | "text" | "summary">>;
export function editScene(book: BookProject, sceneId: string, patch: ScenePatch, ctx: EditContext): BookEdit {
  const found = findScene(book, sceneId);
  if (!found) throw new Error("Scena non trovata.");
  const { chapter, scene } = found;
  assertEditable(book, [sceneId]);
  const before = currentContent(book, { kind: "scene", id: sceneId })!;
  const oldText = scene.text;
  const fields: string[] = [];
  if (patch.title !== undefined && clean(patch.title) !== scene.title) { scene.title = requireText(patch.title, "Titolo", 1, MAX_TITLE).trim(); fields.push("titolo"); }
  if (patch.objective !== undefined && clean(patch.objective) !== scene.objective) { scene.objective = requireText(patch.objective, "Obiettivo", 0, MAX_PURPOSE); fields.push("obiettivo"); }
  const textChanged = patch.text !== undefined && clean(patch.text) !== scene.text;
  if (textChanged) {
    const text = clean(patch.text!);
    if (text.length > MAX_TEXT) throw new Error("Testo troppo lungo per una scena.");
    if (!text.trim() && scene.status !== "planned") throw new Error("Una scena scritta non può restare vuota: eliminala dalla struttura del capitolo.");
    const nextToWrite = nextSceneToWrite(book)?.id === scene.id;
    const reviewing = scene.status === "draft" && book.phase === "review" && book.currentSceneId === scene.id;
    scene.text = text;
    // The author's prose is authoritative: the autopilot never rewrites it as a draft.
    // Scenes fused from a conflict keep waiting for their explicit confirmation.
    if (text.trim() && scene.status !== "canon" && !book.editorialReviewSceneIds?.includes(scene.id)) {
      scene.status = "canon";
      // Written in place of the AI's next step: the memory is updated from the author's text.
      if (reviewing || (nextToWrite && book.phase === "prose" && !book.currentSceneId)) {
        book.currentSceneId = scene.id;
        book.phase = "consolidate";
      }
    }
    fields.push("testo");
  }
  if (patch.summary !== undefined && clean(patch.summary) !== (scene.summary ?? "")) {
    scene.summary = requireText(patch.summary, "Riassunto", 0, MAX_SUMMARY);
    delete scene.summaryStale;
    fields.push("riassunto");
  } else if (textChanged && scene.summary !== undefined) scene.summaryStale = true;
  if (!fields.length) throw new Error("Nessuna modifica da salvare.");
  const drift = textChanged ? detectFactDrift(oldText, scene.text, knownNames(book)) : [];
  const changeKind: EditChangeKind = textChanged ? (drift.length ? "event" : "style") : "descriptive";
  const after = currentContent(book, { kind: "scene", id: sceneId })!;
  const flat = sortedChapters(book).flatMap(c => [...c.scenes].sort((a, b) => a.number - b.number));
  const later = flat.slice(flat.findIndex(s => s.id === sceneId) + 1).filter(s => s.text.trim()).slice(0, 2).map(s => s.id);
  const edit = newEdit({ at: ctx.now, target: { kind: "scene", id: sceneId }, label: `Cap. ${chapter.number} · ${scene.number}. ${scene.title}`,
    field: fields.join("+"), origin: ctx.origin, ...(ctx.prompt ? { prompt: ctx.prompt.slice(0, 4000) } : {}),
    ...(ctx.aiActivityId ? { aiActivityId: ctx.aiActivityId } : {}),
    before, after, changeKind, related: [...later, ...relatedOfText(book, scene.text, scene.id, chapter.number)], stampAfter: contentStamp(after) });
  touchChapter(book, chapter, edit.id, textChanged, ctx.now);
  return record(book, edit);
}

export type ChapterPatch = Partial<Pick<Chapter, "title" | "purpose" | "summary">>;
export function editChapter(book: BookProject, chapterId: string, patch: ChapterPatch, ctx: EditContext): BookEdit {
  const chapter = book.chapters.find(c => c.id === chapterId);
  if (!chapter) throw new Error("Capitolo non trovato.");
  const before = currentContent(book, { kind: "chapter", id: chapterId })!;
  const fields: string[] = [];
  if (patch.title !== undefined && clean(patch.title) !== chapter.title) { chapter.title = requireText(patch.title, "Titolo", 1, MAX_TITLE).trim(); fields.push("titolo"); }
  if (patch.purpose !== undefined && clean(patch.purpose) !== chapter.purpose) { chapter.purpose = requireText(patch.purpose, "Scopo", 0, MAX_PURPOSE); fields.push("scopo"); }
  if (patch.summary !== undefined && clean(patch.summary) !== (chapter.summary ?? "")) {
    chapter.summary = requireText(patch.summary, "Riassunto", 0, MAX_SUMMARY);
    delete chapter.summaryStale;
    fields.push("riassunto");
  }
  if (!fields.length) throw new Error("Nessuna modifica da salvare.");
  const after = currentContent(book, { kind: "chapter", id: chapterId })!;
  const edit = newEdit({ at: ctx.now, target: { kind: "chapter", id: chapterId }, label: `Capitolo ${chapter.number} — ${chapter.title}`,
    field: fields.join("+"), origin: ctx.origin, ...(ctx.prompt ? { prompt: ctx.prompt.slice(0, 4000) } : {}),
    before, after, changeKind: "descriptive", related: chapter.scenes.map(s => s.id), stampAfter: contentStamp(after) });
  if (chapter.frozenAt) chapter.reviewStale = { since: chapter.reviewStale?.since ?? ctx.now, editIds: [...(chapter.reviewStale?.editIds ?? []), edit.id].slice(-50) };
  return record(book, edit);
}

/** Add, delete, move scenes and chapters. IDs stay stable; numbers follow the order. */
export type StructureOperation =
  | { op: "addScene"; chapterId: string; index: number; title: string; objective: string }
  | { op: "deleteScene"; sceneId: string }
  | { op: "moveScene"; sceneId: string; chapterId: string; index: number }
  | { op: "addChapter"; index: number; title: string; purpose: string }
  | { op: "deleteChapter"; chapterId: string }
  | { op: "moveChapter"; chapterId: string; index: number };
export function editStructure(book: BookProject, operation: StructureOperation, ctx: EditContext): BookEdit {
  if (book.revision) throw new Error("Una revisione o una modifica è in corso: completala prima di cambiare la struttura del libro.");
  const before = structureContent(book);
  const touched = new Set<Chapter>();
  let label = "", deleted: string | null = null, related: string[] = [];
  const clamp = (index: number, max: number) => Math.max(0, Math.min(Math.trunc(index), max));
  switch (operation.op) {
    case "addScene": {
      const chapter = book.chapters.find(c => c.id === operation.chapterId);
      if (!chapter) throw new Error("Capitolo non trovato.");
      if (chapter.scenes.length >= 200) throw new Error("Massimo 200 scene per capitolo.");
      const scene: Scene = { id: randomId("scene", sceneIds(book)), number: 0, title: requireText(operation.title, "Titolo", 1, MAX_TITLE).trim(),
        objective: requireText(operation.objective, "Obiettivo", 0, MAX_PURPOSE), text: "", status: "planned" };
      chapter.scenes.splice(clamp(operation.index, chapter.scenes.length), 0, scene);
      touched.add(chapter); label = `Nuova scena «${scene.title}» nel capitolo ${chapter.number}`; related = [scene.id];
      break;
    }
    case "deleteScene": {
      const found = findScene(book, operation.sceneId);
      if (!found) throw new Error("Scena non trovata.");
      assertEditable(book, [operation.sceneId]);
      deleted = JSON.stringify({ chapterId: found.chapter.id, index: found.chapter.scenes.indexOf(found.scene), scene: found.scene });
      found.chapter.scenes = found.chapter.scenes.filter(s => s.id !== operation.sceneId);
      touched.add(found.chapter); label = `Scena eliminata «${found.scene.title}» (capitolo ${found.chapter.number})`;
      if (book.knowledge) for (const event of book.knowledge.events) event.sceneIds = event.sceneIds.filter(id => id !== operation.sceneId);
      book.editorialReviewSceneIds = book.editorialReviewSceneIds?.filter(id => id !== operation.sceneId);
      if (book.currentSceneId === operation.sceneId) book.currentSceneId = undefined;
      break;
    }
    case "moveScene": {
      const found = findScene(book, operation.sceneId);
      const target = book.chapters.find(c => c.id === operation.chapterId);
      if (!found || !target) throw new Error("Scena o capitolo non trovati.");
      assertEditable(book, [operation.sceneId]);
      if (target !== found.chapter && target.scenes.length >= 200) throw new Error("Massimo 200 scene per capitolo.");
      found.chapter.scenes = found.chapter.scenes.filter(s => s.id !== operation.sceneId);
      target.scenes.splice(clamp(operation.index, target.scenes.length), 0, found.scene);
      touched.add(found.chapter); touched.add(target);
      label = `Scena «${found.scene.title}» spostata` + (target !== found.chapter ? ` nel capitolo ${target.number}` : ""); related = [found.scene.id];
      break;
    }
    case "addChapter": {
      if (book.chapters.length >= 200) throw new Error("Massimo 200 capitoli.");
      const chapter: Chapter = { id: randomId("chapter", new Set(book.chapters.map(c => c.id))), number: 0,
        title: requireText(operation.title, "Titolo", 1, MAX_TITLE).trim(), purpose: requireText(operation.purpose, "Scopo", 0, MAX_PURPOSE), scenes: [] };
      const ordered = sortedChapters(book);
      ordered.splice(clamp(operation.index, ordered.length), 0, chapter);
      ordered.forEach((c, i) => { c.number = i + 1; });
      book.chapters = ordered; label = `Nuovo capitolo «${chapter.title}»`; related = [chapter.id];
      break;
    }
    case "deleteChapter": {
      const chapter = book.chapters.find(c => c.id === operation.chapterId);
      if (!chapter) throw new Error("Capitolo non trovato.");
      assertEditable(book, chapter.scenes.map(s => s.id));
      if (book.chapters.length === 1) throw new Error("Il libro deve avere almeno un capitolo.");
      deleted = JSON.stringify({ chapter });
      const ids = new Set(chapter.scenes.map(s => s.id));
      book.chapters = book.chapters.filter(c => c.id !== operation.chapterId);
      if (book.knowledge) for (const event of book.knowledge.events) event.sceneIds = event.sceneIds.filter(id => !ids.has(id));
      book.editorialReviewSceneIds = book.editorialReviewSceneIds?.filter(id => !ids.has(id));
      if (book.currentSceneId && ids.has(book.currentSceneId)) book.currentSceneId = undefined;
      if (book.editorialCycle?.chapterId === chapter.id) { archiveJudgedRounds(book); book.editorialCycle = undefined; if (book.phase === "chapterReview") book.phase = "prose"; }
      label = `Capitolo eliminato «${chapter.title}»`;
      // Later frozen chapters lost a predecessor: their validation is outdated.
      for (const later of book.chapters) if (later.number > chapter.number) touched.add(later);
      break;
    }
    case "moveChapter": {
      const ordered = sortedChapters(book);
      const from = ordered.findIndex(c => c.id === operation.chapterId);
      if (from < 0) throw new Error("Capitolo non trovato.");
      const [chapter] = ordered.splice(from, 1);
      const to = clamp(operation.index, ordered.length);
      ordered.splice(to, 0, chapter!);
      const low = Math.min(from, to), high = Math.max(from, to);
      ordered.forEach((c, i) => { c.number = i + 1; if (i >= low && i <= high) touched.add(c); });
      book.chapters = ordered; label = `Capitolo «${chapter!.title}» spostato in posizione ${to + 1}`; related = [chapter!.id];
      break;
    }
  }
  renumber(book);
  const after = structureContent(book);
  if (after === before && operation.op.startsWith("move")) throw new Error("L'elemento è già in quella posizione.");
  const edit = newEdit({ at: ctx.now, target: { kind: "structure", id: "book" }, label, field: operation.op, origin: ctx.origin,
    before: deleted ?? before, after, changeKind: "structural", related: [...related, ...[...touched].map(c => c.id)], stampAfter: contentStamp(after) });
  for (const chapter of touched) if (book.chapters.includes(chapter)) touchChapter(book, chapter, edit.id, true, ctx.now);
  return record(book, edit);
}

/* ------------------------------ knowledge base ------------------------------ */

const BEHAVIOR_KEYS = new Set(["personality", "speech", "arc", "motivation", "methods"]);
const STRUCTURAL_KEYS = new Set(["role", "goal", "structure"]);
/** A working copy: the book's sheets change only once the whole result validates. */
function requireKnowledge(book: BookProject) {
  if (!book.knowledge || book.knowledge.pending) throw new Error("Le schede del libro non sono ancora state generate.");
  return structuredClone(book.knowledge);
}
export type EntityPatch = Partial<Pick<KnowledgeEntity, "name" | "aliases" | "importance" | "summary" | "attributes" | "relationships" | "status">>;
function entityChangeKind(before: KnowledgeEntity, after: KnowledgeEntity): EditChangeKind {
  if (before.name !== after.name) return "structural";
  const keys = new Set([...Object.keys(before.attributes), ...Object.keys(after.attributes)]);
  const changed = [...keys].filter(key => before.attributes[key] !== after.attributes[key]);
  if (changed.some(key => STRUCTURAL_KEYS.has(key))) return "structural";
  if (JSON.stringify(before.relationships) !== JSON.stringify(after.relationships)) return "event";
  if (changed.some(key => BEHAVIOR_KEYS.has(key))) return "behavior";
  return "descriptive";
}
export function editEntity(book: BookProject, entityId: string, patch: EntityPatch, ctx: EditContext): BookEdit {
  const kb = requireKnowledge(book);
  const entity = kb.entities.find(e => e.id === entityId);
  if (!entity) throw new Error("Scheda non trovata.");
  const before = entityContent(entity), previous = structuredClone(entity);
  const next: KnowledgeEntity = { ...entity,
    ...(patch.name !== undefined ? { name: requireText(patch.name, "Nome", 1, 120).trim() } : {}),
    ...(patch.aliases !== undefined ? { aliases: [...new Set(patch.aliases.map(a => clean(a).trim()).filter(Boolean))].slice(0, 8) } : {}),
    ...(patch.importance !== undefined ? { importance: patch.importance } : {}),
    ...(patch.summary !== undefined ? { summary: requireText(patch.summary, "Descrizione", 0, 600) } : {}),
    ...(patch.attributes !== undefined ? { attributes: Object.fromEntries(Object.entries(patch.attributes)
      .map(([k, v]) => [k, clean(v).trim()] as const).filter(([k, v]) => /^[a-z][a-z0-9_]{0,39}$/.test(k) && v)) } : {}),
    ...(patch.relationships !== undefined ? { relationships: patch.relationships.map(r => ({ targetId: r.targetId, type: clean(r.type).trim(), ...(r.note?.trim() ? { note: clean(r.note).trim() } : {}) })) } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  };
  if (Object.keys(next.attributes).length > LIMITS.attributes) throw new Error(`Massimo ${LIMITS.attributes} campi per scheda.`);
  if (entityContent(next) === before) throw new Error("Nessuna modifica da salvare.");
  const clash = findEntity({ ...kb, entities: kb.entities.filter(e => e.id !== entityId) }, entity.type, next.name)
    ?? next.aliases.map(alias => findEntity({ ...kb, entities: kb.entities.filter(e => e.id !== entityId) }, entity.type, alias)).find(Boolean);
  if (clash) throw new Error(`Esiste già una scheda «${clash.name}» con questo nome o alias.`);
  const { name, aliases, importance, summary, attributes, relationships } = previous;
  next.history = [...(entity.history ?? []), { version: entity.version, at: ctx.now, reason: (ctx.origin === "ai" ? "Modifica AI: " : "Modifica dell'autore") + (ctx.prompt ? " " + ctx.prompt : ""),
    snapshot: { name, aliases, importance, summary, attributes, relationships } }].slice(-LIMITS.history);
  next.history.forEach(h => { h.reason = h.reason.slice(0, 300); });
  next.version = entity.version + 1; next.origin = "author"; next.updatedAt = ctx.now;
  if (patch.status === undefined) next.status = "validated";
  kb.entities[kb.entities.indexOf(entity)] = next;
  book.knowledge = parseKnowledge(kb);
  // A renamed sheet keeps its narrative state and its scene metadata, never the prose.
  if (previous.name !== next.name) {
    const folder = MEMORY_FOLDER[entity.type];
    const memory = book.memory[folder];
    if (Object.hasOwn(memory, previous.name) && !Object.hasOwn(memory, next.name)) {
      memory[next.name] = memory[previous.name]!;
      delete memory[previous.name];
    }
    for (const chapter of book.chapters) for (const scene of chapter.scenes) {
      const list = folder === "characters" ? scene.characters : scene[folder];
      if (list) list.forEach((value, i) => { if (value === previous.name) list[i] = next.name; });
      if (folder === "characters" && scene.viewpoint === previous.name) scene.viewpoint = next.name;
    }
  }
  const after = entityContent(next);
  const edit = newEdit({ at: ctx.now, target: { kind: "entity", id: entityId }, label: next.name, field: "scheda", origin: ctx.origin,
    ...(ctx.prompt ? { prompt: ctx.prompt.slice(0, 4000) } : {}), ...(ctx.aiActivityId ? { aiActivityId: ctx.aiActivityId } : {}),
    before, after, changeKind: entityChangeKind(previous, next), related: [...next.relationships.map(r => r.targetId),
      ...kb.events.filter(e => e.involves.includes(entityId)).map(e => e.id)], stampAfter: contentStamp(after) });
  return record(book, edit);
}
export function addEntity(book: BookProject, input: { type: EntityType; name: string; importance: KnowledgeEntity["importance"]; summary: string }, ctx: EditContext): BookEdit {
  const kb = requireKnowledge(book);
  if (!ENTITY_TYPES.includes(input.type)) throw new Error("Tipo di scheda non valido.");
  if (kb.entities.length >= LIMITS.entities) throw new Error(`Massimo ${LIMITS.entities} schede.`);
  const name = requireText(input.name, "Nome", 1, 120).trim();
  if (findEntity(kb, input.type, name)) throw new Error("Esiste già una scheda con questo nome.");
  const taken = new Set([...kb.entities, ...kb.events, ...kb.timelines].map(x => x.id));
  let id = input.type + ":" + slug(name), n = 2;
  while (taken.has(id)) id = input.type + ":" + slug(name) + "-" + n++;
  const entity: KnowledgeEntity = { id, type: input.type, name, aliases: [], importance: input.importance, summary: requireText(input.summary, "Descrizione", 0, 600),
    attributes: {}, relationships: [], version: 1, status: "validated", origin: "author", updatedAt: ctx.now };
  kb.entities.push(entity);
  book.knowledge = parseKnowledge(kb);
  const after = entityContent(entity);
  return record(book, newEdit({ at: ctx.now, target: { kind: "entity", id }, label: name, field: "creata", origin: ctx.origin,
    before: null, after, changeKind: "structural", related: [], stampAfter: contentStamp(after) }));
}
export function deleteEntity(book: BookProject, entityId: string, ctx: EditContext): BookEdit {
  const kb = requireKnowledge(book);
  const entity = kb.entities.find(e => e.id === entityId);
  if (!entity) throw new Error("Scheda non trovata.");
  const folder = MEMORY_FOLDER[entity.type];
  const memory = Object.hasOwn(book.memory[folder], entity.name) ? book.memory[folder][entity.name] : undefined;
  const affected = kb.events.filter(e => e.involves.includes(entityId) || e.perspectives.some(p => p.entityId === entityId)).map(e => e.id);
  const referencing = kb.entities.filter(e => e.relationships.some(r => r.targetId === entityId)).map(e => e.id);
  kb.entities = kb.entities.filter(e => e.id !== entityId);
  for (const other of kb.entities) other.relationships = other.relationships.filter(r => r.targetId !== entityId);
  for (const event of kb.events) {
    event.involves = event.involves.filter(id => id !== entityId);
    event.perspectives = event.perspectives.filter(p => p.entityId !== entityId);
  }
  book.knowledge = parseKnowledge(kb);
  // Without this the next memory sync would recreate the sheet as a draft.
  if (memory !== undefined) delete book.memory[folder][entity.name];
  return record(book, newEdit({ at: ctx.now, target: { kind: "entity", id: entityId }, label: entity.name, field: "eliminata", origin: ctx.origin,
    before: JSON.stringify({ entity, memory: memory ?? null }), after: null, changeKind: "structural", related: [...affected, ...referencing], stampAfter: "deleted" }));
}

export type EventPatch = Partial<Pick<KnowledgeEvent, "title" | "summary" | "when" | "storyOrder" | "narration" | "secret" | "involves" | "causes" | "sceneIds" | "timelineIds" | "perspectives">>;
function eventChangeKind(before: KnowledgeEvent, after: KnowledgeEvent): EditChangeKind {
  if (before.storyOrder !== after.storyOrder || JSON.stringify(before.causes) !== JSON.stringify(after.causes) || before.when !== after.when ||
      JSON.stringify(before.sceneIds) !== JSON.stringify(after.sceneIds)) return "structural";
  if (before.summary !== after.summary || before.title !== after.title || before.secret !== after.secret ||
      JSON.stringify(before.involves) !== JSON.stringify(after.involves) || JSON.stringify(before.perspectives) !== JSON.stringify(after.perspectives)) return "event";
  return "descriptive";
}
export function editEvent(book: BookProject, eventId: string, patch: EventPatch, ctx: EditContext): BookEdit {
  const kb = requireKnowledge(book);
  const event = kb.events.find(e => e.id === eventId);
  if (!event) throw new Error("Evento non trovato.");
  const before = eventContent(event), previous = structuredClone(event);
  const known = sceneIds(book);
  if (patch.sceneIds?.some(id => !known.has(id))) throw new Error("L'evento cita una scena inesistente.");
  if (patch.narration && !NARRATION_MODES.includes(patch.narration)) throw new Error("Modalità di racconto non valida.");
  if (patch.perspectives?.some(p => !STANCES.includes(p.stance))) throw new Error("Prospettiva non valida.");
  const next: KnowledgeEvent = { ...event, ...patch,
    ...(patch.title !== undefined ? { title: requireText(patch.title, "Titolo", 2, 160).trim() } : {}),
    ...(patch.summary !== undefined ? { summary: requireText(patch.summary, "Sintesi", 0, 800) } : {}),
    ...(patch.when !== undefined ? (patch.when.trim() ? { when: clean(patch.when).trim().slice(0, 80) } : {}) : {}) };
  if (patch.when !== undefined && !patch.when.trim()) delete next.when;
  if (eventContent(next) === before) throw new Error("Nessuna modifica da salvare.");
  if (kb.events.some(e => e.id !== eventId && e.title.toLocaleLowerCase("it") === next.title.toLocaleLowerCase("it")))
    throw new Error("Esiste già un evento con questo titolo.");
  const { id: _i, version: _v, origin: _o, updatedAt: _u, history: _h, ...snapshot } = previous;
  next.history = [...(event.history ?? []), { version: event.version, at: ctx.now, reason: (ctx.origin === "ai" ? "Modifica AI" : "Modifica dell'autore").slice(0, 300), snapshot }].slice(-LIMITS.history);
  next.version = event.version + 1; next.origin = "author"; next.updatedAt = ctx.now;
  kb.events[kb.events.indexOf(event)] = next;
  book.knowledge = parseKnowledge(kb); // refs and acyclic causes, fail closed
  const after = eventContent(next);
  return record(book, newEdit({ at: ctx.now, target: { kind: "event", id: eventId }, label: next.title, field: "evento", origin: ctx.origin,
    ...(ctx.prompt ? { prompt: ctx.prompt.slice(0, 4000) } : {}), ...(ctx.aiActivityId ? { aiActivityId: ctx.aiActivityId } : {}),
    before, after, changeKind: eventChangeKind(previous, next),
    related: [...next.sceneIds, ...next.involves, ...kb.events.filter(e => e.causes.includes(eventId)).map(e => e.id)], stampAfter: contentStamp(after) }));
}
export function addEvent(book: BookProject, input: { title: string; summary: string; timelineId?: string }, ctx: EditContext): BookEdit {
  const kb = requireKnowledge(book);
  if (kb.events.length >= LIMITS.events) throw new Error(`Massimo ${LIMITS.events} eventi.`);
  const title = requireText(input.title, "Titolo", 2, 160).trim();
  if (kb.events.some(e => e.title.toLocaleLowerCase("it") === title.toLocaleLowerCase("it"))) throw new Error("Esiste già un evento con questo titolo.");
  const taken = new Set([...kb.entities, ...kb.events, ...kb.timelines].map(x => x.id));
  let id = "event:" + slug(title), n = 2;
  while (taken.has(id)) id = "event:" + slug(title) + "-" + n++;
  const event: KnowledgeEvent = { id, title, summary: requireText(input.summary, "Sintesi", 0, 800), storyOrder: Math.max(0, ...kb.events.map(e => e.storyOrder)) + 1,
    narration: "scene", involves: [], causes: [], sceneIds: [], secret: false, perspectives: [],
    timelineIds: input.timelineId ? [input.timelineId] : [], version: 1, origin: "author", updatedAt: ctx.now };
  kb.events.push(event);
  book.knowledge = parseKnowledge(kb);
  const after = eventContent(event);
  return record(book, newEdit({ at: ctx.now, target: { kind: "event", id }, label: title, field: "creato", origin: ctx.origin,
    before: null, after, changeKind: "structural", related: [], stampAfter: contentStamp(after) }));
}
export function deleteEvent(book: BookProject, eventId: string, ctx: EditContext): BookEdit {
  const kb = requireKnowledge(book);
  const event = kb.events.find(e => e.id === eventId);
  if (!event) throw new Error("Evento non trovato.");
  const dependents = kb.events.filter(e => e.causes.includes(eventId)).map(e => e.id);
  kb.events = kb.events.filter(e => e.id !== eventId);
  for (const other of kb.events) other.causes = other.causes.filter(id => id !== eventId);
  book.knowledge = parseKnowledge(kb);
  return record(book, newEdit({ at: ctx.now, target: { kind: "event", id: eventId }, label: event.title, field: "eliminato", origin: ctx.origin,
    before: JSON.stringify({ event }), after: null, changeKind: "structural", related: [...dependents, ...event.sceneIds], stampAfter: "deleted" }));
}
/** Move an event one step earlier or later in the STORY chronology (not the narration). */
export function moveEvent(book: BookProject, eventId: string, direction: -1 | 1, ctx: EditContext, timelineId?: string): BookEdit {
  const kb = requireKnowledge(book);
  const ordered = kb.events.filter(e => !timelineId || e.timelineIds.includes(timelineId))
    .sort((a, b) => a.storyOrder - b.storyOrder || a.title.localeCompare(b.title));
  const index = ordered.findIndex(e => e.id === eventId);
  const other = ordered[index + direction];
  if (index < 0 || !other) throw new Error(direction < 0 ? "L'evento è già il primo." : "L'evento è già l'ultimo.");
  const self = ordered[index]!;
  const [a, b] = [self.storyOrder, other.storyOrder];
  // Equal orders are separated so the swap is visible and stable.
  const nextSelf = a === b ? b + direction * 0.5 : b;
  return editEvent(book, eventId, { storyOrder: nextSelf }, ctx) && editEvent(book, other.id, { storyOrder: a }, ctx);
}

export type TimelinePatch = Partial<Pick<KnowledgeTimeline, "title" | "kind" | "summary">>;
export function editTimeline(book: BookProject, timelineId: string | undefined, patch: TimelinePatch, ctx: EditContext): BookEdit {
  const kb = requireKnowledge(book);
  const existing = timelineId ? kb.timelines.find(t => t.id === timelineId) : undefined;
  if (timelineId && !existing) throw new Error("Timeline non trovata.");
  if (!existing && kb.timelines.length >= LIMITS.timelines) throw new Error(`Massimo ${LIMITS.timelines} timeline.`);
  const before = existing ? JSON.stringify(existing) : null;
  const title = requireText(patch.title ?? existing?.title ?? "", "Titolo", 2, 120).trim();
  if (kb.timelines.some(t => t.id !== timelineId && t.title.toLocaleLowerCase("it") === title.toLocaleLowerCase("it"))) throw new Error("Esiste già una timeline con questo titolo.");
  let id = existing?.id;
  if (!id) {
    const taken = new Set([...kb.entities, ...kb.events, ...kb.timelines].map(x => x.id));
    id = "timeline:" + slug(title); let n = 2;
    while (taken.has(id)) id = "timeline:" + slug(title) + "-" + n++;
  }
  const next: KnowledgeTimeline = { id, title, kind: patch.kind ?? existing?.kind ?? "arc", summary: requireText(patch.summary ?? existing?.summary ?? "", "Descrizione", 0, 600) };
  if (existing && JSON.stringify(next) === before) throw new Error("Nessuna modifica da salvare.");
  kb.timelines = existing ? kb.timelines.map(t => t.id === id ? next : t) : [...kb.timelines, next];
  book.knowledge = parseKnowledge(kb);
  const after = JSON.stringify(next);
  return record(book, newEdit({ at: ctx.now, target: { kind: "timeline", id }, label: title, field: existing ? "timeline" : "creata", origin: ctx.origin,
    before, after, changeKind: existing ? "descriptive" : "structural", related: kb.events.filter(e => e.timelineIds.includes(id!)).map(e => e.id), stampAfter: contentStamp(after) }));
}
export function deleteTimeline(book: BookProject, timelineId: string, ctx: EditContext): BookEdit {
  const kb = requireKnowledge(book);
  const timeline = kb.timelines.find(t => t.id === timelineId);
  if (!timeline) throw new Error("Timeline non trovata.");
  const events = kb.events.filter(e => e.timelineIds.includes(timelineId)).map(e => e.id);
  kb.timelines = kb.timelines.filter(t => t.id !== timelineId);
  for (const event of kb.events) event.timelineIds = event.timelineIds.filter(id => id !== timelineId);
  book.knowledge = parseKnowledge(kb);
  return record(book, newEdit({ at: ctx.now, target: { kind: "timeline", id: timelineId }, label: timeline.title, field: "eliminata", origin: ctx.origin,
    before: JSON.stringify(timeline), after: null, changeKind: "structural", related: events, stampAfter: "deleted" }));
}

/* --------------------------------- restore --------------------------------- */

/** Bring an element back to how it was before one edit. Recorded as a new edit:
 * history is never rewritten. Reorderings are undone with the order controls. */
export function restoreBefore(book: BookProject, editId: string, ctx: EditContext): BookEdit {
  const edit = book.edits?.find(e => e.id === editId);
  if (!edit) throw new Error("Modifica non trovata.");
  if (edit.pruned || edit.before === null && edit.field !== "creata" && edit.field !== "creato")
    throw new Error("La versione precedente non è più conservata.");
  const restoreCtx: EditContext = { ...ctx, prompt: "Ripristino della versione precedente a: " + edit.label };
  const target: EditTarget = edit.target;
  switch (target.kind) {
    case "scene": {
      if (edit.before === null) throw new Error("Questa scena non aveva una versione precedente.");
      const before = JSON.parse(edit.before) as { title: string; objective: string; text: string; summary: string };
      return editScene(book, target.id, { title: before.title, objective: before.objective, text: before.text, ...(before.summary ? { summary: before.summary } : {}) }, restoreCtx);
    }
    case "chapter": {
      const before = JSON.parse(edit.before!) as { title: string; purpose: string; summary: string };
      return editChapter(book, target.id, { title: before.title, purpose: before.purpose, ...(before.summary ? { summary: before.summary } : {}) }, restoreCtx);
    }
    case "entity": {
      if (edit.field === "creata") return deleteEntity(book, target.id, restoreCtx);
      if (edit.field === "eliminata") {
        const kb = requireKnowledge(book);
        const saved = JSON.parse(edit.before!) as { entity: KnowledgeEntity; memory: string | null };
        if (kb.entities.some(e => e.id === saved.entity.id) || findEntity(kb, saved.entity.type, saved.entity.name))
          throw new Error("Esiste già una scheda con questo identificativo o nome.");
        const entity = { ...saved.entity, relationships: saved.entity.relationships.filter(r => kb.entities.some(e => e.id === r.targetId)),
          version: saved.entity.version + 1, updatedAt: ctx.now };
        kb.entities.push(entity);
        book.knowledge = parseKnowledge(kb);
        if (saved.memory !== null && !Object.hasOwn(book.memory[MEMORY_FOLDER[entity.type]], entity.name)) book.memory[MEMORY_FOLDER[entity.type]][entity.name] = saved.memory;
        const after = entityContent(entity);
        return record(book, newEdit({ at: ctx.now, target, label: entity.name, field: "ripristinata", origin: ctx.origin, prompt: restoreCtx.prompt,
          before: null, after, changeKind: "structural", related: [], stampAfter: contentStamp(after) }));
      }
      const before = JSON.parse(edit.before!) as KnowledgeEntity;
      const kb = requireKnowledge(book);
      return editEntity(book, target.id, { name: before.name, aliases: before.aliases, importance: before.importance, summary: before.summary,
        attributes: before.attributes, relationships: before.relationships.filter(r => kb.entities.some(e => e.id === r.targetId)), status: before.status }, restoreCtx);
    }
    case "event": {
      if (edit.field === "creato") return deleteEvent(book, target.id, restoreCtx);
      const kb = requireKnowledge(book);
      if (edit.field === "eliminato") {
        const saved = (JSON.parse(edit.before!) as { event: KnowledgeEvent }).event;
        if (kb.events.some(e => e.id === saved.id || e.title === saved.title)) throw new Error("Esiste già un evento con questo identificativo o titolo.");
        const known = sceneIds(book), entities = new Set(kb.entities.map(e => e.id)), events = new Set(kb.events.map(e => e.id)), timelines = new Set(kb.timelines.map(t => t.id));
        const event = { ...saved, sceneIds: saved.sceneIds.filter(id => known.has(id)), involves: saved.involves.filter(id => entities.has(id)),
          perspectives: saved.perspectives.filter(p => entities.has(p.entityId)), causes: saved.causes.filter(id => events.has(id)),
          timelineIds: saved.timelineIds.filter(id => timelines.has(id)), version: saved.version + 1, updatedAt: ctx.now };
        kb.events.push(event);
        book.knowledge = parseKnowledge(kb);
        const after = eventContent(event);
        return record(book, newEdit({ at: ctx.now, target, label: event.title, field: "ripristinato", origin: ctx.origin, prompt: restoreCtx.prompt,
          before: null, after, changeKind: "structural", related: event.sceneIds, stampAfter: contentStamp(after) }));
      }
      const before = JSON.parse(edit.before!) as KnowledgeEvent;
      const entities = new Set(kb.entities.map(e => e.id)), events = new Set(kb.events.map(e => e.id)), known = sceneIds(book), timelines = new Set(kb.timelines.map(t => t.id));
      return editEvent(book, target.id, { title: before.title, summary: before.summary, when: before.when ?? "", storyOrder: before.storyOrder, narration: before.narration,
        secret: before.secret, involves: before.involves.filter(id => entities.has(id)), causes: before.causes.filter(id => events.has(id)),
        sceneIds: before.sceneIds.filter(id => known.has(id)), timelineIds: before.timelineIds.filter(id => timelines.has(id)),
        perspectives: before.perspectives.filter(p => entities.has(p.entityId)) }, restoreCtx);
    }
    case "timeline": {
      if (edit.field === "creata") return deleteTimeline(book, target.id, restoreCtx);
      const before = JSON.parse(edit.before!) as KnowledgeTimeline;
      if (edit.field === "eliminata") return editTimeline(book, undefined, before, restoreCtx);
      return editTimeline(book, target.id, before, restoreCtx);
    }
    case "structure": {
      if (edit.field === "deleteScene") {
        const saved = JSON.parse(edit.before!) as { chapterId: string; index: number; scene: Scene };
        const chapter = book.chapters.find(c => c.id === saved.chapterId);
        if (!chapter) throw new Error("Il capitolo della scena non esiste più.");
        if (sceneIds(book).has(saved.scene.id)) throw new Error("La scena esiste già.");
        const before = structureContent(book);
        chapter.scenes.splice(Math.min(saved.index, chapter.scenes.length), 0, saved.scene);
        renumber(book);
        const after = structureContent(book);
        const restored = newEdit({ at: ctx.now, target, label: `Scena ripristinata «${saved.scene.title}»`, field: "restoreScene", origin: ctx.origin, prompt: restoreCtx.prompt,
          before, after, changeKind: "structural", related: [saved.scene.id, chapter.id], stampAfter: contentStamp(after) });
        touchChapter(book, chapter, restored.id, true, ctx.now);
        return record(book, restored);
      }
      if (edit.field === "deleteChapter") {
        const saved = (JSON.parse(edit.before!) as { chapter: Chapter }).chapter;
        if (book.chapters.some(c => c.id === saved.id)) throw new Error("Il capitolo esiste già.");
        const taken = sceneIds(book);
        if (saved.scenes.some(s => taken.has(s.id))) throw new Error("Alcune scene del capitolo esistono già.");
        const before = structureContent(book);
        const ordered = sortedChapters(book);
        ordered.splice(Math.min(saved.number - 1, ordered.length), 0, saved);
        book.chapters = ordered; renumber(book);
        const after = structureContent(book);
        const restored = newEdit({ at: ctx.now, target, label: `Capitolo ripristinato «${saved.title}»`, field: "restoreChapter", origin: ctx.origin, prompt: restoreCtx.prompt,
          before, after, changeKind: "structural", related: [saved.id], stampAfter: contentStamp(after) });
        touchChapter(book, saved, restored.id, true, ctx.now);
        return record(book, restored);
      }
      throw new Error("Per annullare un riordino usa le frecce di spostamento: la cronologia resta registrata.");
    }
    default: throw new Error("Questo elemento non si ripristina da qui.");
  }
}
