import { routeFor, type Activity, type AiPriceRate, type AppSettings, type BookAiBudget, type BookProject, type TaskKind } from "./types";
import { validTokenCount } from "./ai-usage";

export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const MAX_SAFE_RATE = 10_000;

export class AiBudgetStop extends Error {
  constructor(message: string) { super(message); this.name = "AiBudgetStop"; }
}
export interface AiBudgetAccounting {
  /** Estimates use user-entered rates, never provider invoices. */
  estimatedSpentEur: number;
  incompleteCount: number;
  unpricedCount: number;
  countedCalls: number;
}
export interface BudgetPreflight extends AiBudgetAccounting {
  estimatedNextEur: number;
  reservedInputTokens: number;
  reservedOutputTokens: number;
  limitEur: number;
  remainingEur: number;
}
export function isPriceRate(rate: AiPriceRate): boolean {
  return !!rate.endpointId.trim() && !!rate.modelId.trim() &&
    Number.isFinite(rate.inputEurPerMillion) && rate.inputEurPerMillion >= 0 &&
    rate.inputEurPerMillion <= MAX_SAFE_RATE &&
    Number.isFinite(rate.outputEurPerMillion) && rate.outputEurPerMillion >= 0 &&
    rate.outputEurPerMillion <= MAX_SAFE_RATE;
}
export function isBudgetValid(budget: BookAiBudget): boolean {
  return Number.isFinite(budget.limitEur) && budget.limitEur > 0 &&
    budget.limitEur <= 100_000 && Number.isSafeInteger(budget.maxOutputTokens) &&
    budget.maxOutputTokens >= 256 && budget.maxOutputTokens <= 32_768 &&
    !Number.isNaN(Date.parse(budget.enabledAt));
}
export function lookupRate(settings: AppSettings, endpointId: string, modelId: string): AiPriceRate | undefined {
  const matches = (settings.aiPriceRates ?? []).filter(r =>
    r.endpointId === endpointId && r.modelId === modelId);
  if (matches.length !== 1 || !isPriceRate(matches[0]!)) return undefined;
  return matches[0];
}
function pricedCost(input: number, output: number, rate: AiPriceRate): number {
  return (input * rate.inputEurPerMillion + output * rate.outputEurPerMillion) / 1_000_000;
}
function isBillableAttempt(activity: Activity): boolean {
  return activity.aiRequested === true ||
    (activity.aiRequested !== false && !!(activity.endpointId || activity.modelId));
}
export function accountBookAiBudget(
  activities: readonly Activity[], settings: AppSettings, budget: BookAiBudget,
): AiBudgetAccounting {
  const result: AiBudgetAccounting = {
    estimatedSpentEur: 0, incompleteCount: 0, unpricedCount: 0, countedCalls: 0,
  };
  const enabledSince = Date.parse(budget.enabledAt);
  if (!Number.isFinite(enabledSince)) return result;
  for (const activity of activities) {
    if (Date.parse(activity.createdAt) < enabledSince || !isBillableAttempt(activity)) continue;
    result.countedCalls++;
    const input = validTokenCount(activity.inputTokens);
    const output = validTokenCount(activity.outputTokens);
    if (input === undefined || output === undefined || activity.status === "running") {
      result.incompleteCount++;
      continue;
    }
    const rate = lookupRate(settings, activity.endpointId ?? "", activity.modelId ?? "");
    if (!rate) {
      result.unpricedCount++;
      continue;
    }
    result.estimatedSpentEur += pricedCost(input, output, rate);
  }
  return result;
}

/** A soft guard; it cannot promise a hard financial cap for remote billing.
 * Reserves for an entire response before the request, based on input UTF-8
 * bytes plus protocol overhead and an explicit max_tokens request.
 * No undocumented defaults, inferred provider prices or fictitious balances.
 */
export function preflightBookAiBudget(
  book: BookProject, settings: AppSettings, activities: readonly Activity[],
  kind: TaskKind, system: string, prompt: string,
): BudgetPreflight | undefined {
  const budget = book.aiBudget;
  if (!budget?.enabled) return;
  if (!isBudgetValid(budget)) throw new AiBudgetStop("Budget non valido. Aggiorna importo, data e massimo token output.");
  const route = routeFor(kind, settings, book);
  const rate = lookupRate(settings, route.endpointId, route.modelId);
  if (!rate) throw new AiBudgetStop(
    "Tariffa non configurata per " + route.modelId + " / " + route.endpointId +
    ". Imposta prezzi input/output in euro per milione di token, prima di riprendere.",
  );
  const accounting = accountBookAiBudget(activities, settings, budget);
  if (accounting.incompleteCount || accounting.unpricedCount) throw new AiBudgetStop(
    "Budget sospeso: " + accounting.incompleteCount + " chiamate senza usage completo e " +
    accounting.unpricedCount + " chiamate prive di un listino valido. Verifica la fatturazione " +
    "del provider; i consumi sconosciuti non vengono trattati come zero.",
  );
  // Conservative approximation rather than a tokenizer-specific claim.
  const payloadBytes = new TextEncoder().encode(JSON.stringify({
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
  })).length;
  const reservedInputTokens = payloadBytes + 256;
  const reservedOutputTokens = budget.maxOutputTokens;
  const estimatedNextEur = pricedCost(reservedInputTokens, reservedOutputTokens, rate);
  if (!Number.isFinite(estimatedNextEur) ||
      accounting.estimatedSpentEur + estimatedNextEur >= budget.limitEur - 1e-9) {
    throw new AiBudgetStop(
      "Budget stimato raggiunto o insufficiente per la prossima chiamata (" +
      (accounting.estimatedSpentEur + estimatedNextEur).toFixed(4) + " € / " +
      budget.limitEur.toFixed(2) +
      " €). Aumenta consapevolmente la soglia o interrompi la redazione.",
    );
  }
  return {
    ...accounting, estimatedNextEur, reservedInputTokens, reservedOutputTokens,
    limitEur: budget.limitEur, remainingEur: budget.limitEur - accounting.estimatedSpentEur,
  };
}
