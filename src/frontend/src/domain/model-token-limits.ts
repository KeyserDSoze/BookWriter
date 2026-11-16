import type { AppSettings, EndpointProfile, ModelTokenLimits } from "./types";

export const MIN_MODEL_TOKENS = 256;
export const MAX_MODEL_TOKENS = 10_000_000;
const FORBIDDEN_IDS = ["__proto__", "constructor", "prototype"];

/** Italian prose is ~3.5 characters per token for common tokenizers; 3.4 errs on the safe side. */
export const CHARS_PER_TOKEN = 3.4;
export const estimateTextTokens = (system: string, prompt: string): number =>
  Math.ceil((system.length + prompt.length) / CHARS_PER_TOKEN);

export const isModelTokenCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= MIN_MODEL_TOKENS && value <= MAX_MODEL_TOKENS;

/** Limits typed by the author for one model; an absent field means "no limit declared". */
export function declaredModelTokenLimits(endpoint: EndpointProfile, modelId: string): ModelTokenLimits {
  const table = endpoint.modelTokenLimits;
  if (!table || !Object.prototype.hasOwnProperty.call(table, modelId)) return {};
  const entry = table[modelId];
  return {
    ...(isModelTokenCount(entry?.inputTokens) ? { inputTokens: entry!.inputTokens } : {}),
    ...(isModelTokenCount(entry?.outputTokens) ? { outputTokens: entry!.outputTokens } : {}),
  };
}

/** Functional update; empty limits remove the model's entry. */
export function withModelTokenLimits(endpoint: EndpointProfile, modelId: string, limits: ModelTokenLimits): EndpointProfile {
  if (!modelId || FORBIDDEN_IDS.includes(modelId)) throw new Error("Identificatore del modello non valido per i limiti di token.");
  const table: Record<string, ModelTokenLimits> = Object.assign(
    Object.create(null) as Record<string, ModelTokenLimits>, endpoint.modelTokenLimits ?? {});
  const next: ModelTokenLimits = {
    ...(limits.inputTokens === undefined ? {} : { inputTokens: limits.inputTokens }),
    ...(limits.outputTokens === undefined ? {} : { outputTokens: limits.outputTokens }),
  };
  if (Object.keys(next).length) table[modelId] = next;
  else delete table[modelId];
  return { ...endpoint, modelTokenLimits: Object.keys(table).length ? { ...table } : undefined };
}

/** Limits declared by a provider's /models/details (context_window = prompt + answer, max_output_tokens).
 * Input = window minus the answer (its declared maximum, else a quarter of the window up to 4096). null/missing = nothing. */
export function tokenLimitsFromDetails(payload: unknown): Record<string, ModelTokenLimits> {
  const result: Record<string, ModelTokenLimits> = {};
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) return result;
  for (const entry of data.slice(0, 2_000) as Array<Record<string, unknown> | null>) {
    const id = entry?.id;
    if (typeof id !== "string" || !id || id !== id.trim() || id.length > 256 || FORBIDDEN_IDS.includes(id)) continue;
    const window = isModelTokenCount(entry!.context_window) ? entry!.context_window : undefined;
    const maxOut = isModelTokenCount(entry!.max_output_tokens) && (window === undefined || entry!.max_output_tokens < window)
      ? entry!.max_output_tokens : undefined;
    const input = window === undefined ? undefined : window - (maxOut ?? Math.min(4096, Math.floor(window / 4)));
    const limits: ModelTokenLimits = {
      ...(input !== undefined && isModelTokenCount(input) ? { inputTokens: input } : {}),
      ...(maxOut === undefined ? {} : { outputTokens: maxOut }),
    };
    if (Object.keys(limits).length) result[id] = limits;
  }
  return result;
}

/** Fill only what the author has not typed: manual values are never overwritten. */
export function withDetectedTokenLimits(endpoint: EndpointProfile, models: readonly string[],
  detected: Record<string, ModelTokenLimits>): { limits: EndpointProfile["modelTokenLimits"]; filled: number } {
  let next = endpoint;
  let filled = 0;
  for (const model of models) {
    if (!Object.prototype.hasOwnProperty.call(detected, model)) continue;
    const have = declaredModelTokenLimits(next, model);
    const add = detected[model]!;
    const merged: ModelTokenLimits = { ...have,
      ...(have.inputTokens === undefined && add.inputTokens !== undefined ? { inputTokens: add.inputTokens } : {}),
      ...(have.outputTokens === undefined && add.outputTokens !== undefined ? { outputTokens: add.outputTokens } : {}) };
    if (merged.inputTokens === have.inputTokens && merged.outputTokens === have.outputTokens) continue;
    next = withModelTokenLimits(next, model, merged);
    filled++;
  }
  return { limits: next.modelTokenLimits, filled };
}

/** Output cap actually requested: the smaller of the book budget's reserve and the model's declared maximum. */
export function effectiveOutputTokens(limits: ModelTokenLimits, budgetReserve: number | undefined): number | undefined {
  const caps = [limits.outputTokens, budgetReserve].filter((n): n is number => n !== undefined);
  return caps.length ? Math.min(...caps) : undefined;
}

/** Runs on Save, on cloud profiles and on backup import: a limit outside the range is never ignored silently. */
export function assertModelTokenLimitSettings(settings: Pick<AppSettings, "endpoints">): void {
  for (const endpoint of settings.endpoints) {
    const table: unknown = endpoint.modelTokenLimits;
    if (table === undefined) continue;
    if (!table || typeof table !== "object" || Array.isArray(table))
      throw new Error("Limiti di token dei modelli non validi: correggi la configurazione.");
    const entries = Object.entries(table);
    if (entries.length > 2_000) throw new Error("Troppi limiti di token dei modelli.");
    for (const [id, entry] of entries) {
      const limits = entry as ModelTokenLimits | null;
      if (!id || id.length > 256 || id !== id.trim() || FORBIDDEN_IDS.includes(id) ||
          !limits || typeof limits !== "object" || Array.isArray(limits) ||
          Object.keys(limits).some(key => key !== "inputTokens" && key !== "outputTokens") ||
          (limits.inputTokens === undefined && limits.outputTokens === undefined) ||
          (limits.inputTokens !== undefined && !isModelTokenCount(limits.inputTokens)) ||
          (limits.outputTokens !== undefined && !isModelTokenCount(limits.outputTokens)))
        throw new Error(`I limiti di token devono essere interi tra ${MIN_MODEL_TOKENS} e ${MAX_MODEL_TOKENS.toLocaleString("it-IT")}.`);
    }
  }
}
