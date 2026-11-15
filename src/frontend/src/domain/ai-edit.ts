import { z } from "zod";
import type { BookProject } from "./types";
import { parseJsonReply } from "./json-reply";
import { writerInstructions } from "./editorial-profiles";
import { ATTRIBUTE_FIELDS, findEntity, NARRATION_LABELS, NARRATION_MODES, STANCE_LABELS, STANCES,
  type KnowledgeBase, type KnowledgeEntity, type KnowledgeEvent } from "./knowledge";
import { attributeLabel } from "./knowledge-markdown";
import { findScene, type EditTarget } from "./book-edits";
import { editChapter, editEntity, editEvent, editScene, type ChapterPatch, type EntityPatch, type EventPatch, type ScenePatch } from "./book-editing";

/** «Modifica solo questo»: the AI proposes a new version of ONE element (or of the
 * scenes of one chapter). Nothing changes until the author accepts a change after the
 * before/after comparison. No propagation and no review: those stay author choices. */
export type AiEditRequest =
  | { kind: "scene"; id: string; selection?: { start: number; end: number } }
  | { kind: "chapter"; id: string; scope: "details" | "text" }
  | { kind: "entity"; id: string }
  | { kind: "event"; id: string };
export type AiEditPatch = ScenePatch | ChapterPatch | EntityPatch | EventPatch;
export interface AiEditChange {
  key: string; target: EditTarget; label: string;
  /** Content the proposal was built on: accepting it on newer content is refused. */
  baseStamp: string;
  /** Readable versions for the comparison. */
  before: string; after: string;
  patch: AiEditPatch; status: "proposed" | "applied" | "rejected"; activityId?: string;
}
export interface AiEditProposal {
  id: string; request: AiEditRequest; instruction: string; label: string; createdAt: string;
  changes: AiEditChange[];
  /** Calls that failed or proposed nothing, in words. */
  notes: string[];
}
export interface AiEditCall { key: string; target: EditTarget; label: string; prompt: string; parse: (text: string, book: BookProject) => { patch: AiEditPatch; before: string; after: string } | undefined }
export const MIN_AI_EDIT_INSTRUCTION = 8, MAX_AI_EDIT_INSTRUCTION = 4000, MAX_CHAPTER_AI_EDIT_SCENES = 30;

export function aiEditSystem(book: BookProject): string {
  return [
    "Sei il romanziere e l'editor di questo libro. L'autore ti chiede di modificare UN SOLO elemento: applica esattamente la sua richiesta e conserva tutto il resto (fatti, nomi, eventi, voce, stile).",
    "Non introdurre nuovi fatti oltre a quelli richiesti, non svelare segreti, non commentare: restituisci solo il formato richiesto.",
    writerInstructions(book.editorialProfiles), book.writingStyle ? "Stile del libro: " + book.writingStyle : "",
    book.authorConstraints.length ? "Vincoli permanenti dell'autore:\n" + book.authorConstraints.join("\n") : "",
  ].filter(Boolean).join("\n");
}
function assertProse(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("La risposta è vuota: nessuna modifica proposta.");
  if (/^```/.test(trimmed) || (/^[[{]/.test(trimmed) && /[\]}]$/.test(trimmed))) throw new Error("Il modello ha restituito codice o JSON invece del testo.");
  return trimmed;
}
const sceneLabel = (book: BookProject, sceneId: string) => {
  const found = findScene(book, sceneId)!;
  return `Cap. ${found.chapter.number} · ${found.scene.number}. ${found.scene.title}`;
};
function neighbours(book: BookProject, sceneId: string): string {
  const flat = [...book.chapters].sort((a, b) => a.number - b.number).flatMap(c => [...c.scenes].sort((a, b) => a.number - b.number));
  const index = flat.findIndex(s => s.id === sceneId);
  const prev = flat.slice(0, index).reverse().find(s => s.text.trim()), next = flat.slice(index + 1).find(s => s.text.trim());
  return [prev ? "FINE DELLA SCENA PRECEDENTE (solo contesto):\n" + prev.text.slice(-1500) : "", next ? "INIZIO DELLA SCENA SUCCESSIVA (solo contesto):\n" + next.text.slice(0, 1500) : ""].filter(Boolean).join("\n\n");
}
function sceneCall(book: BookProject, sceneId: string, instruction: string, selection?: { start: number; end: number }, chapterWide = false): AiEditCall {
  const found = findScene(book, sceneId);
  if (!found) throw new Error("Scena non trovata.");
  const { scene } = found;
  if (!scene.text.trim()) throw new Error("La scena non è ancora scritta: scrivila o lascia che la scriva l'autopilot.");
  const label = sceneLabel(book, sceneId);
  if (selection) {
    const start = Math.max(0, Math.min(selection.start, selection.end)), end = Math.min(scene.text.length, Math.max(selection.start, selection.end));
    if (end - start < 2) throw new Error("Seleziona il passaggio da modificare.");
    const chosen = scene.text.slice(start, end);
    return { key: "scene|" + sceneId, target: { kind: "scene", id: sceneId }, label, prompt: [
      `RICHIESTA DELL'AUTORE: «${instruction}»`,
      "Riscrivi SOLO il passaggio selezionato (fra [[INIZIO SELEZIONE]] e [[FINE SELEZIONE]]). Il nuovo passaggio sostituirà esattamente la selezione: deve raccordarsi al testo prima e dopo. Restituisci SOLO il nuovo passaggio, senza i marcatori.",
      `SCENA «${scene.title}»:\n${scene.text.slice(0, start)}[[INIZIO SELEZIONE]]${chosen}[[FINE SELEZIONE]]${scene.text.slice(end)}`,
    ].join("\n\n"), parse: (text, current) => {
      const now = findScene(current, sceneId)!.scene;
      const replacement = assertProse(text).replace(/\[\[(INIZIO|FINE) SELEZIONE\]\]/g, "");
      if (replacement.length > chosen.length * 6 + 4000) throw new Error("Il passaggio proposto è molto più lungo della selezione: nessuna modifica proposta.");
      // Keep the selection's surrounding whitespace so the paragraphs stay as they were.
      const lead = chosen.match(/^\s*/)![0], tail = chosen.match(/\s*$/)![0];
      const after = now.text.slice(0, start) + lead + replacement + tail + now.text.slice(end);
      return after === now.text ? undefined : { patch: { text: after }, before: now.text, after };
    } };
  }
  return { key: "scene|" + sceneId, target: { kind: "scene", id: sceneId }, label, prompt: [
    `RICHIESTA DELL'AUTORE: «${instruction}»`,
    chapterWide ? "La richiesta riguarda tutto il capitolo: applicala a questa scena solo dove è pertinente. Se questa scena non va cambiata, restituiscila identica." : "",
    "Riscrivi la scena applicando la richiesta e restituisci SOLO la prosa completa della scena.",
    neighbours(book, sceneId),
    `SCENA «${scene.title}» (obiettivo: ${scene.objective || "non indicato"}):\n${scene.text}`,
  ].filter(Boolean).join("\n\n"), parse: (text, current) => {
    const now = findScene(current, sceneId)!.scene;
    const after = assertProse(text);
    return after === now.text.trim() ? undefined : { patch: { text: after }, before: now.text, after };
  } };
}

const chapterReply = z.object({ title: z.string().min(1).max(300), purpose: z.string().max(20_000), summary: z.string().max(6000).optional() }).passthrough();
const chapterText = (c: { title: string; purpose: string; summary?: string }) => `Titolo: ${c.title}\nScopo: ${c.purpose}\nRiassunto: ${c.summary ?? ""}`;

const entityReply = z.object({
  name: z.string().min(1).max(120), aliases: z.array(z.string().min(1).max(120)).max(8).optional(),
  importance: z.enum(["main", "secondary", "minor"]).optional(), summary: z.string().max(600).optional(),
  attributes: z.record(z.string(), z.string().max(900)).optional(),
  relationships: z.array(z.object({ target: z.string().min(1).max(120), type: z.string().min(2).max(40), note: z.string().max(240).optional() })).max(24).optional(),
}).passthrough();
const IMPORTANCE = { main: "Principale", secondary: "Secondario", minor: "Minore" } as const;
export function entityText(entity: Pick<KnowledgeEntity, "type" | "name" | "aliases" | "importance" | "summary" | "attributes" | "relationships">, kb: KnowledgeBase): string {
  const keys = [...ATTRIBUTE_FIELDS[entity.type].map(f => f.key), ...Object.keys(entity.attributes).filter(k => !ATTRIBUTE_FIELDS[entity.type].some(f => f.key === k))];
  return [`Nome: ${entity.name}`, entity.aliases.length ? `Detto anche: ${entity.aliases.join(", ")}` : "", `Importanza: ${IMPORTANCE[entity.importance]}`,
    `Descrizione: ${entity.summary}`, ...keys.filter(k => entity.attributes[k]).map(k => `${attributeLabel(entity.type, k)}: ${entity.attributes[k]}`),
    entity.relationships.length ? "Relazioni: " + entity.relationships.map(r => `${r.type} → ${kb.entities.find(e => e.id === r.targetId)?.name ?? r.targetId}${r.note ? " (" + r.note + ")" : ""}`).join("; ") : "",
  ].filter(Boolean).join("\n");
}
const eventReply = z.object({
  title: z.string().min(2).max(160), summary: z.string().max(800).optional(), when: z.string().max(80).optional(),
  narration: z.enum(NARRATION_MODES).optional(), secret: z.boolean().optional(),
  involves: z.array(z.string().min(1).max(120)).max(20).optional(),
  perspectives: z.array(z.object({ who: z.string().min(1).max(120), stance: z.enum(STANCES), note: z.string().max(200).optional() })).max(12).optional(),
}).passthrough();
export function eventText(event: Pick<KnowledgeEvent, "title" | "summary" | "when" | "narration" | "secret" | "involves" | "perspectives">, kb: KnowledgeBase): string {
  const name = (id: string) => kb.entities.find(e => e.id === id)?.name ?? id;
  return [`Titolo: ${event.title}`, event.when ? `Quando: ${event.when}` : "", `Racconto: ${NARRATION_LABELS[event.narration]}`, `Segreto: ${event.secret ? "sì" : "no"}`,
    `Sintesi: ${event.summary}`, event.involves.length ? "Coinvolti: " + event.involves.map(name).join(", ") : "",
    event.perspectives.length ? "Prospettive: " + event.perspectives.map(p => `${name(p.entityId)} ${STANCE_LABELS[p.stance].toLowerCase()}${p.note ? " (" + p.note + ")" : ""}`).join("; ") : "",
  ].filter(Boolean).join("\n");
}
/** The model cites names; the code resolves them. An unknown name refuses the proposal. */
function resolveName(kb: KnowledgeBase, value: string): string {
  const entity = findEntity(kb, undefined, value);
  if (!entity) throw new Error(`L'AI cita «${value.slice(0, 80)}», che non è fra le schede: nessuna modifica proposta. Crea prima la scheda o riformula la richiesta.`);
  return entity.id;
}
/** Dry run on a copy: the same validation as a manual save, before showing the diff. */
function dryRun(book: BookProject, apply: (copy: BookProject) => void): boolean {
  try { apply(structuredClone(book)); return true; }
  catch (error) {
    if (error instanceof Error && /Nessuna modifica/.test(error.message)) return false;
    throw error;
  }
}

/** The AI calls a request needs (one per element; one per written scene for a chapter text). */
export function aiEditCalls(book: BookProject, request: AiEditRequest, instruction: string): AiEditCall[] {
  const clean = instruction.normalize("NFC").trim();
  if (clean.length < MIN_AI_EDIT_INSTRUCTION) throw new Error("Descrivi la modifica con qualche parola in più.");
  if (clean.length > MAX_AI_EDIT_INSTRUCTION) throw new Error(`Richiesta troppo lunga: massimo ${MAX_AI_EDIT_INSTRUCTION} caratteri.`);
  const ctx = { now: new Date().toISOString(), origin: "ai" as const };
  switch (request.kind) {
    case "scene": return [sceneCall(book, request.id, clean, request.selection)];
    case "chapter": {
      const chapter = book.chapters.find(c => c.id === request.id);
      if (!chapter) throw new Error("Capitolo non trovato.");
      if (request.scope === "text") {
        const written = [...chapter.scenes].sort((a, b) => a.number - b.number).filter(s => s.text.trim());
        if (!written.length) throw new Error("Il capitolo non ha ancora scene scritte.");
        if (written.length > MAX_CHAPTER_AI_EDIT_SCENES) throw new Error(`Capitolo troppo lungo per una modifica unica: massimo ${MAX_CHAPTER_AI_EDIT_SCENES} scene.`);
        return written.map(scene => sceneCall(book, scene.id, clean, undefined, true));
      }
      return [{ key: "chapter|" + chapter.id, target: { kind: "chapter", id: chapter.id }, label: `Capitolo ${chapter.number} — ${chapter.title}`, prompt: [
        `RICHIESTA DELL'AUTORE: «${clean}»`,
        'Modifica titolo, scopo e riassunto del capitolo secondo la richiesta. Rispondi SOLO JSON: {"title":"...","purpose":"...","summary":"..."} (riporta invariati i campi da non cambiare).',
        chapterText(chapter), "SCENE DEL CAPITOLO:\n" + chapter.scenes.map(s => `- ${s.number}. ${s.title}: ${s.summary ?? s.objective}`).join("\n"),
      ].join("\n\n"), parse: (text, current) => {
        const reply = chapterReply.parse(parseJsonReply(text));
        const now = current.chapters.find(c => c.id === chapter.id)!;
        const patch: ChapterPatch = {};
        if (reply.title.trim() !== now.title) patch.title = reply.title.trim();
        if (reply.purpose !== now.purpose) patch.purpose = reply.purpose;
        if (reply.summary !== undefined && reply.summary !== (now.summary ?? "")) patch.summary = reply.summary;
        if (!Object.keys(patch).length || !dryRun(current, copy => editChapter(copy, chapter.id, patch, ctx))) return undefined;
        return { patch, before: chapterText(now), after: chapterText({ ...now, ...patch }) };
      } }];
    }
    case "entity": {
      const kb = book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
      const entity = kb?.entities.find(e => e.id === request.id);
      if (!kb || !entity) throw new Error("Scheda non trovata.");
      const others = kb.entities.filter(e => e.id !== entity.id).map(e => `${e.name} (${e.type})`).slice(0, 200).join(", ");
      const keys = ATTRIBUTE_FIELDS[entity.type].map(f => `"${f.key}" (${f.label})`).join(", ");
      return [{ key: "entity|" + entity.id, target: { kind: "entity", id: entity.id }, label: entity.name, prompt: [
        `RICHIESTA DELL'AUTORE: «${clean}»`,
        `Modifica SOLO questa scheda secondo la richiesta. Rispondi SOLO JSON con la scheda completa: {"name":"...","aliases":["..."],"importance":"main|secondary|minor","summary":"max 600 caratteri","attributes":{"chiave":"valore"},"relationships":[{"target":"NOME di un'altra scheda","type":"tipo","note":"..."}]}. Chiavi suggerite per gli attributi: ${keys}. Riporta invariato ciò che non cambia. Le relazioni citano solo nomi di schede esistenti.`,
        "SCHEDA ATTUALE:\n" + entityText(entity, kb), others ? "ALTRE SCHEDE ESISTENTI: " + others : "",
      ].filter(Boolean).join("\n\n"), parse: (text, current) => {
        const reply = entityReply.parse(parseJsonReply(text));
        const ckb = current.knowledge!;
        const now = ckb.entities.find(e => e.id === entity.id)!;
        const attributes = Object.fromEntries(Object.entries(reply.attributes ?? now.attributes).map(([k, v]) => [k.trim().toLowerCase(), v] as const));
        const patch: EntityPatch = { name: reply.name, aliases: reply.aliases ?? now.aliases, importance: reply.importance ?? now.importance,
          summary: reply.summary ?? now.summary, attributes,
          relationships: reply.relationships
            ? reply.relationships.map(r => ({ targetId: resolveName(ckb, r.target), type: r.type, ...(r.note ? { note: r.note } : {}) })) : now.relationships };
        if (!dryRun(current, copy => editEntity(copy, entity.id, patch, ctx))) return undefined;
        return { patch, before: entityText(now, ckb), after: entityText({ ...now, ...patch } as KnowledgeEntity, ckb) };
      } }];
    }
    case "event": {
      const kb = book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
      const event = kb?.events.find(e => e.id === request.id);
      if (!kb || !event) throw new Error("Evento non trovato.");
      return [{ key: "event|" + event.id, target: { kind: "event", id: event.id }, label: event.title, prompt: [
        `RICHIESTA DELL'AUTORE: «${clean}»`,
        `Modifica SOLO questo evento secondo la richiesta. Rispondi SOLO JSON: {"title":"...","summary":"max 800 caratteri","when":"momento nella storia","narration":"${NARRATION_MODES.join("|")}","secret":false,"involves":["NOMI delle schede coinvolte"],"perspectives":[{"who":"NOME","stance":"${STANCES.join("|")}","note":"..."}]}. Riporta invariato ciò che non cambia; cita solo nomi di schede esistenti.`,
        "EVENTO ATTUALE:\n" + eventText(event, kb), "SCHEDE ESISTENTI: " + kb.entities.map(e => e.name).slice(0, 200).join(", "),
      ].join("\n\n"), parse: (text, current) => {
        const reply = eventReply.parse(parseJsonReply(text));
        const ckb = current.knowledge!;
        const now = ckb.events.find(e => e.id === event.id)!;
        const patch: EventPatch = { title: reply.title, summary: reply.summary ?? now.summary, when: reply.when ?? now.when ?? "",
          narration: reply.narration ?? now.narration, secret: reply.secret ?? now.secret,
          involves: reply.involves ? [...new Set(reply.involves.map(n => resolveName(ckb, n)))] : now.involves,
          perspectives: reply.perspectives ? reply.perspectives.map(p => ({ entityId: resolveName(ckb, p.who), stance: p.stance, ...(p.note ? { note: p.note } : {}) })) : now.perspectives };
        if (!dryRun(current, copy => editEvent(copy, event.id, patch, ctx))) return undefined;
        const merged = { ...now, ...patch, when: patch.when || undefined } as KnowledgeEvent;
        return { patch, before: eventText(now, ckb), after: eventText(merged, ckb) };
      } }];
    }
  }
}

/** Apply one accepted change to the book (validated again on the current content). */
export function applyAiEditChange(book: BookProject, change: AiEditChange, ctx: Parameters<typeof editScene>[3]) {
  switch (change.target.kind) {
    case "scene": return editScene(book, change.target.id, change.patch as ScenePatch, ctx);
    case "chapter": return editChapter(book, change.target.id, change.patch as ChapterPatch, ctx);
    case "entity": return editEntity(book, change.target.id, change.patch as EntityPatch, ctx);
    case "event": return editEvent(book, change.target.id, change.patch as EventPatch, ctx);
    default: throw new Error("Elemento non modificabile con l'AI da qui.");
  }
}
