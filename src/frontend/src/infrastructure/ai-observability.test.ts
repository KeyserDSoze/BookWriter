import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addAiDelta, aiTraceKey, clearAiTraces, currentLiveAi, finishLiveAi, loadAiTrace,
  markAiHeader, saveAiTrace, startLiveAi, subscribeLiveAi,
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
});
