/** Defensive JSON reader for a single, non-streaming OpenAI-compatible
 * chat/completions reply. Provider text is untrusted, never logged.
 *
 * 2 MB is much larger than our capped editorial report/scene outputs but
 * bounded independently of a malicious HTTP Content-Length. It is a limit
 * on the entire UTF-8 JSON envelope, not a text-truncation allowance.
 */
export const MAX_CHAT_COMPLETION_BYTES = 2_000_000;
export const CHAT_COMPLETION_READ_TIMEOUT_MS = 60_000;

export class ProviderResponseReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderResponseReadError";
  }
}
function interrupted(): DOMException {
  return new DOMException("Generazione interrotta dall'autore.", "AbortError");
}
function invalidResponse(): ProviderResponseReadError {
  return new ProviderResponseReadError("Il provider AI non ha restituito JSON valido.");
}
function oversizedResponse(): ProviderResponseReadError {
  return new ProviderResponseReadError(
    "Risposta AI troppo grande: nessun testo è stato applicato. Controlla i limiti della generazione.",
  );
}
function stopBody(response: Response): void {
  try { void response.body?.cancel().catch(() => { /* already closed */ }); }
  catch { /* network stream may already be locked */ }
}

/** The timer starts when the HTTP headers have arrived, not while the model
 * is generating the response before headers. Both abort and timeout race
 * reader.read() so even a misbehaving custom stream cannot hang the UI.
 * readTimeoutMs is injectable only for deterministic unit tests. */
export async function readChatCompletionJson(
  response: Response,
  signal: AbortSignal,
  readTimeoutMs = CHAT_COMPLETION_READ_TIMEOUT_MS,
): Promise<unknown> {
  if (signal.aborted) {
    stopBody(response);
    throw interrupted();
  }

  const mime = response.headers.get("content-type") ?? "";
  if (mime && !/\/json(?:\s*;|$)|\+json(?:\s*;|$)/i.test(mime)) {
    stopBody(response);
    throw invalidResponse();
  }

  const rawLength = response.headers.get("content-length");
  if (rawLength !== null) {
    const length = rawLength.trim();
    if (!/^\d+$/.test(length)) {
      stopBody(response);
      throw invalidResponse();
    }
    if (Number(length) > MAX_CHAT_COMPLETION_BYTES) {
      stopBody(response);
      throw oversizedResponse();
    }
  }

  const reader = response.body?.getReader();
  if (!reader) throw invalidResponse();

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interruptedRead = new Promise<never>((_, reject) => {
    onAbort = () => reject(interrupted());
    signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      reject(new ProviderResponseReadError(
        "Tempo scaduto durante la lettura della risposta AI. Nessun testo è stato applicato.",
      ));
    }, readTimeoutMs);
  });
  let complete = false;
  try {
    let bytesRead = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await Promise.race([reader.read(), interruptedRead]);
      if (signal.aborted) throw interrupted();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_CHAT_COMPLETION_BYTES) throw oversizedResponse();
      chunks.push(chunk.value);
    }

    // No truncated prose or partial JSON. A completed, bounded body is
    // required before provider usage or message content can be trusted.
    const bytes = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (signal.aborted) throw interrupted();
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw invalidResponse();
    }
    if (signal.aborted) throw interrupted();
    complete = true;
    return parsed;
  } catch (error) {
    if (signal.aborted) throw interrupted();
    if (timedOut) throw new ProviderResponseReadError(
      "Tempo scaduto durante la lettura della risposta AI. Nessun testo è stato applicato.",
    );
    if (error instanceof ProviderResponseReadError) throw error;
    throw new ProviderResponseReadError(
      "Impossibile leggere la risposta del provider AI. Nessun testo è stato applicato.",
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (!complete) {
      // Do not await cancel(): the remote stream may ignore cancellation.
      // The rejection/timeout must be observable even in that situation.
      void reader.cancel().catch(() => { /* network may already be aborted */ });
    }
    try { reader.releaseLock(); } catch { /* pending read is being cancelled */ }
  }
}
