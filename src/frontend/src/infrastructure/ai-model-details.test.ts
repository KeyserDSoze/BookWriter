import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModelDetails } from "./ai";
import { tokenLimitsFromDetails, withDetectedTokenLimits } from "../domain/model-token-limits";
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
  it("compila solo i campi mancanti e non sovrascrive mai i valori scritti a mano", () => {
    const endpoint = { id: "e", name: "E", baseUrl: url, secret: null, models: ["a", "c"],
      modelTokenLimits: { a: { inputTokens: 20000 } } } as unknown as EndpointProfile;
    const { limits, filled } = withDetectedTokenLimits(endpoint, ["a", "c"], tokenLimitsFromDetails(details));
    expect(filled).toBe(2);
    expect(limits).toEqual({ a: { inputTokens: 20000, outputTokens: 4096 }, c: { outputTokens: 2048 } });
    expect(withDetectedTokenLimits({ ...endpoint, modelTokenLimits: limits } as EndpointProfile, ["a", "c"],
      tokenLimitsFromDetails(details)).filled).toBe(0);
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
