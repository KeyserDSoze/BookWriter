import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type Activity, type AppSettings } from "../domain/types";
import { EmptyProviderContentError, MalformedProviderContentError,
  keepObservedUsageOnRejectedReply } from "./ai-provider-error";

vi.mock("./crypto", () => ({ decryptLocal: vi.fn().mockResolvedValue("sk-test-local-only") }));
import { callModel } from "./ai";

function fixture() {
  const book = newBook("Mara al castello", "Mara", "Sobrio", "Adulti");
  const settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  settings.defaultRoute.modelId = "mock-reviewed";
  settings.endpoints[0]!.secret = { iv: "encrypted-only", data: "encrypted-only" };
  return { book, settings };
}
function providerResponse(content: unknown, usage?: unknown, status = 200): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }], usage,
  }), { status, headers: { "content-type": "application/json" } });
}
afterEach(() => vi.unstubAllGlobals());

describe("HTTP 200: usage osservato ma testo non utilizzabile", () => {
  it("getta errore tipizzato con usage completo, senza conservare il corpo della risposta", async () => {
    const {book,settings} = fixture();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse("   ",{
      prompt_tokens: 243, completion_tokens: 72,
    })));
    let failure: unknown;
    try {
      await callModel("chapterAudit", "System", "Prompt", settings, book, new AbortController().signal);
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(EmptyProviderContentError);
    const e = failure as EmptyProviderContentError;
    expect(e.message).toBe("Il provider AI ha risposto senza testo utilizzabile.");
    expect({ endpointId:e.endpointId, modelId:e.modelId,
      input:e.inputTokens, output:e.outputTokens }).toEqual({
      endpointId:"openai",modelId:"mock-reviewed",input:243,output:72,
    });
    expect(JSON.stringify(e)).not.toContain("sk-test");
    expect(JSON.stringify(e)).not.toContain("System");
  });
  it("accetta una lista completamente testuale senza cambiare il testo originale",async()=>{
    const {book,settings}=fixture();
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(providerResponse([
      {type:"text",text:"Prima parte"},
      {text:"Seconda parte"},
    ],{prompt_tokens:234,completion_tokens:45})));
    const answer=await callModel("chapterAudit","System","Prompt",settings,book,new AbortController().signal);
    expect(answer).toEqual({text:["Prima parte","Seconda parte"].join("\n"),
      endpointId:"openai",modelId:"mock-reviewed",inputTokens:234,outputTokens:45});
  });
  it("rifiuta tutte le parti malformate, non canonizza oggetti o testo parziale e conserva usage",async()=>{
    const {book,settings}=fixture();
    const invalidContent=[
      [null], [42], [true], ["testo"],
      [{type:"text",text:42}], [{text:{value:"PROMPT PRIVATO"}}],
      [{type:"text",text:"Testo benigno"},{type:"image_url",image_url:"https://example.invalid"}],
      [{type:"refusal",text:"PROMPT PRIVATO"}],
      {text:"PROMPT PRIVATO"},
    ];
    for(const content of invalidContent){
      vi.stubGlobal("fetch",vi.fn().mockResolvedValue(providerResponse(content,{
        prompt_tokens:243,completion_tokens:72,
      })));
      let error:unknown;
      try{await callModel("chapterAudit","System","Prompt",settings,book,new AbortController().signal);}
      catch(failure){error=failure;}
      expect(error).toBeInstanceOf(MalformedProviderContentError);
      const failure=error as MalformedProviderContentError;
      expect(failure).toMatchObject({endpointId:"openai",modelId:"mock-reviewed",
        inputTokens:243,outputTokens:72});
      expect(JSON.stringify(failure)).not.toMatch(/PROMPT PRIVATO|sk-test-local-only|Testo benigno/);
      const attempt={} as Activity;
      keepObservedUsageOnRejectedReply(attempt,failure);
      expect(attempt).toMatchObject({inputTokens:243,outputTokens:72});
    }
  });
  it("rifiuta envelope con choices mancanti senza perdere usage dichiarato",async()=>{
    const {book,settings}=fixture();
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices:null,usage:{prompt_tokens:17,completion_tokens:5},
    }),{status:200})));
    await expect(callModel("chapterAudit","System","Prompt",settings,book,
      new AbortController().signal)).rejects.toMatchObject({
        name:"MalformedProviderContentError",inputTokens:17,outputTokens:5,
      });
  });
  it("mantiene fail-closed la spesa se usage su contenuto malformato è parziale o invalido",async()=>{
    const {book,settings}=fixture();
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(providerResponse([null],{
      prompt_tokens:350,completion_tokens:"72",
    })));
    await expect(callModel("chapterAudit","System","Prompt",settings,book,
      new AbortController().signal)).rejects.toMatchObject({
        name:"MalformedProviderContentError",inputTokens:350,outputTokens:undefined,
      });
  });

  it("conserva uso parziale ma non inventa conteggi negativi/non interi/stringa", async () => {
    const {book,settings} = fixture();
    for(const usage of [
      {prompt_tokens:450,completion_tokens:null},
      {prompt_tokens:-1,completion_tokens:1.3},
      {prompt_tokens:"500",completion_tokens:0},
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerResponse("", usage)));
      await expect(callModel("chapterAudit","System","Prompt",settings,book,new AbortController().signal))
        .rejects.toBeInstanceOf(EmptyProviderContentError);
    }
    const p = new EmptyProviderContentError("openai","mock-reviewed",
      {prompt_tokens:450,completion_tokens:null});
    const activity = { endpointId:"old",modelId:"old",
      inputTokens:undefined,outputTokens:undefined } as Activity;
    keepObservedUsageOnRejectedReply(activity,p);
    expect(activity).toMatchObject({endpointId:"openai",modelId:"mock-reviewed",inputTokens:450});
    expect(activity.outputTokens).toBeUndefined();
    const invalid = new EmptyProviderContentError("openai","mock-reviewed",
      {prompt_tokens:-1,completion_tokens:1.3});
    expect(invalid.inputTokens).toBeUndefined();
    expect(invalid.outputTokens).toBeUndefined();
  });
  it("non prende usage da errori HTTP 4xx o JSON malformato", async () => {
    const {book,settings} = fixture();
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(providerResponse("",{
      prompt_tokens:999,completion_tokens:999,
    },429)));
    await expect(callModel("chapterAudit","System","Prompt",settings,book,new AbortController().signal))
      .rejects.toThrow("429");
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("non JSON",{status:200})));
    await expect(callModel("chapterAudit","System","Prompt",settings,book,new AbortController().signal))
      .rejects.toThrow(/JSON valido/);
    const activity={inputTokens:undefined} as Activity;
    keepObservedUsageOnRejectedReply(activity,new Error("HTTP 429"));
    expect(activity.inputTokens).toBeUndefined();
    expect(activity.endpointId).toBeUndefined();
  });
  it("risposta non vuota conserva i conteggi validi e scarta quelli falsi", async () => {
    const {book,settings} = fixture();
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(providerResponse("  Un testo  ",{
      prompt_tokens:345,completion_tokens:"72",
    })));
    const answer=await callModel("chapterAudit","System","Prompt",settings,book,new AbortController().signal);
    expect(answer).toMatchObject({text:"Un testo",inputTokens:345});
    expect(answer.outputTokens).toBeUndefined();
  });
});
