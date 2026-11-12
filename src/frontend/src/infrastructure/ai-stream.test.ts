import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { callModel } from "./ai";
import { chatReasoningEffort, chatStreamMode, readChatCompletionStream } from "./ai-stream";

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

function fixture(){
  const settings=structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0]={...settings.endpoints[0]!,baseUrl:"http://localhost:1234/v1",
    secret:null,authMode:"none",streamMode:"sse",reasoningEffort:"high"};
  settings.defaultRoute.modelId="meta/muse-glimmer";
  return {settings,book:newBook("Storia","Test","Prosa","Ragazzi")};
}
function sse(items:string[]):Response{
  const encoder=new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller){
      for(const item of items)controller.enqueue(encoder.encode(item));
      controller.close();
    },
  }),{headers:{"content-type":"text/event-stream"}});
}
const events=[
  'data: {"choices":[{"index":0,"delta":{"reasoning_content":"Pianifico "}}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{"content":"Testo "}}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{"content":"finale"}}]}\n\n',
  'data: {"choices":[],"usage":{"prompt_tokens":24,"completion_tokens":12}}\n\n',
  'data: [DONE]\n\n',
];
describe("SSE Chat Completions e controllo reasoning",()=>{
  it("assembla eventi suddivisi su chunk e espone deltas provider soltanto se presenti",async()=>{
    const deltas:Array<{kind:string;text:string}>=[];
    const r=await readChatCompletionStream(sse(events.flatMap(e=>[
      e.slice(0,3),e.slice(3,9),e.slice(9)])),new AbortController().signal,
      delta=>deltas.push(delta));
    expect(r).toMatchObject({choices:[{message:{content:"Testo finale"}}],
      usage:{prompt_tokens:24,completion_tokens:12}});
    expect(deltas).toEqual([
      {kind:"reasoning",text:"Pianifico "},
      {kind:"text",text:"Testo "},
      {kind:"text",text:"finale"},
    ]);
  });
  it("invoca il provider una volta, senza key e con effort/stream espliciti",async()=>{
    const {settings,book}=fixture();
    const request=vi.fn().mockResolvedValue(sse(events));
    vi.stubGlobal("fetch",request);
    const deltas:string[]=[];
    const answer=await callModel("brainstorm","Sistema","Racconta",settings,book,
      new AbortController().signal,{onProgress:d=>deltas.push(d.text),maxOutputTokens:200});
    expect(answer).toMatchObject({text:"Testo finale",inputTokens:24,outputTokens:12});
    expect(deltas).toEqual(["Pianifico ","Testo ","finale"]);
    expect(request).toHaveBeenCalledTimes(1);
    const init=request.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toEqual({"Content-Type":"application/json"});
    expect(JSON.parse(init.body as string)).toMatchObject({
      reasoning_effort:"high",stream:true,stream_options:{include_usage:true},
      max_tokens:200,model:"meta/muse-glimmer",
    });
  });
  it("può leggere JSON legacy se il provider ignora lo streaming, senza retry",async()=>{
    const {settings,book}=fixture();
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices:[{message:{content:"Risposta JSON valida"}}],usage:{prompt_tokens:1,completion_tokens:2},
    }),{headers:{"content-type":"application/json"}}));
    vi.stubGlobal("fetch",fetcher);
    const answer=await callModel("prose","Sistema","Prompt",settings,book,new AbortController().signal);
    expect(answer.text).toBe("Risposta JSON valida");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rifiuta stream interrotti, errori provider, dati malformati o eccessivi",async()=>{
    for(const events of [
      ['data: {"choices":[{"delta":{"content":"Parziale"}}]}\n\n'],
      ['data: {"error":{"message":"Secret"}}\n\n','data: [DONE]\n\n'],
      ['data: {json invalido}\n\n','data: [DONE]\n\n'],
      ['data: {"choices":[{"delta":{"content":{"bad":1}}}]}\n\n','data: [DONE]\n\n'],
      ['data: [DONE]\n\n'],
    ]) {
      await expect(readChatCompletionStream(sse(events),new AbortController().signal))
        .rejects.toThrow(/Stream AI|Il provider ha terminato/);
    }
    const big=new Response("data: "+("x".repeat(2000001)),{
      headers:{"content-type":"text/event-stream"}});
    await expect(readChatCompletionStream(big,new AbortController().signal))
      .rejects.toThrow(/Stream AI|Il provider ha terminato/);
  });
  it("valida effort e stream prima della rete, non assume compatibilità",async()=>{
    const {settings,book}=fixture(),fetcher=vi.fn();
    vi.stubGlobal("fetch",fetcher);
    expect(chatReasoningEffort(undefined)).toBeUndefined();
    expect(chatStreamMode(undefined)).toBe("off");
    for(const wrong of [null,"extra-high","none",0,{}]){
      expect(()=>chatReasoningEffort(wrong)).toThrow(/Reasoning effort/);
      settings.endpoints[0]!.reasoningEffort=wrong as "low";
      await expect(callModel("prose","Sistema","Prompt",settings,book,
        new AbortController().signal)).rejects.toThrow(/Reasoning effort/);
    }
    settings.endpoints[0]!.reasoningEffort=undefined;
    settings.endpoints[0]!.streamMode="invalid" as "sse";
    await expect(callModel("prose","Sistema","Prompt",settings,book,
      new AbortController().signal)).rejects.toThrow(/Modalità streaming/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
