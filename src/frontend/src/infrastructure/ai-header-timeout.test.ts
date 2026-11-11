import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type Activity, type AppSettings } from "../domain/types";
import { keepObservedUsageOnRejectedReply } from "./ai-provider-error";
import { callModel } from "./ai";
import { fetchChatCompletionHeaders, chatHeaderTimeoutSeconds,
  DEFAULT_CHAT_HEADER_TIMEOUT_SECONDS, ProviderHeaderTimeoutError } from "./ai-header-timeout";

vi.mock("./crypto", () => ({ decryptLocal: vi.fn().mockResolvedValue("sk-private-fixture") }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const make = () => {
  const book = newBook("Trama protetta.", "Storia", "Narrativo", "Adulti");
  const settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0]!.secret = { iv: "x", data: "encrypted" };
  settings.endpoints[0]!.headerTimeoutSeconds = 60;
  settings.defaultRoute.modelId = "mock-long-inference";
  return { book, settings };
};
const pending = () => new Promise<Response>(() => { /* broken proxy ignores abort */ });

describe("POST /chat/completions — deadline prima degli header", () => {
  it("accetta il default storico e solo timeout interi da 60 a 1800 s", () => {
    expect(chatHeaderTimeoutSeconds(undefined)).toBe(DEFAULT_CHAT_HEADER_TIMEOUT_SECONDS);
    expect(chatHeaderTimeoutSeconds(60)).toBe(60);
    expect(chatHeaderTimeoutSeconds(1800)).toBe(1800);
    for (const value of [0, 59, 1801, 90.5, NaN, Infinity, "60", null]) {
      expect(() => chatHeaderTimeoutSeconds(value)).toThrow(/Attesa header AI/);
    }
  });

  it("termina senza attendere un fetch che non risolve e abortisce il controller interno", async () => {
    vi.useFakeTimers();
    let networkSignal: AbortSignal | undefined;
    const mocked = vi.fn().mockImplementation((_url, init: RequestInit) => {
      networkSignal = init.signal as AbortSignal;
      return pending();
    });
    vi.stubGlobal("fetch", mocked);
    const {book,settings}=make();
    const attempt = callModel("chapterAudit", "Sistema privato", "Prompt privato",
      settings, book, new AbortController().signal);
    const failure=expect(attempt).rejects.toBeInstanceOf(ProviderHeaderTimeoutError);
    await vi.advanceTimersByTimeAsync(60_000);
    await failure;
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(networkSignal?.aborted).toBe(true);
  });

  it("priorità all'annullamento autore anche se fetch non onora AbortSignal", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(pending));
    const c = new AbortController();
    const attempt = fetchChatCompletionHeaders("https://api.example.invalid/v1/chat/completions",
      {method:"POST"},c.signal,60);
    const result = expect(attempt).rejects.toMatchObject({ name:"AbortError" });
    c.abort();
    await result;
    await vi.advanceTimersByTimeAsync(61_000);
  });

  it("non accorcia la generazione lecita prima del termine configurato",async()=>{
    vi.useFakeTimers();
    const ok = new Response(JSON.stringify({choices:[{message:{content:"Prosa lecita"}}]}),
      {headers:{"content-type":"application/json"}});
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async()=>{
      await new Promise(resolve=>setTimeout(resolve,95_000));
      return ok;
    }));
    const {book,settings}=make();
    settings.endpoints[0]!.headerTimeoutSeconds=120;
    const answer=callModel("chapterAudit","Sistema","Prompt",settings,book,new AbortController().signal);
    await vi.advanceTimersByTimeAsync(95_000);
    await expect(answer).resolves.toMatchObject({text:"Prosa lecita"});
  });

  it("l'HTTP 429 usa il messaggio noto, non il timeout né un usage fittizio",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("niente token",
      {status:429,headers:{"content-type":"text/plain"}})));
    const {book,settings}=make();
    await expect(callModel("chapterAudit","Sistema","Prompt",settings,book,
      new AbortController().signal)).rejects.toThrow(/429/);
  });

  it("una risposta tardiva dopo il timeout è scartata e il corpo cancellato",async()=>{
    vi.useFakeTimers();
    let settle!: (value: Response)=>void;
    let cancelled=false;
    const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
    vi.stubGlobal("fetch",vi.fn().mockImplementation(()=>new Promise<Response>(resolve=>{settle=resolve;})));
    const task=fetchChatCompletionHeaders("https://api.example.invalid/v1/chat/completions",
      {method:"POST"},new AbortController().signal,60);
    const failure=expect(task).rejects.toBeInstanceOf(ProviderHeaderTimeoutError);
    await vi.advanceTimersByTimeAsync(60_000);
    await failure;
    settle(new Response(stream,{headers:{"content-type":"application/json"}}));
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  it("l'errore non include credenziali, prompt e la contabilità resta sconosciuta",async()=>{
    vi.useFakeTimers();
    vi.stubGlobal("fetch",vi.fn().mockImplementation(pending));
    const {book,settings}=make();
    const task=callModel("chapterAudit","Sistema super segreto","Prompt molto privato",
      settings,book,new AbortController().signal);
    const observed=task.then(()=>{throw Error("expected timeout");},error=>error as Error);
    await vi.advanceTimersByTimeAsync(60_000);
    const failure=await observed;
    expect(failure.name).toBe("ProviderHeaderTimeoutError");
    expect(JSON.stringify(failure)).not.toMatch(/sk-private-fixture|Sistema super segreto|Prompt molto privato/);
    const activity={status:"failed",aiRequested:true} as Activity;
    keepObservedUsageOnRejectedReply(activity,failure);
    expect(activity.inputTokens).toBeUndefined();
    expect(activity.outputTokens).toBeUndefined();
  });
});
