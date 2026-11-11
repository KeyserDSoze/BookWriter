import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Activity, type AppSettings } from "./types";
import { buildAiCostLedgerCsv } from "./ai-cost-ledger";

const settings = (): AppSettings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  aiPriceRates: [{
    endpointId: "provider-a", modelId: "model-a",
    inputEurPerMillion: 3, outputEurPerMillion: 9,
  }],
});
function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "attempt-1", bookId: "book-one", runId: "run-1",
    phase: "prose", status: "succeeded", title: "Segreto da NON esportare",
    reason: "prompt privato NON esportare", nextStep: "NON esportare",
    summary: "PROSA PRIVATA NON ESPORTARE", output: "MANOSCRITTO PRIVATO",
    error: "API_KEY_PRIVATA_NON_ESPORRE",
    createdAt: "2026-11-11T09:00:00.000Z", endpointId: "provider-a",
    modelId: "model-a", aiRequested: true, inputTokens: 2000, outputTokens: 1000,
    ...overrides,
  };
}
const quote = {
  endpointId: "provider-a", modelId: "model-a",
  inputEurPerMillion: 3, outputEurPerMillion: 9,
};
const lines = (value: string) => value.replace(/^\uFEFF/, "").trimEnd().split("\r\n");

describe("Esportazione ledger economico locale per il solo libro", () => {
  it("esporta tariffe snapshot, usage osservato e stima, mai fattura reale o testo privato", () => {
    const csv = buildAiCostLedgerCsv("book-one", [
      activity({ priceRateSnapshot: quote }),
    ], settings());
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const rows = lines(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("costo_stimato_eur;fattura_provider_eur;stato_fattura");
    expect(rows[1]).toContain('"2000";"1000";"completo";"snapshot";"3";"9";"0.015";"";"non_disponibile"');
    expect(csv).not.toMatch(/Segreto|prompt privato|PROSA PRIVATA|MANOSCRITTO|API_KEY/);
    expect(csv).not.toContain("book-one");
  });

  it("prezzo postumo non rivaluta snapshot; legacy esplicito usa solo il listino corrente", () => {
    const changed = settings();
    changed.aiPriceRates = [{ ...quote, inputEurPerMillion: 30, outputEurPerMillion: 90 }];
    const csv = buildAiCostLedgerCsv("book-one", [
      activity({ id: "old", createdAt: "2026-11-11T08:00:00Z" }),
      activity({ id: "new", priceRateSnapshot: quote }),
    ], changed);
    const rows = lines(csv);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('"old"');
    expect(rows[1]).toContain('"listino_corrente";"30";"90";"0.15"');
    expect(rows[2]).toContain('"new"');
    expect(rows[2]).toContain('"snapshot";"3";"9";"0.015"');
  });

  it("non inventa costo per usage mancante, parziale, running o conteggio invalido", () => {
    const csv = buildAiCostLedgerCsv("book-one", [
      activity({ id: "missing", inputTokens: undefined, outputTokens: undefined }),
      activity({ id: "partial", inputTokens: 0, outputTokens: undefined }),
      activity({ id: "running", status: "running" }),
      activity({ id: "invalid", inputTokens: -1, outputTokens: NaN }),
      activity({ id: "zero", inputTokens: 0, outputTokens: 0 }),
    ], settings());
    const data = lines(csv);
    expect(data).toHaveLength(6);
    for (const id of ["missing", "partial", "running", "invalid"]) {
      const row = data.find(line => line.includes('"' + id + '"'))!;
      expect(row).toContain(';"non_disponibile"');
      expect(row).toMatch(/;"[^"]+";"3";"9";"";"";"non_disponibile"$/);
    }
    expect(data.find(line => line.includes('"partial"'))).toContain('"0";"";"parziale"');
    expect(data.find(line => line.includes('"running"'))).toContain('"in_corso"');
    expect(data.find(line => line.includes('"zero"'))).toContain('"0";"0";"completo";"listino_corrente";"3";"9";"0";""');
  });

  it("rifiuta snapshot malformati, non li ricalcola con le tariffe presenti", () => {
    const csv = buildAiCostLedgerCsv("book-one", [
      activity({ priceRateSnapshot: { ...quote, modelId: "other" } }),
    ], settings());
    expect(csv).toContain('"snapshot_non_valido";"";"";"";"";"non_disponibile"');
    expect(csv).not.toContain('"0.015"');
  });

  it("separa libri, preflight falliti prima della rete e attività manuali", () => {
    const csv = buildAiCostLedgerCsv("book-one", [
      activity({ bookId: "book-two", id: "different-book" }),
      activity({ id: "manual", aiRequested: undefined, endpointId: undefined, modelId: undefined }),
      activity({ id: "preflight", aiRequested: false, status: "failed" }),
      activity({ id: "failed", status: "failed", inputTokens: undefined, outputTokens: undefined }),
      activity({ id: "cancelled", status: "cancelled", inputTokens: 20, outputTokens: 5 }),
    ], settings());
    const data = lines(csv);
    expect(data).toHaveLength(3);
    expect(csv).not.toMatch(/different-book|manual|preflight|book-two/);
    expect(csv).toContain('"failed"');
    expect(csv).toContain('"cancelled"');
    expect(csv).toContain('"20";"5";"completo"');
  });

  it("neutralizza formule CSV, delimitatori, newline e quote anche in route/import maliziosi", () => {
    const csv = buildAiCostLedgerCsv("book-one", [
      activity({
        id: "  =1+1", endpointId: "+CMD\r\nnext",
        modelId: '@HYPERLINK("https://example.invalid";"click")',
        priceRateSnapshot: undefined,
      }),
    ], settings());
    expect(csv).toContain('"\'  =1+1"');
    expect(csv).toContain('"\'+CMD  next"');
    expect(csv).toContain('"\'@HYPERLINK(""https://example.invalid"";""click"")"');
    expect(lines(csv)).toHaveLength(2);
    expect(csv).not.toContain("\r\nnext");
  });

  it("esporta il solo schema senza fatture se non ci sono tentativi AI", () => {
    const csv = buildAiCostLedgerCsv("book-one", [
      activity({ aiRequested: false }),
    ], settings());
    expect(lines(csv)).toHaveLength(1);
    expect(csv).toContain("fattura_provider_eur");
    expect(csv).not.toContain("attempt-1");
  });
});
