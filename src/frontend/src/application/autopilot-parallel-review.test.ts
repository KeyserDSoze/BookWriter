import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type BookProject } from "../domain/types";
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("../infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("./writer-guard", () => ({ withWriterGuard: writerGuard }));
import { EDITORIAL_ROLES, reviewConcurrency } from "../domain/editorial-board";
import { AutopilotRunner } from "./autopilot";

function book(concurrency?: number): BookProject {
  const b = newBook("Mara protegge la chiave di un castello.", "Romanzo", "Sobrio", "Adulti");
  b.phase = "prose"; b.status = "paused";
  if (concurrency) b.editorialConcurrency = concurrency;
  b.chapters = [{ id: "ch-1", number: 1, title: "Il castello", purpose: "Presentazione",
    scenes: [{ id: "scene-1", number: 1, title: "Ingresso", objective: "Aprire la trama",
      text: "Mara saluta il guardiano e passa la porta.", status: "canon", summary: "Mara entra." }] }];
  return b;
}
const pass = () => JSON.stringify({
  verdict: "pass", summary: "Verifica completata senza rilievi.", memoryNote: "Nota privata", findings: [],
});
const judgment = JSON.stringify({
  reasoning: "Il direttore ha valutato le dodici letture e la fondatezza di ciascun rilievo della redazione.",
  decisions: [],
});
const synopsis = JSON.stringify({
  chapterSummary: "Mara entra al castello dopo una breve conversazione con il guardiano.",
  bookSummary: "All'inizio del romanzo Mara entra al castello custodendo la propria chiave.",
});
const isReviewer = (kind: string) => kind === "chapterAudit" || kind === "chapterReaders";

beforeEach(async () => {
  const db = await getDb();
  await db.clear("books"); await db.clear("activities"); await db.clear("outbox");
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  modelCall.mockReset(); writerGuard.mockReset();
  writerGuard.mockImplementation(async (_bookId, _runId, _ctrl, callback) =>
    callback({ assertActive: async () => {}, failure: () => undefined }));
});
afterEach(() => vi.unstubAllGlobals());

describe("Revisori in parallelo (opt-in)", () => {
  it("usa un solo revisore alla volta senza opzione e ignora il parallelismo con il budget attivo", () => {
    expect(reviewConcurrency(book())).toBe(1);
    expect(reviewConcurrency(book(3))).toBe(3);
    expect(reviewConcurrency(book(99))).toBe(4);
    const budgeted = book(3);
    budgeted.aiBudget = { enabled: true, limitEur: 5, enabledAt: new Date().toISOString() } as never;
    expect(reviewConcurrency(budgeted)).toBe(1);
  });

  async function runBook(concurrency?: number) {
    const source = book(concurrency); await saveBook(source, false);
    let inFlight = 0, maxInFlight = 0;
    const prompts: Array<{ kind: string; prompt: string }> = [];
    modelCall.mockImplementation(async (kind: string, _system: string, prompt: string) => {
      prompts.push({ kind, prompt });
      if (isReviewer(kind)) {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 15));
        inFlight--;
      }
      const text = kind === "chapterJudge" ? judgment : kind === "summarize" ? synopsis : pass();
      return { text, endpointId: "test", modelId: "Astra", inputTokens: 120, outputTokens: 30 };
    });
    await new AutopilotRunner().run(source.id, async () => undefined);
    return { source, saved: (await getBook(source.id))!, maxInFlight, prompts };
  }

  it("di default resta in sequenza", async () => {
    const { saved, maxInFlight } = await runBook();
    expect(saved.chapters[0]?.frozenAt).toBeDefined();
    expect(maxInFlight).toBe(1);
  });

  it("con 3 richieste insieme applica i 12 rapporti in ordine e congela il capitolo", async () => {
    const { source, saved, maxInFlight, prompts } = await runBook(3);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(saved.status).toBe("completed");
    const reports = saved.chapters[0]!.editorialRounds![0]!.reports;
    expect(reports.map(r => r.role)).toEqual([...EDITORIAL_ROLES]);
    expect(prompts.filter(p => isReviewer(p.kind))).toHaveLength(12);
    const history = (await listActivities(source.id)).filter(a => a.phase === "chapterReview");
    expect(history).toHaveLength(14);
    expect(history.every(a => a.status === "succeeded" && a.aiRequested === true &&
      a.inputTokens === 120)).toBe(true);
  });

  it("un revisore che fallisce ferma la sessione e registra le richieste anticipate come non applicate", async () => {
    const source = book(3); await saveBook(source, false);
    const noRetry = structuredClone(DEFAULT_SETTINGS);
    for (const endpoint of noRetry.endpoints) endpoint.localAutoRetry = false;
    await saveSettings(noRetry);
    let reviewerCalls = 0;
    modelCall.mockImplementation(async (kind: string) => {
      if (isReviewer(kind)) {
        const call = ++reviewerCalls;
        await new Promise(resolve => setTimeout(resolve, 10));
        if (call === 2) throw new Error("boom");
      }
      return { text: pass(), endpointId: "test", modelId: "Astra", inputTokens: 10, outputTokens: 5 };
    });
    await new AutopilotRunner().run(source.id, async () => undefined);
    const saved = (await getBook(source.id))!;
    expect(saved.status).toBe("error");
    expect(saved.editorialCycle?.reports).toHaveLength(1);
    const history = await listActivities(source.id);
    expect(history.some(a => a.status === "running")).toBe(false);
    expect(history.filter(a => a.status === "failed")).toHaveLength(1);
    const dropped = history.filter(a => a.status === "cancelled");
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.every(a => a.aiRequested === true &&
      /parallelo non applicata/.test(a.error ?? ""))).toBe(true);
  });

  it("in parallelo il prompt non contiene note private dello stesso ciclo", async () => {
    const parallel = await runBook(2);
    expect(parallel.prompts.filter(p => isReviewer(p.kind) && p.prompt.includes("Nota privata"))).toHaveLength(0);
  });
});

