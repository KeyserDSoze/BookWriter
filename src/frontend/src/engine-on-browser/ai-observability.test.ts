import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addAiDelta, aiInspectionGeneration, currentLiveAi, currentTaskAi, discardLiveAiPreviews, finishLiveAi, markAiHeader, pruneAiTraces, receiveAiResponse, saveAiTrace, startLiveAi, subscribeLiveAi, type AiLocalTrace } from "@engine/infrastructure/ai-observability";
import { host } from "@engine/core/host";
import { getDb } from "../infrastructure/db";
import { adoptLegacyAiTraces, aiTraceKey, aiTraceMetaKey, clearAiTraces, loadAiTrace, summarizeAiTraces } from "../infrastructure/ai-trace-store";

const collectKeptAiTraces = (bookId: string, budget: number, maxFiles: number) => host().traces!.collectKept(bookId, budget, maxFiles);
const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
function trace(id: string, minutes: number, extra: Partial<AiLocalTrace> = {}): AiLocalTrace {
  return { activityId: id, bookId: "book-1", createdAt: minutesAgo(minutes), endpointId: "openai", modelId: "m",
    systemPrompt: "S-" + id, userPrompt: "U-" + id, response: "R-" + id, truncated: false, kept: false, ...extra };
}
async function keys(prefix: string): Promise<string[]> {
  return ((await (await getDb()).getAllKeys("meta")) as string[]).filter(key => typeof key === "string" && key.startsWith(prefix));
}
beforeEach(async () => { await (await getDb()).clear("meta"); });

describe("conversazioni salvate: scrittura, limiti e privacy", () => {
  it("conserva richiesta e risposta separatamente da Activity e limita le dimensioni", async () => {
    await saveAiTrace({ ...trace("activity-1", 1), systemPrompt: "S".repeat(120001), response: "R".repeat(120001),
      reasoning: "T".repeat(20001), userPrompt: "U" });
    expect(aiTraceKey("activity-1")).toBe("ai-trace:activity-1");
    expect(aiTraceMetaKey("activity-1")).toBe("ai-trace-meta:activity-1");
    const saved = await loadAiTrace("book-1", "activity-1");
    expect(saved).toMatchObject({ truncated: true });
    expect(saved?.systemPrompt).toHaveLength(120000);
    expect(saved?.response).toHaveLength(120000);
    expect(saved?.reasoning).toHaveLength(20000);
    expect(await loadAiTrace("book-2", "activity-1")).toBeNull();
  });
  it("scrive testo e metadati nella stessa transazione, con il flag temporanea/conservata", async () => {
    await saveAiTrace(trace("t", 1, { kept: false }));
    await saveAiTrace(trace("k", 1, { kept: true }));
    expect((await (await getDb()).get("meta", aiTraceMetaKey("t")))).toEqual(
      { activityId: "t", bookId: "book-1", createdAt: minutesAgo(1), kept: false });
    expect(await summarizeAiTraces()).toEqual({ temporary: 1, kept: 1 });
  });
  it("senza indicazione è «conservata»: nulla di ciò che l'autore voleva tenere sparisce per sbaglio", async () => {
    const { kept: _drop, ...legacy } = trace("old", 1);
    await saveAiTrace(legacy);
    expect((await loadAiTrace("book-1", "old"))?.kept).toBe(true);
  });
  it("ricontrolla l'attualità subito prima di scrivere: se superata non scrive né testo né metadati", async () => {
    await saveAiTrace(trace("stale", 1), () => false);
    expect(await loadAiTrace("book-1", "stale")).toBeNull();
    expect(await keys("ai-trace")).toEqual([]);
  });
});

describe("tracce delle versioni precedenti", () => {
  it("una traccia senza metadati diventa «conservata»: non viene cancellata dalla potatura", async () => {
    const db = await getDb();
    await db.put("meta", { ...trace("legacy", 99_999), kept: undefined }, aiTraceKey("legacy"));
    expect(await adoptLegacyAiTraces()).toBe(1);
    expect(await adoptLegacyAiTraces()).toBe(0); // idempotent
    expect(await summarizeAiTraces()).toEqual({ temporary: 0, kept: 1 });
    expect(await pruneAiTraces({ maxTasks: 1, maxMinutes: 5 }, NOW)).toBe(0);
    expect(await loadAiTrace("book-1", "legacy")).not.toBeNull();
  });
  it("ignora valori che non sono conversazioni", async () => {
    await (await getDb()).put("meta", "non un oggetto", "ai-trace:strana");
    expect(await adoptLegacyAiTraces()).toBe(0);
  });
});

describe("potatura delle conversazioni temporanee", () => {
  it("tiene gli ultimi N e cancella testo e metadati dei più vecchi", async () => {
    for (const [id, minutes] of [["a", 50], ["b", 40], ["c", 30], ["d", 20], ["e", 10]] as const) await saveAiTrace(trace(id, minutes));
    expect(await pruneAiTraces({ maxTasks: 3, maxMinutes: 1000 }, NOW)).toBe(2);
    expect(await loadAiTrace("book-1", "a")).toBeNull();
    expect(await loadAiTrace("book-1", "b")).toBeNull();
    expect(await loadAiTrace("book-1", "c")).not.toBeNull();
    expect(await keys("ai-trace-meta:")).toHaveLength(3);
    expect(await keys("ai-trace:")).toHaveLength(3);
  });
  it("cancella quelle oltre il tempo scelto, anche mezz'ora", async () => {
    await saveAiTrace(trace("fresca", 29));
    await saveAiTrace(trace("scaduta", 31));
    expect(await pruneAiTraces({ maxTasks: 20, maxMinutes: 30 }, NOW)).toBe(1);
    expect(await loadAiTrace("book-1", "scaduta")).toBeNull();
    expect(await loadAiTrace("book-1", "fresca")).not.toBeNull();
  });
  it("non tocca mai le conservate senza scadenza né le altre chiavi di IndexedDB", async () => {
    const db = await getDb();
    await db.put("meta", { importante: true }, "task-prose:v1:book-1:x");
    await saveAiTrace(trace("per-sempre", 999_999, { kept: true }));
    await saveAiTrace(trace("temporanea", 999_999));
    expect(await pruneAiTraces({ maxTasks: 1, maxMinutes: 5 }, NOW)).toBe(1);
    expect(await loadAiTrace("book-1", "per-sempre")).not.toBeNull();
    expect(await db.get("meta", "task-prose:v1:book-1:x")).toEqual({ importante: true });
  });
  it("non cancella la conversazione di una richiesta ancora in corso", async () => {
    startLiveAi({ activityId: "in-corso", bookId: "book-1", title: "Lunga", endpointId: "x", modelId: "y" });
    await saveAiTrace(trace("in-corso", 9_999));
    await saveAiTrace(trace("finita", 9_999));
    expect(await pruneAiTraces({ maxTasks: 20, maxMinutes: 30 }, NOW)).toBe(1);
    expect(await loadAiTrace("book-1", "in-corso")).not.toBeNull();
    finishLiveAi("in-corso", "completata");
    expect(await pruneAiTraces({ maxTasks: 20, maxMinutes: 30 }, NOW)).toBe(1);
    expect(await loadAiTrace("book-1", "in-corso")).toBeNull();
  });
  it("senza nulla da cancellare non scrive", async () => {
    await saveAiTrace(trace("ok", 1));
    expect(await pruneAiTraces({ maxTasks: 20, maxMinutes: 60 }, NOW)).toBe(0);
  });
});

describe("«cancella tutto» e raccolta delle conservate", () => {
  it("elimina tutte le conversazioni (temporanee e conservate) senza toccare altre chiavi", async () => {
    const db = await getDb();
    await db.put("meta", "chiave", "device-encryption-key");
    await saveAiTrace(trace("t", 1));
    await saveAiTrace(trace("k", 1, { kept: true }));
    expect(await clearAiTraces()).toBe(2);
    expect(await keys("ai-trace")).toEqual([]);
    expect(await db.get("meta", "device-encryption-key")).toBe("chiave");
  });
  it("raccoglie per GitHub le sole conservate del libro, dalla più recente, entro il budget", async () => {
    await saveAiTrace(trace("vecchia", 300, { kept: true }));
    await saveAiTrace(trace("media", 200, { kept: true }));
    await saveAiTrace(trace("nuova", 100, { kept: true }));
    await saveAiTrace(trace("temporanea", 50));
    await saveAiTrace(trace("altro-libro", 10, { kept: true, bookId: "book-2" }));
    const all = await collectKeptAiTraces("book-1", 10_000_000, 100);
    expect(all.traces.map(item => item.activityId)).toEqual(["nuova", "media", "vecchia"]);
    expect(all.omitted).toBe(0);
    const size = JSON.stringify(all.traces[0]).length;
    const limited = await collectKeptAiTraces("book-1", size * 2 + 5, 100);
    expect(limited.traces.map(item => item.activityId)).toEqual(["nuova", "media"]);
    expect(limited.omitted).toBe(1);
    const capped = await collectKeptAiTraces("book-1", 10_000_000, 1);
    expect(capped.traces).toHaveLength(1);
    expect(capped.omitted).toBe(2);
  });
});

describe("testo in arrivo: sempre visibile, senza consenso", () => {
  it("accumula risposta e reasoning del task corrente senza alcuna opzione", () => {
    const listener = vi.fn(), unsub = subscribeLiveAi(listener);
    startLiveAi({ activityId: "a", bookId: "b", title: "Brainstorming", endpointId: "openai", modelId: "model" });
    markAiHeader("a");
    addAiDelta("a", { kind: "reasoning", text: "ragionamento del provider" });
    addAiDelta("a", { kind: "text", text: "testo in arrivo" });
    expect(currentLiveAi()).toMatchObject({ stage: "streaming", textPreview: "testo in arrivo",
      reasoningPreview: "ragionamento del provider", textCharacters: 15, reasoningCharacters: 25 });
    finishLiveAi("a", "rifiutata");
    expect(currentLiveAi()).toMatchObject({ stage: "rifiutata", textPreview: "testo in arrivo" });
    expect(listener).toHaveBeenCalled();
    unsub();
  });
  it("espone solo i delta del task corrente, senza promuoverli a canon", () => {
    startLiveAi({ activityId: "new", bookId: "book", title: "Nuova", endpointId: "x", modelId: "y" });
    addAiDelta("old", { kind: "text", text: "vecchio" });
    addAiDelta("new", { kind: "text", text: "stream" });
    expect(currentLiveAi()).toMatchObject({ stage: "streaming", textPreview: "stream" });
    finishLiveAi("old", "completata");
    expect(currentLiveAi()?.stage).toBe("streaming");
    finishLiveAi("new", "completata");
    expect(currentLiveAi()?.stage).toBe("completata");
  });
  it("isola richieste parallele e non azzera lo stream quando passa al revisore successivo", () => {
    const base = { bookId: "parallel-book", title: "Revisione", endpointId: "x", modelId: "y" };
    startLiveAi({ ...base, activityId: "parallel-first" });
    startLiveAi({ ...base, activityId: "parallel-second" }, false);
    addAiDelta("parallel-first", { kind: "text", text: "Prima risposta" });
    addAiDelta("parallel-second", { kind: "reasoning", text: "Secondo reasoning" });
    addAiDelta("parallel-second", { kind: "text", text: "Seconda risposta" });
    const previous = currentTaskAi(base.bookId, "parallel-second");
    expect(currentTaskAi("other-book", "parallel-second")).toBeNull();
    expect(currentLiveAi()?.activityId).toBe("parallel-first");
    startLiveAi({ ...base, activityId: "parallel-second" });
    expect(currentLiveAi()).toBe(previous);
    expect(currentTaskAi(base.bookId, "parallel-first")?.textPreview).toBe("Prima risposta");
    finishLiveAi("parallel-first", "completata");
    expect(currentLiveAi()?.activityId).toBe("parallel-second");
  });
  it("mantiene la coda più recente anche oltre i limiti delle trascrizioni", () => {
    startLiveAi({ activityId: "long", bookId: "b", title: "Lunga", endpointId: "x", modelId: "y" });
    addAiDelta("long", { kind: "text", text: "A".repeat(120001) });
    addAiDelta("long", { kind: "text", text: "ULTIMA_RIGA" });
    addAiDelta("long", { kind: "reasoning", text: "R".repeat(20001) + "ULTIMO_REASONING" });
    expect(currentLiveAi()?.textPreview).toHaveLength(120000);
    expect(currentLiveAi()?.textTail).toHaveLength(4000);
    expect(currentLiveAi()?.textTail).toMatch(/ULTIMA_RIGA$/);
    expect(currentLiveAi()?.reasoningTail).toMatch(/ULTIMO_REASONING$/);
  });
  it("«cancella» svuota la RAM e blocca i salvataggi già avviati, ma il testo nuovo ricompare", async () => {
    startLiveAi({ activityId: "revoke", bookId: "b", title: "Cancellazione", endpointId: "x", modelId: "y" });
    addAiDelta("revoke", { kind: "text", text: "privato" });
    const before = aiInspectionGeneration();
    await clearAiTraces();
    expect(aiInspectionGeneration()).toBe(before + 1);
    expect(currentTaskAi("b", "revoke")).toMatchObject({ textPreview: "", textTail: "", textCharacters: 7 });
    expect(currentTaskAi("b", "revoke")?.previewClearedAt).toBeTypeOf("number");
    addAiDelta("revoke", { kind: "text", text: " e poi" });
    expect(currentTaskAi("b", "revoke")?.textPreview).toBe(" e poi");
    discardLiveAiPreviews();
    expect(currentLiveAi()?.textPreview).toBe("");
  });
  it("limita a otto gli ultimi task terminati in memoria", () => {
    for (let index = 0; index < 12; index++) {
      startLiveAi({ activityId: "cache-" + index, bookId: "cache", title: "Cache", endpointId: "x", modelId: "y" });
      finishLiveAi("cache-" + index, "completata");
    }
    startLiveAi({ activityId: "cache-active", bookId: "cache", title: "Attivo", endpointId: "x", modelId: "y" });
    expect(currentTaskAi("cache", "cache-0")).toBeNull();
    expect(currentTaskAi("cache", "cache-11")?.stage).toBe("completata");
  });
  it("il completamento non altera i caratteri realmente osservati nello streaming", () => {
    startLiveAi({ activityId: "raw", bookId: "b", title: "Raw", endpointId: "x", modelId: "y" });
    addAiDelta("raw", { kind: "text", text: "  risposta  " });
    receiveAiResponse("raw", "risposta");
    expect(currentLiveAi()).toMatchObject({ textCharacters: 12, textPreview: "  risposta  " });
  });
  it("una risposta non in streaming (JSON) è mostrata per intero", () => {
    startLiveAi({ activityId: "json", bookId: "b", title: "JSON", endpointId: "x", modelId: "y" });
    receiveAiResponse("json", "risposta completa");
    expect(currentLiveAi()).toMatchObject({ textCharacters: 17, textPreview: "risposta completa", textTail: "risposta completa" });
  });
});
