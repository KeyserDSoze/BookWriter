import { TASK_KINDS, type AppSettings, type ReasoningLevel, type TaskKind, type TaskReasoningOverrides } from "./types";
import { REASONING_LEVELS, reasoningSupport } from "./model-reasoning";

/** Thinking is worth its latency where the answer is a judgement or a plan;
 * prose, structured JSON and bookkeeping do not need long chains of thought. */
export const RECOMMENDED_REASONING: Record<TaskKind, ReasoningLevel> = {
  brainstorm: "medium", validate: "medium", audience: "low", adversarial: "medium",
  outline: "medium", prose: "low", continuity: "low", consolidate: "low",
  summarize: "low", revision: "medium", merge: "low",
  chapterAudit: "low", chapterReaders: "low", chapterJudge: "high", chapterRepair: "low",
};

export interface ReasoningPresetResult {
  efforts: TaskReasoningOverrides;
  /** Tasks set from what the model reports. */
  applied: number;
  /** Tasks left untouched: the provider did not report the model's levels. */
  unverified: number;
  /** Tasks whose model reports no thinking control: any previous level was cleared. */
  withoutReasoning: number;
}

function nearest(options: readonly ReasoningLevel[], wanted: ReasoningLevel): ReasoningLevel {
  const rank = (level: ReasoningLevel) => REASONING_LEVELS.indexOf(level);
  const lower = options.filter(level => rank(level) <= rank(wanted));
  return lower.length ? lower[lower.length - 1]! : options[0]!;
}

/** Pure: builds the new per-task efforts from the levels each routed model declares. */
export function recommendedReasoningPreset(settings: AppSettings): ReasoningPresetResult {
  const efforts: TaskReasoningOverrides = { ...settings.taskReasoningEfforts };
  let applied = 0, unverified = 0, withoutReasoning = 0;
  for (const kind of TASK_KINDS) {
    const route = settings.taskRoutes[kind];
    const endpointId = route?.endpointId || settings.defaultRoute.endpointId;
    const modelId = route?.modelId || settings.defaultRoute.modelId;
    const support = reasoningSupport(settings.endpoints.find(e => e.id === endpointId), modelId);
    if (support.status === "unknown") { unverified++; continue; }
    if (support.status === "none") { delete efforts[kind]; withoutReasoning++; continue; }
    efforts[kind] = nearest(support.options, RECOMMENDED_REASONING[kind]);
    applied++;
  }
  return { efforts, applied, unverified, withoutReasoning };
}
