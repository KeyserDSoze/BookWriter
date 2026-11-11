import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type AppSettings } from "../domain/types";
import { callModel, chatOutputTokenParameter } from "./ai";

vi.mock("./crypto", () => ({ decryptLocal: vi.fn().mockResolvedValue("sk-fixture-not-a-real-key") }));
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  settings.defaultRoute.modelId = "model-a";
  settings.endpoints[0]!.secret = {iv:"encrypted",data:"encrypted"};
  const book = newBook("Una trama", "Il libro", "Prosa", "Adulti");
  return { settings, book };
}
function ok(): Response {
  return new Response(JSON.stringify({
    choices:[{message:{content:"Prosa valida"}}],
    usage:{prompt_tokens:10,completion_tokens:3},
  }),{status:200,headers:{"content-type":"application/json"}});
}
function body(mock: ReturnType<typeof vi.fn>, attempt = 0): Record<string, unknown> {
  return JSON.parse((mock.mock.calls[attempt]?.[1] as RequestInit).body as string) as Record<string,unknown>;
}

describe("Parametro limite token POST Chat Completions", () => {
  it("lascia intatto il default storico max_tokens e invia solo un campo", async () => {
    const {settings,book}=fixture();
    const request=vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch",request);
    const answer=await callModel("chapterAudit","Sistema","Prompt",settings,book,
      new AbortController().signal,{maxOutputTokens:8192});
    expect(answer).toMatchObject({text:"Prosa valida",inputTokens:10,outputTokens:3});
    expect(request).toHaveBeenCalledTimes(1);
    expect(body(request)).toMatchObject({model:"model-a",max_tokens:8192});
    expect(body(request)).not.toHaveProperty("max_completion_tokens");
    expect((request.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
  });

  it("usa max_completion_tokens se selezionato senza aggiungere max_tokens", async () => {
    const {settings,book}=fixture();
    settings.endpoints[0]!.outputTokenParameter="max_completion_tokens";
    const request=vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch",request);
    await callModel("chapterAudit","Sistema","Prompt",settings,book,
      new AbortController().signal,{maxOutputTokens:512});
    expect(body(request)).toMatchObject({model:"model-a",max_completion_tokens:512});
    expect(body(request)).not.toHaveProperty("max_tokens");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("non invia alcun parametro limite se il budget non lo richiede", async () => {
    const {settings,book}=fixture();
    settings.endpoints[0]!.outputTokenParameter="max_completion_tokens";
    const request=vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch",request);
    await callModel("chapterAudit","Sistema","Prompt",settings,book,new AbortController().signal);
    expect(body(request)).not.toHaveProperty("max_tokens");
    expect(body(request)).not.toHaveProperty("max_completion_tokens");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("la route diversa usa la configurazione del proprio endpoint, non del nome modello", async () => {
    const {settings,book}=fixture();
    settings.endpoints.push({
      ...structuredClone(settings.endpoints[0]!),id:"compat",
      name:"Secondo provider",baseUrl:"https://compat.example.test/v1",
      outputTokenParameter:"max_completion_tokens",
    });
    settings.taskRoutes.chapterAudit={endpointId:"compat",modelId:"model-a"};
    // A Response body is a one-shot ReadableStream: give each POST its own body.
    const request=vi.fn().mockImplementation(async()=>ok());
    vi.stubGlobal("fetch",request);
    await callModel("chapterAudit","Sistema","Prompt",settings,book,
      new AbortController().signal,{maxOutputTokens:256});
    expect((request.mock.calls[0]?.[0] as string))
      .toBe("https://compat.example.test/v1/chat/completions");
    expect(body(request)).toHaveProperty("max_completion_tokens",256);
    settings.taskRoutes.chapterAudit={endpointId:"openai",modelId:"model-a"};
    await callModel("chapterAudit","Sistema","Prompt",settings,book,
      new AbortController().signal,{maxOutputTokens:256});
    expect(body(request,1)).toHaveProperty("max_tokens",256);
    expect(body(request,1)).not.toHaveProperty("max_completion_tokens");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("HTTP 400/422 non causa tentativi automatici con il parametro alternativo", async () => {
    for(const status of [400,422,429]) {
      const {settings,book}=fixture();
      settings.endpoints[0]!.outputTokenParameter="max_completion_tokens";
      const request=vi.fn().mockResolvedValue(new Response(
        "test secret and prompt must not be leaked",
        {status,headers:{"content-type":"text/plain"}},
      ));
      vi.stubGlobal("fetch",request);
      await expect(callModel("chapterAudit","Sistema privato","Prompt privato",
        settings,book,new AbortController().signal,{maxOutputTokens:1024}))
        .rejects.toThrow("HTTP "+status);
      expect(request).toHaveBeenCalledTimes(1);
      expect(body(request)).toHaveProperty("max_completion_tokens",1024);
      expect(body(request)).not.toHaveProperty("max_tokens");
    }
  });

  it("valori estranei dal profilo o limite invalido si fermano prima della rete", async () => {
    const {settings,book}=fixture();
    const request=vi.fn();
    vi.stubGlobal("fetch",request);
    expect(chatOutputTokenParameter(undefined)).toBe("max_tokens");
    expect(chatOutputTokenParameter("max_tokens")).toBe("max_tokens");
    expect(chatOutputTokenParameter("max_completion_tokens")).toBe("max_completion_tokens");
    for(const bad of [null,"", "max_output_tokens","MAX_TOKENS",123,{},[]]) {
      expect(()=>chatOutputTokenParameter(bad)).toThrow(/Parametro limite output AI/);
      settings.endpoints[0]!.outputTokenParameter=bad as "max_tokens";
      await expect(callModel("chapterAudit","Sistema","Prompt",settings,book,
        new AbortController().signal,{maxOutputTokens:1024}))
        .rejects.toThrow(/Parametro limite output AI/);
    }
    settings.endpoints[0]!.outputTokenParameter="max_tokens";
    for(const bad of [0,-1,1.5,NaN,Infinity,32769]) {
      await expect(callModel("chapterAudit","Sistema","Prompt",settings,book,
        new AbortController().signal,{maxOutputTokens:bad}))
        .rejects.toThrow(/Limite output AI non valido/);
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("abort preventivo non effettua alcun POST", async () => {
    const {settings,book}=fixture();
    settings.endpoints[0]!.outputTokenParameter="max_completion_tokens";
    const request=vi.fn();
    vi.stubGlobal("fetch",request);
    const ctrl=new AbortController();ctrl.abort();
    await expect(callModel("chapterAudit","Sistema","Prompt",settings,book,ctrl.signal,
      {maxOutputTokens:2048})).rejects.toMatchObject({name:"AbortError"});
    expect(request).not.toHaveBeenCalled();
  });
});
