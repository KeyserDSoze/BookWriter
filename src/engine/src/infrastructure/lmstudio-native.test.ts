import { afterEach,describe,expect,it,vi } from "vitest";
import { DEFAULT_SETTINGS,newBook } from "../domain/types";
import { callModel } from "./ai";
import { chatStreamTimeoutSeconds } from "./ai-stream";
import {
  lmStudioNativeEndpoint,lmStudioNativeProtocol,lmStudioNativeReasoning,
  readLmStudioNativeStream,type LmStudioPhase,
} from "./lmstudio-native";
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const messages=[
 {type:"chat.start",model_instance_id:"meta/muse-glimmer"},
 {type:"model_load.start",model_instance_id:"meta/muse-glimmer"},
 {type:"model_load.progress",model_instance_id:"meta/muse-glimmer",progress:0.8},
 {type:"prompt_processing.start"},
 {type:"prompt_processing.progress",progress:0.5},
 {type:"reasoning.start"},
 {type:"reasoning.delta",content:"Valuto il piano. "},
 {type:"message.start"},
 {type:"message.delta",content:"C'era una volta "},
 {type:"message.delta",content:"una scimmia."},
 {type:"chat.end",result:{
   model_instance_id:"meta/muse-glimmer",
   output:[{type:"reasoning",content:"Valuto il piano. "},
     {type:"message",content:"C'era una volta una scimmia."}],
   stats:{input_tokens:48,total_output_tokens:112,reasoning_output_tokens:40},
 }},
];
function native(events:unknown[]=messages):Response {
 const encode=new TextEncoder();
 return new Response(new ReadableStream<Uint8Array>({start(ctrl){
   for(const e of events){
     const v=e as Record<string,unknown>;
     const raw="event: "+v.type+"\ndata: "+JSON.stringify(v)+"\n\n";
     const b=encode.encode(raw);
     ctrl.enqueue(b.subarray(0,7));
     ctrl.enqueue(b.subarray(7));
   }
   ctrl.close();
 }}),{headers:{"content-type":"text/event-stream"}});
}
function fixture(){
 const settings=structuredClone(DEFAULT_SETTINGS);
 settings.endpoints[0]={...settings.endpoints[0]!,baseUrl:"http://localhost:1234/v1",
   authMode:"none",secret:null,apiProtocol:"lmstudio_native",reasoningEffort:"high",streamTimeoutSeconds:1500};
 settings.defaultRoute.modelId="meta/muse-glimmer";
 const book=newBook("Scimmie e leone","Jungle","Prosa","Bambini");
 return {settings,book};
}
describe("LM Studio native explicit and local-only",()=>{
 it("legge fasi autentiche e messaggio finale verificato senza eseguire tools",async()=>{
   const phases:LmStudioPhase[]=[],deltas:string[]=[],transport:number[]=[];
   const answer=await readLmStudioNativeStream(native(),new AbortController().signal,
     x=>deltas.push(x.kind+":"+x.text),p=>phases.push(p),s=>transport.push(s.events));
   expect(answer).toEqual({choices:[{message:{content:"C'era una volta una scimmia."}}],
     usage:{prompt_tokens:48,completion_tokens:112}});
   expect(phases).toContainEqual({phase:"model_loading",progress:0.8});
   expect(phases).toContainEqual({phase:"prompt_processing",progress:0.5});
   expect(phases).toContainEqual({phase:"reasoning"});
   expect(phases).toContainEqual({phase:"message"});
   expect(deltas).toEqual(["reasoning:Valuto il piano. ","text:C'era una volta ","text:una scimmia."]);
   expect(Math.max(...transport)).toBe(messages.length);
 });
 it("POST /api/v1/chat usa reasoning nativo e store:false, senza header Bearer",async()=>{
   const {settings,book}=fixture(),fetcher=vi.fn().mockResolvedValue(native());
   settings.taskReasoningEfforts={brainstorm:"medium"};
   book.taskReasoningEfforts={brainstorm:"low"};
   vi.stubGlobal("fetch",fetcher);
   const result=await callModel("brainstorm","Sistema","Prompt",settings,book,
     new AbortController().signal,{maxOutputTokens:1024});
   expect(result).toMatchObject({text:"C'era una volta una scimmia.",
     inputTokens:48,outputTokens:112});
   expect(fetcher).toHaveBeenCalledTimes(1);
   expect(fetcher.mock.calls[0]![0]).toBe("http://localhost:1234/api/v1/chat");
   const init=fetcher.mock.calls[0]![1] as RequestInit;
   expect(init.headers).toEqual({"Content-Type":"application/json"});
   expect(init).toMatchObject({redirect:"error",credentials:"omit"});
   const body=JSON.parse(init.body as string);
   expect(body).toMatchObject({model:"meta/muse-glimmer",system_prompt:"Sistema",
     input:"Prompt",stream:true,store:false,reasoning:"low",max_output_tokens:1024});
   expect(body).not.toHaveProperty("integrations");
   expect(body).not.toHaveProperty("messages");
   expect(body).not.toHaveProperty("reasoning_effort");
 });
 it("nessun output finale non promuove un reasoning nel canone",async()=>{
   const pieces=[messages[0],messages[5],messages[6],
     {type:"chat.end",result:{output:[{type:"reasoning",content:"solo pensieri"}],
       stats:{input_tokens:1,total_output_tokens:30}}}];
   await expect(readLmStudioNativeStream(native(pieces),new AbortController().signal))
     .rejects.toThrow(/senza risposta testuale finale/);
 });
 it("interrompe per eventi error, tool_call, chat.end mancante o MIME scorretto",async()=>{
   const cases=[
     [messages[0],{type:"error",error:{type:"internal_error",message:"privato"}}],
     [messages[0],{type:"chat.end",result:{output:[{type:"tool_call",tool:"open_browser"}]}}],
     [messages[0],messages[8]],
   ];
   for(const v of cases)await expect(readLmStudioNativeStream(native(v),new AbortController().signal))
     .rejects.toThrow();
   await expect(readLmStudioNativeStream(new Response("{}",
     {headers:{"content-type":"application/json"}}),new AbortController().signal))
     .rejects.toThrow(/non ha restituito eventi SSE/);
 });
 it("rifiuta API nativa remota, path divergenti e xhigh prima di fetch",async()=>{
   const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
   for(const base of ["https://remote.test/v1","http://localhost:1234/v1/extra",
     "http://localhost.evil.test/v1"]){
     expect(()=>lmStudioNativeEndpoint(base)).toThrow();
     const {settings,book}=fixture();
     settings.endpoints[0]!.baseUrl=base;
     await expect(callModel("brainstorm","S","P",settings,book,
       new AbortController().signal)).rejects.toThrow();
   }
   expect(()=>lmStudioNativeReasoning("xhigh")).toThrow(/non supporta xhigh/);
   expect(()=>lmStudioNativeProtocol("unknown")).toThrow(/Protocollo/);
   const {settings,book}=fixture();settings.taskReasoningEfforts={brainstorm:"xhigh"};
   await expect(callModel("brainstorm","S","P",settings,book,new AbortController().signal))
     .rejects.toThrow(/non supporta xhigh/);
   expect(fetcher).not.toHaveBeenCalled();
 });
 it("timeout stream configurabile, limite su vecchi profili rimane 600s",()=>{
   expect(chatStreamTimeoutSeconds(undefined)).toBe(600);
   expect(chatStreamTimeoutSeconds(3600)).toBe(3600);
   for(const bad of [0,599,3601,1.2,NaN,null,"1200",{}])
     expect(()=>chatStreamTimeoutSeconds(bad)).toThrow(/Attesa streaming/);
 });
 it("abort del browser impedisce applicazione dello stream",async()=>{
   const controller=new AbortController();
   const stream=new ReadableStream<Uint8Array>({
     start(c){c.enqueue(new TextEncoder().encode('event: chat.start\ndata: {"type":"chat.start"}\n\n'));},
   });
   const pending=readLmStudioNativeStream(new Response(stream,
     {headers:{"content-type":"text/event-stream"}}),controller.signal);
   controller.abort();
   await expect(pending).rejects.toMatchObject({name:"AbortError"});
 });
});
