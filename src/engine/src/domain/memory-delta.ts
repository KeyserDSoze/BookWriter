import { z } from "zod";
import type { NarrativeMemory } from "./types";

/** The model returns only what changed ("delta"): rewriting the whole canon memory after every scene
 * cost thousands of output tokens, about half an hour on a slow local model. The legacy full-state reply
 * is still accepted. A reply is untrusted data: every field is size-limited, nothing is silently truncated. */
const CATEGORIES = ["characters", "locations", "factions", "items", "secrets"] as const;
type Category = typeof CATEGORIES[number];

export const MEMORY_ENTRY_LIMIT = 900;
export const MEMORY_TIMELINE_LIMIT = 60;
export const CURRENT_STATE_LIMIT = 2500;
const KEY_LIMIT = 160;
const UPSERTS_PER_CATEGORY = 60;

export const memorySchema = z.object({
  characters: z.record(z.string(), z.string()),
  locations: z.record(z.string(), z.string()),
  factions: z.record(z.string(), z.string()),
  items: z.record(z.string(), z.string()),
  secrets: z.record(z.string(), z.string()),
  timeline: z.array(z.string()),
  currentState: z.string(),
});

const entries = z.record(z.string().min(1).max(KEY_LIMIT), z.string().max(MEMORY_ENTRY_LIMIT))
  .refine(value => Object.keys(value).length <= UPSERTS_PER_CATEGORY, "Troppe voci modificate in una sola risposta.");
const removals = z.array(z.string().min(1).max(KEY_LIMIT)).max(UPSERTS_PER_CATEGORY);
const entryRemovals = z.object({
  characters: removals.optional(), locations: removals.optional(), factions: removals.optional(),
  items: removals.optional(), secrets: removals.optional(),
});
const deltaSchema = z.object({
  mode: z.literal("delta"),
  sceneSummary: z.string().trim().min(20).max(800).optional(),
  characters: entries.optional(), locations: entries.optional(), factions: entries.optional(),
  items: entries.optional(), secrets: entries.optional(),
  remove: entryRemovals.extend({
    /** Timeline events made false or obsolete by this text, as written in the memory. */
    timeline: z.array(z.string().min(1).max(400)).max(UPSERTS_PER_CATEGORY).optional(),
  }).optional(),
  timelineAdd: z.array(z.string().min(3).max(400)).max(20).optional(),
  currentState: z.string().max(CURRENT_STATE_LIMIT).optional(),
});

/** Comparison key of a timeline event: case, accents, punctuation and spacing do not make a new event. */
export function eventKey(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("it")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
/** Shorter events («Mara arriva») can legitimately happen twice and are never merged automatically. */
const MIN_REPEATED_EVENT_KEY = 20;

/** Re-reading a chapter after a correction used to append its events once per round. An event whose key
 * is already in the timeline (or earlier in the same reply) is not added again. */
function appendEvents(timeline: readonly string[], additions: readonly string[]): string[] {
  const seen = new Set(timeline.map(eventKey).filter(key => key.length >= MIN_REPEATED_EVENT_KEY));
  const out = [...timeline];
  for (const event of additions) {
    const key = eventKey(event);
    if (key.length >= MIN_REPEATED_EVENT_KEY) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(event);
  }
  return out;
}

/** Local, deterministic first step of a compaction: repeated copies of the same event are dropped, the
 * first (chronological) one is kept. No model call, nothing reworded. */
export function withoutRepeatedEvents(memory: NarrativeMemory): { memory: NarrativeMemory; removed: number } {
  const seen = new Set<string>();
  const timeline = memory.timeline.filter(event => {
    const key = eventKey(event);
    if (key.length < MIN_REPEATED_EVENT_KEY) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const removed = memory.timeline.length - timeline.length;
  return { memory: removed ? { ...structuredClone(memory), timeline } : memory, removed };
}

/** Fields of a delta reply for the submit function: the validator's fields, with the essentials required. */
export function memoryDeltaToolShape(withSceneSummary: boolean) {
  return withSceneSummary
    ? deltaSchema.required({ currentState: true, sceneSummary: true }).shape
    : deltaSchema.omit({ sceneSummary: true }).required({ currentState: true }).shape;
}
/** Fields of an entry compaction: rewritten or removed entries only; the timeline is compacted on its own. */
export function memoryCompactionToolShape() {
  return deltaSchema.omit({ sceneSummary: true, timelineAdd: true }).extend({ remove: entryRemovals.optional() })
    .required({ currentState: true }).shape;
}
export const MEMORY_COMPACTION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  mode: "Sempre \"delta\": restituisci solo le voci riscritte o da eliminare; le altre restano invariate.",
  characters: "Personaggi da riscrivere in forma compatta: nome → scheda di stato (identità, tratti, relazioni, cosa sa, dove si trova), al massimo 600 caratteri.",
  locations: "Luoghi da riscrivere in forma compatta: nome → scheda di stato, al massimo 600 caratteri.",
  factions: "Fazioni da riscrivere in forma compatta: nome → scheda di stato, al massimo 600 caratteri.",
  items: "Oggetti da riscrivere in forma compatta: nome → chi li possiede e dove sono, al massimo 600 caratteri.",
  secrets: "Segreti da riscrivere in forma compatta: id → stato privato, chi lo sa e quando rivelarlo. Nessun segreto ancora rilevante va perso.",
  remove: "Voci esaurite da eliminare (personaggi, luoghi, oggetti secondari non più utili), per categoria. Mai segreti ancora da rivelare.",
  currentState: "Stato attuale della storia, compatto (al massimo 2000 caratteri).",
};
export const MEMORY_DELTA_DESCRIPTIONS: Readonly<Record<string, string>> = {
  mode: "Sempre \"delta\": restituisci solo ciò che cambia rispetto alla memoria precedente.",
  sceneSummary: "Riassunto fedele della scena in 2-4 frasi: eventi, cambiamenti e come finisce (20-800 caratteri).",
  characters: `Personaggi nuovi o cambiati: nome → scheda di stato completa (identità, tratti, relazioni, cosa sa, dove si trova, cosa possiede; non la cronaca delle azioni; max ${MEMORY_ENTRY_LIMIT} caratteri). {} se nessuno cambia.`,
  locations: "Luoghi nuovi o cambiati: nome → scheda di stato (com'è, chi c'è, cosa vi si trova). {} se nessuno cambia.",
  factions: "Fazioni nuove o cambiate: nome → scheda di stato. {} se nessuna cambia.",
  items: "Oggetti nuovi o cambiati: nome → stato completo (chi li possiede, dove sono). {} se nessuno cambia.",
  secrets: "Segreti nuovi o cambiati: id → stato privato, chi lo sa e quando rivelarlo. {} se nessuno cambia.",
  remove: "Voci da eliminare, per categoria. Ometti se non elimini nulla.",
  "remove.timeline": "Eventi della cronologia diventati falsi o superati, copiati esattamente dalla memoria.",
  timelineAdd: "Solo eventi NUOVI che cambiano la storia (decisioni, scoperte, rivelazioni, spostamenti, conflitti, perdite), di norma 1-5, in ordine; mai gesti, sensazioni o eventi già presenti nella cronologia (3-400 caratteri ciascuno).",
  currentState: `Stato attuale della storia dopo questo testo (max ${CURRENT_STATE_LIMIT} caratteri).`,
};

export interface MemoryUpdate { memory: NarrativeMemory; sceneSummary?: string; mode: "delta" | "full" }

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Merge a delta reply (or accept a legacy full reply) into the previous memory. Never mutates it. */
export function applyMemoryResponse(previous: NarrativeMemory, parsedReply: unknown): MemoryUpdate {
  const mode = (parsedReply as { mode?: unknown } | null)?.mode;
  if (mode !== "delta") {
    const { sceneSummary, ...rest } = (parsedReply ?? {}) as { sceneSummary?: unknown };
    const memory = withoutRepeatedEvents(memorySchema.parse(rest) as NarrativeMemory).memory;
    return { memory, mode: "full", ...(typeof sceneSummary === "string" && sceneSummary.trim().length >= 20
      ? { sceneSummary: sceneSummary.trim().slice(0, 800) } : {}) };
  }
  const delta = deltaSchema.parse(parsedReply);
  const next: NarrativeMemory = structuredClone(previous);
  for (const category of CATEGORIES) {
    const target: Record<string, string> = { ...next[category] };
    for (const key of delta.remove?.[category] ?? []) delete target[key];
    for (const [key, value] of Object.entries(delta[category] ?? {})) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error("Nome di voce non ammesso nella memoria.");
      target[key] = value;
    }
    next[category] = target as NarrativeMemory[Category];
  }
  if (delta.remove?.timeline?.length) {
    const drop = new Set(delta.remove.timeline.map(eventKey).filter(Boolean));
    next.timeline = next.timeline.filter(event => !drop.has(eventKey(event)));
  }
  if (delta.timelineAdd?.length) next.timeline = appendEvents(next.timeline, delta.timelineAdd);
  if (delta.currentState !== undefined) next.currentState = delta.currentState;
  return { memory: next, mode: "delta", ...(delta.sceneSummary ? { sceneSummary: delta.sceneSummary } : {}) };
}

/** Characters of canon memory that every later prompt carries. */
export function memorySize(memory: NarrativeMemory): number {
  return JSON.stringify(memory).length;
}
export const MEMORY_COMPACTION_TRIGGER = 24_000;
export function memoryNeedsCompaction(memory: NarrativeMemory): boolean {
  return memorySize(memory) > MEMORY_COMPACTION_TRIGGER || memory.timeline.length > MEMORY_TIMELINE_LIMIT + 20;
}
/** A compaction that does not shrink the memory would be repeated forever. A smaller reduction is enough
 * only when it really solves the problem (memory below the trigger and every entry within its limit). */
export function assertCompactionShrinks(before: NarrativeMemory, after: NarrativeMemory): void {
  const size = memorySize(after);
  if (size <= memorySize(before) * 0.85) return;
  const solved = size < memorySize(before) && !memoryNeedsCompaction(after) &&
    CATEGORIES.every(category => Object.values(after[category]).every(value => value.length <= MEMORY_ENTRY_LIMIT));
  if (!solved)
    throw new Error("La compattazione non ha ridotto abbastanza la memoria (serve almeno il 15% in meno). Nessuna modifica applicata: compattala a mano o usa un modello più capace.");
}

/** Compaction is split so that a small or slow model writes a short reply: first the timeline alone
 * (when it is the problem: too many events, or long events that weigh more than the entries), then only
 * the entries that must shrink. Every timeline stage leaves fewer events, so the choice cannot loop. */
export type CompactionStage = "timeline" | "entries";
export function compactionStage(memory: NarrativeMemory): CompactionStage {
  if (memory.timeline.length > MEMORY_TIMELINE_LIMIT) return "timeline";
  const timelineSize = JSON.stringify(memory.timeline).length;
  return memory.timeline.length > COMPACT_TIMELINE_TARGET && timelineSize * 2 > memorySize(memory) ? "timeline" : "entries";
}
export const COMPACT_TIMELINE_TARGET = 40;
export const compactTimelineSchema = z.object({ timeline: z.array(z.string()) });
export const COMPACT_TIMELINE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  timeline: `La cronologia compattata, in ordine: al massimo ${COMPACT_TIMELINE_TARGET} eventi essenziali (ognuno al massimo 300 caratteri), duplicati e riformulazioni uniti, azioni minori della stessa scena raggruppate.`,
};
/** The compacted timeline replaces the old one only if it is a real, bounded reduction. Reworded events are
 * the model's choice; the checks only prevent loops, growth and empty or oversized lists. */
export function applyTimelineCompaction(previous: NarrativeMemory, reply: unknown): NarrativeMemory {
  const parsed = compactTimelineSchema.safeParse(reply);
  if (!parsed.success) throw new Error('La risposta deve essere {"timeline":["evento", ...]} con soli testi.');
  const timeline = parsed.data.timeline.map(event => event.replace(/^\s*\d{1,3}[.)]\s+/, "").trim()).filter(Boolean);
  if (!timeline.length) throw new Error("La cronologia compattata è vuota: riassumi gli eventi, non eliminarli tutti.");
  const long = timeline.findIndex(event => event.length > 400);
  if (long >= 0) throw new Error(`L'evento ${long + 1} della cronologia supera 400 caratteri: dividilo o accorcialo.`);
  if (timeline.length > MEMORY_TIMELINE_LIMIT || timeline.length >= previous.timeline.length)
    throw new Error(`La cronologia compattata ha ${timeline.length} eventi: ne servono al massimo ${COMPACT_TIMELINE_TARGET} (erano ${previous.timeline.length}).`);
  // Summarizing is fine, wiping the story is not: a handful of events cannot stand for a long timeline.
  const floor = Math.min(10, Math.ceil(previous.timeline.length / 12));
  if (timeline.length < floor)
    throw new Error(`La cronologia compattata ha solo ${timeline.length} eventi: conserva gli eventi essenziali della storia (almeno ${floor}).`);
  const chars = (events: readonly string[]) => events.reduce((sum, event) => sum + event.length, 0);
  if (chars(timeline) >= chars(previous.timeline))
    throw new Error("La cronologia compattata non è più corta di quella attuale: unisci e accorcia gli eventi.");
  return { ...structuredClone(previous), timeline: withoutRepeatedEvents({ ...previous, timeline }).memory.timeline };
}

const SCENE_SUMMARY_FIELD = '"sceneSummary":"<riassunto fedele della scena in 2-4 frasi: eventi, cambiamenti e come finisce, max 600 caratteri>",';
// The example is deliberately not valid JSON (placeholders in < >): a model that restates the format
// before answering must never get the template itself applied to the canon.
export const DELTA_REPLY_RULE =
  "Restituisci ESCLUSIVAMENTE JSON valido con SOLO le modifiche rispetto alla memoria precedente (NON ripetere le voci invariate), in questo formato, dove i testi fra < > vanno sostituiti: " +
  '{"mode":"delta",' + SCENE_SUMMARY_FIELD +
  '"characters":{"<nome>":"<scheda di stato completa>"},"locations":{},"factions":{},"items":{},"secrets":{"<id>":"<stato privato e quando rivelarlo>"},' +
  '"remove":{"characters":["<nome da eliminare>"],"timeline":["<evento diventato falso, copiato esattamente>"]},"timelineAdd":[<eventi nuovi essenziali, ciascuno fra virgolette>],"currentState":"<stato attuale della storia, max 2500 caratteri>"}. ' +
  `Una voce modificata va riportata per intero (max ${MEMORY_ENTRY_LIMIT} caratteri) ed è una SCHEDA DI STATO (chi o cosa è, tratti, relazioni, cosa sa, dove si trova, cosa possiede): le azioni della scena non vanno nelle schede. ` +
  "timelineAdd contiene solo eventi NUOVI che cambiano la storia (decisioni, scoperte, rivelazioni, spostamenti, conflitti, perdite), di norma da 1 a 5, mai gesti o sensazioni e mai eventi già presenti nella cronologia, nemmeno riformulati. " +
  'Usa {} o [] per ciò che non cambia e ometti "remove" se non elimini nulla.';
export const DELTA_REPLY_RULE_NO_SUMMARY = DELTA_REPLY_RULE.replace(SCENE_SUMMARY_FIELD, "");
