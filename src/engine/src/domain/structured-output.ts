import { z } from "zod";
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
  `\n\nConsegna il risultato chiamando la funzione ${SUBMIT_TOOL_NAME}: i suoi parametri descrivono campo per campo l'oggetto richiesto. Dove il compito dice di rispondere con JSON, metti quell'oggetto COMPLETO negli argomenti della funzione, con tutti i campi obbligatori compilati. Non chiamarla mai con argomenti vuoti e non scrivere altro testo.`;

/** JSON schema of the submit function's arguments. */
export type ToolSchema = Record<string, unknown>;

// Limits and patterns stay with the validation after the call: in a constrained-decoding grammar they only add size.
const DROPPED_KEYWORDS = new Set(["$schema", "propertyNames", "minLength", "maxLength", "maxItems", "maxProperties", "pattern", "format", "default"]);

/** The parameters of the submit function for a JSON task, derived from the Zod schema that validates the reply,
 * so the two cannot drift. `descriptions` explain fields by dotted path (array items share the path: "decisions.findingId"). */
export function toolParameters(schema: z.ZodType, descriptions: Readonly<Record<string, string>> = {}): ToolSchema {
  const root = clean(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }), "", descriptions) as ToolSchema;
  return descriptions[""] ? { ...root, description: descriptions[""] } : root;
}
function clean(node: unknown, path: string, descriptions: Readonly<Record<string, string>>): unknown {
  if (Array.isArray(node)) return node.map(child => clean(child, path, descriptions));
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYWORDS.has(key) || (key === "additionalProperties" && value === false)) continue;
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => {
        const at = path ? path + "." + name : name;
        const cleaned = clean(child, at, descriptions) as Record<string, unknown>;
        return [name, descriptions[at] ? { ...cleaned, description: descriptions[at] } : cleaned];
      }));
    } else out[key] = clean(value, path, descriptions);
  }
  return out;
}
/** The same descriptions under a parent field (e.g. the sheets nested in a memory update). */
export function describeUnder(prefix: string, descriptions: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(descriptions).map(([path, text]) => [path ? prefix + "." + path : prefix, text]));
}

/** A forced function call is only worth it when `{}` is not a valid answer. */
export function hasRequiredFields(schema: ToolSchema | undefined): schema is ToolSchema {
  const required = schema?.required;
  return Array.isArray(required) && required.length > 0;
}

/** True for an OpenAI-compatible endpoint whose model the author explicitly tagged «tools», unless switched off.
 * The role is never guessed from the model name. */
export function toolOutputAvailable(endpoint: EndpointProfile, modelId: string): boolean {
  if (endpoint.apiProtocol === "lmstudio_native") return false;
  if (structuredOutputMode(endpoint.structuredOutput) === "off") return false;
  return declaredModelCapabilities(endpoint, modelId).includes("tools");
}

/** One function only, so "required" forces exactly it. The object form naming the function is ignored by
 * llama.cpp (it falls back to "auto", without the grammar) while "required" is understood by llama.cpp,
 * LM Studio, vLLM and the hosted OpenAI-compatible APIs. */
export function toolRequestFields(schema: ToolSchema): { tools: unknown[]; tool_choice: unknown } {
  return {
    tools: [{
      type: "function",
      function: {
        name: SUBMIT_TOOL_NAME,
        description: "Consegna il risultato finale del compito: gli argomenti sono l'oggetto completo descritto dai parametri.",
        parameters: schema,
      },
    }],
    tool_choice: "required",
  };
}

/** Some models wrap the result (`{"arguments":{…}}`, `{"result":{…}}`) or encode it twice as a JSON string.
 * Unwrap only when the outer value lacks the required fields and the single inner value has all of them;
 * anything else is returned unchanged and goes to the normal validation. */
export function normalizeToolArguments(args: string, schema: ToolSchema): string {
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
  if (!required.length) return args;
  const complete = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value) &&
    required.every(key => Object.prototype.hasOwnProperty.call(value, key));
  const parse = (text: string): unknown => { try { return JSON.parse(text) as unknown; } catch { return undefined; } };
  const outer = parse(args);
  const doubled = typeof outer === "string";
  const value = doubled ? parse(outer) : outer;
  if (complete(value)) return doubled ? JSON.stringify(value) : args;
  if (!value || typeof value !== "object" || Array.isArray(value)) return args;
  const inner = Object.values(value);
  if (inner.length !== 1) return args;
  const candidate = typeof inner[0] === "string" ? parse(inner[0]) : inner[0];
  return complete(candidate) ? JSON.stringify(candidate) : args;
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
