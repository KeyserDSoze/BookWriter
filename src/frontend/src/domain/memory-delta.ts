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
const deltaSchema = z.object({
  mode: z.literal("delta"),
  sceneSummary: z.string().trim().min(20).max(800).optional(),
  characters: entries.optional(), locations: entries.optional(), factions: entries.optional(),
  items: entries.optional(), secrets: entries.optional(),
  remove: z.object({
    characters: removals.optional(), locations: removals.optional(), factions: removals.optional(),
    items: removals.optional(), secrets: removals.optional(),
  }).optional(),
  timelineAdd: z.array(z.string().min(3).max(400)).max(20).optional(),
  currentState: z.string().max(CURRENT_STATE_LIMIT).optional(),
});

export interface MemoryUpdate { memory: NarrativeMemory; sceneSummary?: string; mode: "delta" | "full" }

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Merge a delta reply (or accept a legacy full reply) into the previous memory. Never mutates it. */
export function applyMemoryResponse(previous: NarrativeMemory, parsedReply: unknown): MemoryUpdate {
  const mode = (parsedReply as { mode?: unknown } | null)?.mode;
  if (mode !== "delta") {
    const { sceneSummary, ...rest } = (parsedReply ?? {}) as { sceneSummary?: unknown };
    const memory = memorySchema.parse(rest) as NarrativeMemory;
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
  if (delta.timelineAdd?.length) next.timeline = [...next.timeline, ...delta.timelineAdd];
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
/** A compaction that does not shrink the memory would be repeated forever. */
export function assertCompactionShrinks(before: NarrativeMemory, after: NarrativeMemory): void {
  if (memorySize(after) > memorySize(before) * 0.85)
    throw new Error("La compattazione non ha ridotto abbastanza la memoria (serve almeno il 15% in meno). Nessuna modifica applicata: compattala a mano o usa un modello più capace.");
}

export const DELTA_REPLY_RULE =
  "Restituisci ESCLUSIVAMENTE JSON valido con SOLO le modifiche rispetto alla memoria precedente (NON ripetere le voci invariate), in questo formato: " +
  '{"mode":"delta","sceneSummary":"riassunto fedele della scena in 2-4 frasi: eventi, cambiamenti e come finisce (max 600 caratteri)",' +
  '"characters":{"nome":"nuovo stato completo"},"locations":{},"factions":{},"items":{},"secrets":{"id":"stato privato e quando rivelare"},' +
  '"remove":{"characters":["nome da eliminare"]},"timelineAdd":["nuovo evento"],"currentState":"riassunto dello stato attuale (max 2500 caratteri)"}. ' +
  `Una voce modificata va riportata per intero (max ${MEMORY_ENTRY_LIMIT} caratteri). Usa {} o [] per ciò che non cambia e ometti "remove" se non elimini nulla.`;
export const DELTA_REPLY_RULE_NO_SUMMARY = DELTA_REPLY_RULE
  .replace('"sceneSummary":"riassunto fedele della scena in 2-4 frasi: eventi, cambiamenti e come finisce (max 600 caratteri)",', "");
