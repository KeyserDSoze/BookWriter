import type { AppSettings, BookProject, TaskKind } from "../domain/types";
import { routeFor } from "../domain/types";
import { decryptLocal } from "./crypto";
import { validTokenCount } from "../domain/ai-usage";
import { EmptyProviderContentError, MalformedProviderContentError } from "./ai-provider-error";
import { readChatCompletionJson } from "./ai-completion-response";
import { fetchChatCompletionHeaders, ProviderHeaderTimeoutError } from "./ai-header-timeout";

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

/** Select only explicitly supported Chat Completions output parameter.
 * Legacy endpoints retain max_tokens; no automatic retry with another field
 * because the first request may already have consumed billable tokens.
 */
export function chatOutputTokenParameter(value: unknown): "max_tokens" | "max_completion_tokens" {
  if (value === undefined || value === "max_tokens") return "max_tokens";
  if (value === "max_completion_tokens") return "max_completion_tokens";
  throw new Error("Parametro limite output AI non valido: scegli max_tokens oppure max_completion_tokens nelle Impostazioni.");
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
  // Fail closed on malformed local/imported settings before decrypting or POST.
  const outputField = chatOutputTokenParameter(endpoint.outputTokenParameter);
  if (options?.maxOutputTokens !== undefined &&
      (!Number.isSafeInteger(options.maxOutputTokens) ||
        options.maxOutputTokens < 1 || options.maxOutputTokens > 32_768)) {
    throw new Error("Limite output AI non valido: usa un intero tra 1 e 32768 token.");
  }
  const base = normalizeEndpoint(endpoint.baseUrl);
  const apiKey = await decryptLocal(endpoint.secret);
  if (signal.aborted) throw new DOMException("Generazione interrotta dall'autore.", "AbortError");

  let response: Response;
  try {
    response = await fetchChatCompletionHeaders(`${base}/chat/completions`, {
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
        ...(options?.maxOutputTokens !== undefined ? { [outputField]: options.maxOutputTokens } : {}),
      }),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }, signal, endpoint.headerTimeoutSeconds);
  } catch (e) {
    if (signal.aborted) throw new DOMException("Interrotto", "AbortError");
    if (e instanceof ProviderHeaderTimeoutError) throw e;
    throw new Error("Impossibile contattare l'endpoint AI. Controlla rete, URL e CORS.");
  }
  if (signal.aborted) throw new DOMException("Generazione interrotta dall'autore.", "AbortError");
  if (!response.ok) {
    // Do not read untrusted error payloads; release the stream best effort.
    // Cancellation is not a second request and must not hide the HTTP status.
    try {
      void response.body?.cancel().catch(() => {});
    } catch {
      // Some custom Response/stream implementations can throw synchronously.
      // Preserve the original HTTP failure instead of replacing it.
    }
    const reason = friendlyApiError(response.status);
    // A rejected request may have been billed; never inspect provider body or retry.
    if ((response.status === 400 || response.status === 422) && options?.maxOutputTokens !== undefined) {
      throw new Error(`${reason} Controlla anche il parametro limite output API nelle Impostazioni e la documentazione del provider prima di riprovare manualmente.`);
    }
    throw new Error(reason);
  }

  const payload = await readChatCompletionJson(response, signal);
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

const MAX_MODEL_CATALOG_BYTES = 256_000;
const MAX_MODEL_CATALOG_ITEMS = 2_000;
const MAX_MODEL_ID_LENGTH = 256;
const MODEL_CATALOG_TIMEOUT_MS = 12_000;

class ModelCatalogError extends Error {
  constructor(message: string) { super(message); this.name = "ModelCatalogError"; }
}
function invalidModelCatalog(): ModelCatalogError {
  return new ModelCatalogError(
    "Catalogo modelli non valido: conserva i modelli precedenti o inserisci manualmente il nome.");
}

/** A provider response is untrusted even with HTTP 200. Never buffer an
 * unbounded model catalogue, trust Content-Length alone or log its body. */
async function boundedModelCatalog(response: Response, signal: AbortSignal): Promise<unknown> {
  const mime = response.headers.get("content-type") ?? "";
  if (mime && !/\/json(?:\s*;|$)|\+json(?:\s*;|$)/i.test(mime))
    throw invalidModelCatalog();
  const rawLength = response.headers.get("content-length");
  if (rawLength !== null) {
    if (!/^\d+$/.test(rawLength.trim())) throw invalidModelCatalog();
    if (Number(rawLength) > MAX_MODEL_CATALOG_BYTES)
      throw new ModelCatalogError("Catalogo modelli troppo grande: usa l'inserimento manuale.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw invalidModelCatalog();
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(invalidModelCatalog());
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  let complete = false;
  try {
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      // The 12 s request deadline also covers a provider that never finishes
      // its response body even if reader.read() ignores AbortController.
      const chunk = await Promise.race([reader.read(), interrupted]);
      if (signal.aborted) throw invalidModelCatalog();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_MODEL_CATALOG_BYTES)
        throw new ModelCatalogError("Catalogo modelli troppo grande: usa l'inserimento manuale.");
      chunks.push(chunk.value);
    }
    if (signal.aborted) throw invalidModelCatalog();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw invalidModelCatalog();
    }
    if (signal.aborted) throw invalidModelCatalog();
    complete = true;
    return parsed;
  } catch (error) {
    if (error instanceof ModelCatalogError) throw error;
    throw invalidModelCatalog();
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    try {
      if (!complete) void reader.cancel().catch(() => { /* already closed */ });
    } catch { /* broken reader cannot override the original error */ }
    try { reader.releaseLock(); } catch { /* pending read may be active */ }
  }
}

/** GET /models is advisory. Malformed/empty responses must never replace an
 * existing catalogue with incomplete or non-string entries. */
export async function fetchModels(
  endpointUrl: string,
  secret: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const base = normalizeEndpoint(endpointUrl);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timeout = setTimeout(() => controller.abort(), MODEL_CATALOG_TIMEOUT_MS);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) throw new DOMException("Richiesta annullata.", "AbortError");
    let response: Response;
    // A provider/test proxy can ignore abort before headers. Do not wait for
    // the underlying fetch forever; the same deadline covers headers and body.
    let waitingForHeaders = true;
    let onDeadline: (() => void) | undefined;
    const interruptedHeaders = new Promise<never>((_, reject) => {
      onDeadline = () => reject(new Error("Ricerca modelli interrotta."));
      controller.signal.addEventListener("abort", onDeadline, { once: true });
      if (controller.signal.aborted) onDeadline();
    });
    try {
      const pendingHeaders = fetch(base + "/models", {
        method: "GET", mode: "cors", credentials: "omit",
        referrerPolicy: "no-referrer", cache: "no-store", redirect: "error",
        headers: { Authorization: "Bearer " + secret },
        signal: controller.signal,
      }).then(late => {
        if (!waitingForHeaders) {
          try { void late.body?.cancel().catch(() => {}); }
          catch { /* stale response may already be locked */ }
        }
        return late;
      });
      response = await Promise.race([pendingHeaders, interruptedHeaders]);
    } catch {
      throw new Error("Impossibile contattare il catalogo modelli: verifica rete, URL e CORS.");
    } finally {
      waitingForHeaders = false;
      if (onDeadline) controller.signal.removeEventListener("abort", onDeadline);
    }
    if (!response.ok) throw new Error(friendlyApiError(response.status));
    const parsed = await boundedModelCatalog(response, controller.signal);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw invalidModelCatalog();
    const data = (parsed as { data?: unknown }).data;
    if (!Array.isArray(data) || data.length === 0 || data.length > MAX_MODEL_CATALOG_ITEMS)
      throw invalidModelCatalog();
    const ids = new Set<string>();
    for (const entry of data) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw invalidModelCatalog();
      const id: unknown = (entry as { id?: unknown }).id;
      if (typeof id !== "string" || !id || id !== id.trim() ||
          id.length > MAX_MODEL_ID_LENGTH || /[\u0000-\u001f\u007f-\u009f]/u.test(id))
        throw invalidModelCatalog();
      ids.add(id);
    }
    return [...ids].sort();
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Richiesta annullata.", "AbortError");
    if (controller.signal.aborted)
      throw new ModelCatalogError("Timeout del catalogo modelli: usa l'inserimento manuale.");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
