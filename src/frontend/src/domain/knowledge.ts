import { z } from "zod";

/** Structured, persistent memory of the book: stable IDs, relations by ID,
 * story order distinct from narration order. It complements — never replaces —
 * the canon prose and the narrative memory; an AI sheet is not a verified fact. */
export const ENTITY_TYPES = ["character", "location", "item", "faction"] as const;
export type EntityType = typeof ENTITY_TYPES[number];
export const ENTITY_LABELS: Record<EntityType, { one: string; many: string }> = {
  character: { one: "Personaggio", many: "Personaggi" }, location: { one: "Luogo", many: "Luoghi" },
  item: { one: "Oggetto", many: "Oggetti" }, faction: { one: "Fazione", many: "Fazioni" },
};
export const MEMORY_FOLDER: Record<EntityType, "characters" | "locations" | "items" | "factions"> = {
  character: "characters", location: "locations", item: "items", faction: "factions",
};
/** Suggested fields per type: concise, filled only when they matter to the story. */
export const ATTRIBUTE_FIELDS: Record<EntityType, ReadonlyArray<{ key: string; label: string }>> = {
  character: [
    { key: "role", label: "Funzione narrativa" }, { key: "personality", label: "Personalità e motivazione" },
    { key: "speech", label: "Modo di parlare" }, { key: "background", label: "Background e cultura" },
    { key: "arc", label: "Arco narrativo" }, { key: "appearance", label: "Aspetto (se conta)" },
  ],
  location: [
    { key: "role", label: "Funzione narrativa" }, { key: "atmosphere", label: "Atmosfera" },
    { key: "rules", label: "Regole e vincoli" }, { key: "geography", label: "Posizione e accessi" },
  ],
  item: [
    { key: "role", label: "Funzione narrativa" }, { key: "properties", label: "Proprietà" }, { key: "history", label: "Origine e storia" },
  ],
  faction: [
    { key: "role", label: "Funzione narrativa" }, { key: "goal", label: "Obiettivo" },
    { key: "structure", label: "Struttura e guida" }, { key: "methods", label: "Metodi" },
  ],
};
export const NARRATION_MODES = ["scene", "flashback", "foreshadowing", "offscreen", "backstory"] as const;
export const NARRATION_LABELS: Record<typeof NARRATION_MODES[number], string> = {
  scene: "In scena", flashback: "Flashback", foreshadowing: "Anticipazione", offscreen: "Fuori scena", backstory: "Antefatto",
};
export const STANCES = ["knows", "unaware", "believes_false", "conceals"] as const;
export const STANCE_LABELS: Record<typeof STANCES[number], string> = {
  knows: "Sa", unaware: "Non sa", believes_false: "Crede il falso", conceals: "Sa e nasconde",
};
export const LIMITS = { entities: 300, events: 400, timelines: 40, history: 8, relationships: 24, attributes: 12 } as const;

export const ENTITY_ID = /^(character|location|item|faction):[a-z0-9][a-z0-9-]{0,79}$/;
const EVENT_ID = /^event:[a-z0-9][a-z0-9-]{0,79}$/;
const TIMELINE_ID = /^timeline:[a-z0-9][a-z0-9-]{0,79}$/;
const text = (max: number) => z.string().max(max);
const name = z.string().min(1).max(120).refine(value => !!value.trim() && !["__proto__", "constructor", "prototype"].includes(value));
const origin = z.enum(["planned", "written", "author", "imported"]);
const iso = z.string().max(40).refine(value => Number.isFinite(Date.parse(value)));
const attributes = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), text(900))
  .refine(value => Object.keys(value).length <= LIMITS.attributes);
const relationship = z.object({ targetId: z.string().regex(ENTITY_ID), type: z.string().min(2).max(40), note: text(240).optional() }).strict();
const entitySnapshot = z.object({
  name, aliases: z.array(name).max(8), importance: z.enum(["main", "secondary", "minor"]), summary: text(600),
  attributes, relationships: z.array(relationship).max(LIMITS.relationships),
}).strict();
export const knowledgeEntitySchema = entitySnapshot.extend({
  id: z.string().regex(ENTITY_ID), type: z.enum(ENTITY_TYPES),
  version: z.number().int().min(1).max(100_000), status: z.enum(["draft", "validated"]), origin, updatedAt: iso,
  history: z.array(z.object({ version: z.number().int().min(1), at: iso, reason: text(300), snapshot: entitySnapshot }).strict()).max(LIMITS.history).optional(),
}).strict();
const perspective = z.object({ entityId: z.string().regex(ENTITY_ID), stance: z.enum(STANCES), note: text(200).optional() }).strict();
const eventSnapshot = z.object({
  title: z.string().min(2).max(160), summary: text(800), storyOrder: z.number().finite().min(0).max(100_000),
  when: text(80).optional(), narration: z.enum(NARRATION_MODES),
  involves: z.array(z.string().regex(ENTITY_ID)).max(20), causes: z.array(z.string().regex(EVENT_ID)).max(12),
  sceneIds: z.array(z.string().min(1).max(200)).max(20), plannedChapter: z.number().int().min(1).max(200).optional(),
  secret: z.boolean(), perspectives: z.array(perspective).max(12), timelineIds: z.array(z.string().regex(TIMELINE_ID)).max(6),
}).strict();
export const knowledgeEventSchema = eventSnapshot.extend({
  id: z.string().regex(EVENT_ID), version: z.number().int().min(1).max(100_000), origin, updatedAt: iso,
  history: z.array(z.object({ version: z.number().int().min(1), at: iso, reason: text(300), snapshot: eventSnapshot }).strict()).max(LIMITS.history).optional(),
}).strict();
export const knowledgeTimelineSchema = z.object({
  id: z.string().regex(TIMELINE_ID), title: z.string().min(2).max(120), kind: z.enum(["global", "arc", "event"]), summary: text(600),
  /** Who the timeline follows (a character's arc, a faction): sheet IDs. */
  subjectIds: z.array(z.string().regex(ENTITY_ID)).max(12).optional(),
}).strict();
export const knowledgeBaseSchema = z.object({
  schemaVersion: z.literal(1),
  entities: z.array(knowledgeEntitySchema).max(LIMITS.entities),
  events: z.array(knowledgeEventSchema).max(LIMITS.events),
  timelines: z.array(knowledgeTimelineSchema).max(LIMITS.timelines),
  /** The autopilot still has to generate the sheets (new plan or explicit author request). */
  pending: z.boolean().optional(),
  generatedAt: iso.optional(),
}).strict().superRefine((kb, ctx) => {
  const problem = knowledgeIntegrityProblem(kb);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});
export type KnowledgeEntity = z.infer<typeof knowledgeEntitySchema>;
export type KnowledgeEvent = z.infer<typeof knowledgeEventSchema>;
export type KnowledgeTimeline = z.infer<typeof knowledgeTimelineSchema>;
export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;
export type EntitySnapshot = z.infer<typeof entitySnapshot>;

const fold = (value: string) => value.normalize("NFC").trim().toLocaleLowerCase("it");
export function slug(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "voce";
}
/** Graph and reference integrity: IDs unique, relations resolvable, causes acyclic. */
export function knowledgeIntegrityProblem(kb: Pick<KnowledgeBase, "entities" | "events" | "timelines">): string | undefined {
  const ids = [...kb.entities, ...kb.events, ...kb.timelines].map(x => x.id);
  if (new Set(ids).size !== ids.length) return "Identificativi duplicati nella knowledge base.";
  const entities = new Set(kb.entities.map(e => e.id)), events = new Set(kb.events.map(e => e.id)), timelines = new Set(kb.timelines.map(t => t.id));
  for (const type of ENTITY_TYPES) {
    const names = kb.entities.filter(e => e.type === type).flatMap(e => [e.name, ...e.aliases].map(fold));
    if (new Set(names).size !== names.length) return "Due schede dello stesso tipo hanno lo stesso nome o alias.";
  }
  for (const entity of kb.entities) {
    if (!entity.id.startsWith(entity.type + ":")) return "Tipo e identificativo della scheda non coincidono.";
    if (entity.relationships.some(r => !entities.has(r.targetId) || r.targetId === entity.id)) return "Relazione verso una scheda inesistente.";
  }
  for (const event of kb.events) {
    if (event.involves.some(id => !entities.has(id)) || event.perspectives.some(p => !entities.has(p.entityId)))
      return "Evento collegato a una scheda inesistente.";
    if (event.causes.some(id => !events.has(id) || id === event.id)) return "Evento con una causa inesistente.";
    if (event.timelineIds.some(id => !timelines.has(id))) return "Evento collegato a una timeline inesistente.";
  }
  for (const timeline of kb.timelines)
    if (timeline.subjectIds?.some(id => !entities.has(id)) || new Set(timeline.subjectIds ?? []).size !== (timeline.subjectIds ?? []).length)
      return "Timeline collegata a una scheda inesistente o ripetuta.";
  // Causal dependencies must form a DAG: a cycle would make impact analysis loop.
  const causes = new Map(kb.events.map(e => [e.id, e.causes]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    for (const next of causes.get(id) ?? []) if (visit(next)) return true;
    state.set(id, 2);
    return false;
  };
  for (const id of causes.keys()) if (visit(id)) return "Le cause degli eventi formano un ciclo.";
  return undefined;
}
export function emptyKnowledge(pending = false): KnowledgeBase {
  return { schemaVersion: 1, entities: [], events: [], timelines: [], ...(pending ? { pending: true } : {}) };
}
export function parseKnowledge(value: unknown): KnowledgeBase {
  const parsed = knowledgeBaseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Knowledge base non valida: " + (parsed.error.issues[0]?.message ?? "schema"));
  return parsed.data;
}

export function findEntity(kb: KnowledgeBase, type: EntityType | undefined, nameOrId: string): KnowledgeEntity | undefined {
  const wanted = fold(nameOrId);
  return kb.entities.find(e => e.id === nameOrId) ??
    kb.entities.find(e => (!type || e.type === type) && [e.name, ...e.aliases].some(n => fold(n) === wanted));
}
function uniqueId(prefix: string, label: string, taken: Set<string>): string {
  const base = prefix + ":" + slug(label);
  let id = base, n = 2;
  while (taken.has(id)) id = base + "-" + n++;
  taken.add(id);
  return id;
}

/** What the model returns: references by NAME (or existing ID), never invented IDs. */
const replyEntity = z.object({
  type: z.enum(ENTITY_TYPES), name: z.string().min(1).max(120), aliases: z.array(z.string().min(1).max(120)).max(8).optional(),
  importance: z.enum(["main", "secondary", "minor"]).optional(), summary: z.string().max(600).optional(),
  attributes: z.record(z.string(), z.string().max(900)).optional(),
  relationships: z.array(z.object({ target: z.string().min(1).max(120), type: z.string().min(2).max(40), note: z.string().max(240).optional() })).max(LIMITS.relationships).optional(),
});
const replyEvent = z.object({
  title: z.string().min(2).max(160), summary: z.string().max(800).optional(), storyOrder: z.number().finite().min(0).max(100_000).optional(),
  when: z.string().max(80).optional(), narration: z.enum(NARRATION_MODES).optional(),
  involves: z.array(z.string().min(1).max(120)).max(20).optional(), causes: z.array(z.string().min(1).max(160)).max(12).optional(),
  chapter: z.number().int().min(1).max(200).optional(), sceneIds: z.array(z.string().min(1).max(200)).max(20).optional(),
  secret: z.boolean().optional(), timelines: z.array(z.string().min(2).max(120)).max(6).optional(),
  perspectives: z.array(z.object({ who: z.string().min(1).max(120), stance: z.enum(STANCES), note: z.string().max(200).optional() })).max(12).optional(),
});
export const knowledgeReplySchema = z.object({
  entities: z.array(replyEntity).max(80).optional(),
  events: z.array(replyEvent).max(120).optional(),
  timelines: z.array(z.object({ title: z.string().min(2).max(120), kind: z.enum(["global", "arc", "event"]).optional(), summary: z.string().max(600).optional(),
    subjects: z.array(z.string().min(1).max(120)).max(12).optional() })).max(20).optional(),
});
export type KnowledgeReply = z.infer<typeof knowledgeReplySchema>;

function snapshotOf(entity: KnowledgeEntity): EntitySnapshot {
  // A deep copy: later in-place edits (relations) must never rewrite a stored version.
  return structuredClone({ name: entity.name, aliases: entity.aliases, importance: entity.importance, summary: entity.summary,
    attributes: entity.attributes, relationships: entity.relationships });
}
function pushHistory<T extends { version: number; history?: Array<{ version: number; at: string; reason: string; snapshot: S }> }, S>(
  item: T, snapshot: S, at: string, reason: string): void {
  item.history = [...(item.history ?? []), { version: item.version, at, reason: reason.slice(0, 300), snapshot }].slice(-LIMITS.history);
  item.version++;
}

/** Merge an AI reply into the base. Unknown names fail closed with a readable
 * message (the corrective retry tells the model which name to fix). */
export function mergeKnowledgeReply(previous: KnowledgeBase, raw: unknown, options: {
  origin: KnowledgeEntity["origin"]; reason: string; now: string; sceneIds?: ReadonlySet<string>; defaultSceneId?: string;
}): KnowledgeBase {
  const reply = knowledgeReplySchema.parse(raw);
  const kb: KnowledgeBase = structuredClone(previous);
  const taken = new Set([...kb.entities, ...kb.events, ...kb.timelines].map(x => x.id));
  const timelineSubjects: Array<{ timeline: KnowledgeTimeline; subjects: string[] }> = [];
  for (const item of reply.timelines ?? []) {
    const existing = kb.timelines.find(t => fold(t.title) === fold(item.title));
    if (existing) { if (item.subjects?.length) timelineSubjects.push({ timeline: existing, subjects: item.subjects }); continue; }
    // One global chronology: a second "global" from the model becomes an arc.
    const kind = item.kind === "global" && kb.timelines.some(t => t.kind === "global") ? "arc" : item.kind ?? "arc";
    const timeline: KnowledgeTimeline = { id: uniqueId("timeline", item.title, taken), title: item.title.trim(), kind, summary: item.summary ?? "" };
    kb.timelines.push(timeline);
    if (item.subjects?.length) timelineSubjects.push({ timeline, subjects: item.subjects });
  }
  // Entities first (create or update), then relations once every name exists.
  const touched: Array<{ entity: KnowledgeEntity; reply: z.infer<typeof replyEntity>; before?: EntitySnapshot; versioned?: boolean }> = [];
  for (const item of reply.entities ?? []) {
    const existing = findEntity(kb, item.type, item.name);
    const cleanAttributes = Object.fromEntries(Object.entries(item.attributes ?? {})
      .filter(([key, value]) => /^[a-z][a-z0-9_]{0,39}$/.test(key) && value.trim()).slice(0, LIMITS.attributes));
    if (existing) {
      const before = snapshotOf(existing);
      const next = { ...existing, aliases: [...new Set([...existing.aliases, ...(item.aliases ?? [])])].slice(0, 8),
        importance: item.importance ?? existing.importance, summary: item.summary?.trim() || existing.summary,
        attributes: { ...existing.attributes, ...cleanAttributes } };
      const changed = JSON.stringify(snapshotOf(next as KnowledgeEntity)) !== JSON.stringify(before);
      if (changed) {
        pushHistory(existing, before, options.now, options.reason);
        Object.assign(existing, { aliases: next.aliases, importance: next.importance, summary: next.summary, attributes: next.attributes, updatedAt: options.now });
      }
      touched.push({ entity: existing, reply: item, before, versioned: changed });
    } else {
      if (kb.entities.length >= LIMITS.entities) throw new Error("Knowledge base piena: massimo " + LIMITS.entities + " schede.");
      const entity: KnowledgeEntity = { id: uniqueId(item.type, item.name, taken), type: item.type, name: item.name.trim(),
        aliases: [...new Set(item.aliases ?? [])].filter(a => fold(a) !== fold(item.name)).slice(0, 8),
        importance: item.importance ?? "secondary", summary: item.summary?.trim() ?? "", attributes: cleanAttributes,
        relationships: [], version: 1, status: "draft", origin: options.origin, updatedAt: options.now };
      kb.entities.push(entity);
      touched.push({ entity, reply: item });
    }
  }
  for (const { entity, reply: item, before, versioned } of touched) {
    const previousRelations = JSON.stringify(entity.relationships);
    for (const relation of item.relationships ?? []) {
      const target = findEntity(kb, undefined, relation.target);
      if (!target) throw new Error("Relazione verso «" + relation.target + "», che non è una scheda: aggiungila o usa un nome esistente.");
      if (target.id === entity.id) continue;
      const existing = entity.relationships.find(r => r.targetId === target.id);
      if (existing) { existing.type = relation.type; if (relation.note) existing.note = relation.note; }
      else if (entity.relationships.length < LIMITS.relationships)
        entity.relationships.push({ targetId: target.id, type: relation.type, ...(relation.note ? { note: relation.note } : {}) });
    }
    // A change of relations alone is still a new version of an existing sheet.
    if (before && !versioned && JSON.stringify(entity.relationships) !== previousRelations) {
      pushHistory(entity, before, options.now, options.reason);
      entity.updatedAt = options.now;
    }
  }
  const findEvent = (label: string) => kb.events.find(e => e.id === label || fold(e.title) === fold(label));
  const resolveEntity = (label: string) => {
    const found = findEntity(kb, undefined, label);
    if (!found) throw new Error("L'evento cita «" + label + "», che non è una scheda: aggiungila o usa un nome esistente.");
    return found.id;
  };
  for (const { timeline, subjects } of timelineSubjects) {
    const ids = subjects.map(label => {
      const found = findEntity(kb, undefined, label);
      if (!found) throw new Error("La timeline «" + timeline.title + "» segue «" + label + "», che non è una scheda: aggiungila o usa un nome esistente.");
      return found.id;
    });
    timeline.subjectIds = [...new Set([...(timeline.subjectIds ?? []), ...ids])].slice(0, 12);
  }
  const pendingCauses: Array<{ event: KnowledgeEvent; causes: string[]; before?: NonNullable<KnowledgeEvent["history"]>[number]["snapshot"]; versioned?: boolean }> = [];
  let order = Math.max(0, ...kb.events.map(e => e.storyOrder));
  for (const item of reply.events ?? []) {
    const sceneIds = [...new Set(item.sceneIds ?? (options.defaultSceneId ? [options.defaultSceneId] : []))];
    if (options.sceneIds && sceneIds.some(id => !options.sceneIds!.has(id)))
      throw new Error("L'evento «" + item.title + "» cita una scena inesistente: usa gli ID delle scene del piano.");
    const timelineIds = (item.timelines ?? []).map(label => {
      const found = kb.timelines.find(t => fold(t.title) === fold(label) || t.id === label);
      if (!found) throw new Error("Timeline «" + label + "» non dichiarata.");
      return found.id;
    });
    const fields = {
      ...(item.summary !== undefined ? { summary: item.summary.trim() } : {}),
      ...(item.storyOrder !== undefined ? { storyOrder: item.storyOrder } : {}),
      ...(item.when !== undefined ? { when: item.when } : {}),
      ...(item.narration ? { narration: item.narration } : {}),
      ...(item.involves ? { involves: [...new Set(item.involves.map(resolveEntity))] } : {}),
      ...(item.chapter !== undefined ? { plannedChapter: item.chapter } : {}),
      ...(item.secret !== undefined ? { secret: item.secret } : {}),
      ...(item.perspectives ? { perspectives: item.perspectives.map(p => ({ entityId: resolveEntity(p.who), stance: p.stance, ...(p.note ? { note: p.note } : {}) })) } : {}),
      ...(item.timelines ? { timelineIds: [...new Set(timelineIds)] } : {}),
    };
    const existing = findEvent(item.title);
    if (existing) {
      const { id: _id, version: _v, origin: _o, updatedAt: _u, history: _h, ...before } = existing;
      const merged = { ...existing, ...fields, sceneIds: [...new Set([...existing.sceneIds, ...sceneIds])].slice(0, 20) };
      const { id: _i2, version: _v2, origin: _o2, updatedAt: _u2, history: _h2, ...after } = merged;
      const changed = JSON.stringify(before) !== JSON.stringify(after);
      if (changed) {
        pushHistory(existing, before, options.now, options.reason);
        Object.assign(existing, after, { updatedAt: options.now });
      }
      pendingCauses.push({ event: existing, causes: item.causes ?? [], before, versioned: changed });
    } else {
      if (kb.events.length >= LIMITS.events) throw new Error("Knowledge base piena: massimo " + LIMITS.events + " eventi.");
      const event: KnowledgeEvent = { id: uniqueId("event", item.title, taken), title: item.title.trim(), summary: "",
        storyOrder: item.storyOrder ?? ++order, narration: "scene", involves: [], causes: [], sceneIds,
        secret: false, perspectives: [], timelineIds: [], version: 1, origin: options.origin, updatedAt: options.now, ...fields };
      kb.events.push(event);
      pendingCauses.push({ event, causes: item.causes ?? [] });
    }
  }
  for (const { event, causes, before, versioned } of pendingCauses) {
    const ids = causes.map(label => {
      const found = findEvent(label);
      if (!found) throw new Error("Causa «" + label + "» non trovata fra gli eventi.");
      return found.id;
    }).filter(id => id !== event.id);
    const next = [...new Set([...event.causes, ...ids])].slice(0, 12);
    if (JSON.stringify(next) === JSON.stringify(event.causes)) continue;
    // A change of causes alone is still a new version of an existing event.
    if (before && !versioned) { pushHistory(event, before, options.now, options.reason); event.updatedAt = options.now; }
    event.causes = next;
  }
  return parseKnowledge(kb);
}

type MemoryCards = Record<"characters" | "locations" | "items" | "factions", Record<string, string>>;
const memorySummary = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 300);
/** Deterministic, AI-free: every memory entry has a sheet. New sheets are drafts.
 * With the previous memory, a draft sheet that still mirrors its memory entry
 * (never edited by the author or the AI) follows the entry when it changes. */
export function syncKnowledgeWithMemory(kb: KnowledgeBase, memory: MemoryCards, now: string, previous?: MemoryCards): KnowledgeBase {
  const next = structuredClone(kb);
  const taken = new Set([...next.entities, ...next.events, ...next.timelines].map(x => x.id));
  for (const type of ENTITY_TYPES) for (const [key, value] of Object.entries(memory[MEMORY_FOLDER[type]] ?? {})) {
    if (!key.trim() || ["__proto__", "constructor", "prototype"].includes(key) || key.length > 120) continue;
    const existing = findEntity(next, type, key);
    if (existing) {
      const folder = previous?.[MEMORY_FOLDER[type]];
      const old = folder && Object.hasOwn(folder, key) ? folder[key] : undefined;
      const fresh = memorySummary(value);
      if (typeof old === "string" && existing.status === "draft" && existing.summary === memorySummary(old) && fresh && fresh !== existing.summary) {
        pushHistory(existing, snapshotOf(existing), now, "Aggiornata dalla memoria narrativa");
        existing.summary = fresh; existing.updatedAt = now;
      }
      continue;
    }
    if (next.entities.length >= LIMITS.entities) continue;
    next.entities.push({ id: uniqueId(type, key, taken), type, name: key.trim(), aliases: [], importance: "minor",
      summary: memorySummary(value), attributes: {}, relationships: [],
      version: 1, status: "draft", origin: "written", updatedAt: now });
  }
  return next;
}

/** Compact, private prompt text for writers and specialists — never blind readers. */
export function describeEntities(entities: readonly KnowledgeEntity[], all: KnowledgeBase, limit = 6000): string {
  const label = (id: string) => all.entities.find(e => e.id === id)?.name ?? id;
  const blocks = entities.map(entity => [
    `${entity.name} (${ENTITY_LABELS[entity.type].one.toLowerCase()}, ${entity.importance}${entity.aliases.length ? ", alias: " + entity.aliases.join(", ") : ""})`,
    entity.summary && "  " + entity.summary,
    ...ATTRIBUTE_FIELDS[entity.type].filter(f => entity.attributes[f.key]).map(f => `  ${f.label}: ${entity.attributes[f.key]}`),
    ...Object.entries(entity.attributes).filter(([k]) => !ATTRIBUTE_FIELDS[entity.type].some(f => f.key === k)).map(([k, v]) => `  ${k}: ${v}`),
    entity.relationships.length ? "  Relazioni: " + entity.relationships.map(r => `${r.type} ${label(r.targetId)}`).join("; ") : "",
  ].filter(Boolean).join("\n"));
  let out = "";
  for (const block of blocks) { if ((out + block).length > limit) break; out += (out ? "\n" : "") + block; }
  return out;
}
export function describeEvents(events: readonly KnowledgeEvent[], all: KnowledgeBase, limit = 4000): string {
  const label = (id: string) => all.entities.find(e => e.id === id)?.name ?? id;
  let out = "";
  for (const event of events) {
    const line = `- [${NARRATION_LABELS[event.narration]}${event.secret ? ", SEGRETO" : ""}] ${event.title}: ${event.summary}` +
      (event.involves.length ? " (coinvolti: " + event.involves.map(label).join(", ") + ")" : "") +
      (event.perspectives.length ? " — prospettive: " + event.perspectives.map(p => label(p.entityId) + " " + STANCE_LABELS[p.stance].toLowerCase() + (p.note ? " (" + p.note + ")" : "")).join("; ") : "");
    if ((out + line).length > limit) break;
    out += (out ? "\n" : "") + line;
  }
  return out;
}

export const KNOWLEDGE_REPLY_SHAPE =
  '{"entities":[{"type":"character|location|item|faction","name":"...","aliases":[],"importance":"main|secondary|minor","summary":"funzione nella storia in 1-2 frasi",' +
  '"attributes":{"role":"...","personality":"...","speech":"...","background":"..."},"relationships":[{"target":"nome di un\'altra scheda","type":"alleato|nemico|famiglia|...","note":"..."}]}],' +
  '"events":[{"title":"...","summary":"cosa accade","storyOrder":10,"when":"momento nella storia","narration":"scene|flashback|foreshadowing|offscreen|backstory",' +
  '"involves":["nomi delle schede"],"causes":["titolo di un evento precedente da cui dipende"],"chapter":1,"sceneIds":["scene:001:001"],"secret":false,' +
  '"perspectives":[{"who":"nome","stance":"knows|unaware|believes_false|conceals","note":"..."}],"timelines":["titolo della timeline"]}],' +
  '"timelines":[{"title":"...","kind":"global|arc|event","summary":"...","subjects":["nomi delle schede che la timeline segue, per un arco"]}]}';
