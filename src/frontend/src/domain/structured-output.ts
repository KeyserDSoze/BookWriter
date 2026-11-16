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
  `\n\nConsegna il risultato chiamando la funzione ${SUBMIT_TOOL_NAME}: gli argomenti della funzione sono l'oggetto JSON richiesto, nel formato indicato sopra. Non scrivere altro testo.`;

/** True only for an OpenAI-compatible call expecting one JSON object, to a model the author
 * explicitly tagged «tools». The role is never guessed from the model name. */
export function usesToolOutput(
  endpoint: EndpointProfile, modelId: string, expectsJson: boolean | undefined, nativeProtocol: boolean,
): boolean {
  if (!expectsJson || nativeProtocol) return false;
  if (structuredOutputMode(endpoint.structuredOutput) === "off") return false;
  return declaredModelCapabilities(endpoint, modelId).includes("tools");
}

export function toolRequestFields(): { tools: unknown[]; tool_choice: unknown } {
  return {
    tools: [{
      type: "function",
      function: {
        name: SUBMIT_TOOL_NAME,
        description: "Consegna il risultato finale del compito come oggetto JSON.",
        parameters: { type: "object", additionalProperties: true },
      },
    }],
    tool_choice: { type: "function", function: { name: SUBMIT_TOOL_NAME } },
  };
}

/** The arguments of the submit call in a reply message, or undefined when the model answered in text.
 * Untrusted: only a non-empty string from the expected function counts. */
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
    if (typeof args === "string" && args.trim()) return args;
  }
  return undefined;
}
