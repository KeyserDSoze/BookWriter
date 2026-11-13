import type { Activity } from "./types";

export interface ModelUsage {
  endpointId: string;
  modelId: string;
  calls: number;
  completeReports: number;
  partialReports: number;
  missingReports: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  completedCalls: number;
  completeReports: number;
  partialReports: number;
  missingReports: number;
  failedActivities: number;
  interruptedActivities: number;
  runningActivities: number;
  models: ModelUsage[];
}

/**
 * The only reliable source is the provider's reported usage stored on each
 * Activity. Never infer prices, account balance, or usage on failed requests.
 * An Activity with only one side reported is PARTIAL, not a full measurement.
 */
export function validTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value : undefined;
}
/** Cached prompt tokens as reported by OpenAI-compatible providers (OpenAI, DeepSeek style). */
export function cachedTokensFromUsage(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const u = usage as { prompt_tokens_details?: unknown; prompt_cache_hit_tokens?: unknown };
  const details = u.prompt_tokens_details;
  const nested = details && typeof details === "object" && !Array.isArray(details)
    ? validTokenCount((details as { cached_tokens?: unknown }).cached_tokens) : undefined;
  return nested ?? validTokenCount(u.prompt_cache_hit_tokens);
}

export function summarizeAiUsage(activities: readonly Activity[]): UsageSummary {
  const byModel = new Map<string, ModelUsage>();
  const summary: UsageSummary = {
    inputTokens: 0, outputTokens: 0, totalTokens: 0,
    completedCalls: 0, completeReports: 0, partialReports: 0, missingReports: 0,
    failedActivities: 0, interruptedActivities: 0, runningActivities: 0,
    models: [],
  };
  for (const activity of activities) {
    if (activity.status === "failed") summary.failedActivities++;
    if (activity.status === "cancelled") summary.interruptedActivities++;
    if (activity.status === "running") {
      summary.runningActivities++;
      continue; // Unconfirmed in-flight token accounting.
    }
    const input = validTokenCount(activity.inputTokens);
    const output = validTokenCount(activity.outputTokens);
    const modelReferenced = !!activity.modelId || !!activity.endpointId;
    // Only count explicitly routed AI calls, or activities with provider usage.
    // Manual editorial actions and synchronization logs never inflate totals.
    if (!modelReferenced && input === undefined && output === undefined) continue;

    const endpointId = activity.endpointId || "(endpoint sconosciuto)";
    const modelId = activity.modelId || "(modello sconosciuto)";
    const key = JSON.stringify([endpointId, modelId]);
    let row = byModel.get(key);
    if (!row) {
      row = {
        endpointId, modelId, calls: 0, completeReports: 0,
        partialReports: 0, missingReports: 0, inputTokens: 0, outputTokens: 0,
      };
      byModel.set(key, row);
    }
    row.calls++;
    summary.completedCalls++;
    const complete = input !== undefined && output !== undefined;
    const missing = input === undefined && output === undefined;
    if (complete) { row.completeReports++; summary.completeReports++; }
    else if (missing) { row.missingReports++; summary.missingReports++; }
    else { row.partialReports++; summary.partialReports++; }
    row.inputTokens += input ?? 0;
    row.outputTokens += output ?? 0;
    summary.inputTokens += input ?? 0;
    summary.outputTokens += output ?? 0;
  }
  summary.totalTokens = summary.inputTokens + summary.outputTokens;
  summary.models = [...byModel.values()].sort((a, b) =>
    (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens) ||
    a.modelId.localeCompare(b.modelId));
  return summary;
}
