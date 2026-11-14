import { z } from "zod";
import type { BookProject, NarrativeMemory } from "./types";
import type { MarkdownValue } from "./markdown-document";
import { ATTRIBUTE_FIELDS, ENTITY_TYPES, knowledgeBaseSchema, knowledgeEntitySchema, knowledgeEventSchema, knowledgeTimelineSchema,
  NARRATION_LABELS, parseKnowledge, slug, STANCE_LABELS, syncKnowledgeWithMemory, type EntityType, type KnowledgeBase,
  type KnowledgeEntity, type KnowledgeEvent } from "./knowledge";
import { CHANGE_STATE_LABELS, changeOperationSchema } from "./narrative-change";
import { editorialProfilesSchema } from "./editorial-profiles";

/** Readable sheets for humans and other LLMs, with the structured fields in a
 * flat frontmatter (simple strings and string lists, as the portable contract requires). */
export function sheetMetadata(entity: KnowledgeEntity, mapId: (id: string) => string): Record<string, MarkdownValue> {
  return {
    importance: entity.importance, summary: entity.summary, status: entity.status, version: entity.version,
    aliases: entity.aliases,
    ...Object.fromEntries(Object.entries(entity.attributes).map(([key, value]) => ["attr_" + key, value])),
    relations: entity.relationships.map(r => [r.type, mapId(r.targetId), r.note ?? ""].join(" | ").replace(/ \| $/, "")),
  };
}
export function eventMetadata(event: KnowledgeEvent, mapId: (id: string) => string, sceneId: (id: string) => string): Record<string, MarkdownValue> {
  return {
    type: "event", id: event.id, title: event.title, story_order: event.storyOrder, narration: event.narration,
    ...(event.when ? { when: event.when } : {}), ...(event.plannedChapter !== undefined ? { chapter: event.plannedChapter } : {}),
    secret: event.secret, involves: event.involves.map(mapId), causes: event.causes,
    scenes: event.sceneIds.map(sceneId), timelines: event.timelineIds,
    perspectives: event.perspectives.map(p => [p.stance, mapId(p.entityId), p.note ?? ""].join(" | ").replace(/ \| $/, "")),
    version: event.version,
  };
}

/** Prompt-driven changes, as readable history next to the book (not re-imported as live operations). */
export function changeReportDocuments(book: BookProject): Record<string, string> {
  const files: Record<string, string> = {};
  for (const op of book.changeOperations ?? []) {
    const lines = [
      "# Modifica: " + op.targetLabel, "",
      "Richiesta dell'autore: " + op.instruction, "",
      "Stato: " + CHANGE_STATE_LABELS[op.state] + (op.completedAt ? " (completata il " + op.completedAt + ")" : ""),
      ...(op.plan ? ["", "## Piano", "", "Interpretazione: " + op.plan.interpretation, "",
        "Tipo: " + (op.plan.changeKind === "style" ? "solo forma e stile" : "fatti narrativi"),
        "Scene dirette: " + (op.plan.direct.join(", ") || "nessuna"), "Scene indirette: " + (op.plan.indirect.join(", ") || "nessuna"),
        "Impatto globale: " + (op.plan.global ? "sì" : "no"), "Scene riscritte: " + (op.plan.rewriteSceneIds.join(", ") || "nessuna"),
        ...(op.plan.changedFacts.length ? ["Fatti cambiati:", ...op.plan.changedFacts.map(f => "- " + f)] : []),
        "", "Motivazione: " + op.plan.rationale] : []),
      ...(op.report.some(r => r.drift.length) ? ["", "## Controllo locale dei fatti", "", ...op.report.flatMap(r => r.drift.map(d => "- " + r.sceneId + ": " + d))] : []),
      "", "I testi precedenti, se ancora conservati, sono nello snapshot del libro e permettono il ripristino guidato.",
    ];
    const meta = ["---", "type: change_report", "id: " + JSON.stringify(op.id), "target: " + JSON.stringify(op.target.kind + ":" + op.target.id),
      "state: " + JSON.stringify(op.state), "created: " + JSON.stringify(op.createdAt), "---", ""].join("\n");
    files["changes/" + op.createdAt.slice(0, 10) + "-" + op.id.slice(0, 8) + ".md"] = meta + "\n" + lines.join("\n") + "\n";
  }
  return files;
}

/** Versioned JSON Schemas generated from the same validators the app uses. */
export function schemaDocuments(): Record<string, string> {
  const doc = (title: string, schema: z.ZodType) => JSON.stringify({ title, $id: "https://ghostwriting.ws/schemas/" + slug(title) + ".schema.json",
    "x-bookwriter-schema-version": 1, ...z.toJSONSchema(schema, { unrepresentable: "any" }) }, null, 2) + "\n";
  return {
    "schemas/knowledge.schema.json": doc("knowledge", knowledgeBaseSchema),
    "schemas/entity.schema.json": doc("entity", knowledgeEntitySchema),
    "schemas/event.schema.json": doc("event", knowledgeEventSchema),
    "schemas/timeline.schema.json": doc("timeline", knowledgeTimelineSchema),
    "schemas/editorial-profiles.schema.json": doc("editorial-profiles", editorialProfilesSchema),
    "schemas/change-operation.schema.json": doc("change-operation", changeOperationSchema),
  };
}

const split = (value: string) => { const [a = "", b = "", ...rest] = value.split(" | "); return [a.trim(), b.trim(), rest.join(" | ").trim()] as const; };
function list(value: MarkdownValue | undefined): string[] {
  return Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [String(value)];
}
/** Rebuilds the knowledge base from Markdown sheets, events and timelines.
 * Returns undefined for books without structured data (legacy behaviour). Fails closed on broken references. */
export function readKnowledgeDocuments(docs: ReadonlyArray<{ path: string; metadata: Record<string, MarkdownValue>; body: string }>,
  sceneIds: ReadonlySet<string>, memory: NarrativeMemory, now: string): KnowledgeBase | undefined {
  const sheetDocs = docs.filter(d => ENTITY_TYPES.some(t => d.path.startsWith(t + "s/") && d.metadata.type === t));
  const structured = sheetDocs.filter(d => d.metadata.importance !== undefined || d.metadata.knowledge_only === true ||
    Object.keys(d.metadata).some(k => k.startsWith("attr_")) || d.metadata.relations !== undefined);
  const eventDocs = docs.filter(d => d.path.startsWith("events/") && d.metadata.type === "event");
  const timelineDocs = docs.filter(d => d.path.startsWith("timelines/") && d.metadata.type === "timeline");
  if (!structured.length && !eventDocs.length && !timelineDocs.length) return undefined;
  const text = (v: MarkdownValue | undefined, max: number) => typeof v === "string" ? v.slice(0, max) : "";
  const kb: KnowledgeBase = {
    schemaVersion: 1, generatedAt: now,
    entities: structured.map(d => ({
      id: String(d.metadata.id), type: d.metadata.type as EntityType, name: String(d.metadata.name ?? d.metadata.title ?? d.metadata.id),
      aliases: list(d.metadata.aliases), importance: (["main", "secondary", "minor"].includes(String(d.metadata.importance)) ? d.metadata.importance : "secondary") as KnowledgeEntity["importance"],
      summary: text(d.metadata.summary, 600),
      attributes: Object.fromEntries(Object.entries(d.metadata).filter(([k, v]) => k.startsWith("attr_") && typeof v === "string").map(([k, v]) => [k.slice(5), v as string])),
      relationships: list(d.metadata.relations).map(line => { const [type, targetId, note] = split(line); return { targetId, type, ...(note ? { note } : {}) }; }),
      version: typeof d.metadata.version === "number" ? d.metadata.version : 1,
      status: d.metadata.status === "validated" ? "validated" : "draft", origin: "imported", updatedAt: now,
    })),
    timelines: timelineDocs.map(d => ({ id: String(d.metadata.id), title: String(d.metadata.title ?? d.metadata.id),
      kind: (["global", "arc", "event"].includes(String(d.metadata.kind)) ? d.metadata.kind : "arc") as "global" | "arc" | "event", summary: d.body.slice(0, 600) })),
    events: eventDocs.map(d => {
      const scenes = list(d.metadata.scenes);
      if (scenes.some(id => !sceneIds.has(id))) throw new Error("Evento «" + String(d.metadata.title) + "» collegato a una scena inesistente.");
      return {
        id: String(d.metadata.id), title: String(d.metadata.title ?? d.metadata.id), summary: d.body.slice(0, 800),
        storyOrder: typeof d.metadata.story_order === "number" ? d.metadata.story_order : 0,
        ...(typeof d.metadata.when === "string" && d.metadata.when ? { when: d.metadata.when } : {}),
        narration: (Object.keys(NARRATION_LABELS).includes(String(d.metadata.narration)) ? d.metadata.narration : "scene") as KnowledgeEvent["narration"],
        involves: list(d.metadata.involves), causes: list(d.metadata.causes), sceneIds: scenes,
        ...(typeof d.metadata.chapter === "number" ? { plannedChapter: d.metadata.chapter } : {}),
        secret: d.metadata.secret === true, timelineIds: list(d.metadata.timelines),
        perspectives: list(d.metadata.perspectives).map(line => { const [stance, entityId, note] = split(line);
          return { entityId, stance: stance as KnowledgeEvent["perspectives"][number]["stance"], ...(note ? { note } : {}) }; })
          .filter(p => Object.keys(STANCE_LABELS).includes(p.stance) || (() => { throw new Error("Prospettiva non valida in un evento."); })()),
        version: typeof d.metadata.version === "number" ? d.metadata.version : 1, origin: "imported" as const, updatedAt: now,
      };
    }),
  };
  return syncKnowledgeWithMemory(parseKnowledge(kb), memory, now);
}

export function attributeLabel(type: EntityType, key: string): string {
  return ATTRIBUTE_FIELDS[type].find(f => f.key === key)?.label ?? key.replace(/_/g, " ");
}
