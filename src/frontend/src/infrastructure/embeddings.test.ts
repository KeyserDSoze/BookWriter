import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "../domain/types";
import { embedTextBatch, localEmbeddingSelection, MAX_EMBED_BATCH } from "./embeddings";
import { decryptLocal } from "./crypto";

vi.mock("./crypto",()=>({decryptLocal:vi.fn().mockResolvedValue("local-only-token")}));
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
function local():AppSettings{
  const settings=structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0]={...settings.endpoints[0]!,
    baseUrl:"http://localhost:1234/v1",authMode:"none",secret:null,
    models:["text-embedding-nomic"],modelCapabilities:{"text-embedding-nomic":["embedding"]}};
  settings.capabilityRoutes={embedding:{endpointId:"openai",modelId:"text-embedding-nomic"}};
  return settings;
}
function response(count:number){
  return new Response(JSON.stringify({
    data:Array.from({length:count},(_,index)=>({index,embedding:[index+1,2,3]})),
  }),{headers:{"content-type":"application/json"}});
}
describe("POST /embeddings localhost: privacy e validazione fail-closed",()=>{
  it("senza chiave esegue una richiesta limitata, niente Authorization e nessun altro provider",async()=>{
    const settings=local(),send=vi.fn().mockResolvedValue(response(2));
    vi.stubGlobal("fetch",send);
    const vectors=await embedTextBatch(settings,["testo A","testo B"],new AbortController().signal);
    expect(vectors).toEqual([[1,2,3],[2,2,3]]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe("http://localhost:1234/v1/embeddings");
    const request=send.mock.calls[0]![1] as RequestInit;
    expect(request).toMatchObject({method:"POST",credentials:"omit",redirect:"error",
      mode:"cors",referrerPolicy:"no-referrer"});
    expect(request.headers).toEqual({"Content-Type":"application/json"});
    expect(JSON.parse(request.body as string)).toMatchObject({
      model:"text-embedding-nomic",input:["testo A","testo B"],
    });
    expect(decryptLocal).not.toHaveBeenCalled();
  });
  it("rifiuta remoto, tag non valido, assenza default e lotti oltre limite PRIMA della rete",async()=>{
    const settings=local(),send=vi.fn();
    vi.stubGlobal("fetch",send);
    settings.endpoints[0]!.baseUrl="https://external.example.test/v1";
    expect(()=>localEmbeddingSelection(settings)).toThrow(/solo un modello embedding su localhost/);
    await expect(embedTextBatch(settings,["privato"],new AbortController().signal)).rejects.toThrow(/localhost/);
    settings.endpoints[0]!.baseUrl="http://localhost:1234/v1";
    settings.endpoints[0]!.modelCapabilities={"text-embedding-nomic":["voice"]};
    await expect(embedTextBatch(settings,["privato"],new AbortController().signal)).rejects.toThrow(/non è etichettato/);
    settings.endpoints[0]!.modelCapabilities={"text-embedding-nomic":["embedding"]};
    settings.capabilityRoutes=undefined;
    await expect(embedTextBatch(settings,["privato"],new AbortController().signal)).rejects.toThrow(/predefinito/);
    settings.capabilityRoutes={embedding:{endpointId:"openai",modelId:"text-embedding-nomic"}};
    await expect(embedTextBatch(settings,Array(MAX_EMBED_BATCH+1).fill("x") as string[],new AbortController().signal))
      .rejects.toThrow(/al massimo 8/);
    expect(send).not.toHaveBeenCalled();
  });
  it("blocca risposta malformata, vettori duplicati, incongruenti, null e body enorme",async()=>{
    const payloads=[
      {data:[{index:0,embedding:[1,2]},{index:0,embedding:[3,4]}]},
      {data:[{index:0,embedding:[1,2]},{index:1,embedding:[1,2,3]}]},
      {data:[{index:0,embedding:[0,0]},{index:1,embedding:[1,2]}]},
      {data:[{index:0,embedding:[1,"x"]},{index:1,embedding:[1,2]}]},
      {data:[{index:0,embedding:[1,2]}]},
      {data:null},
    ];
    for(const payload of payloads){
      vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify(payload),
        {headers:{"content-type":"application/json"}})));
      await expect(embedTextBatch(local(),["uno","due"],new AbortController().signal))
        .rejects.toThrow();
    }
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("x",{
      headers:{"content-type":"application/json","content-length":"3000000"}})));
    await expect(embedTextBatch(local(),["uno"],new AbortController().signal))
      .rejects.toThrow(/troppo grande/);
  });
  it("rifiuta lotti annullati senza chiamare il provider",async()=>{
    const controller=new AbortController();controller.abort();
    const send=vi.fn();vi.stubGlobal("fetch",send);
    await expect(embedTextBatch(local(),["uno"],controller.signal))
      .rejects.toMatchObject({name:"AbortError"});
    expect(send).not.toHaveBeenCalled();
  });
});
