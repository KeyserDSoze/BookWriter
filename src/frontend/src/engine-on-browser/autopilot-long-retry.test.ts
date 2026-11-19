import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type AppSettings } from "@engine/domain/types";
const { call, guard } = vi.hoisted(() => ({ call: vi.fn(), guard: vi.fn() }));
vi.mock("@engine/infrastructure/ai", () => ({ callModel: call }));
vi.mock("@engine/application/writer-guard", () => ({ withWriterGuard: guard }));
import { AutopilotRunner } from "@engine/application/autopilot";
import { AUTO_RETRY_BACKOFF } from "@engine/application/auto-retry";
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
import { assertRetryClaim, claimRetrySchedule, clearRetrySchedule, getRetrySchedule, retryScheduleKey } from "@engine/infrastructure/retry-schedule";
import { retryIsDue, retryScheduleSchema, restrictRetryPolicy, readLongTermRetry } from "@engine/core/retry-policy";

let settings: AppSettings;
beforeEach(async () => {
  call.mockReset(); guard.mockReset();
  guard.mockImplementation(async (_id, _run, _abort, action) =>
    action({ assertActive: async () => {}, failure: () => undefined }));
  const db = await getDb();
  for (const name of ["books", "activities", "outbox", "meta", "settings"]) await db.clear(name);
  settings = structuredClone(DEFAULT_SETTINGS);
  settings.defaultRoute = { endpointId: "openai", modelId: "m" };
  settings.endpoints[0] = { ...settings.endpoints[0]!, authMode: "api_key", autoRetry: true, autoRetryMax: 2,
    longTermRetry: { enabled: true, intervalMinutes: 15, maxCycles: 3 } };
  await saveSettings(settings); AUTO_RETRY_BACKOFF.baseMs = 0;
});
afterEach(() => { vi.restoreAllMocks(); AUTO_RETRY_BACKOFF.baseMs = 5000; });
async function bookAndFailure() {
  const book = newBook("Una storia interamente sintetica.", "Retry", "Chiaro", "Adulti");
  await saveBook(book, false);
  call.mockRejectedValue(new Error("Rete temporaneamente assente."));
  const runner = new AutopilotRunner();
  await runner.run(book.id, async () => undefined);
  return { book, runner, plan: (await getRetrySchedule(book.id))! };
}

describe("Attesa long-term durevole", () => {
  it("S=2: tre richieste, attesa di 15 minuti e nessuna richiesta prima della scadenza", async () => {
    const { book, runner, plan } = await bookAndFailure();
    expect(call).toHaveBeenCalledTimes(3);
    expect((await getBook(book.id))?.status).toBe("paused");
    expect(plan).toMatchObject({ state: "waiting", cyclesUsed: 0 });
    expect(Date.parse(plan.nextRetryAt) - Date.parse(plan.scheduledAt)).toBe(900_000);
    expect(retryIsDue(plan, Date.parse(plan.nextRetryAt) - 1)).toBe(false);
    await expect(runner.run(book.id, async () => undefined, { generation: plan.generation })).rejects.toThrow("non ancora dovuta");
    expect(call).toHaveBeenCalledTimes(3);
    expect((await getRetrySchedule(book.id))?.generation).toBe(plan.generation);
  });
  it("tre gruppi differiti, non quattro, tutti con il runId originario", async () => {
    const { book, runner, plan } = await bookAndFailure();
    let current = plan;
    for (let i = 1; i <= 3; i++) {
      await runner.run(book.id, async () => undefined, { generation: current.generation, force: true });
      expect(call).toHaveBeenCalledTimes(3 * (i + 1));
      const next = await getRetrySchedule(book.id);
      if (i < 3) { expect(next?.cyclesUsed).toBe(i); current = next!; }
      else expect(next).toBeUndefined();
    }
    const attempts = (await listActivities(book.id)).filter(a => a.aiRequested);
    expect(new Set(attempts.map(a => a.runId))).toEqual(new Set([plan.runId]));
    expect(attempts.every(a => a.status === "failed")).toBe(true);
  });
  it("successo: piano rimosso atomicamente, stesso budget/sessione e lavoro successivo", async () => {
    const { book, runner, plan } = await bookAndFailure();
    call.mockImplementationOnce(async () => {
      runner.stopAfterCurrent();
      return { text: "Idee sintetiche LONG MID SHORT.", endpointId: "openai", modelId: "m", inputTokens: 2, outputTokens: 3 };
    });
    await runner.run(book.id, async () => {
      const activities = await listActivities(book.id);
      if (activities.some(a => a.status === "succeeded")) expect(await getRetrySchedule(book.id)).toBeUndefined();
    }, { generation: plan.generation, force: true });
    expect((await getBook(book.id))?.phase).toBe("validate");
    expect((await listActivities(book.id)).find(a => a.status === "succeeded")?.runId).toBe(plan.runId);
  });
  it("short-term spento: pianifica dopo la prima richiesta; legacy non concede long-term", async () => {
    settings.endpoints[0]!.autoRetry = false; await saveSettings(settings);
    const first = await bookAndFailure();
    expect(call).toHaveBeenCalledTimes(1); expect(first.plan).toBeDefined();
    delete settings.endpoints[0]!.longTermRetry; await saveSettings(settings);
    call.mockClear();
    const second = await bookAndFailure();
    expect(call).toHaveBeenCalledTimes(1); expect(await getRetrySchedule(second.book.id)).toBeUndefined();
  });
  it("due claim concorrenti: uno solo; un claim abbandonato non si ripete dopo crash", async () => {
    const { book, plan } = await bookAndFailure();
    const claims = await Promise.allSettled([
      claimRetrySchedule(book.id, plan.generation, true), claimRetrySchedule(book.id, plan.generation, true),
    ]);
    expect(claims.filter(c => c.status === "fulfilled")).toHaveLength(1);
    await expect(claimRetrySchedule(book.id, plan.generation, true)).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(3);
  });
  it("modifica narrativa o revoca della politica invalidano il risveglio", async () => {
    const { book, runner, plan } = await bookAndFailure();
    const latest = (await getBook(book.id))!;
    latest.brief += " Modifica dell'autore.";
    await saveBook(latest, false, latest.updatedAt);
    await expect(runner.run(book.id, async () => undefined, { generation: plan.generation, force: true })).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(3);
    await clearRetrySchedule(book.id);
    const again = await bookAndFailure();
    settings.endpoints[0]!.longTermRetry!.enabled = false; await saveSettings(settings);
    await expect(again.runner.run(again.book.id, async () => undefined, { generation: again.plan.generation, force: true })).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(6);
  });
  it("un ACK GitHub operativo non invalida l'attesa; nessun recupero a raffica dopo sleep", async () => {
    const { book, runner, plan } = await bookAndFailure();
    const db = await getDb();
    const latest = (await getBook(book.id))!;
    latest.remote = { owner: "synthetic", repository: "book", branch: "main", autoSync: false, lastSyncedCommit: "a".repeat(40) };
    await db.put("books", latest, book.id);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(plan.nextRetryAt) + 7 * 86_400_000);
    await runner.run(book.id, async () => undefined, { generation: plan.generation });
    expect(call).toHaveBeenCalledTimes(6);
    const next = (await getRetrySchedule(book.id))!;
    expect(Date.parse(next.nextRetryAt)).toBe(Date.now() + 900_000);
  });
  it.each(["HTTP 401", "HTTP 403", "HTTP 422", "Spazio disco", "Quota checkpoint", "IndexedDB bloccato"])(
    "%s non diventa retry short-term o long-term", async message => {
      const book = newBook("Sintetico", "Errori", "Chiaro", "Adulti"); await saveBook(book, false);
      call.mockRejectedValue(new Error(message));
      await new AutopilotRunner().run(book.id, async () => undefined);
      expect(call).toHaveBeenCalledTimes(1);
      expect(await getRetrySchedule(book.id)).toBeUndefined();
    });
  it("budget con usage ignoto: una ripartenza non azzera la protezione", async () => {
    const { book, runner, plan } = await bookAndFailure();
    const latest = (await getBook(book.id))!;
    latest.aiBudget = { enabled: true, enabledAt: "2000-01-01T00:00:00.000Z",
      limitEur: 100, sessionLimitEur: 1, maxOutputTokens: 256 };
    settings.aiPriceRates = [{ endpointId: "openai", modelId: "m", inputEurPerMillion: 1, outputEurPerMillion: 1 }];
    await saveBook(latest, false, latest.updatedAt); await saveSettings(settings);
    await runner.run(book.id, async () => undefined, { generation: plan.generation, force: true });
    expect(call).toHaveBeenCalledTimes(3);
    expect((await getBook(book.id))?.status).toBe("paused");
    expect(await getRetrySchedule(book.id)).toBeUndefined();
  });
  it("annullamento tra claim e fetch impedisce una richiesta tardiva", async () => {
    const { book, runner, plan } = await bookAndFailure();
    let revoked = false;
    await runner.run(book.id, async () => {
      const stored = await getRetrySchedule(book.id);
      if (!revoked && stored?.state === "claimed") { revoked = true; await clearRetrySchedule(book.id, stored.generation); }
    }, { generation: plan.generation, force: true }).catch(() => undefined);
    expect(call).toHaveBeenCalledTimes(3);
  });
  it("un edit durante il claim revoca atomicamente la generazione prima della rete", async () => {
    const { book, plan } = await bookAndFailure();
    const claimed = await claimRetrySchedule(book.id, plan.generation, true);
    const current = (await getBook(book.id))!;
    current.brief += " Nuove indicazioni narrative dell'autore.";
    await saveBook(current, false, current.updatedAt);
    expect(await getRetrySchedule(book.id)).toBeUndefined();
    await expect(assertRetryClaim(claimed)).rejects.toMatchObject({ name: "AbortError" });
    expect(call).toHaveBeenCalledTimes(3);
  });
  it("annullare l'attesa rimuove anche il messaggio operativo, non l'audit del fallimento", async () => {
    const { book, plan } = await bookAndFailure();
    await clearRetrySchedule(book.id, plan.generation);
    expect((await getBook(book.id))?.previousError).toBeUndefined();
    expect((await listActivities(book.id)).filter(a => a.aiRequested)).toHaveLength(3);
  });
  it("clock precedente, date o intervalli alterati non autorizzano un risveglio", async () => {
    const { book, plan } = await bookAndFailure();
    expect(retryIsDue(plan, Date.parse(plan.scheduledAt) - 1, true)).toBe(false);
    const malformed = { ...plan, nextRetryAt: plan.scheduledAt };
    expect(retryScheduleSchema.safeParse(malformed).success).toBe(false);
    await (await getDb()).put("meta", malformed, retryScheduleKey(book.id));
    await expect(claimRetrySchedule(book.id, plan.generation, true)).rejects.toThrow("non verificabile");
    expect(readLongTermRetry(undefined).enabled).toBe(false);
    expect(restrictRetryPolicy({ enabled: true, intervalMinutes: 20, maxCycles: 2 },
      { enabled: true, intervalMinutes: 1, maxCycles: null })).toEqual({ enabled: true, intervalMinutes: 20, maxCycles: 2 });
  });
});
