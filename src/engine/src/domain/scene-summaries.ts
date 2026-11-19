import { z } from "zod";
import type { BookProject, Chapter, Scene } from "./types";
import { carryReviewedStamp, currentStamp } from "./book-edits";

/** Scene summaries are derived data: written by the model from the scene text, never
 * a fallback cut of the prose. A scene whose summary is missing or outdated carries
 * `summaryStale`; the autopilot rewrites those summaries before the chapter's board. */
export const MAX_SUMMARY_SCENE_CHARS = 60_000;
export const MAX_SUMMARY_BATCH_CHARS = 48_000;
export const MAX_SUMMARY_BATCH = 8;

/** Written scenes of a chapter that need a (new) summary. Very long scenes are left to the
 * author (no silent truncation): they keep their «da aggiornare» badge. */
export function scenesNeedingSummary(chapter: Chapter): Scene[] {
  return [...chapter.scenes].sort((a, b) => a.number - b.number)
    .filter(s => s.status !== "planned" && !!s.text.trim() && s.summaryStale === true && s.text.length <= MAX_SUMMARY_SCENE_CHARS);
}
/** One call's worth of scenes, in book order; a long scene goes alone. */
export function summaryBatch(scenes: readonly Scene[]): Scene[] {
  const out: Scene[] = [];
  let size = 0;
  for (const scene of scenes) {
    if (out.length && (size + scene.text.length > MAX_SUMMARY_BATCH_CHARS || out.length >= MAX_SUMMARY_BATCH)) break;
    out.push(scene);
    size += scene.text.length;
  }
  return out;
}
export const sceneSummariesReplySchema = z.object({
  sceneSummaries: z.record(z.string(), z.string().trim().min(20).max(800)),
});
export function sceneSummariesPrompt(scenes: readonly Scene[]): string {
  return [
    "Scrivi un riassunto fedele di OGNI scena qui sotto: 2-4 frasi su cosa accade, cosa cambia e come finisce. Non inventare, non giudicare, non anticipare scene successive.",
    'Rispondi ESCLUSIVAMENTE JSON {"sceneSummaries":{"ID scena":"riassunto"}} con tutti gli ID elencati.',
    ...scenes.map(scene => `SCENA ${scene.id} «${scene.title}»:\n${scene.text}`),
  ].join("\n\n");
}
/** Every requested scene must have its summary (fail closed); a scene whose text changed
 * during the call keeps its stale flag, so its next summary reads the new text. */
export function applySceneSummaries(book: BookProject, expected: ReadonlyArray<{ id: string; text: string }>, raw: unknown): number {
  const reply = sceneSummariesReplySchema.parse(raw);
  const missing = expected.filter(item => !Object.hasOwn(reply.sceneSummaries, item.id));
  if (missing.length) throw new Error("Mancano i riassunti di " + missing.map(item => item.id).slice(0, 5).join(", ") + ": restituiscili tutti.");
  let applied = 0;
  for (const item of expected) {
    const scene = book.chapters.flatMap(c => c.scenes).find(s => s.id === item.id);
    if (!scene || scene.text !== item.text) continue;
    const target = { kind: "scene" as const, id: scene.id };
    const before = currentStamp(book, target);
    scene.summary = reply.sceneSummaries[item.id]!.trim();
    delete scene.summaryStale;
    // Same text, new summary: a review of the scene stays valid.
    carryReviewedStamp(book, target, before);
    applied++;
  }
  return applied;
}
