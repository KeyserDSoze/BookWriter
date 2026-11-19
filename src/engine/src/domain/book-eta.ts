import type { Activity, BookProject, Phase } from "./types";
import { chapterSegments } from "./editorial-board";

/** Observed, never invented: speed and remaining time come only from this book's finished AI tasks. */
export interface BookEta {
  tokensPerSecond?: number;
  /** Seconds still needed for the work the pipeline already knows about. */
  remainingSeconds?: number;
  remainingTasks: number;
  observedTasks: number;
  /** Some remaining work has no finished task of its kind to learn from: the estimate is a lower bound. */
  partial: boolean;
}

const RECENT = 40;
const DEFAULT_SCENE_CHARS = 3000;
const SEGMENT_CHARS = 10_000;

function seconds(activity: Activity): number | undefined {
  if (!activity.endedAt) return undefined;
  const value = (Date.parse(activity.endedAt) - Date.parse(activity.createdAt)) / 1000;
  return Number.isFinite(value) && value > 0 && value < 24 * 3600 ? value : undefined;
}

function mean(values: number[]): number | undefined {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
}

/** Segments the editorial board will read for a chapter (written text, or a typical scene for unwritten ones). */
function boardSegments(chapter: BookProject["chapters"][number], typicalChars: number): number {
  const written = chapter.scenes.every(scene => scene.text.trim());
  if (written) {
    try { return chapterSegments(chapter).length; } catch { /* fall through to an estimate */ }
  }
  const chars = chapter.scenes.reduce((sum, scene) => sum + (scene.text.trim().length || typicalChars), 0);
  return Math.max(1, Math.ceil(chars / SEGMENT_CHARS));
}

export function estimateBookEta(book: BookProject, activities: Activity[]): BookEta {
  const finished = activities
    .filter(a => a.aiRequested === true && a.status === "succeeded" && !a.interventionId)
    .slice(0, RECENT);
  const byPhase = new Map<Phase, number[]>();
  const all: number[] = [];
  let tokens = 0, tokenSeconds = 0;
  for (const activity of finished) {
    const duration = seconds(activity);
    if (duration === undefined) continue;
    all.push(duration);
    byPhase.set(activity.phase, [...(byPhase.get(activity.phase) ?? []), duration]);
    if (activity.outputTokens && activity.outputTokens > 0) { tokens += activity.outputTokens; tokenSeconds += duration; }
  }
  const overall = mean(all);
  const tokensPerSecond = tokenSeconds > 0 ? tokens / tokenSeconds : undefined;

  const written = book.chapters.flatMap(ch => ch.scenes).filter(s => s.text.trim());
  const typicalChars = written.length
    ? Math.round(written.reduce((sum, s) => sum + s.text.length, 0) / written.length) : DEFAULT_SCENE_CHARS;

  // Remaining task counts per phase, following the pipeline.
  const counts = new Map<Phase, number>();
  const add = (phase: Phase, n: number) => { if (n > 0) counts.set(phase, (counts.get(phase) ?? 0) + n); };
  const planning: Phase[] = ["brainstorm", "validate", "audience", "adversarial", "outline"];
  if (planning.includes(book.phase)) {
    add("brainstorm", book.phase === "brainstorm" ? 1 : 0);
    add("validate", ["brainstorm", "validate"].includes(book.phase) ? 1 : 0);
    add("audience", book.phase === "audience" ? 5 - book.audienceReviews.length :
      ["brainstorm", "validate"].includes(book.phase) ? 5 : 0);
    add("adversarial", planning.indexOf(book.phase) <= planning.indexOf("adversarial") ? 1 : 0);
    add("outline", 1);
  }
  for (const chapter of book.chapters) {
    const unfinishedScenes = chapter.scenes.filter(s => s.status !== "canon");
    for (const scene of unfinishedScenes) {
      add("prose", scene.text.trim() ? 0 : 1);
      add("review", 1);
      add("consolidate", 1);
    }
    if (!chapter.frozenAt) {
      // Twelve reviewers and one summary per segment, plus the judge: one clean round, no repairs.
      add("chapterReview", boardSegments(chapter, typicalChars) * 13 + 1);
    }
  }

  let remainingTasks = 0, total = 0, partial = false;
  for (const [phase, n] of counts) {
    remainingTasks += n;
    const typical = mean(byPhase.get(phase) ?? []) ?? overall;
    if (typical === undefined) { partial = true; continue; }
    if (!byPhase.has(phase)) partial = true;
    total += typical * n;
  }
  return {
    ...(tokensPerSecond === undefined ? {} : { tokensPerSecond }),
    ...(overall === undefined || remainingTasks === 0 ? {} : { remainingSeconds: Math.round(total) }),
    remainingTasks, observedTasks: all.length, partial,
  };
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 1) return "meno di un minuto";
  if (minutes < 90) return minutes + " min";
  const hours = totalSeconds / 3600;
  if (hours < 48) return (hours < 10 ? hours.toFixed(1).replace(".", ",") : Math.round(hours)) + " ore";
  return Math.round(hours / 24) + " giorni";
}

/** One plain-language line, or undefined while there is nothing observed to base it on. */
export function describeEta(eta: BookEta): string | undefined {
  if (!eta.observedTasks) return undefined;
  const parts: string[] = [];
  if (eta.tokensPerSecond !== undefined)
    parts.push("velocità del modello ~" + eta.tokensPerSecond.toFixed(1).replace(".", ",") + " token/s");
  if (eta.remainingSeconds !== undefined)
    parts.push("tempo stimato rimanente " + (eta.partial ? "almeno " : "circa ") + formatDuration(eta.remainingSeconds) +
      " (" + eta.remainingTasks + " task, un solo giro di revisione)");
  return parts.length ? parts.join(" · ") : undefined;
}
