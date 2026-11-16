import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModelDetails } from "./ai";
import { capabilityTagsFromDetails, tokenLimitsFromDetails, withDetectedCapabilities, withDetectedTokenLimits } from "../domain/model-token-limits";
import type { EndpointProfile } from "../domain/types";

const url = "https://proxy.example.test/v1";
const details = {
  object: "list",
  data: [
    { id: "a", context_window: 32768, max_output_tokens: 4096 },
    { id: "b", context_window: 32768, max_output_tokens: null },
    { id: "c", context_window: null, max_output_tokens: 2048 },
    { id: "d", context_window: null, max_output_tokens: null },
    { id: "e", context_window: 1000, max_output_tokens: 5000 },
    { id: "__proto__", context_window: 8192, max_output_tokens: 1024 },
  ],
};
afterEach(() => vi.unstubAllGlobals());

describe("Limiti di token letti da /models/details", () => {
  it("ricava input e output dal contesto dichiarato, ignorando i null e le voci incoerenti", () => {
    const limits = tokenLimitsFromDetails(details);
    expect(limits["a"]).toEqual({ inputTokens: 28672, outputTokens: 4096 });
    expect(limits["b"]).toEqual({ inputTokens: 32768 - 4096 });
    expect(limits["c"]).toEqual({ outputTokens: 2048 });
    expect(limits["d"]).toBeUndefined();
    expect(limits["e"]).toEqual({ inputTokens: 1000 - 250 });
    expect(Object.keys(limits)).not.toContain("__proto__");
    expect(tokenLimitsFromDetails(null)).toEqual({});
    expect(tokenLimitsFromDetails({ data: "x" })).toEqual({});
  });
  it("una lettura esplicita aggiorna i valori dichiarati dal provider e lascia quelli che non dichiara", () => {
    const endpoint = { id: "e", name: "E", baseUrl: url, secret: null, models: ["a", "c"],
      modelTokenLimits: { a: { inputTokens: 20000, outputTokens: 1000 }, c: { inputTokens: 5000 } } } as unknown as EndpointProfile;
    const { limits, filled } = withDetectedTokenLimits(endpoint, ["a", "c"], tokenLimitsFromDetails(details));
    expect(filled).toBe(2);
    expect(limits).toEqual({ a: { inputTokens: 28672, outputTokens: 4096 }, c: { inputTokens: 5000, outputTokens: 2048 } });
    expect(withDetectedTokenLimits({ ...endpoint, modelTokenLimits: limits } as EndpointProfile, ["a", "c"],
      tokenLimitsFromDetails(details)).filled).toBe(0);
  });
  it("con i valori reali di llmproxy (131072 / 8192) ricava input 122880 e output 8192", () => {
    const real = { data: [{ id: "muse-glimmer-30b", type: "chat", context_window: 131072, max_output_tokens: 8192,
      capabilities: { streaming: true, tools: true, vision: true, reasoning: true } }] };
    expect(tokenLimitsFromDetails(real)["muse-glimmer-30b"]).toEqual({ inputTokens: 122880, outputTokens: 8192 });
    expect(capabilityTagsFromDetails(real)["muse-glimmer-30b"]).toEqual(["chat", "tools"]);
  });
  it("aggiunge i ruoli dichiarati dal provider senza mai toglierne e senza dedurli dal nome", () => {
    const endpoint = { id: "e", name: "E", baseUrl: url, secret: null, models: ["m", "emb", "x"],
      modelCapabilities: { m: ["voice"] } } as unknown as EndpointProfile;
    const payload = { data: [
      { id: "m", type: "chat", capabilities: { tools: true } }, { id: "emb", type: "embedding" },
      { id: "x", type: "chat", capabilities: { tools: false } }, { id: "voice-model", type: "audio" },
    ] };
    const { tags, added } = withDetectedCapabilities(endpoint, ["m", "emb", "x"], capabilityTagsFromDetails(payload));
    expect(added).toBe(3);
    expect(tags).toEqual({ m: ["chat", "tools", "voice"], emb: ["embedding"], x: ["chat"] });
    expect(capabilityTagsFromDetails(payload)["voice-model"]).toBeUndefined();
    expect(withDetectedCapabilities({ ...endpoint, modelCapabilities: tags } as EndpointProfile, ["m", "emb", "x"],
      capabilityTagsFromDetails(payload)).added).toBe(0);
  });
  it("legge /models/details con la stessa sicurezza del catalogo e, se fallisce, restituisce undefined", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(details),
      { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    await expect(fetchModelDetails(url, "sk-segreta")).resolves.toEqual(details);
    expect(request.mock.calls[0]![0]).toBe(url + "/models/details");
    expect(request.mock.calls[0]![1]).toMatchObject({ method: "GET", credentials: "omit", redirect: "error",
      headers: { Authorization: "Bearer sk-segreta" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    await expect(fetchModelDetails(url, "sk-segreta")).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("CORS")));
    await expect(fetchModelDetails(url, "sk-segreta")).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })));
    await expect(fetchModelDetails(url, "sk-segreta")).resolves.toBeUndefined();
  });
});
