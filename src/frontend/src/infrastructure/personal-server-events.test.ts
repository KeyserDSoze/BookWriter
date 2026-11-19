import { describe, expect, it } from "vitest";
import { MAX_SSE_EVENT_BYTES, parseServerSentEvents } from "./personal-server-events";

const enc = new TextEncoder();
const streamOf = (chunks: Array<string | Uint8Array>) => new ReadableStream<Uint8Array>({
  start(controller) { for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? enc.encode(chunk) : chunk); controller.close(); },
});
async function collect(chunks: Array<string | Uint8Array>) {
  const events = [];
  for await (const event of parseServerSentEvents(streamOf(chunks))) events.push(event);
  return events;
}

describe("Parser SSE limitato", () => {
  it("riassembla eventi divisi fra chunk, CRLF, commenti e dati su più righe", async () => {
    const events = await collect([": commento\r\nevent: snapshot-re", "quired\r\ndata: {\"bookId\":", "\"a\"}\r\n\r\nevent: heartbeat\ndata: 1\ndata: \n\n"]);
    expect(events).toEqual([{ event: "snapshot-required", data: { bookId: "a" } }, { event: "heartbeat", data: 1 }]);
  });
  it("un CR finale può essere la metà di un CRLF: non crea un evento vuoto", async () => {
    const events = await collect(["event: x\ndata: 1\r", "\n\r", "\n"]);
    expect(events).toEqual([{ event: "x", data: 1 }]);
  });
  it("un chunk con molti eventi completi non viene scambiato per un evento troppo grande", async () => {
    const many = Array.from({ length: 4000 }, (_, n) => `event: live\ndata: {"n":${n}}\n\n`).join("");
    expect(many.length).toBeGreaterThan(MAX_SSE_EVENT_BYTES * 2);
    expect(await collect([many])).toHaveLength(4000);
  });
  it("rifiuta JSON non valido, eventi oltre il limite e UTF-8 non valido", async () => {
    await expect(collect(["event: x\ndata: {rotto\n\n"])).rejects.toThrow("non valido");
    await expect(collect(["event: x\ndata: " + "a".repeat(MAX_SSE_EVENT_BYTES + 10) + "\n\n"])).rejects.toThrow("limite");
    await expect(collect(["event: x\ndata: " + "b".repeat(MAX_SSE_EVENT_BYTES + 10)])).rejects.toThrow("limite");
    await expect(collect([new Uint8Array([0x65, 0x76, 0xff, 0xfe, 0x0a, 0x0a])])).rejects.toThrow();
  });
  it("ignora campi sconosciuti e un evento senza dati; non esegue nulla", async () => {
    expect(await collect(["id: 5\nretry: 10\nevent: solo\n\n", "foo: bar\nevent: ok\ndata: \"__proto__\"\n\n"]))
      .toEqual([{ event: "ok", data: "__proto__" }]);
  });
});
