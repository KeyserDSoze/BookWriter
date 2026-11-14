import { MAX_CLOUD_FILE_BYTES } from "../../domain/cloud-profile";
import { CloudError } from "./types";

export interface CloudRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}
export interface CloudResponse { status: number; text: string; headers: Headers }

const DEFAULT_TIMEOUT_MS = 20_000;

export function cloudHttpError(status: number, retryAfter?: string | null): CloudError {
  if (status === 401) return new CloudError("auth", "Sessione cloud scaduta o revocata: riconnetti l'account.", status);
  if (status === 403) return new CloudError("forbidden",
    "Permesso cloud negato (HTTP 403): controlla l'app registration, gli scope o lo spazio disponibile.", status);
  if (status === 404) return new CloudError("notfound", "Elemento cloud non trovato (HTTP 404).", status);
  if (status === 409 || status === 412)
    return new CloudError("conflict", "Il file cloud è stato modificato da un altro dispositivo.", status);
  if (status === 429) {
    const seconds = Number(retryAfter);
    return new CloudError("rate", "Troppe richieste al cloud" +
      (Number.isFinite(seconds) && seconds > 0 ? ": riprova tra " + Math.min(Math.ceil(seconds), 3600) + " secondi." : ": riprova tra poco."), status);
  }
  if (status >= 500) return new CloudError("server", "Il servizio cloud ha risposto con un errore (HTTP " + status + ").", status);
  return new CloudError("invalid", "Il servizio cloud ha rifiutato la richiesta (HTTP " + status + ").", status);
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new CloudError("invalid", "Risposta cloud troppo grande: file ignorato.");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new CloudError("invalid", "Risposta cloud troppo grande: file ignorato.");
      }
      chunks.push(value);
    }
  } finally { try { reader.releaseLock(); } catch { /* best effort */ } }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new CloudError("invalid", "Risposta cloud non valida (UTF-8)."); }
}

/** Every cloud call goes through here: HTTPS only, fixed hosts, no cookies, no
 * redirect, no referrer, bounded size and time. Status handling stays with the
 * caller; a non-2xx body is never read (it can echo request details). */
export async function cloudFetch(
  url: string, request: CloudRequest, allowedOrigins: readonly string[] | "any-https",
): Promise<CloudResponse> {
  let target: URL;
  try { target = new URL(url); } catch { throw new CloudError("config", "Indirizzo cloud non valido."); }
  if (target.protocol !== "https:" || target.username || target.password ||
      (allowedOrigins !== "any-https" && !allowedOrigins.includes(target.origin)))
    throw new CloudError("config", "Indirizzo cloud non autorizzato.");
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort();
  if (request.signal?.aborted) controller.abort();
  request.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetch(target.toString(), {
        method: request.method ?? "GET", headers: request.headers, body: request.body,
        mode: "cors", credentials: "omit", cache: "no-store", redirect: "error",
        referrerPolicy: "no-referrer", signal: controller.signal,
      });
    } catch {
      if (request.signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
      throw new CloudError("network", timedOut
        ? `Il cloud non ha risposto entro ${Math.round(timeoutMs / 1000)} secondi.`
        : "Cloud non raggiungibile. Controlla rete e autorizzazioni del browser.");
    }
    if (response.status < 200 || response.status > 299) {
      void response.body?.cancel().catch(() => undefined);
      return { status: response.status, text: "", headers: response.headers };
    }
    const text = await readBounded(response, request.maxBytes ?? MAX_CLOUD_FILE_BYTES + 16_384);
    return { status: response.status, text, headers: response.headers };
  } catch (error) {
    if (error instanceof CloudError || (error instanceof DOMException && error.name === "AbortError")) throw error;
    if (request.signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
    throw new CloudError("network", timedOut
      ? `Il cloud non ha risposto entro ${Math.round(timeoutMs / 1000)} secondi.`
      : "Cloud non raggiungibile. Controlla rete e autorizzazioni del browser.");
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
  }
}
