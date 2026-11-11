import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { callModel, endpointAuthMode, fetchModels } from "./ai";
import { decryptLocal } from "./crypto";

vi.mock("./crypto", () => ({ decryptLocal: vi.fn().mockResolvedValue("test-only-key") }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function answer(): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: "Testo locale valido" } }],
    usage: { prompt_tokens: 9, completion_tokens: 4 },
  }), { headers: { "content-type": "application/json" } });
}
function fixture(host = "localhost") {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0] = {
    ...settings.endpoints[0]!, baseUrl: `http://${host}:1234/v1`,
    authMode: "none", secret: null,
  };
  settings.defaultRoute.modelId = "lm-studio-model";
  return {settings,book:newBook("Un racconto","Locale","Prosa","Adulti")};
}
describe("LM Studio / endpoint locale senza API key", () => {
  it("POST Chat Completions senza Authorization né decifrazione su loopback",async()=>{
    for(const host of ["localhost","127.0.0.1"]){
      const {settings,book}=fixture(host);
      const fetcher=vi.fn().mockResolvedValue(answer());
      vi.stubGlobal("fetch",fetcher);
      const result=await callModel("prose","Sistema","Prompt",settings,book,
        new AbortController().signal,{maxOutputTokens:256});
      expect(result).toMatchObject({text:"Testo locale valido",inputTokens:9,outputTokens:4});
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]![0]).toBe(`http://${host}:1234/v1/chat/completions`);
      const options=fetcher.mock.calls[0]![1] as RequestInit;
      expect(options.headers).toEqual({"Content-Type":"application/json"});
      expect(options).toMatchObject({method:"POST",credentials:"omit",redirect:"error",mode:"cors"});
      expect(JSON.parse(options.body as string)).toHaveProperty("max_tokens",256);
      expect(decryptLocal).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });
  it("GET /models senza Authorization",async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data:[{id:"local-model"},{id:"local-model"}],
    }),{headers:{"content-type":"application/json"}}));
    vi.stubGlobal("fetch",fetcher);
    expect(await fetchModels("http://localhost:1234/v1",null)).toEqual(["local-model"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe("http://localhost:1234/v1/models");
    expect((fetcher.mock.calls[0]![1] as RequestInit).headers).toEqual({});
    expect(decryptLocal).not.toHaveBeenCalled();
  });
  it("legacy richiede sempre API key, il locale autenticato mantiene Bearer",async()=>{
    const {settings,book}=fixture();
    const fetcher=vi.fn().mockResolvedValue(answer());
    vi.stubGlobal("fetch",fetcher);
    settings.endpoints[0]!.authMode=undefined;
    await expect(callModel("prose","Sistema","Prompt",settings,book,new AbortController().signal))
      .rejects.toThrow(/Chiave API mancante/);
    expect(fetcher).not.toHaveBeenCalled();
    settings.endpoints[0]!.secret={iv:"iv",data:"encrypted"};
    await callModel("prose","Sistema","Prompt",settings,book,new AbortController().signal);
    expect((fetcher.mock.calls[0]![1] as RequestInit).headers).toEqual({
      "Content-Type":"application/json",Authorization:"Bearer test-only-key",
    });
    expect(decryptLocal).toHaveBeenCalledTimes(1);
  });
  it("rifiuta no-auth su host remoti e falsi loopback, valori corrotti prima di rete",async()=>{
    const fetcher=vi.fn();
    vi.stubGlobal("fetch",fetcher);
    for(const url of ["https://remote.example.test/v1","https://localhost.evil.example/v1",
      "http://localhost.evil.example:1234/v1","https://127.0.0.2/v1"]){
      const {settings,book}=fixture();
      settings.endpoints[0]!.baseUrl=url;
      await expect(callModel("prose","Sistema","Prompt",settings,book,
        new AbortController().signal)).rejects.toThrow();
      await expect(fetchModels(url,null)).rejects.toThrow();
    }
    const {settings,book}=fixture();
    for(const value of [null,"","anonymous",1,{}]){
      settings.endpoints[0]!.authMode=value as "api_key";
      await expect(callModel("prose","Sistema","Prompt",settings,book,
        new AbortController().signal)).rejects.toThrow(/Modalità autenticazione AI non valida/);
    }
    expect(()=>endpointAuthMode("none","https://remote.example.test/v1"))
      .toThrow(/solo un endpoint localhost/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(decryptLocal).not.toHaveBeenCalled();
  });
  it("non accetta GET anonima remota e mantiene la chiave obbligatoria",async()=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    await expect(fetchModels("https://remote.example.test/v1",null))
      .rejects.toThrow(/solo un endpoint localhost/);
    await expect(fetchModels("http://localhost:1234/v1",""))
      .rejects.toThrow(/Inserisci prima la chiave API/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
