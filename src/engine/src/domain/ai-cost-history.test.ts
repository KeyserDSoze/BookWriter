import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Activity, type AppSettings } from "./types";
import { listBookAiCostHistory, buildAiCostLedgerCsv } from "./ai-cost-ledger";

const price = {
  endpointId: "provider", modelId: "model",
  inputEurPerMillion: 3, outputEurPerMillion: 9,
};
function entry(changes: Partial<Activity> = {}): Activity {
  return {
    id: "a", bookId: "book-1", runId: "run-1",
    phase: "chapterReview", status: "succeeded", title: "Revisione del capitolo",
    reason: "SEGRETO_PROMPT_NON_MOSTRARE", nextStep: "Proseguire",
    summary: "PROSA_NON_MOSTRARE", output: "ROMANZO_NON_MOSTRARE",
    error: "KEY_NON_MOSTRARE",
    createdAt: "2026-11-11T09:00:00.000Z",
    endpointId: "provider", modelId: "model", aiRequested: true,
    inputTokens: 2000, outputTokens: 1000,
    priceRateSnapshot: price,
    ...changes,
  };
}
function settings(): AppSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    aiPriceRates: [{ ...price, inputEurPerMillion: 30, outputEurPerMillion: 90 }],
  };
}
describe("Storico costi AI per task", () => {
  it("usa solo il libro, scarta preflight e interventi manuali, ordina senza mutare l'input", () => {
    const original = [
      entry({ id: "new", createdAt: "2026-11-11T10:00:00.000Z" }),
      entry({ id: "other-book", bookId: "book-2" }),
      entry({ id: "preflight", aiRequested: false, status: "failed" }),
      entry({ id: "manual", aiRequested: undefined, endpointId: undefined,
        modelId: undefined, priceRateSnapshot: undefined }),
      entry({ id: "legacy", aiRequested: undefined, priceRateSnapshot: undefined }),
      entry({ id: "first", createdAt: "2026-11-11T08:00:00.000Z" }),
    ];
    const output = listBookAiCostHistory("book-1", original, settings());
    expect(output.map(x => x.id)).toEqual(["first", "legacy", "new"]);
    expect(original.map(x => x.id)[0]).toBe("new");
    expect(output[0]?.taskTitle).toBe("Revisione del capitolo");
    expect(output[0]?.phase).toBe("chapterReview");
    for (const row of output) {
      for (const forbidden of ["reason", "output", "summary", "error"]) {
        expect(Object.keys(row)).not.toContain(forbidden);
      }
    }
  });

  it("condivide quote e stime del CSV: snapshot immutabile contro listino corrente legacy", () => {
    const s = settings();
    const rows = [
      entry({ id: "frozen" }),
      entry({ id: "legacy", priceRateSnapshot: undefined }),
      entry({ id: "no-price", priceRateSnapshot: { ...price, modelId: "other" } }),
    ];
    const data = listBookAiCostHistory("book-1", rows, s);
    expect(data.map(row => row.id)).toEqual(["frozen", "legacy", "no-price"]);
    expect(data[0]?.assessment).toMatchObject({ rateOrigin: "snapshot", estimatedEur: 0.015 });
    expect(data[1]?.assessment).toMatchObject({ rateOrigin: "listino_corrente", estimatedEur: 0.15 });
    expect(data[2]?.assessment).toMatchObject({ rateOrigin: "snapshot_non_valido" });
    expect(data[2]?.assessment.estimatedEur).toBeUndefined();
    const csv = buildAiCostLedgerCsv("book-1", rows, s);
    expect(csv).toContain('"frozen"');
    expect(csv).toContain('"0.015"');
    expect(csv).toContain('"0.15"');
    expect(csv).toContain('"snapshot_non_valido"');
  });

  it("distingue zero noto da tentativi falliti e usage parziale o in corso", () => {
    const data = listBookAiCostHistory("book-1", [
      entry({ id: "zero", inputTokens: 0, outputTokens: 0 }),
      entry({ id: "partial", status: "failed", inputTokens: 0, outputTokens: undefined }),
      entry({ id: "running", status: "running" }),
      entry({ id: "unknown", status: "cancelled", inputTokens: undefined, outputTokens: undefined }),
    ], settings());
    const get = (id: string) => data.find(x => x.id === id)!;
    expect(get("zero").assessment).toMatchObject({usageCoverage:"completo",estimatedEur:0});
    expect(get("partial").assessment).toMatchObject({usageCoverage:"parziale",inputTokens:0});
    expect(get("partial").assessment.estimatedEur).toBeUndefined();
    expect(get("running").assessment).toMatchObject({usageCoverage:"in_corso"});
    expect(get("running").assessment.estimatedEur).toBeUndefined();
    expect(get("unknown").assessment).toMatchObject({usageCoverage:"mancante"});
    expect(get("unknown").assessment.estimatedEur).toBeUndefined();
  });

  it("è read-only: nessuna mutazione di Activity o snapshot durante l'aggregazione", () => {
    const row = entry();
    const before = structuredClone(row);
    const source = [row];
    const prices = settings();
    const output = listBookAiCostHistory("book-1", source, prices);
    expect(source[0]).toEqual(before);
    expect(output).toHaveLength(1);
    expect(output[0]?.assessment.rate).toEqual(price);
    expect(output[0]?.assessment.rate).not.toBe(prices.aiPriceRates?.[0]);
  });
});
