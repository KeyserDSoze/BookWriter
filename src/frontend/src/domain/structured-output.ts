import type { EndpointProfile } from "./types";
import { declaredModelCapabilities } from "./model-capabilities";

/** «auto»: a model the author tagged «tools» delivers JSON results as function-call arguments.
 * «off»: always the plain text/JSON protocol. */
export const STRUCTURED_OUTPUT_MODES = ["auto", "off"] as const;
export type StructuredOutputMode = typeof STRUCTURED_OUTPUT_MODES[number];

export function structuredOutputMode(value: unknown): StructuredOutputMode {
  if (value === undefined || value === "auto") return "auto";
  if (value === "off") return "off";
  throw new Error("Output strutturato non valido: scegli Automatico oppure Disattivato nelle Impostazioni.");
}

/** The single function the model is forced to call. BookWriter never executes it: its
 * arguments are the model's answer and go through the same validation as any text reply. */
export const SUBMIT_TOOL_NAME = "submit_result";
export const SUBMIT_TOOL_NOTE =
  `\n\nConsegna il risultato chiamando la funzione ${SUBMIT_TOOL_NAME}: gli argomenti della funzione sono l'oggetto JSON COMPLETO richiesto, nel formato indicato sopra, con tutti i campi. Non chiamarla mai con argomenti vuoti e non scrivere altro testo.`;

/** `true`: any JSON object; an object: the JSON schema of the arguments (helps models that otherwise send `{}`). */
export type StructuredJson = true | Record<string, unknown>;

const str = { type: "string" };
/** The director's verdict: the fields every reply needs; the rest is validated after the call. */
export const JUDGE_RESULT_SCHEMA: Record<string, unknown> = {
  type: "object", additionalProperties: true, required: ["reasoning", "decisions"],
  properties: {
    reasoning: str,
    decisions: { type: "array", items: { type: "object", additionalProperties: true,
      required: ["findingId", "action", "rationale"],
      properties: { findingId: str, action: { type: "string", enum: ["accept", "reject"] }, rationale: str, remediation: str } } },
  },
};
/** A reviewer's report. */
export const REVIEW_REPORT_SCHEMA: Record<string, unknown> = {
  type: "object", additionalProperties: true, required: ["verdict", "summary", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "issues"] }, summary: str, memoryNote: str,
    findings: { type: "array", items: { type: "object", additionalProperties: true,
      required: ["sceneId", "category", "severity", "evidence", "reason", "remediation"],
      properties: { sceneId: str, category: str, severity: { type: "string", enum: ["critical", "major", "minor"] },
        evidence: str, reason: str, remediation: str } } },
  },
};

/** True only for an OpenAI-compatible call expecting one JSON object, to a model the author
 * explicitly tagged «tools». The role is never guessed from the model name. */
export function usesToolOutput(
  endpoint: EndpointProfile, modelId: string, expectsJson: boolean | undefined, nativeProtocol: boolean,
): boolean {
  if (!expectsJson || nativeProtocol) return false;
  if (structuredOutputMode(endpoint.structuredOutput) === "off") return false;
  return declaredModelCapabilities(endpoint, modelId).includes("tools");
}

export function toolRequestFields(schema?: Record<string, unknown>): { tools: unknown[]; tool_choice: unknown } {
  return {
    tools: [{
      type: "function",
      function: {
        name: SUBMIT_TOOL_NAME,
        description: "Consegna il risultato finale del compito come oggetto JSON completo.",
        parameters: schema ?? { type: "object", additionalProperties: true },
      },
    }],
    tool_choice: { type: "function", function: { name: SUBMIT_TOOL_NAME } },
  };
}

/** The arguments of the submit call in a reply message, or undefined when the model answered in text.
 * Untrusted: only a non-empty, non-`{}` string from the expected function counts. */
export function toolCallArguments(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const calls = (message as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(calls)) return undefined;
  for (const call of calls) {
    if (!call || typeof call !== "object") continue;
    const fn = (call as { function?: unknown }).function;
    if (!fn || typeof fn !== "object") continue;
    const { name, arguments: args } = fn as { name?: unknown; arguments?: unknown };
    if (name !== undefined && name !== SUBMIT_TOOL_NAME) continue;
    if (typeof args === "string" && args.trim() && !isEmptyJsonObject(args)) return args;
  }
  return undefined;
}

/** True when the reply asked for the submit function but carried no result (e.g. `{}`). */
export function hasEmptyToolCall(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const calls = (message as { tool_calls?: unknown }).tool_calls;
  return Array.isArray(calls) && calls.some(call => {
    const name = (call as { function?: { name?: unknown } } | null)?.function?.name;
    return name === undefined || name === SUBMIT_TOOL_NAME;
  });
}

function isEmptyJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
  } catch { return false; }
}
