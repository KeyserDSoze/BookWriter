import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { callModel } from "./ai";

vi.mock("./crypto", () => ({ decryptLocal: vi.fn().mockResolvedValue("test-only-key") }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function run(usage: unknown) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0] = { ...settings.endpoints[0]!, baseUrl: "http://localhost:1234/v1", authMode: "none", secret: null };
  settings.defaultRoute.modelId = "m";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content: "Testo valido" } }], usage,
  }), { headers: { "content-type": "application/json" } })));
  return callModel("prose", "S", "P", settings, newBook("Un racconto", "T", "P", "A"), new AbortController().signal);
}

describe("token di input serviti dalla cache del provider", () => {
  it("espone i token in cache dichiarati dal provider", async () => {
    const r = await run({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 64 } });
    expect(r).toMatchObject({ inputTokens: 100, outputTokens: 5, cachedInputTokens: 64 });
  });
  it("senza dettaglio nessun valore inventato", async () => {
    const r = await run({ prompt_tokens: 100, completion_tokens: 5 });
    expect(r.cachedInputTokens).toBeUndefined();
  });
});
