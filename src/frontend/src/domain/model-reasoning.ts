import type { EndpointProfile, ModelReasoningInfo, ReasoningLevel, TaskReasoning } from "./types";

export const REASONING_LEVELS: readonly ReasoningLevel[] = ["low", "medium", "high", "xhigh"];
export const REASONING_LEVEL_LABEL: Record<ReasoningLevel, string> = {
  low: "Low", medium: "Medium", high: "High", xhigh: "Extra high",
};

export type ReasoningSupport =
  | { status: "unknown" }
  | { status: "none" }
  | { status: "options"; options: ReasoningLevel[]; default?: ReasoningLevel };

const isLevel = (value: unknown): value is ReasoningLevel =>
  typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value);

/** What the provider reported for this model. Stored data is validated defensively. */
export function reasoningSupport(endpoint: EndpointProfile | undefined, modelId: string): ReasoningSupport {
  const catalog = endpoint?.modelReasoning;
  if (!catalog || typeof catalog !== "object" || !Object.prototype.hasOwnProperty.call(catalog, modelId))
    return { status: "unknown" };
  const info: ModelReasoningInfo | null | undefined = catalog[modelId];
  if (info === null) return { status: "none" };
  if (!info || typeof info !== "object" || !Array.isArray(info.options)) return { status: "unknown" };
  const options = REASONING_LEVELS.filter(level => info.options.includes(level));
  if (!options.length) return { status: "none" };
  return { status: "options", options, ...(isLevel(info.default) ? { default: info.default } : {}) };
}

/** A level is sent only when the model is not known to reject it. */
export function reasoningLevelSupported(support: ReasoningSupport, level: TaskReasoning): boolean {
  if (level === "automatic") return true;
  if (support.status === "unknown") return true;
  if (support.status === "none") return false;
  return support.options.includes(level);
}

/** Short Italian explanation shown next to every reasoning dropdown. */
export function describeReasoningSupport(support: ReasoningSupport, modelId: string): string {
  const model = modelId.trim() || "il modello";
  if (support.status === "unknown")
    return `Livelli di ${model} non verificati: premi «Leggi /models» sull'endpoint per leggerli (solo LM Studio).`;
  if (support.status === "none")
    return `${model} non dichiara un controllo del thinking: nessun livello verrà inviato.`;
  const levels = support.options.map(level => REASONING_LEVEL_LABEL[level]).join(", ");
  return `${model} supporta: ${levels}.` +
    (support.default ? ` Con «Automatico» usa il suo livello predefinito: ${REASONING_LEVEL_LABEL[support.default]}.` : "");
}
