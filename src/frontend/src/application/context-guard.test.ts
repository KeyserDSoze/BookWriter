import { describe, expect, it, vi, afterEach } from "vitest";
import { parseLmStudioContext } from "../infrastructure/lmstudio-models";
import { assertPromptFitsLoadedContext, estimatePromptTokens, judgePromptAgainstContext,
  PromptExceedsContextError } from "./context-guard";
import type { EndpointProfile } from "../domain/types";

const payload = {
  models: [
    { type: "llm", key: "meta/muse-glimmer", max_context_length: 131072,
      loaded_instances: [{ id: "meta/muse-glimmer", config: { context_length: 16384 } }] },
    { type: "llm", key: "other/unloaded", max_context_length: 8192, loaded_instances: [] },
    { type: "embedding", key: "nomic", loaded_instances: [{ id: "nomic", config: { context_length: 2048 } }] },
  ],
};
const endpoint = { id: "lm", name: "LM", baseUrl: "http://localhost:1235/v1", authMode: "none", models: [] } as unknown as EndpointProfile;

afterEach(() => vi.unstubAllGlobals());

describe("Guardia del contesto caricato", () => {
  it("legge il contesto realmente caricato e quello massimo, ignorando dati malformati", () => {
    expect(parseLmStudioContext(payload, "meta/muse-glimmer")).toEqual({ loaded: 16384, max: 131072 });
    expect(parseLmStudioContext(payload, "other/unloaded")).toEqual({ max: 8192 });
    expect(parseLmStudioContext(payload, "assente")).toBeUndefined();
    expect(parseLmStudioContext({ models: "x" }, "a")).toBeUndefined();
    const hostile = { models: [{ type: "llm", key: "a", loaded_instances: [{ id: "a", config: { context_length: -5 } }], max_context_length: "9" }] };
    expect(parseLmStudioContext(hostile, "a")).toEqual({});
  });
  it("stima i token con margine prudente e riserva spazio per la risposta", () => {
    expect(estimatePromptTokens("a".repeat(340), "b".repeat(340))).toBe(200);
    expect(judgePromptAgainstContext("", "x".repeat(34_000), undefined, 16384).fits).toBe(true);
    expect(judgePromptAgainstContext("", "x".repeat(55_000), undefined, 16384).fits).toBe(false);
    expect(judgePromptAgainstContext("", "x".repeat(34_000), 8000, 16384).fits).toBe(false);
  });
  it("blocca prima della richiesta quando il prompt non entra, con indicazione utile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload),
      { status: 200, headers: { "content-type": "application/json" } })));
    const signal = new AbortController().signal;
    await expect(assertPromptFitsLoadedContext(endpoint, "meta/muse-glimmer", "Giudice", "s", "x".repeat(60_000), undefined, signal))
      .rejects.toThrow(PromptExceedsContextError);
    await expect(assertPromptFitsLoadedContext(endpoint, "meta/muse-glimmer", "Giudice", "s", "x".repeat(60_000), undefined, signal))
      .rejects.toThrow(/131072.*Nessuna richiesta è stata inviata/);
    await expect(assertPromptFitsLoadedContext(endpoint, "meta/muse-glimmer", "Scena", "s", "x".repeat(2_000), undefined, signal))
      .resolves.toBeUndefined();
  });
  it("non blocca se il contesto è ignoto, il server non risponde o l'endpoint usa una chiave", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    const signal = new AbortController().signal;
    await expect(assertPromptFitsLoadedContext(endpoint, "meta/muse-glimmer", "T", "s", "x".repeat(999_999), undefined, signal))
      .resolves.toBeUndefined();
    const keyed = { ...endpoint, authMode: "api_key" } as EndpointProfile;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(assertPromptFitsLoadedContext(keyed, "m", "T", "s", "x".repeat(999_999), undefined, signal))
      .resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
