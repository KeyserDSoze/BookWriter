import { describe, expect, it } from "vitest";
import { pricedCost, assessAiCostAttempt } from "./ai-budget";
import { cachedTokensFromUsage } from "./ai-usage";
import { buildAiCostLedgerCsv } from "./ai-cost-ledger";
import { DEFAULT_SETTINGS, type Activity, type AppSettings } from "./types";

const rate = { endpointId: "openai", modelId: "m", inputEurPerMillion: 2, outputEurPerMillion: 8 };
function settingsWith(r: Partial<typeof rate> & { cachedInputEurPerMillion?: number }): AppSettings {
  const s: AppSettings = structuredClone(DEFAULT_SETTINGS);
  s.aiPriceRates = [{ ...rate, ...r }];
  return s;
}
function act(partial: Partial<Activity> = {}): Activity {
  return {
    id: "a1", bookId: "b", runId: "r", phase: "outline", title: "t", reason: "r", nextStep: "n",
    status: "succeeded", createdAt: "2026-11-05T12:00:00.000Z", aiRequested: true,
    endpointId: "openai", modelId: "m", inputTokens: 1_000_000, outputTokens: 500_000, ...partial,
  };
}

describe("costo per modello con token in cache", () => {
  it("senza prezzo cache tutti i token input costano come input", () => {
    expect(pricedCost(1_000_000, 0, rate, 400_000)).toBeCloseTo(2, 9);
  });
  it("con prezzo cache divide l'input tra normale e in cache", () => {
    const r = { ...rate, cachedInputEurPerMillion: 0.5 };
    expect(pricedCost(1_000_000, 500_000, r, 400_000)).toBeCloseTo(0.6 * 2 + 0.4 * 0.5 + 4, 9);
  });
  it("i token in cache non superano l'input", () => {
    const r = { ...rate, cachedInputEurPerMillion: 1 };
    expect(pricedCost(100, 0, r, 5_000)).toBeCloseTo(100 / 1_000_000, 12);
  });
  it("valuta l'attività usando i token in cache riportati dal provider", () => {
    const s = settingsWith({ cachedInputEurPerMillion: 0.5 });
    const withCache = assessAiCostAttempt(act({ cachedInputTokens: 800_000 }), s);
    expect(withCache.estimatedEur).toBeCloseTo(0.2 * 2 + 0.8 * 0.5 + 4, 9);
    const without = assessAiCostAttempt(act(), s);
    expect(without.estimatedEur).toBeCloseTo(2 + 4, 9);
  });
  it("rifiuta un prezzo cache non valido", () => {
    const s = settingsWith({ cachedInputEurPerMillion: -1 });
    expect(assessAiCostAttempt(act(), s).estimatedEur).toBeUndefined();
  });
  it("legge i token in cache dai formati OpenAI e DeepSeek e ignora valori invalidi", () => {
    expect(cachedTokensFromUsage({ prompt_tokens_details: { cached_tokens: 12 } })).toBe(12);
    expect(cachedTokensFromUsage({ prompt_cache_hit_tokens: 7 })).toBe(7);
    expect(cachedTokensFromUsage({ prompt_tokens_details: { cached_tokens: -1 } })).toBeUndefined();
    expect(cachedTokensFromUsage({ prompt_tokens_details: { cached_tokens: "5" } })).toBeUndefined();
    expect(cachedTokensFromUsage(undefined)).toBeUndefined();
    expect(cachedTokensFromUsage([1])).toBeUndefined();
  });
  it("il CSV espone token e prezzo in cache", () => {
    const s = settingsWith({ cachedInputEurPerMillion: 0.5 });
    const csv = buildAiCostLedgerCsv("b", [act({ cachedInputTokens: 800_000 })], s);
    expect(csv).toContain("token_input_in_cache_osservati");
    expect(csv).toContain("prezzo_input_cache_eur_milione");
    expect(csv).toContain('"800000"');
    expect(csv).toContain('"0.5"');
  });
});
