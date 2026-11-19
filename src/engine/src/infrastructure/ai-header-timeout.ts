/** Deadline for the request/headers phase of POST /chat/completions.
 * This is NOT the 60-second body-read deadline. Server inference may
 * legitimately take minutes, so authors can set 1–30 minutes per endpoint.
 * No secret, prompt, URL or raw provider exception belongs in an error. */
export const DEFAULT_CHAT_HEADER_TIMEOUT_SECONDS = 300;
export const MIN_CHAT_HEADER_TIMEOUT_SECONDS = 60;
export const MAX_CHAT_HEADER_TIMEOUT_SECONDS = 1800;

export class ProviderHeaderTimeoutError extends Error {
  constructor(hint = "") {
    super("Tempo scaduto in attesa degli header del provider AI. Nessun testo è stato applicato; il consumo potrebbe essere sconosciuto." + hint);
    this.name = "ProviderHeaderTimeoutError";
  }
}
export function chatHeaderTimeoutSeconds(value: unknown): number {
  if (value === undefined) return DEFAULT_CHAT_HEADER_TIMEOUT_SECONDS;
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
      value < MIN_CHAT_HEADER_TIMEOUT_SECONDS || value > MAX_CHAT_HEADER_TIMEOUT_SECONDS)
    throw new Error("Attesa header AI non valida: seleziona da 60 a 1800 secondi.");
  return value;
}
function authorAbort(): DOMException {
  return new DOMException("Generazione interrotta dall'autore.", "AbortError");
}
function cancelLateBody(response: Response): void {
  try { void response.body?.cancel().catch(() => { /* stream no longer available */ }); }
  catch { /* stream may be locked or already consumed */ }
}

/** Race the header deadline AND the author's signal against fetch itself.
 * Aborting a controller is insufficient when a test proxy or provider never
 * settles fetch(); Promise.race also releases the caller in that case.
 * Late 2xx replies are discarded, not parsed, and their body is cancelled.
 * Body reading then uses the original author signal and its own timeout. */
export async function fetchChatCompletionHeaders(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutSeconds?: number,
): Promise<Response> {
  const duration = chatHeaderTimeoutSeconds(timeoutSeconds) * 1000;
  if (signal.aborted) throw authorAbort();
  const controller = new AbortController();
  let expired = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(authorAbort());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      controller.abort();
      reject(new ProviderHeaderTimeoutError());
    }, duration);
  });
  try {
    if (signal.aborted) throw authorAbort();
    const pending = fetch(url, { ...init, signal: controller.signal }).then(response => {
      if (finished) cancelLateBody(response);
      return response;
    });
    const response = await Promise.race([pending, cancelled, timeout]);
    if (signal.aborted) {
      cancelLateBody(response);
      throw authorAbort();
    }
    if (expired) {
      cancelLateBody(response);
      throw new ProviderHeaderTimeoutError();
    }
    return response;
  } catch {
    if (signal.aborted) throw authorAbort();
    if (expired) throw new ProviderHeaderTimeoutError();
    throw new Error("Impossibile contattare l'endpoint AI. Controlla rete, URL e CORS.");
  } finally {
    finished = true;
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
