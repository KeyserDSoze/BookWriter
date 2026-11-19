import type { BookProject, Chapter, Scene } from "./types";
import { parseMemoryId } from "./book-edits";
import { MEMORY_FOLDER, type KnowledgeBase, type KnowledgeEntity, type KnowledgeEvent } from "./knowledge";

/** Derived index, rebuilt from the book on demand (never stored, never stale).
 * Lexical and structural: a mention is a pointer for review, not a proof of meaning. */
export interface SceneRef { chapterId: string; chapterNumber: number; sceneId: string; sceneNumber: number; via: "metadata" | "text" | "event" }
export type NarrativeState = "planned" | "narrated" | "consolidated";

const fold = (value: string) => value.normalize("NFC").toLocaleLowerCase("it");
function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
const patterns = new Map<string, RegExp>();
function wholeWord(name: string): RegExp {
  let pattern = patterns.get(name);
  if (!pattern) {
    pattern = new RegExp("(?<![\\p{L}\\p{N}\\p{M}_])" + escape(fold(name)).replace(/\s+/g, "\\s+") + "(?![\\p{L}\\p{N}\\p{M}_])", "u");
    if (patterns.size > 2000) patterns.clear();
    patterns.set(name, pattern);
  }
  return pattern;
}
function flatScenes(book: BookProject): Array<{ chapter: Chapter; scene: Scene; position: number }> {
  let position = 0;
  return [...book.chapters].sort((a, b) => a.number - b.number)
    .flatMap(chapter => [...chapter.scenes].sort((a, b) => a.number - b.number).map(scene => ({ chapter, scene, position: position++ })));
}
const written = (scene: Scene) => scene.status !== "planned" && !!scene.text.trim();

/** Scenes where an entity appears: declared metadata, name/alias as a whole word, or an event it takes part in. */
export function entityReferences(book: BookProject, kb: KnowledgeBase, entity: KnowledgeEntity): SceneRef[] {
  const names = [entity.name, ...entity.aliases].filter(n => n.trim().length >= 2);
  const folder = MEMORY_FOLDER[entity.type];
  const eventScenes = new Set(kb.events.filter(e => e.involves.includes(entity.id)).flatMap(e => e.sceneIds));
  const refs: SceneRef[] = [];
  for (const { chapter, scene } of flatScenes(book)) {
    const declared = (folder === "characters" ? [...(scene.characters ?? []), ...(scene.viewpoint ? [scene.viewpoint] : [])] : scene[folder] ?? []);
    const base = { chapterId: chapter.id, chapterNumber: chapter.number, sceneId: scene.id, sceneNumber: scene.number };
    if (declared.some(value => value === entity.id || names.some(n => fold(n) === fold(value)))) refs.push({ ...base, via: "metadata" });
    else if (written(scene) && names.some(n => wholeWord(n).test(fold(scene.text)))) refs.push({ ...base, via: "text" });
    else if (eventScenes.has(scene.id)) refs.push({ ...base, via: "event" });
  }
  return refs;
}
export function entityState(book: BookProject, refs: readonly SceneRef[]): NarrativeState {
  const chapters = new Map(book.chapters.map(c => [c.id, c]));
  const scenes = new Map(book.chapters.flatMap(c => c.scenes.map(s => [s.id, s] as const)));
  const narrated = refs.filter(r => { const s = scenes.get(r.sceneId); return !!s && written(s) && r.via !== "event"; });
  if (!narrated.length) return "planned";
  return narrated.some(r => chapters.get(r.chapterId)?.frozenAt) ? "consolidated" : "narrated";
}
export function eventState(book: BookProject, event: KnowledgeEvent): NarrativeState {
  const located = flatScenes(book).filter(x => event.sceneIds.includes(x.scene.id) && written(x.scene));
  if (!located.length) return "planned";
  return located.every(x => x.chapter.frozenAt) ? "consolidated" : "narrated";
}
export const STATE_LABELS: Record<NarrativeState, string> = { planned: "Pianificato", narrated: "Scritto", consolidated: "Consolidato" };

/** Events that (transitively) depend on the given one, nearest first. */
export function dependentEvents(kb: KnowledgeBase, eventId: string): KnowledgeEvent[] {
  const result: KnowledgeEvent[] = [];
  const seen = new Set([eventId]);
  let frontier = [eventId];
  while (frontier.length && result.length < 200) {
    const next: string[] = [];
    for (const event of kb.events) if (!seen.has(event.id) && event.causes.some(id => frontier.includes(id))) {
      seen.add(event.id); result.push(event); next.push(event.id);
    }
    frontier = next;
  }
  return result;
}

export interface ImpactAnalysis {
  /** Written scenes that cite or use the target. */
  direct: string[];
  /** Written scenes depending on events or consequences of the target. */
  indirect: string[];
  /** The change may alter the structure of the whole book. */
  global: boolean;
  reasons: string[];
}
/** Deterministic candidates; the AI analysis may add or drop scenes with reasons. */
export function analyzeImpact(book: BookProject, kb: KnowledgeBase, target: { kind: "entity" | "event" | "chapter" | "timeline" | "memory"; id: string }): ImpactAnalysis {
  const order = new Map(flatScenes(book).map(x => [x.scene.id, x.position]));
  const writtenIds = new Set(flatScenes(book).filter(x => written(x.scene)).map(x => x.scene.id));
  const direct = new Set<string>(), indirect = new Set<string>(), reasons: string[] = [];
  let events: KnowledgeEvent[] = [];
  if (target.kind === "entity") {
    const entity = kb.entities.find(e => e.id === target.id);
    if (!entity) throw new Error("Scheda non trovata.");
    for (const ref of entityReferences(book, kb, entity)) if (writtenIds.has(ref.sceneId) && ref.via !== "event") direct.add(ref.sceneId);
    events = kb.events.filter(e => e.involves.includes(entity.id) || e.perspectives.some(p => p.entityId === entity.id));
    if (direct.size) reasons.push(direct.size + " scene scritte nominano «" + entity.name + "».");
  } else if (target.kind === "chapter") {
    const chapter = book.chapters.find(c => c.id === target.id);
    if (!chapter) throw new Error("Capitolo non trovato.");
    for (const scene of chapter.scenes) if (writtenIds.has(scene.id)) direct.add(scene.id);
    events = kb.events.filter(e => e.sceneIds.some(id => chapter.scenes.some(s => s.id === id)));
    if (direct.size) reasons.push("Il capitolo ha " + direct.size + " scene scritte.");
  } else if (target.kind === "timeline") {
    const timeline = kb.timelines.find(t => t.id === target.id);
    if (!timeline) throw new Error("Timeline non trovata.");
    events = timelineEvents(kb, timeline.id);
    for (const event of events) for (const id of event.sceneIds) if (writtenIds.has(id)) direct.add(id);
    if (direct.size) reasons.push("Gli eventi della timeline sono raccontati in " + direct.size + " scene.");
  } else if (target.kind === "memory") {
    const parsed = parseMemoryId(target.id);
    if (!parsed) throw new Error("Parte della memoria non trovata.");
    if (parsed.part === "entry") {
      const pattern = wholeWord(parsed.name);
      for (const { scene } of flatScenes(book)) if (written(scene) && pattern.test(fold(scene.text))) direct.add(scene.id);
      if (direct.size) reasons.push(direct.size + " scene scritte nominano «" + parsed.name + "».");
    } else reasons.push("La memoria guida tutta la scrittura successiva: l'analisi indica quali scene già scritte vanno riallineate.");
  } else {
    const event = kb.events.find(e => e.id === target.id);
    if (!event) throw new Error("Evento non trovato.");
    events = [event];
    for (const id of event.sceneIds) if (writtenIds.has(id)) direct.add(id);
    if (direct.size) reasons.push("L'evento è raccontato in " + direct.size + " scene.");
  }
  const dependents = events.flatMap(e => dependentEvents(kb, e.id));
  for (const event of [...events, ...dependents]) for (const id of event.sceneIds)
    if (writtenIds.has(id) && !direct.has(id)) indirect.add(id);
  if (dependents.length) reasons.push(dependents.length + " eventi successivi dipendono da quelli coinvolti.");
  const total = writtenIds.size || 1;
  const entity = target.kind === "entity" ? kb.entities.find(e => e.id === target.id) : undefined;
  const global = (direct.size + indirect.size) / total >= 0.4 || (entity?.importance === "main" && direct.size >= 3) || dependents.length >= 8;
  if (global) reasons.push("Modifica potenzialmente globale: coinvolge gran parte del libro o un elemento principale.");
  const sorted = (ids: Set<string>) => [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return { direct: sorted(direct), indirect: sorted(indirect), global, reasons };
}

/** Events of one timeline: tagged with it, or involving a sheet the timeline follows. */
export function timelineEvents(kb: KnowledgeBase, timelineId?: string): KnowledgeEvent[] {
  if (!timelineId) return kb.events;
  const subjects = new Set(kb.timelines.find(t => t.id === timelineId)?.subjectIds ?? []);
  return kb.events.filter(e => e.timelineIds.includes(timelineId) || e.involves.some(id => subjects.has(id)));
}
/** Story chronology and narration order can differ (flashbacks, backstory). */
export function timelineOrders(book: BookProject, kb: KnowledgeBase, timelineId?: string): { story: KnowledgeEvent[]; narration: KnowledgeEvent[] } {
  const events = timelineEvents(kb, timelineId);
  const position = new Map(flatScenes(book).map(x => [x.scene.id, x.position]));
  const firstPosition = (event: KnowledgeEvent) => Math.min(...event.sceneIds.map(id => position.get(id) ?? Infinity),
    event.plannedChapter !== undefined ? 1e6 + event.plannedChapter : Infinity);
  const story = [...events].sort((a, b) => a.storyOrder - b.storyOrder || a.title.localeCompare(b.title));
  const narration = [...events].sort((a, b) => firstPosition(a) - firstPosition(b) || a.storyOrder - b.storyOrder);
  return { story, narration };
}

/** Sheets and events relevant to a piece of text: whole-word mentions or declared links. */
export function relevantKnowledge(book: BookProject, kb: KnowledgeBase, text: string, sceneId?: string, chapterNumber?: number):
  { entities: KnowledgeEntity[]; events: KnowledgeEvent[] } {
  const folded = fold(text);
  const scene = sceneId ? book.chapters.flatMap(c => c.scenes).find(s => s.id === sceneId) : undefined;
  const declared = new Set([...(scene?.characters ?? []), ...(scene?.locations ?? []), ...(scene?.items ?? []), ...(scene?.factions ?? []),
    ...(scene?.viewpoint ? [scene.viewpoint] : [])].map(fold));
  const events = kb.events.filter(e => (sceneId && e.sceneIds.includes(sceneId)) ||
    (chapterNumber !== undefined && e.plannedChapter === chapterNumber && !e.sceneIds.length));
  const involved = new Set(events.flatMap(e => e.involves));
  const entities = kb.entities.filter(e => involved.has(e.id) || declared.has(fold(e.name)) || declared.has(e.id) ||
    [e.name, ...e.aliases].some(n => n.trim().length >= 2 && wholeWord(n).test(folded)));
  const rank = { main: 0, secondary: 1, minor: 2 } as const;
  return { entities: entities.sort((a, b) => rank[a.importance] - rank[b.importance]).slice(0, 14), events: events.slice(0, 12) };
}
