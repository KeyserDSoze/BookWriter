import { describe, expect, it } from "vitest";
import { assessAiBudgetHeadroom, AI_BUDGET_WARNING_FRACTION,
  accountBookAiBudget, accountSessionAiBudget, type AiBudgetAccounting } from "./ai-budget";
import { DEFAULT_SETTINGS, newBook, type Activity } from "./types";

const account = (estimatedSpentEur: number, incompleteCount = 0,
  unpricedCount = 0): AiBudgetAccounting => ({
  estimatedSpentEur, incompleteCount, unpricedCount, countedCalls: 2,
  legacyPricedCount: 0,
});

describe("Avviso anticipato dei budget AI locali", () => {
  it("resta silenzioso con budget inutilizzato e restituisce margine noto (non credito provider)", () => {
    expect(AI_BUDGET_WARNING_FRACTION).toBe(0.8);
    expect(assessAiBudgetHeadroom(account(0), 10)).toEqual({
      status: "sotto_soglia", knownRemainingEur: 10, knownUsedFraction: 0,
    });
    const justBelow = assessAiBudgetHeadroom(account(7.999), 10);
    expect(justBelow.status).toBe("sotto_soglia");
    expect(justBelow.knownUsedFraction).toBeCloseTo(0.7999, 8);
  });

  it("avverte precisamente dall'80%, ma non blocca né altera il preflight", () => {
    expect(assessAiBudgetHeadroom(account(8), 10)).toEqual({
      status: "vicino", knownRemainingEur: 2, knownUsedFraction: 0.8,
    });
    expect(assessAiBudgetHeadroom(account(9.99), 10).status).toBe("vicino");
    expect(assessAiBudgetHeadroom(account(10), 10)).toEqual({
      status: "raggiunto", knownRemainingEur: 0, knownUsedFraction: 1,
    });
    expect(assessAiBudgetHeadroom(account(12), 10)).toMatchObject({
      status: "raggiunto", knownRemainingEur: 0, knownUsedFraction: 1.2,
    });
  });

  it("consumo parziale o tariffa assente prevalgono anche su uso noto alto o zero", () => {
    for (const accounting of [
      account(0, 1), account(8, 1), account(12, 1),
      account(8, 0, 1), account(0, 0, 2),
    ]) {
      expect(assessAiBudgetHeadroom(accounting, 10)).toEqual({ status: "incerto" });
    }
  });

  it("non espone margini fittizi per limite/costo NaN, infinito o negativo", () => {
    for (const limit of [-1, 0, NaN, Infinity]) {
      expect(assessAiBudgetHeadroom(account(1), limit)).toEqual({ status: "incerto" });
    }
    for (const cost of [-1, NaN, Infinity]) {
      expect(assessAiBudgetHeadroom(account(cost), 10)).toEqual({ status: "incerto" });
    }
  });

  it("lo stato sessione usa solo runId e libro attivo, il periodo globale resta indipendente", () => {
    const book = newBook("Trama", "Un libro", "Sobrio", "Adulti");
    const settings = structuredClone(DEFAULT_SETTINGS);
    const rate = { endpointId: "openai", modelId: "m", inputEurPerMillion: 1, outputEurPerMillion: 0 };
    book.aiBudget = { enabled: true, enabledAt: "2026-11-11T00:00:00.000Z",
      limitEur: 10, maxOutputTokens: 8192, sessionLimitEur: 1 };
    const activity = (id: string, bookId: string, runId: string, amount: number,
      createdAt: string): Activity => ({
      id, bookId, runId, status: "succeeded", phase: "prose",
      title: "Task", reason: "Test", nextStep: "Controllo",
      aiRequested: true, endpointId: "openai", modelId: "m",
      priceRateSnapshot: rate, inputTokens: amount, outputTokens: 0, createdAt,
    });
    const rows = [
      activity("near", book.id, "new", 800000, "2026-11-11T09:00:00.000Z"),
      activity("other-run", book.id, "old", 7200000, "2026-11-11T08:00:00.000Z"),
      activity("other-book", "not-this-book", "new", 9000000, "2026-11-11T08:00:00.000Z"),
      activity("before-enabled", book.id, "new", 9000000, "2026-11-10T08:00:00.000Z"),
    ];
    const inBook = rows.filter(row => row.bookId === book.id);
    const global = accountBookAiBudget(inBook, settings, book.aiBudget);
    const session = accountSessionAiBudget(rows, settings, book.aiBudget, book.id, "new");
    expect(assessAiBudgetHeadroom(global, book.aiBudget.limitEur).status).toBe("vicino");
    expect(assessAiBudgetHeadroom(session, book.aiBudget.sessionLimitEur!).status).toBe("vicino");
    expect(global.estimatedSpentEur).toBe(8);
    expect(session.estimatedSpentEur).toBe(0.8);
    expect(assessAiBudgetHeadroom(
      accountSessionAiBudget(rows, settings, book.aiBudget, book.id, "brand-new"),
      book.aiBudget.sessionLimitEur!,
    ).status).toBe("sotto_soglia");
  });
});
