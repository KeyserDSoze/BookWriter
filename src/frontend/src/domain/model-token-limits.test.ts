import { describe, expect, it } from "vitest";
import type { EndpointProfile } from "./types";
import {
  assertModelTokenLimitSettings, declaredModelTokenLimits, effectiveOutputTokens, withModelTokenLimits,
} from "./model-token-limits";

const endpoint = { id: "e", name: "E", baseUrl: "http://localhost:1234/v1", secret: null, models: ["m"] } as EndpointProfile;

describe("Limiti di token dichiarati per modello", () => {
  it("li aggiorna senza mutare l'originale e rimuove la voce quando è vuota", () => {
    const both = withModelTokenLimits(endpoint, "m", { inputTokens: 28_000, outputTokens: 4_096 });
    expect(declaredModelTokenLimits(both, "m")).toEqual({ inputTokens: 28_000, outputTokens: 4_096 });
    expect(endpoint.modelTokenLimits).toBeUndefined();
    const onlyOutput = withModelTokenLimits(both, "m", { outputTokens: 2_048 });
    expect(declaredModelTokenLimits(onlyOutput, "m")).toEqual({ outputTokens: 2_048 });
    expect(withModelTokenLimits(onlyOutput, "m", {}).modelTokenLimits).toBeUndefined();
    expect(declaredModelTokenLimits(both, "altro")).toEqual({});
    expect(() => withModelTokenLimits(endpoint, "__proto__", { inputTokens: 1000 })).toThrow();
  });
  it("il tetto di output è il minore fra limite del modello e riserva del budget", () => {
    expect(effectiveOutputTokens({}, undefined)).toBeUndefined();
    expect(effectiveOutputTokens({ outputTokens: 4096 }, undefined)).toBe(4096);
    expect(effectiveOutputTokens({}, 8192)).toBe(8192);
    expect(effectiveOutputTokens({ outputTokens: 4096 }, 8192)).toBe(4096);
    expect(effectiveOutputTokens({ outputTokens: 4096 }, 1024)).toBe(1024);
  });
  it("rifiuta valori fuori intervallo, non interi, chiavi ostili e voci vuote", () => {
    const check = (value: unknown) => () => assertModelTokenLimitSettings({
      endpoints: [{ ...endpoint, modelTokenLimits: value as EndpointProfile["modelTokenLimits"] }] });
    check({ m: { inputTokens: 28_000, outputTokens: 4_096 } })();
    check(undefined)();
    for (const bad of [
      { m: { inputTokens: 10 } }, { m: { outputTokens: 1.5 } }, { m: { inputTokens: 99_999_999 } },
      { m: {} }, { m: { inputTokens: "8192" } }, { m: { inputTokens: 4096, extra: 1 } },
      { "": { inputTokens: 4096 } }, JSON.parse('{"__proto__":{"inputTokens":4096}}'), [], null,
    ]) expect(check(bad)).toThrow(/limiti di token|Limiti di token/i);
  });
});
