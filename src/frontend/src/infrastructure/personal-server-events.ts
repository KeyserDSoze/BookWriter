/** Minimal, bounded Server-Sent Events parser. Input is hostile: nothing is
 * evaluated, unknown fields are ignored and an oversized line/event ends the stream. */
export interface ServerSentEvent { event: string; data: unknown }

export const MAX_SSE_EVENT_BYTES = 32 * 1024;

export async function* parseServerSentEvents(
  stream: ReadableStream<Uint8Array>, onChunk: () => void = () => undefined,
): AsyncGenerator<ServerSentEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  let dataBytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) return;
      onChunk();
      buffer += decoder.decode(part.value, { stream: true });
      let newline: number;
      while ((newline = buffer.search(/\r\n|\n|\r/)) !== -1) {
        const line = buffer.slice(0, newline);
        const terminator = buffer.startsWith("\r\n", newline) ? 2 : 1;
        // A lone trailing CR may be the first half of CRLF: wait for more bytes.
        if (buffer[newline] === "\r" && newline + 1 >= buffer.length) break;
        buffer = buffer.slice(newline + terminator);
        if (line === "") {
          if (data.length) {
            let parsed: unknown;
            try { parsed = JSON.parse(data.join("\n")); } catch { throw new Error("Evento del server non valido."); }
            yield { event, data: parsed };
          }
          event = "message"; data = []; dataBytes = 0;
        } else if (line.startsWith(":")) {
          continue;
        } else {
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "event") event = value.slice(0, 60);
          else if (field === "data") {
            dataBytes += value.length + 1;
            if (dataBytes > MAX_SSE_EVENT_BYTES) throw new Error("Evento del server oltre il limite.");
            data.push(value);
          }
        }
      }
      // Only the unfinished tail is bounded: a chunk may hold many complete small events.
      if (buffer.length > MAX_SSE_EVENT_BYTES) throw new Error("Evento del server oltre il limite.");
    }
  } finally {
    try { void reader.cancel().catch(() => undefined); } catch { /* best effort */ }
    try { reader.releaseLock(); } catch { /* a pending read may still hold it */ }
  }
}
