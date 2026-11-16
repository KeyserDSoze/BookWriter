import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { getDb, listActivities } from "../infrastructure/db";
import { addAiDelta, aiTraceMetaKey, currentTaskAi, discardLiveAiPreviews, loadAiTrace, saveAiTrace }
  from "../infrastructure/ai-observability";
import { launchModelCall, type LaunchInput } from "./model-call";

const { call }=vi.hoisted(()=>({call:vi.fn()}));
vi.mock("../infrastructure/ai",()=>({callModel:call}));

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("activities");await db.clear("meta");
  call.mockReset();
});
function input(options:{keep?:boolean;retention?:{maxTasks:number;maxMinutes:number}}={}):LaunchInput {
  const book=newBook("Un brief sintetico","Titolo","Sobrio","Adulti");
  const settings={...structuredClone(DEFAULT_SETTINGS),
    ...(options.keep===undefined?{}:{keepAiConversations:options.keep}),
    ...(options.retention?{aiTraceRetention:options.retention}:{})};
  return {book,settings,runId:"run",guard:{assertActive:async()=>{},failure:()=>undefined},
    signal:new AbortController().signal,kind:"brainstorm",title:"Brainstorming",
    systemPrompt:"SYSTEM_PRIVATO",userPrompt:"USER_PRIVATO",persisted:true,live:true,
    assignment:{endpointId:"openai",modelId:"test"},
    started:{id:crypto.randomUUID(),bookId:book.id,runId:"run",phase:"brainstorm",title:"Brainstorming",
      reason:"Prova",nextStep:"Verifica",status:"running",createdAt:new Date().toISOString()}};
}
describe("Trascrizione del provider distinta dal commit canonico",()=>{
  it("applica i limiti dichiarati: tetto di output inviato, prompt troppo lungo bloccato prima della rete",async()=>{
    const limited=(inputTokens:number)=>{
      const i=input();
      const endpoint={id:"openai",name:"E",baseUrl:"https://api.example.com/v1",secret:null,models:["test"],
        modelTokenLimits:{test:{inputTokens,outputTokens:4096}}};
      return {...i,configuredEndpoint:endpoint as never};
    };
    call.mockResolvedValue({text:"ok",endpointId:"openai",modelId:"test"});
    await (await launchModelCall(limited(10_000))).promise;
    expect(call.mock.calls[0]![6]).toMatchObject({maxOutputTokens:4096});
    call.mockClear();
    await expect(launchModelCall({...limited(256),userPrompt:"x".repeat(2_000)})).rejects.toThrow(/limite di input dichiarato/);
    expect(call).not.toHaveBeenCalled();
  });
  it("senza alcuna impostazione salva richiesta e risposta in modo temporaneo, senza output nell'Activity",async()=>{
    const i=input();
    call.mockResolvedValue({text:"Risposta non ancora applicata",endpointId:"openai",modelId:"test",inputTokens:12,outputTokens:9});
    const {promise}=await launchModelCall(i);
    await expect(promise).resolves.toMatchObject({inputTokens:12});
    expect(await loadAiTrace(i.book.id,i.started.id)).toMatchObject({
      systemPrompt:i.systemPrompt,userPrompt:i.userPrompt,response:"Risposta non ancora applicata",kept:false});
    await expect((await getDb()).get("meta",aiTraceMetaKey(i.started.id))).resolves.toMatchObject({kept:false});
    expect((await listActivities(i.book.id))[0]?.output).toBeUndefined();
    expect(currentTaskAi(i.book.id,i.started.id)?.endedAt).toBeUndefined();
  });
  it("con la spunta «senza scadenza» la conversazione è marcata come conservata",async()=>{
    const i=input({keep:true});
    call.mockResolvedValue({text:"Da tenere",endpointId:"openai",modelId:"test"});
    await (await launchModelCall(i)).promise;
    expect(await loadAiTrace(i.book.id,i.started.id)).toMatchObject({response:"Da tenere",kept:true});
  });
  it("il testo in arrivo è visibile subito, senza consenso",async()=>{
    const i=input();
    call.mockResolvedValue({text:"Finale",endpointId:"openai",modelId:"test"});
    await (await launchModelCall(i)).promise;
    expect(currentTaskAi(i.book.id,i.started.id)?.textPreview).toBe("Finale");
  });
  it("passa sempre le callback di osservazione al provider",async()=>{
    const i=input();
    call.mockResolvedValue({text:"x",endpointId:"openai",modelId:"test"});
    await (await launchModelCall(i)).promise;
    const options=call.mock.calls[0]![6] as Record<string,unknown>;
    expect(options).toMatchObject({onProgress:expect.any(Function),onHeaders:expect.any(Function),
      onTransport:expect.any(Function),onPhase:expect.any(Function)});
  });
  it("conserva testo parziale e reasoning anche dopo interruzione, senza mascherare l'errore",async()=>{
    const i=input(),error=new DOMException("Interruzione sintetica","AbortError");
    call.mockImplementation(async()=>{
      addAiDelta(i.started.id,{kind:"reasoning",text:"Reasoning ricevuto"});
      addAiDelta(i.started.id,{kind:"text",text:"Risposta parziale"});
      throw error;
    });
    const {promise}=await launchModelCall(i);
    await expect(promise).rejects.toBe(error);
    expect(await loadAiTrace(i.book.id,i.started.id)).toMatchObject({
      response:"Risposta parziale",reasoning:"Reasoning ricevuto"});
    expect((await listActivities(i.book.id))[0]?.output).toBeUndefined();
  });
  it("una cancellazione durante la risposta impedisce di risalvare la trascrizione",async()=>{
    const i=input();
    call.mockImplementation(async()=>{
      discardLiveAiPreviews();
      return {text:"Privato dopo la cancellazione",endpointId:"openai",modelId:"test"};
    });
    await (await launchModelCall(i)).promise;
    expect((await loadAiTrace(i.book.id,i.started.id))?.response).toBeUndefined();
  });
  it("una cancellazione durante il preflight non registra prompt né risposta del task già preparato",async()=>{
    const i=input();
    i.guard.assertActive=async()=>{discardLiveAiPreviews();};
    call.mockResolvedValue({text:"Privato",endpointId:"openai",modelId:"test"});
    await (await launchModelCall(i)).promise;
    expect(await loadAiTrace(i.book.id,i.started.id)).toBeNull();
  });
  it("a fine richiesta cancella le conversazioni temporanee oltre il limite, non quelle conservate",async()=>{
    const old=(id:string,kept:boolean,minutes:number)=>saveAiTrace({activityId:id,bookId:"altro",
      createdAt:new Date(Date.now()-minutes*60_000).toISOString(),endpointId:"e",modelId:"m",
      systemPrompt:"s",userPrompt:"u",truncated:false,kept});
    await old("vecchia-temporanea",false,120);
    await old("vecchia-conservata",true,120);
    const i=input({retention:{maxTasks:20,maxMinutes:30}});
    call.mockResolvedValue({text:"Nuova",endpointId:"openai",modelId:"test"});
    await (await launchModelCall(i)).promise;
    expect(await loadAiTrace("altro","vecchia-temporanea")).toBeNull();
    expect(await loadAiTrace("altro","vecchia-conservata")).not.toBeNull();
    expect(await loadAiTrace(i.book.id,i.started.id)).not.toBeNull();
  });
  it("un errore nel salvataggio (disco pieno) non ferma mai il task",async()=>{
    const i=input();
    const db=await getDb();
    const original=db.transaction.bind(db) as (...args:unknown[])=>unknown;
    // Only the writes to the conversation store fail, like a full disk would.
    const transaction=vi.spyOn(db,"transaction").mockImplementation(((...args:unknown[])=>{
      if(args[0]==="meta"&&args[1]==="readwrite")throw new Error("QuotaExceededError");
      return original(...args);
    }) as never);
    call.mockResolvedValue({text:"Il task continua",endpointId:"openai",modelId:"test"});
    await expect((await launchModelCall(i)).promise).resolves.toMatchObject({text:"Il task continua"});
    transaction.mockRestore();
    expect(await loadAiTrace(i.book.id,i.started.id)).toBeNull();
    expect(currentTaskAi(i.book.id,i.started.id)?.textPreview).toBe("Il task continua");
    expect((await listActivities(i.book.id))[0]?.aiRequested).toBe(true);
  });
});
