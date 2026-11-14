import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addAiDelta, aiTraceKey, clearAiTraces, currentLiveAi, currentTaskAi, disableLiveAiInspection,
  finishLiveAi, loadAiTrace, markAiHeader, receiveAiResponse, saveAiTrace, startLiveAi, subscribeLiveAi,
} from "./ai-observability";

const memory=new Map<string,unknown>();
vi.mock("./db",()=>({
  getDb:async()=>({
    put:async(_store:string,value:unknown,key:string)=>{memory.set(key,value);},
    get:async(_store:string,key:string)=>memory.get(key),
    transaction:()=>({
      store:{
        openCursor:async()=>null,
      },
      done:Promise.resolve(),
    }),
  }),
}));
beforeEach(()=>memory.clear());
describe("Tracce locali sensibili opt-in e progresso volatile",()=>{
  it("conserva richieste separatamente da Activity e limita dimensioni",async()=>{
    const source={activityId:"activity-1",bookId:"book-1",createdAt:"2026-11-12",
      endpointId:"openai",modelId:"meta/muse-glimmer",
      systemPrompt:"S".repeat(120001),userPrompt:"U",response:"R".repeat(120001),
      reasoning:"T".repeat(20001),truncated:false};
    await saveAiTrace(source);
    expect(aiTraceKey("activity-1")).toBe("ai-trace:activity-1");
    const saved=await loadAiTrace("book-1","activity-1");
    expect(saved).toMatchObject({truncated:true});
    expect(saved?.systemPrompt).toHaveLength(120000);
    expect(saved?.response).toHaveLength(120000);
    expect(saved?.reasoning).toHaveLength(20000);
    expect(await loadAiTrace("book-2","activity-1")).toBeNull();
  });
  it("se ispezione non attiva, registra conteggi ma non deltas sensibili",()=>{
    const listener=vi.fn(),unsub=subscribeLiveAi(listener);
    startLiveAi({activityId:"a",bookId:"b",title:"Brainstorming",endpointId:"openai",
      modelId:"model",inspect:false});
    markAiHeader("a");
    addAiDelta("a",{kind:"reasoning",text:"ragionamento privato"});
    addAiDelta("a",{kind:"text",text:"testo privato"});
    finishLiveAi("a","rifiutata");
    expect(currentLiveAi()).toMatchObject({stage:"rifiutata",textPreview:"",
      reasoningPreview:"",textCharacters:13,reasoningCharacters:20});
    expect(listener).toHaveBeenCalled();
    unsub();
  });
  it("con opt-in espone solo i delta del task corrente, senza promuoverli a canon",()=>{
    startLiveAi({activityId:"new",bookId:"book",title:"Nuova",endpointId:"x",
      modelId:"y",inspect:true});
    addAiDelta("old",{kind:"text",text:"vecchio"});
    addAiDelta("new",{kind:"text",text:"stream"});
    addAiDelta("new",{kind:"reasoning",text:"ragionamento del provider"});
    expect(currentLiveAi()).toMatchObject({stage:"streaming",textPreview:"stream",
      reasoningPreview:"ragionamento del provider"});
    finishLiveAi("old","completata");
    expect(currentLiveAi()?.stage).toBe("streaming");
    finishLiveAi("new","completata");
    expect(currentLiveAi()?.stage).toBe("completata");
  });
  it("isola richieste parallele e non azzera lo stream quando passa al revisore successivo",()=>{
    const base={bookId:"parallel-book",title:"Revisione",endpointId:"x",modelId:"y",inspect:true};
    startLiveAi({...base,activityId:"parallel-first"});
    startLiveAi({...base,activityId:"parallel-second"},false);
    addAiDelta("parallel-first",{kind:"text",text:"Prima risposta"});
    addAiDelta("parallel-second",{kind:"reasoning",text:"Secondo reasoning"});
    addAiDelta("parallel-second",{kind:"text",text:"Seconda risposta"});
    const previous=currentTaskAi(base.bookId,"parallel-second");
    expect(currentTaskAi("other-book","parallel-second")).toBeNull();
    expect(currentLiveAi()?.activityId).toBe("parallel-first");
    startLiveAi({...base,activityId:"parallel-second"});
    expect(currentLiveAi()).toBe(previous);
    expect(currentTaskAi(base.bookId,"parallel-first")?.textPreview).toBe("Prima risposta");
    finishLiveAi("parallel-first","completata");
    expect(currentLiveAi()?.activityId).toBe("parallel-second");
  });
  it("mantiene la coda più recente anche oltre i limiti delle trascrizioni",()=>{
    startLiveAi({activityId:"long",bookId:"b",title:"Lunga",endpointId:"x",modelId:"y",inspect:true});
    addAiDelta("long",{kind:"text",text:"A".repeat(120001)});
    addAiDelta("long",{kind:"text",text:"ULTIMA_RIGA"});
    addAiDelta("long",{kind:"reasoning",text:"R".repeat(20001)+"ULTIMO_REASONING"});
    expect(currentLiveAi()?.textPreview).toHaveLength(120000);
    expect(currentLiveAi()?.textTail).toHaveLength(4000);
    expect(currentLiveAi()?.textTail).toMatch(/ULTIMA_RIGA$/);
    expect(currentLiveAi()?.reasoningTail).toMatch(/ULTIMO_REASONING$/);
  });
  it("revoca e cancellazione azzerano i testi in RAM senza riattivarli con altri delta",async()=>{
    startLiveAi({activityId:"revoke",bookId:"b",title:"Revoca",endpointId:"x",modelId:"y",inspect:true});
    addAiDelta("revoke",{kind:"text",text:"privato"});
    disableLiveAiInspection();
    addAiDelta("revoke",{kind:"text",text:"ancora"});
    receiveAiResponse("revoke","risposta finale privata");
    expect(currentLiveAi()).toMatchObject({inspect:false,textPreview:"",reasoningPreview:"",textTail:""});
    await clearAiTraces();
    expect(currentTaskAi("b","revoke")?.textPreview).toBe("");
  });
  it("limita a otto gli ultimi task terminati in memoria",()=>{
    for(let index=0;index<12;index++){
      startLiveAi({activityId:"cache-"+index,bookId:"cache",title:"Cache",endpointId:"x",modelId:"y",inspect:true});
      finishLiveAi("cache-"+index,"completata");
    }
    startLiveAi({activityId:"cache-active",bookId:"cache",title:"Attivo",endpointId:"x",modelId:"y",inspect:true});
    expect(currentTaskAi("cache","cache-0")).toBeNull();
    expect(currentTaskAi("cache","cache-11")?.stage).toBe("completata");
  });
  it("ricontrolla il consenso dopo l'attesa per il database prima di scrivere",async()=>{
    await saveAiTrace({activityId:"stale-write",bookId:"b",createdAt:"2026-11-14",
      endpointId:"x",modelId:"y",systemPrompt:"Privato",userPrompt:"Privato",truncated:false},()=>false);
    expect(await loadAiTrace("b","stale-write")).toBeNull();
  });
  it("il completamento non altera i caratteri realmente osservati nello streaming",()=>{
    startLiveAi({activityId:"raw",bookId:"b",title:"Raw",endpointId:"x",modelId:"y",inspect:true});
    addAiDelta("raw",{kind:"text",text:"  risposta  "});
    receiveAiResponse("raw","risposta");
    expect(currentLiveAi()).toMatchObject({textCharacters:12,textPreview:"  risposta  "});
  });
});
