import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type Activity, type AppSettings } from "../domain/types";
import { keepObservedUsageOnRejectedReply } from "./ai-provider-error";
import { callModel } from "./ai";
import { MAX_CHAT_COMPLETION_BYTES, readChatCompletionJson } from "./ai-completion-response";

vi.mock("./crypto", () => ({ decryptLocal: vi.fn().mockResolvedValue("sk-local-fixture-only") }));
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const book = newBook("Una storia di prova.", "Mara", "Narrativo", "Adulti");
  const settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  settings.defaultRoute.modelId = "mock-bounded";
  settings.endpoints[0]!.secret = {iv:"cipher",data:"cipher"};
  return {book,settings};
}
const controller = () => new AbortController();
function bodyJSON(text:string, usage?:unknown): string {
  return JSON.stringify({choices:[{message:{content:text}}],usage});
}
function response(s: string, headers: Record<string,string>={}): Response {
  return new Response(s,{status:200,headers:{"content-type":"application/json",...headers}});
}
function chunked(s: string, split:number): Response {
  const bytes=new TextEncoder().encode(s);
  const stream=new ReadableStream<Uint8Array>({
    start(c) {
      for(let p=0;p<bytes.length;p+=split)c.enqueue(bytes.slice(p,p+split));
      c.close();
    },
  });
  return new Response(stream,{headers:{"content-type":"application/json"}});
}

describe("POST /chat/completions — limiti e sicurezza dello stream",()=>{
  it("legge uno stream valido diviso su più parti e conserva usage verificato",async()=>{
    const {book,settings}=fixture();
    const json=bodyJSON("  Testo narrativo valido  ",{prompt_tokens:42,completion_tokens:13});
    const fetcher=vi.fn().mockResolvedValue(chunked(json,9));
    vi.stubGlobal("fetch",fetcher);
    const result=await callModel("chapterAudit","System","Prompt",settings,book,controller().signal);
    expect(result).toEqual({text:"Testo narrativo valido",endpointId:"openai",
      modelId:"mock-bounded",inputTokens:42,outputTokens:13});
    expect(fetcher.mock.calls[0]![1]).toMatchObject({method:"POST",redirect:"error"});
  });

  it("accetta esattamente 2.000.000 byte senza troncare testo o JSON",async()=>{
    const template=bodyJSON("Z");
    const target="X".repeat(MAX_CHAT_COMPLETION_BYTES-(template.length-1));
    const full=bodyJSON(target);
    expect(new TextEncoder().encode(full)).toHaveLength(MAX_CHAT_COMPLETION_BYTES);
    const parsed=await readChatCompletionJson(chunked(full,64_000),controller().signal);
    expect((parsed as {choices:Array<{message:{content:string}}>}).choices[0]!.message.content)
      .toHaveLength(target.length);
  });

  it("rifiuta il Content-Length sovradimensionato prima di leggere lo stream",async()=>{
    let cancelled=false;
    const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
    const res=new Response(stream,{headers:{"content-type":"application/json",
      "content-length":String(MAX_CHAT_COMPLETION_BYTES+1)}});
    await expect(readChatCompletionJson(res,controller().signal)).rejects.toThrow(/troppo grande/);
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  it("non si fida di Content-Length piccolo: cancella uno stream eccessivo",async()=>{
    let cancelled=false;
    const stream=new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(1_400_000));
        c.enqueue(new Uint8Array(700_000));
      },
      cancel(){cancelled=true;},
    });
    const res=new Response(stream,{headers:{"content-type":"application/json","content-length":"1"}});
    await expect(readChatCompletionJson(res,controller().signal)).rejects.toThrow(/troppo grande/);
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  it("stream che non termina ha deadline di lettura anche se il provider ignora abort",async()=>{
    let cancelled=false;
    const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
    const started=Date.now();
    await expect(readChatCompletionJson(new Response(stream),controller().signal,15))
      .rejects.toThrow(/Tempo scaduto/);
    expect(Date.now()-started).toBeLessThan(2000);
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  it("annullamento del chiamante prevale sul timeout e interrompe lo stream",async()=>{
    let cancelled=false;
    const c=controller();
    const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
    const task=readChatCompletionJson(new Response(stream),c.signal,5000);
    c.abort();
    await expect(task).rejects.toMatchObject({name:"AbortError"});
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  it("rifiuta JSON malformato, UTF-8 illegale, HTML e lunghezze dichiarate invalide",async()=>{
    const cases=[
      response("{invalid"),
      new Response(new Uint8Array([0xff,0xfe]),{headers:{"content-type":"application/json"}}),
      new Response("<html>segreto</html>",{headers:{"content-type":"text/html"}}),
      response(bodyJSON("valid"),{"content-length":"not-a-number"}),
    ];
    for(const res of cases) {
      await expect(readChatCompletionJson(res,controller().signal)).rejects.toThrow(/JSON valido/);
    }
  });

  it("il cleanup non sostituisce gli errori originali se reader.cancel fallisce", async()=>{
    for (const failure of ["throw", "reject"] as const) {
      const cancel=vi.fn();
      if (failure==="throw") {
        cancel.mockImplementation(()=>{throw new Error("errore privato del cleanup");});
      } else {
        cancel.mockRejectedValue(new Error("errore privato del cleanup"));
      }
      const releaseLock=vi.fn();
      const reader={
        read:vi.fn().mockRejectedValue(new Error("errore privato del reader")),
        cancel,releaseLock,
      };
      const res=new Response(null);
      Object.defineProperty(res,"body",{value:{getReader:()=>reader}});
      await expect(readChatCompletionJson(res,controller().signal))
        .rejects.toThrow("Impossibile leggere la risposta del provider AI");
      expect(reader.read).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(releaseLock).toHaveBeenCalledTimes(1);
    }
  });

  it("mantiene AbortError e timeout anche con cancel sincrono che fallisce",async()=>{
    for (const mode of ["abort", "timeout"] as const) {
      const cancel=vi.fn().mockImplementation(()=>{
        throw new Error("errore privato del cleanup");
      });
      const reader={
        read:vi.fn().mockImplementation(()=>new Promise(()=>{})),
        cancel,releaseLock:vi.fn(),
      };
      const res=new Response(null);
      Object.defineProperty(res,"body",{value:{getReader:()=>reader}});
      const c=controller();
      const task=readChatCompletionJson(res,c.signal,20);
      if (mode==="abort") c.abort();
      if (mode==="abort") {
        await expect(task).rejects.toMatchObject({name:"AbortError"});
      } else {
        await expect(task).rejects.toThrow("Tempo scaduto durante la lettura");
      }
      expect(reader.read).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    }
  });

  it("un payload bloccato non inventa usage per l'Activity e non registra segreti",async()=>{
    const {book,settings}=fixture();
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response(
      bodyJSON("Testo privato").padEnd(MAX_CHAT_COMPLETION_BYTES+5,"X"),
      {"content-length":"1"},
    )));
    let failure:unknown;
    try {await callModel("chapterAudit","System privato","Prompt privato",settings,book,controller().signal);}
    catch(error){failure=error;}
    expect(failure).toMatchObject({name:"ProviderResponseReadError"});
    expect((failure as Error).message).toContain("troppo grande");
    const activity={status:"failed"} as Activity;
    keepObservedUsageOnRejectedReply(activity,failure);
    expect(activity.inputTokens).toBeUndefined();
    expect(activity.outputTokens).toBeUndefined();
    expect(activity.endpointId).toBeUndefined();
    expect(JSON.stringify(failure)).not.toMatch(/sk-local-fixture|System privato|Prompt privato|Testo privato/);
  });
});
