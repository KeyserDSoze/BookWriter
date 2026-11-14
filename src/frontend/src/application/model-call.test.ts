import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { getDb, listActivities } from "../infrastructure/db";
import { addAiDelta, currentTaskAi, disableLiveAiInspection, loadAiTrace } from "../infrastructure/ai-observability";
import { launchModelCall, type LaunchInput } from "./model-call";

const { call }=vi.hoisted(()=>({call:vi.fn()}));
vi.mock("../infrastructure/ai",()=>({callModel:call}));

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("activities");await db.clear("meta");
  call.mockReset();
});
function input(inspect=true):LaunchInput {
  const book=newBook("Un brief sintetico","Titolo","Sobrio","Adulti");
  const settings={...structuredClone(DEFAULT_SETTINGS),inspectAiRequests:inspect};
  return {book,settings,runId:"run",guard:{assertActive:async()=>{},failure:()=>undefined},
    signal:new AbortController().signal,kind:"brainstorm",title:"Brainstorming",
    systemPrompt:"SYSTEM_PRIVATO",userPrompt:"USER_PRIVATO",persisted:true,live:true,
    assignment:{endpointId:"openai",modelId:"test"},
    started:{id:crypto.randomUUID(),bookId:book.id,runId:"run",phase:"brainstorm",title:"Brainstorming",
      reason:"Prova",nextStep:"Verifica",status:"running",createdAt:new Date().toISOString()}};
}
describe("Trascrizione privata del provider distinta dal commit canonico",()=>{
  it("conserva risposta JSON e prompt prima dell'applicazione, senza output nell'Activity",async()=>{
    const i=input();
    call.mockResolvedValue({text:"Risposta non ancora applicata",endpointId:"openai",modelId:"test",inputTokens:12,outputTokens:9});
    const {promise}=await launchModelCall(i);
    await expect(promise).resolves.toMatchObject({inputTokens:12});
    expect(await loadAiTrace(i.book.id,i.started.id)).toMatchObject({
      systemPrompt:i.systemPrompt,userPrompt:i.userPrompt,response:"Risposta non ancora applicata"});
    expect((await listActivities(i.book.id))[0]?.output).toBeUndefined();
    expect(currentTaskAi(i.book.id,i.started.id)?.endedAt).toBeUndefined();
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
  it("non conserva testo né trace senza consenso",async()=>{
    const i=input(false);
    call.mockResolvedValue({text:"Privato",endpointId:"openai",modelId:"test"});
    await (await launchModelCall(i)).promise;
    expect(await loadAiTrace(i.book.id,i.started.id)).toBeNull();
    expect(currentTaskAi(i.book.id,i.started.id)?.textPreview).toBe("");
  });
  it("una revoca durante la risposta impedisce di risalvare la trascrizione",async()=>{
    const i=input();
    call.mockImplementation(async()=>{
      disableLiveAiInspection();
      return {text:"Privato dopo revoca",endpointId:"openai",modelId:"test"};
    });
    await (await launchModelCall(i)).promise;
    expect((await loadAiTrace(i.book.id,i.started.id))?.response).toBeUndefined();
  });
  it("revoca durante il preflight non registra prompt o risposta del task già preparato",async()=>{
    const i=input();
    i.guard.assertActive=async()=>{disableLiveAiInspection();};
    call.mockResolvedValue({text:"Privato",endpointId:"openai",modelId:"test"});
    await (await launchModelCall(i)).promise;
    expect(await loadAiTrace(i.book.id,i.started.id)).toBeNull();
    expect(currentTaskAi(i.book.id,i.started.id)?.inspect).toBe(false);
  });
});
