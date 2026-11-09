import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type Activity, type AppSettings } from "../domain/types";
import { EmptyProviderContentError, keepObservedUsageOnEmptyReply } from "./ai-provider-error";

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
    keepObservedUsageOnEmptyReply(activity,p);
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
    keepObservedUsageOnEmptyReply(activity,new Error("HTTP 429"));
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
