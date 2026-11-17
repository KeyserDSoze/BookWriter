import type { InterruptedRun } from "../infrastructure/db";
import { readPref, writePref } from "./ui-prefs";

/**
 * After a RELOAD (F5, a restored or crashed tab) of a page whose autopilot was running, the
 * autopilot resumes by itself from the last checkpoint. The call that was in flight is lost
 * (and may still be billed): the author sees that in the notice. Three limits keep this from
 * spending money the author did not expect:
 *  - only a reload: opening the app from a link, a bookmark or a new tab never resumes;
 *  - only if the book was working a short while ago, not after hours or days away;
 *  - a per-device switch (Impostazioni → Questo dispositivo), on by default.
 * Budgets, the writer lock and the GitHub lease apply exactly as for a manual «Riprendi».
 */
export const AUTO_RESUME_WINDOW_MS = 15 * 60_000;
const CLOCK_TOLERANCE_MS = 5 * 60_000;
const PREF = "autoResume";

export const autoResumeEnabled = (): boolean => readPref<boolean>(PREF, true) !== false;
export const setAutoResumeEnabled = (value: boolean): void => writePref(PREF, value);

/** How this page was loaded: "reload" for F5 and restored tabs, "navigate" for a link or a new tab. */
export function pageLoadKind(): string {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return entry?.type ?? "unknown";
  } catch { return "unknown"; }
}

export interface AutoResumeInput {
  enabled: boolean; loadKind: string; runs: readonly InterruptedRun[]; now: number;
}
/** The one book to resume: the most recently active among those interrupted just now. */
export function pickAutoResume(input: AutoResumeInput): InterruptedRun | undefined {
  if (!input.enabled || input.loadKind !== "reload") return undefined;
  return input.runs
    .map(run => ({ run, at: Date.parse(run.lastActivityAt) }))
    .filter(({ at }) => Number.isFinite(at) && input.now - at <= AUTO_RESUME_WINDOW_MS && input.now - at >= -CLOCK_TOLERANCE_MS)
    .sort((a, b) => b.at - a.at)[0]?.run;
}
