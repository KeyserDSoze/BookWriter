import { afterEach, describe, expect, it, vi } from "vitest";
import { readChatCompletionStream } from "./ai-stream";

afterEach(() => { vi.useRealTimers(); });

/** SSE whose chunks arrive on a schedule (ms from start), then [DONE] unless it stalls. */
function scheduled(chunks: Array<{ at: number; data: string }>, finishAt?: number): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const { at, data } of chunks) setTimeout(() => { try { controller.enqueue(encoder.encode(data)); } catch { /* closed */ } }, at);
      if (finishAt !== undefined) setTimeout(() => {
        try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); } catch { /* closed */ }
      }, finishAt);
    },
  }), { headers: { "content-type": "text/event-stream" } });
}
const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`;

describe("Scadenza dello streaming = inattività, non durata totale", () => {
  it("un modello lento ma costante non viene interrotto oltre il limite di inattività", async () => {
    vi.useFakeTimers();
    // Total run time 450 ms with a 200 ms idle limit: every gap is 100 ms.
    const response = scheduled([100, 200, 300, 400].map((at, i) => ({ at, data: delta(`p${i} `) })), 450);
    const task = readChatCompletionStream(response, new AbortController().signal, undefined, 200);
    await vi.advanceTimersByTimeAsync(500);
    await expect(task).resolves.toMatchObject({ choices: [{ message: { content: "p0 p1 p2 p3 " } }] });
  });

  it("scade solo dopo un silenzio più lungo del limite e non applica testo", async () => {
    vi.useFakeTimers();
    const response = scheduled([{ at: 50, data: delta("inizio ") }]);
    const task = readChatCompletionStream(response, new AbortController().signal, undefined, 200);
    const outcome = expect(task).rejects.toThrow(/non ha inviato dati/);
    await vi.advanceTimersByTimeAsync(400);
    await outcome;
  });
});
