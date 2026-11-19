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
  /** Complete legacy rows priced with today's rate (not a saved historical quote). */
  legacyPricedCount: number;
}
export const AI_BUDGET_WARNING_FRACTION = 0.8;
export type AiBudgetHeadroomStatus = "sotto_soglia" | "vicino" | "raggiunto" | "incerto";
export interface AiBudgetHeadroom {
  status: AiBudgetHeadroomStatus;
  /** Based only on complete, priced observed usage — never provider credit. */
  knownRemainingEur?: number;
  /** Ratio of priced, reported usage to the configured local ceiling, not a billing ratio. */
  knownUsedFraction?: number;
}

/** Informational 80% notice. Missing usage outranks numeric margins; the
 * preflight remains the only call-level stop and also reserves future output.
 * Never infer a safe provider balance from an incomplete attempt.
 */
export function assessAiBudgetHeadroom(
  accounting: AiBudgetAccounting, limitEur: number,
): AiBudgetHeadroom {
  if (!Number.isFinite(limitEur) || limitEur <= 0 ||
      !Number.isFinite(accounting.estimatedSpentEur) || accounting.estimatedSpentEur < 0 ||
      accounting.incompleteCount > 0 || accounting.unpricedCount > 0) {
    return { status: "incerto" };
  }
  const fraction = accounting.estimatedSpentEur / limitEur;
  return {
    status: fraction >= 1 ? "raggiunto" :
      fraction >= AI_BUDGET_WARNING_FRACTION ? "vicino" : "sotto_soglia",
    knownRemainingEur: Math.max(0, limitEur - accounting.estimatedSpentEur),
    knownUsedFraction: fraction,
  };
}

export interface BudgetPreflight extends AiBudgetAccounting {
  estimatedNextEur: number;
  reservedInputTokens: number;
  reservedOutputTokens: number;
  limitEur: number;
  remainingEur: number;
  /** Optional per-run estimate. The global book guard always applies as well. */
  sessionLimitEur?: number;
  sessionSpentEur?: number;
  sessionCountedCalls?: number;
}
export function isPriceRate(rate: unknown): rate is AiPriceRate {
  // ZIP/IndexedDB may contain untrusted or legacy values.
  if (!rate || typeof rate !== "object" || Array.isArray(rate)) return false;
  const r = rate as Partial<AiPriceRate>;
  return typeof r.endpointId === "string" && !!r.endpointId.trim() &&
    typeof r.modelId === "string" && !!r.modelId.trim() &&
    typeof r.inputEurPerMillion === "number" && Number.isFinite(r.inputEurPerMillion) &&
    r.inputEurPerMillion >= 0 && r.inputEurPerMillion <= MAX_SAFE_RATE &&
    typeof r.outputEurPerMillion === "number" && Number.isFinite(r.outputEurPerMillion) &&
    r.outputEurPerMillion >= 0 && r.outputEurPerMillion <= MAX_SAFE_RATE &&
    (r.cachedInputEurPerMillion === undefined ||
      typeof r.cachedInputEurPerMillion === "number" && Number.isFinite(r.cachedInputEurPerMillion) &&
      r.cachedInputEurPerMillion >= 0 && r.cachedInputEurPerMillion <= MAX_SAFE_RATE);
}
export function isBudgetValid(budget: BookAiBudget): boolean {
  return Number.isFinite(budget.limitEur) && budget.limitEur > 0 &&
    budget.limitEur <= 100_000 && Number.isSafeInteger(budget.maxOutputTokens) &&
    budget.maxOutputTokens >= 256 && budget.maxOutputTokens <= 32_768 &&
    (budget.sessionLimitEur === undefined ||
      typeof budget.sessionLimitEur === "number" &&
      Number.isFinite(budget.sessionLimitEur) && budget.sessionLimitEur >= 0.01 &&
      budget.sessionLimitEur <= 100_000) &&
    !Number.isNaN(Date.parse(budget.enabledAt));
}
export function lookupRate(settings: AppSettings, endpointId: string, modelId: string): AiPriceRate | undefined {
  const matches = (settings.aiPriceRates ?? []).filter(r =>
    r.endpointId === endpointId && r.modelId === modelId);
  if (matches.length !== 1 || !isPriceRate(matches[0]!)) return undefined;
  return matches[0];
}
/** Persist a separate copy so later Settings edits cannot reprice past calls. */
export function snapshotPriceRate(
  settings: AppSettings, endpointId: string, modelId: string,
): AiPriceRate | undefined {
  const rate = lookupRate(settings, endpointId, modelId);
  return rate ? { ...rate } : undefined;
}
/** Cached input tokens (a subset of input) use the cached price when one is set; otherwise every
 * input token is priced as ordinary input. Unknown cache usage is never assumed. */
export function pricedCost(input: number, output: number, rate: AiPriceRate, cached?: number): number {
  const cachedTokens = cached !== undefined && rate.cachedInputEurPerMillion !== undefined
    ? Math.min(cached, input) : 0;
  return ((input - cachedTokens) * rate.inputEurPerMillion +
    cachedTokens * (rate.cachedInputEurPerMillion ?? 0) +
    output * rate.outputEurPerMillion) / 1_000_000;
}
export function isBillableAttempt(activity: Activity): boolean {
  return activity.aiRequested === true ||
    (activity.aiRequested !== false && !!(activity.endpointId || activity.modelId));
}

export type AiUsageCoverage = "completo" | "parziale" | "mancante" | "in_corso";
export type AiRateOrigin = "snapshot" | "listino_corrente" | "snapshot_non_valido" | "tariffa_assente";
export interface AiCostAssessment {
  /** Only provider-reported non-negative safe integers are admitted. */
  inputTokens?: number;
  outputTokens?: number;
  /** Provider-reported cached share of inputTokens, when present. */
  cachedInputTokens?: number;
  usageCoverage: AiUsageCoverage;
  rateOrigin: AiRateOrigin;
  rate?: AiPriceRate;
  /** Never present when usage is incomplete/in-flight or the rate is absent/invalid. */
  estimatedEur?: number;
}

/** Shared pricing decision for budget guard and local export: no invoice is known. */
export function assessAiCostAttempt(activity: Activity, settings: AppSettings): AiCostAssessment {
  const inputTokens = validTokenCount(activity.inputTokens);
  const outputTokens = validTokenCount(activity.outputTokens);
  const cachedInputTokens = validTokenCount(activity.cachedInputTokens);
  const usageCoverage: AiUsageCoverage = activity.status === "running" ? "in_corso" :
    inputTokens !== undefined && outputTokens !== undefined ? "completo" :
    inputTokens === undefined && outputTokens === undefined ? "mancante" : "parziale";
  const quote = activity.priceRateSnapshot;
  const invalidSnapshot = quote !== undefined && (!isPriceRate(quote) ||
    quote.endpointId !== activity.endpointId || quote.modelId !== activity.modelId);
  const rate = invalidSnapshot ? undefined : quote === undefined
    ? lookupRate(settings, activity.endpointId ?? "", activity.modelId ?? "")
    : quote;
  const rateOrigin: AiRateOrigin = invalidSnapshot ? "snapshot_non_valido" :
    !rate ? "tariffa_assente" : quote === undefined ? "listino_corrente" : "snapshot";
  return {
    inputTokens, outputTokens, cachedInputTokens, usageCoverage, rateOrigin, rate,
    ...(usageCoverage === "completo" && rate ? {
      estimatedEur: pricedCost(inputTokens!, outputTokens!, rate, cachedInputTokens),
    } : {}),
  };
}
export function accountBookAiBudget(
  activities: readonly Activity[], settings: AppSettings, budget: BookAiBudget,
): AiBudgetAccounting {
  const result: AiBudgetAccounting = {
    estimatedSpentEur: 0, incompleteCount: 0, unpricedCount: 0, countedCalls: 0,
    legacyPricedCount: 0,
  };
  const enabledSince = Date.parse(budget.enabledAt);
  if (!Number.isFinite(enabledSince)) return result;
  for (const activity of activities) {
    if (Date.parse(activity.createdAt) < enabledSince || !isBillableAttempt(activity)) continue;
    result.countedCalls++;
    const assessment = assessAiCostAttempt(activity, settings);
    if (assessment.usageCoverage !== "completo") {
      result.incompleteCount++;
      continue;
    }
    if (assessment.estimatedEur === undefined) {
      result.unpricedCount++;
      continue;
    }
    if (assessment.rateOrigin === "listino_corrente") result.legacyPricedCount++;
    result.estimatedSpentEur += assessment.estimatedEur;
  }
  return result;
}

/** An explicit Avvia/Riprendi runId is one *local* session; never a remote reservation.
 * The caller may provide mixed books (e.g. imported activity logs), so scope
 * both bookId and runId before applying exactly the book accounting rules.
 */
export function accountSessionAiBudget(
  activities: readonly Activity[], settings: AppSettings, budget: BookAiBudget,
  bookId: string, runId: string,
): AiBudgetAccounting {
  return accountBookAiBudget(
    activities.filter(activity => activity.bookId === bookId && activity.runId === runId),
    settings, budget,
  );
}

/** A soft guard; it cannot promise a hard financial cap for remote billing.
 * Reserves for an entire response before the request, based on input UTF-8
 * bytes plus protocol overhead and an explicit max_tokens request.
 * No undocumented defaults, inferred provider prices or fictitious balances.
 */
export function preflightBookAiBudget(
  book: BookProject, settings: AppSettings, activities: readonly Activity[],
  kind: TaskKind, system: string, prompt: string, runId?: string,
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
  // A separate, opt-in ceiling for one continuous Avvia/Riprendi session.
  // Every resume intentionally starts a new runId, but NEVER resets the book guard.
  let sessionAccounting: AiBudgetAccounting | undefined;
  if (budget.sessionLimitEur !== undefined) {
    if (!runId?.trim()) throw new AiBudgetStop(
      "Budget di sessione attivo: identificativo della sessione assente. Richiesta AI bloccata.",
    );
    sessionAccounting = accountSessionAiBudget(activities, settings, budget, book.id, runId);
    if (sessionAccounting.incompleteCount || sessionAccounting.unpricedCount) {
      throw new AiBudgetStop(
        "Budget di sessione sospeso: " + sessionAccounting.incompleteCount +
        " chiamate senza usage completo e " + sessionAccounting.unpricedCount +
        " senza tariffa valida. Non trattare consumi ignoti come zero.",
      );
    }
    if (sessionAccounting.estimatedSpentEur + estimatedNextEur >= budget.sessionLimitEur - 1e-9) {
      throw new AiBudgetStop(
        "Budget di sessione stimato raggiunto o insufficiente per la prossima chiamata (" +
        (sessionAccounting.estimatedSpentEur + estimatedNextEur).toFixed(4) + " € / " +
        budget.sessionLimitEur.toFixed(2) + " €). La richiesta non è stata inviata.",
      );
    }
  }
  return {
    ...accounting, estimatedNextEur, reservedInputTokens, reservedOutputTokens,
    limitEur: budget.limitEur, remainingEur: budget.limitEur - accounting.estimatedSpentEur,
    ...(sessionAccounting ? {
      sessionLimitEur: budget.sessionLimitEur,
      sessionSpentEur: sessionAccounting.estimatedSpentEur,
      sessionCountedCalls: sessionAccounting.countedCalls,
    } : {}),
  };
}
