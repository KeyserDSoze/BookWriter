import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type AppSettings } from "../domain/types";
import { structuredOutputMode, toolCallArguments } from "../domain/structured-output";
import { callModel } from "./ai";

vi.mock("./crypto", () => ({ decryptLocal: vi.fn().mockResolvedValue("sk-fixture-not-a-real-key") }));
afterEach(() => vi.unstubAllGlobals());

function fixture(tagged: boolean) {
  const settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  settings.defaultRoute.modelId = "model-a";
  settings.endpoints[0]!.secret = { iv: "encrypted", data: "encrypted" };
  if (tagged) settings.endpoints[0]!.modelCapabilities = { "model-a": ["chat", "tools"] };
  const book = newBook("Una trama", "Il libro", "Prosa", "Adulti");
  return { settings, book };
}
const jsonResponse = (message: unknown) => new Response(JSON.stringify({
  choices: [{ message, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 3 },
}), { status: 200, headers: { "content-type": "application/json" } });
const body = (mock: ReturnType<typeof vi.fn>) =>
  JSON.parse((mock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
const toolMessage = (args: string) => ({
  content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "submit_result", arguments: args } }],
});
function sse(items: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const item of items) controller.enqueue(encoder.encode(`data: ${item}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}
const call = (settings: AppSettings, book: ReturnType<typeof newBook>, structuredJson?: true | false) =>
  callModel("chapterJudge", "Sistema", "Prompt", settings, book, new AbortController().signal,
    structuredJson ? { structuredJson: true as const } : {});

describe("Output strutturato via tools", () => {
  it("invia una sola funzione forzata solo per un modello col tag tools e un compito JSON", async () => {
    const { settings, book } = fixture(true);
    const request = vi.fn().mockResolvedValue(jsonResponse(toolMessage('{"verdict":"freeze"}')));
    vi.stubGlobal("fetch", request);
    const answer = await call(settings, book, true);
    expect(answer).toMatchObject({ text: '{"verdict":"freeze"}', inputTokens: 10, outputTokens: 3 });
    const sent = body(request) as { tools?: Array<{ function: { name: string } }>; tool_choice?: unknown;
      messages: Array<{ content: string }> };
    expect(sent.tools).toHaveLength(1);
    expect(sent.tools![0]!.function.name).toBe("submit_result");
    expect(sent.tool_choice).toEqual({ type: "function", function: { name: "submit_result" } });
    expect(sent.messages[0]!.content).toContain("submit_result");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("senza tag tools, con il compito non JSON o con l'opzione disattivata resta il protocollo testuale", async () => {
    for (const mode of ["no-tag", "no-json", "off"]) {
      const { settings, book } = fixture(mode !== "no-tag");
      if (mode === "off") settings.endpoints[0]!.structuredOutput = "off";
      const request = vi.fn().mockResolvedValue(jsonResponse({ content: '{"a":1}' }));
      vi.stubGlobal("fetch", request);
      const answer = await call(settings, book, mode === "no-json" ? false : true);
      expect(answer.text).toBe('{"a":1}');
      expect(body(request)).not.toHaveProperty("tools");
      expect(body(request)).not.toHaveProperty("tool_choice");
      expect((body(request).messages as Array<{ content: string }>)[0]!.content).toBe("Sistema");
    }
  });

  it("accetta il testo normale se il modello non chiama la funzione", async () => {
    const { settings, book } = fixture(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ content: '{"verdict":"repair"}' })));
    expect((await call(settings, book, true)).text).toBe('{"verdict":"repair"}');
  });

  it("ignora una funzione con un altro nome e senza testo fallisce", async () => {
    const { settings, book } = fixture(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      content: null, tool_calls: [{ function: { name: "altro", arguments: "{}" } }] })));
    await expect(call(settings, book, true)).rejects.toThrow(/senza testo/i);
  });

  it("una chiamata con argomenti vuoti {} non è un risultato: errore chiaro con usage, o testo se presente", async () => {
    const { settings, book } = fixture(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(toolMessage("{}"))));
    await expect(call(settings, book, true)).rejects.toThrow(/argomenti vuoti/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...toolMessage("{}"), content: '{"a":1}' })));
    expect((await call(settings, book, true)).text).toBe('{"a":1}');
  });

  it("passa lo schema dei parametri quando il compito lo fornisce", async () => {
    const { settings, book } = fixture(true);
    const request = vi.fn().mockResolvedValue(jsonResponse(toolMessage('{"x":1}')));
    vi.stubGlobal("fetch", request);
    await callModel("chapterJudge", "S", "P", settings, book, new AbortController().signal,
      { structuredJson: { type: "object", required: ["reasoning"] } });
    const sent = body(request) as { tools: Array<{ function: { parameters: unknown } }> };
    expect(sent.tools[0]!.function.parameters).toEqual({ type: "object", required: ["reasoning"] });
  });

  it("segnala se le funzioni sono richieste e come ha risposto il modello", async () => {
    const { settings, book } = fixture(true);
    const seen: boolean[] = [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(toolMessage('{"a":1}'))));
    const viaFunction = await callModel("chapterJudge", "S", "P", settings, book, new AbortController().signal,
      { structuredJson: true, onTools: r => seen.push(r) });
    expect(viaFunction.delivery).toBe("function");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ content: '{"a":1}' })));
    const viaText = await callModel("chapterJudge", "S", "P", settings, book, new AbortController().signal,
      { structuredJson: true, onTools: r => seen.push(r) });
    expect(viaText.delivery).toBe("text");
    const plain = fixture(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ content: "ok" })));
    const untagged = await callModel("chapterJudge", "S", "P", plain.settings, plain.book,
      new AbortController().signal, { structuredJson: true, onTools: r => seen.push(r) });
    expect(untagged.delivery).toBeUndefined();
    expect(seen).toEqual([true, true, false]);
  });

  it("legge gli argomenti della funzione dallo streaming SSE e li mostra come testo", async () => {
    const { settings, book } = fixture(true);
    settings.endpoints[0]!.streamMode = "sse";
    const chunk = (delta: unknown) => JSON.stringify({ choices: [{ index: 0, delta }] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([
      chunk({ reasoning_content: "ragiono" }),
      chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "submit_result", arguments: '{"verd' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'ict":"freeze"}' } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 7, completion_tokens: 2 } }),
    ])));
    const seen: string[] = [];
    const answer = await callModel("chapterJudge", "S", "P", settings, book, new AbortController().signal,
      { structuredJson: true, onProgress: d => { if (d.kind === "text") seen.push(d.text); } });
    expect(answer).toMatchObject({ text: '{"verdict":"freeze"}', inputTokens: 7, outputTokens: 2 });
    expect(seen.join("")).toBe('{"verdict":"freeze"}');
  });

  it("un rifiuto HTTP 400 non viene ritentato e spiega come disattivare i tools", async () => {
    const { settings, book } = fixture(true);
    const request = vi.fn().mockResolvedValue(new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", request);
    await expect(call(settings, book, true)).rejects.toThrow(/Output strutturato/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("valida la modalità e legge solo gli argomenti stringa non vuoti", () => {
    expect(structuredOutputMode(undefined)).toBe("auto");
    expect(structuredOutputMode("off")).toBe("off");
    expect(() => structuredOutputMode("always")).toThrow(/Output strutturato/);
    expect(toolCallArguments({ tool_calls: [{ function: { arguments: "  " } }] })).toBeUndefined();
    expect(toolCallArguments({ tool_calls: [{ function: { arguments: 5 } }] })).toBeUndefined();
    expect(toolCallArguments(null)).toBeUndefined();
  });
});
