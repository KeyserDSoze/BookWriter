import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { callModel } from "./ai";

vi.mock("./crypto",()=>({decryptLocal:vi.fn().mockResolvedValue("test-key")}));
afterEach(()=>vi.unstubAllGlobals());
describe("Preflight Chat Completions con ruoli dichiarati",()=>{
  it("non invia una POST a modello solo embedding/voce, né ad una route task incompatibile",async()=>{
    const settings=structuredClone(DEFAULT_SETTINGS);
    settings.endpoints[0]={...settings.endpoints[0]!,
      baseUrl:"http://localhost:1234/v1",authMode:"none",
      models:["model-voice","model-embedding"],modelCapabilities:{
        "model-voice":["voice"],"model-embedding":["embedding"],
      }};
    settings.defaultRoute.modelId="model-voice";
    const book=newBook("Trama","Titolo","Stile","Pubblico");
    const request=vi.fn();vi.stubGlobal("fetch",request);
    await expect(callModel("prose","Sistema","Prompt segreto",settings,book,
      new AbortController().signal)).rejects.toThrow(/non è contrassegnato/);
    settings.taskRoutes.prose={endpointId:"openai",modelId:"model-embedding"};
    await expect(callModel("prose","Sistema","Prompt segreto",settings,book,
      new AbortController().signal)).rejects.toThrow(/non è contrassegnato/);
    expect(request).not.toHaveBeenCalled();
  });
  it("un modello con tag chat+tools funziona come quello legacy",async()=>{
    const settings=structuredClone(DEFAULT_SETTINGS);
    settings.endpoints[0]={...settings.endpoints[0]!,
      baseUrl:"http://localhost:1234/v1",authMode:"none",
      models:["text-model"],modelCapabilities:{"text-model":["chat","tools"]}};
    settings.defaultRoute.modelId="text-model";
    const book=newBook("Trama","Titolo","Stile","Pubblico");
    const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices:[{message:{content:"Testo del racconto"}}],
    }),{headers:{"content-type":"application/json"}}));
    vi.stubGlobal("fetch",request);
    const result=await callModel("prose","Sistema","Prompt",settings,book,
      new AbortController().signal);
    expect(result.text).toBe("Testo del racconto");
    expect(request).toHaveBeenCalledTimes(1);
    expect((request.mock.calls[0]![1] as RequestInit).headers).not.toHaveProperty("Authorization");
  });
});
