import type { AppSettings, BookProject, TaskKind } from "../domain/types";
import { routeFor } from "../domain/types";
import { decryptLocal } from "./crypto";
import { validTokenCount } from "../domain/ai-usage";
import { EmptyProviderContentError, MalformedProviderContentError } from "./ai-provider-error";

export type ModelAnswer = {
  text: string;
  endpointId: string;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
};

export function normalizeEndpoint(raw: string): string {
  const url = new URL(raw.trim());
  const local = (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.protocol === "http:";
  if (url.protocol !== "https:" && !local) throw new Error("L'endpoint deve utilizzare HTTPS (HTTP consentito solo su localhost).");
  if (url.username || url.password || url.search || url.hash) throw new Error("Non includere credenziali, query o fragment nell'URL dell'endpoint.");
  return url.toString().replace(/\/$/, "");
}

function friendlyApiError(status: number): string {
  switch (status) {
    case 401: return "Autenticazione API non valida (HTTP 401): controlla la chiave.";
    case 403: return "Accesso al modello non autorizzato (HTTP 403).";
    case 404: return "Endpoint o modello non trovato (HTTP 404).";
    case 408: return "Timeout dal provider (HTTP 408).";
    case 429: return "Limite richieste o credito insufficiente (HTTP 429).";
    default: return `Errore del provider AI (HTTP ${status}). Verifica disponibilità e configurazione.`;
  }
}

/** Accept only plain text or a fully text-only array of OpenAI-compatible
 * content parts. Reject mixed/malformed parts instead of implicitly coercing
 * objects/numbers into prose or partially accepting a response.
 * Undefined denotes an invalid shape; whitespace remains an empty response. */
function responseTextContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const texts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object" || Array.isArray(part)) return undefined;
    const candidate = part as { type?: unknown; text?: unknown };
    if (candidate.type !== undefined && candidate.type !== "text") return undefined;
    if (typeof candidate.text !== "string") return undefined;
    texts.push(candidate.text);
  }
  return texts.join("\n");
}

export async function callModel(
  kind: TaskKind,
  system: string,
  prompt: string,
  settings: AppSettings,
  book: BookProject,
  signal: AbortSignal,
  options?: { maxOutputTokens?: number },
): Promise<ModelAnswer> {
  const assignment = routeFor(kind, settings, book);
  const endpoint = settings.endpoints.find(p => p.id === assignment.endpointId);
  if (!endpoint) throw new Error(`Endpoint non configurato per ${kind}.`);
  if (!assignment.modelId.trim()) throw new Error(`Seleziona il modello per l'attività ${kind} nelle Impostazioni.`);
  if (!endpoint.secret) throw new Error(`Chiave API mancante per l'endpoint ${endpoint.name}.`);
  const base = normalizeEndpoint(endpoint.baseUrl);
  const apiKey = await decryptLocal(endpoint.secret);

  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      mode: "cors",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: assignment.modelId,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        ...(options?.maxOutputTokens ? { max_tokens: options.maxOutputTokens } : {}),
      }),
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw new DOMException("Interrotto", "AbortError");
    throw new Error("Impossibile contattare l'endpoint AI. Controlla rete, URL e CORS.");
  }
  if (!response.ok) throw new Error(friendlyApiError(response.status));

  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error("Il provider AI non ha restituito JSON valido."); }
  if (!payload || typeof payload !== "object") throw new Error("Risposta AI non valida.");
  const data = payload as {
    choices?: unknown;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  const invalid = () => new MalformedProviderContentError(
    endpoint.id, assignment.modelId, data.usage);
  // A 2xx JSON envelope is not evidence of text. Validate every part before
  // returning a ModelAnswer; invalid text still carries provider usage into
  // the failed Activity, without exposing the raw response.
  if (!Array.isArray(data.choices) || !data.choices.length) throw invalid();
  const first: unknown = data.choices[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) throw invalid();
  const message: unknown = (first as {message?: unknown}).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) throw invalid();
  const content: unknown = (message as {content?: unknown}).content;
  if (content === null || content === undefined) throw new EmptyProviderContentError(
    endpoint.id, assignment.modelId, data.usage);
  const text = responseTextContent(content);
  if (text === undefined) throw invalid();
  if (!text.trim()) throw new EmptyProviderContentError(
    endpoint.id, assignment.modelId, data.usage);
  return {
    text: text.trim(), endpointId: endpoint.id, modelId: assignment.modelId,
    inputTokens: validTokenCount(data.usage?.prompt_tokens),
    outputTokens: validTokenCount(data.usage?.completion_tokens),
  };
}

export async function fetchModels(
  endpointUrl: string,
  secret: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const base = normalizeEndpoint(endpointUrl);
  const response = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${secret}` }, redirect: "error", signal,
  });
  if (!response.ok) throw new Error(friendlyApiError(response.status));
  const parsed = await response.json() as { data?: Array<{ id?: string }> };
  if (!Array.isArray(parsed.data)) throw new Error("Il provider non espone un elenco modelli standard.");
  return parsed.data.map(x => x.id).filter((x): x is string => !!x).sort();
}
