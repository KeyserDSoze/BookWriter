import type { AppSettings } from "./types";

/** What happens to the prompt and reply of every AI task after it is shown.
 * The text arriving from the model is ALWAYS shown while it arrives. This policy
 * only decides how long it stays readable afterwards:
 *  - temporary (default): the last `maxTasks` tasks, none older than `maxMinutes`;
 *  - kept: no automatic deletion (the author opted in), optionally also written to
 *    the book's GitHub repository (a second, separate opt-in). */
export const AI_TRACE_DEFAULT_MAX_TASKS = 20;
export const AI_TRACE_DEFAULT_MAX_MINUTES = 10 * 24 * 60;
export const AI_TRACE_MIN_TASKS = 1;
export const AI_TRACE_MAX_TASKS = 500;
export const AI_TRACE_MIN_MINUTES = 5;
export const AI_TRACE_MAX_MINUTES = 365 * 24 * 60;
export const AI_TRACE_AGE_PRESETS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 30, label: "30 minuti" }, { minutes: 60, label: "1 ora" },
  { minutes: 360, label: "6 ore" }, { minutes: 1_440, label: "1 giorno" },
  { minutes: 4_320, label: "3 giorni" }, { minutes: 14_400, label: "10 giorni" },
  { minutes: 43_200, label: "30 giorni" }, { minutes: 129_600, label: "90 giorni" },
];

export interface AiTraceRetention { maxTasks: number; maxMinutes: number }
export interface AiTracePolicy extends AiTraceRetention {
  /** Keep every conversation until the author deletes it. */
  keepForever: boolean;
  /** Also write the kept conversations to GitHub with the book. Implies keepForever. */
  sendToGitHub: boolean;
}

type PolicySource = Pick<AppSettings,
  "inspectAiRequests" | "keepAiConversations" | "syncAiConversationsToGitHub" | "aiTraceRetention">;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Pure and total: unknown or corrupted values fall back to the defaults. A book of
 * an older version that opted in to local inspection (inspectAiRequests) keeps its
 * conversations, but is never promoted to GitHub without a new, explicit choice. */
export function aiTracePolicy(settings: PolicySource): AiTracePolicy {
  const keepForever = settings.keepAiConversations ?? settings.inspectAiRequests === true;
  return {
    keepForever,
    sendToGitHub: keepForever && settings.syncAiConversationsToGitHub === true,
    maxTasks: clampInt(settings.aiTraceRetention?.maxTasks, AI_TRACE_MIN_TASKS, AI_TRACE_MAX_TASKS, AI_TRACE_DEFAULT_MAX_TASKS),
    maxMinutes: clampInt(settings.aiTraceRetention?.maxMinutes, AI_TRACE_MIN_MINUTES, AI_TRACE_MAX_MINUTES, AI_TRACE_DEFAULT_MAX_MINUTES),
  };
}

export interface AiTraceMetaEntry { activityId: string; bookId: string; createdAt: string; kept: boolean }

function timeOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Which temporary conversations to delete now. Kept conversations and the ones of a
 * request still in flight are never returned. A conversation goes away when it is
 * older than `maxMinutes`, or when more than `maxTasks` newer temporary ones exist. */
export function expiredAiTraceIds(
  entries: readonly AiTraceMetaEntry[], retention: AiTraceRetention, now: number,
  protectedIds: ReadonlySet<string> = new Set(),
): string[] {
  const temporary = entries.filter(entry => !entry.kept)
    .sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt) || a.activityId.localeCompare(b.activityId));
  const expired: string[] = [];
  const oldest = now - retention.maxMinutes * 60_000;
  temporary.forEach((entry, index) => {
    if (protectedIds.has(entry.activityId)) return;
    if (index >= retention.maxTasks || timeOf(entry.createdAt) < oldest) expired.push(entry.activityId);
  });
  return expired;
}

/** Plain-language summary of a policy, shown next to the settings and in Attività. */
export function describeAiTraceRetention(policy: AiTracePolicy): string {
  const age = AI_TRACE_AGE_PRESETS.find(preset => preset.minutes === policy.maxMinutes)?.label ??
    (policy.maxMinutes < 60 ? `${policy.maxMinutes} minuti`
      : policy.maxMinutes < 1_440 ? `${Math.round(policy.maxMinutes / 60)} ore`
        : `${Math.round(policy.maxMinutes / 1_440)} giorni`);
  return `ultimi ${policy.maxTasks} task, non più vecchi di ${age}`;
}
