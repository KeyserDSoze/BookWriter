import type { AppSettings } from "../domain/types";
import { declaredModelCapabilities } from "../domain/model-capabilities";
import { decryptLocal } from "./crypto";
import { endpointAuthMode, normalizeEndpoint } from "./ai";

export const MAX_EMBED_BATCH = 8;
const MAX_EMBED_INPUT = 1600;
const MAX_EMBED_BODY_BYTES = 2_000_000;
const MAX_EMBED_DIMS = 4096;
const EMBED_TIMEOUT_MS = 40_000;

export interface EmbeddingSelection {
  endpointId: string;
  modelId: string;
}

/** Explicit opt-in: semantic scene retrieval only supports loopback by design.
 * Never silently send book passages to a configured cloud embedding provider. */
export function localEmbeddingSelection(settings: AppSettings): EmbeddingSelection {
  const route = settings.capabilityRoutes?.embedding;
  if (!route?.modelId.trim()) throw new Error("Seleziona un modello Embedding predefinito nelle Impostazioni.");
  const endpoint = settings.endpoints.find(x => x.id === route.endpointId);
  if (!endpoint || !declaredModelCapabilities(endpoint, route.modelId).includes("embedding"))
    throw new Error("Il modello Embedding selezionato non è etichettato per questo ruolo.");
  const base = normalizeEndpoint(endpoint.baseUrl);
  const host = new URL(base).hostname;
  if (host !== "localhost" && host !== "127.0.0.1")
    throw new Error("Per questa ricerca del manoscritto è consentito solo un modello embedding su localhost.");
  endpointAuthMode(endpoint.authMode, base);
  return { endpointId: endpoint.id, modelId: route.modelId };
}

function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 2 &&
    value.length <= MAX_EMBED_DIMS &&
    value.every(n => typeof n === "number" && Number.isFinite(n)) &&
    value.some(n => n !== 0);
}
function validateEmbeddingPayload(payload: unknown, count: number): number[][] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Risposta Embedding non valida.");
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== count)
    throw new Error("Risposta Embedding incompleta o non valida.");
  const vectors: Array<number[] | undefined> = Array.from({ length: count });
  let dimension: number | undefined;
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("Risposta Embedding non valida.");
    const { index, embedding } = item as { index?: unknown; embedding?: unknown };
    if (typeof index !== "number" || !Number.isSafeInteger(index) ||
        index < 0 || index >= count || vectors[index] !== undefined ||
        !validVector(embedding) || (dimension !== undefined && dimension !== embedding.length))
      throw new Error("Vettori Embedding incompatibili o incompleti.");
    dimension = embedding.length;
    vectors[index] = embedding;
  }
  if (vectors.some(x => x === undefined)) throw new Error("Risposta Embedding incompleta.");
  return vectors as number[][];
}

/** Reads only bounded JSON; malformed/oversized provider data is discarded. */
async function boundedEmbeddingJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const mime = response.headers.get("content-type") ?? "";
  if (mime && !/\bapplication\/json\b|\+json\b/i.test(mime))
    throw new Error("Il provider Embedding non ha restituito JSON.");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length.trim()) ||
      Number(length) > MAX_EMBED_BODY_BYTES))
    throw new Error("Risposta Embedding troppo grande o non valida.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Risposta Embedding priva di dati.");
  const buffers: Uint8Array[] = [];
  let bytes = 0;
  let complete = false;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("Richiesta interrotta.", "AbortError");
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_EMBED_BODY_BYTES) throw new Error("Risposta Embedding troppo grande.");
      buffers.push(part.value);
    }
    if (signal.aborted) throw new DOMException("Richiesta interrotta.", "AbortError");
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const part of buffers) { buffer.set(part, offset); offset += part.length; }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
    complete = true;
    return parsed;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error("Risposta Embedding non valida o troppo grande.");
  } finally {
    if (!complete) { try { void reader.cancel().catch(() => {}); } catch { /* ignore */ } }
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

/** One batch = one bounded POST; no retry, no logging or persistence of vectors. */
export async function embedTextBatch(
  settings: AppSettings, texts: string[], signal: AbortSignal,
): Promise<number[][]> {
  const route = localEmbeddingSelection(settings);
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > MAX_EMBED_BATCH ||
      texts.some(x => typeof x !== "string" || !x.trim() || x.length > MAX_EMBED_INPUT))
    throw new Error("La ricerca accetta al massimo 8 testi brevi per richiesta.");
  const endpoint = settings.endpoints.find(x => x.id === route.endpointId)!;
  const base = normalizeEndpoint(endpoint.baseUrl);
  const mode = endpointAuthMode(endpoint.authMode, base);
  if (mode === "api_key" && !endpoint.secret)
    throw new Error("Chiave API mancante per il modello Embedding.");
  const key = mode === "api_key" ? await decryptLocal(endpoint.secret!) : null;
  if (mode === "api_key" && !key) throw new Error("Chiave API mancante per il modello Embedding.");
  if (signal.aborted) throw new DOMException("Ricerca annullata.", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  let pending = true;
  try {
    const request = fetch(base + "/embeddings", {
      method: "POST", mode: "cors", credentials: "omit", redirect: "error",
      referrerPolicy: "no-referrer", cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(key === null ? {} : { Authorization: "Bearer " + key }),
      },
      body: JSON.stringify({ model: route.modelId, input: texts }),
      signal: controller.signal,
    }).then(response => {
      if (!pending) {
        try { void response.body?.cancel().catch(() => {}); } catch { /* ignore */ }
      }
      return response;
    });
    const cancelled = new Promise<never>((_,reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error(
        "Timeout o annullamento del modello Embedding (40 secondi).")), { once:true });
      if (controller.signal.aborted) reject(new Error("Richiesta Embedding annullata."));
    });
    const response = await Promise.race([request, cancelled]);
    if (!response.ok) {
      try { void response.body?.cancel().catch(() => {}); } catch { /* ignore */ }
      throw new Error(`Modello Embedding non disponibile (HTTP ${response.status}). Controlla che LM Studio supporti /embeddings.`);
    }
    // The entire request (including response stream reading) has the same deadline.
    const payload = await Promise.race([boundedEmbeddingJson(response, controller.signal), cancelled]);
    if (controller.signal.aborted) throw new Error("Richiesta Embedding annullata.");
    return validateEmbeddingPayload(payload, texts.length);
  } finally {
    pending = false;
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    controller.abort();
  }
}
