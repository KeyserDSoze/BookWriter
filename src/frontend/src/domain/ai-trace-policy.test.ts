import { describe, expect, it } from "vitest";
import {
  AI_TRACE_DEFAULT_MAX_MINUTES, AI_TRACE_DEFAULT_MAX_TASKS, AI_TRACE_MAX_MINUTES, AI_TRACE_MAX_TASKS,
  AI_TRACE_MIN_MINUTES, aiTracePolicy, describeAiTraceRetention, expiredAiTraceIds, type AiTraceMetaEntry,
} from "./ai-trace-policy";

const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const entry = (id: string, minutes: number, kept = false): AiTraceMetaEntry =>
  ({ activityId: id, bookId: "book", createdAt: minutesAgo(minutes), kept });

describe("politica di conservazione di richieste e risposte", () => {
  it("di default: temporanee, ultimi 20 task, 10 giorni, niente GitHub", () => {
    expect(aiTracePolicy({})).toEqual({
      keepForever: false, sendToGitHub: false,
      maxTasks: AI_TRACE_DEFAULT_MAX_TASKS, maxMinutes: AI_TRACE_DEFAULT_MAX_MINUTES,
    });
    expect(AI_TRACE_DEFAULT_MAX_TASKS).toBe(20);
    expect(AI_TRACE_DEFAULT_MAX_MINUTES).toBe(10 * 24 * 60);
  });
  it("chi aveva già attivato l'ispezione (≤0.13) conserva, ma non passa mai a GitHub da solo", () => {
    expect(aiTracePolicy({ inspectAiRequests: true })).toMatchObject({ keepForever: true, sendToGitHub: false });
  });
  it("la scelta nuova prevale su quella vecchia", () => {
    expect(aiTracePolicy({ inspectAiRequests: true, keepAiConversations: false }).keepForever).toBe(false);
    expect(aiTracePolicy({ inspectAiRequests: false, keepAiConversations: true }).keepForever).toBe(true);
  });
  it("GitHub richiede la conservazione senza scadenza, anche con un valore residuo salvato", () => {
    expect(aiTracePolicy({ syncAiConversationsToGitHub: true }).sendToGitHub).toBe(false);
    expect(aiTracePolicy({ keepAiConversations: false, syncAiConversationsToGitHub: true }).sendToGitHub).toBe(false);
    expect(aiTracePolicy({ keepAiConversations: true, syncAiConversationsToGitHub: true }).sendToGitHub).toBe(true);
  });
  it("limiti fuori scala o corrotti tornano entro i valori ammessi", () => {
    expect(aiTracePolicy({ aiTraceRetention: { maxTasks: 0, maxMinutes: 1 } })).toMatchObject({ maxTasks: 1, maxMinutes: AI_TRACE_MIN_MINUTES });
    expect(aiTracePolicy({ aiTraceRetention: { maxTasks: 99_999, maxMinutes: 9e9 } }))
      .toMatchObject({ maxTasks: AI_TRACE_MAX_TASKS, maxMinutes: AI_TRACE_MAX_MINUTES });
    expect(aiTracePolicy({ aiTraceRetention: { maxTasks: Number.NaN, maxMinutes: Infinity } }))
      .toMatchObject({ maxTasks: 20, maxMinutes: AI_TRACE_DEFAULT_MAX_MINUTES });
    expect(aiTracePolicy({ aiTraceRetention: { maxTasks: "7" as unknown as number, maxMinutes: null as unknown as number } }))
      .toMatchObject({ maxTasks: 20, maxMinutes: AI_TRACE_DEFAULT_MAX_MINUTES });
    expect(aiTracePolicy({ aiTraceRetention: { maxTasks: 12.6, maxMinutes: 30.2 } })).toMatchObject({ maxTasks: 13, maxMinutes: 30 });
  });
  it("mezz'ora è un valore valido", () => {
    expect(aiTracePolicy({ aiTraceRetention: { maxTasks: 20, maxMinutes: 30 } }).maxMinutes).toBe(30);
    expect(describeAiTraceRetention(aiTracePolicy({ aiTraceRetention: { maxTasks: 5, maxMinutes: 30 } })))
      .toBe("ultimi 5 task, non più vecchi di 30 minuti");
    expect(describeAiTraceRetention(aiTracePolicy({}))).toBe("ultimi 20 task, non più vecchi di 10 giorni");
    expect(describeAiTraceRetention(aiTracePolicy({ aiTraceRetention: { maxTasks: 20, maxMinutes: 200 } }))).toContain("3 ore");
  });
});

describe("quali conversazioni temporanee scadono", () => {
  const retention = { maxTasks: 3, maxMinutes: 60 };
  it("oltre il numero di task: restano i più recenti", () => {
    const entries = [entry("a", 5), entry("b", 4), entry("c", 3), entry("d", 2), entry("e", 1)];
    expect(expiredAiTraceIds(entries, retention, NOW).sort()).toEqual(["a", "b"]);
  });
  it("oltre l'età: scadono anche se sono pochi", () => {
    expect(expiredAiTraceIds([entry("nuova", 10), entry("vecchia", 61)], retention, NOW)).toEqual(["vecchia"]);
    expect(expiredAiTraceIds([entry("al-limite", 60)], retention, NOW)).toEqual([]);
  });
  it("vale il limite che scatta per primo", () => {
    // dal più recente: d, c, b | e è il quarto (oltre 3 task) | a ha 120 minuti (oltre l'età)
    const entries = [entry("a", 120), entry("b", 3), entry("c", 2), entry("d", 1), entry("e", 4)];
    expect(expiredAiTraceIds(entries, retention, NOW).sort()).toEqual(["a", "e"]);
  });
  it("le conservate senza scadenza non scadono mai e non contano nel limite dei temporanei", () => {
    const entries = [entry("k1", 100_000, true), entry("k2", 5, true), entry("t1", 3), entry("t2", 2), entry("t3", 1)];
    expect(expiredAiTraceIds(entries, retention, NOW)).toEqual([]);
  });
  it("una richiesta ancora in corso non viene mai cancellata, anche se vecchia", () => {
    const entries = [entry("lunga", 500), entry("n1", 3), entry("n2", 2), entry("n3", 1)];
    expect(expiredAiTraceIds(entries, retention, NOW, new Set(["lunga"]))).toEqual([]);
  });
  it("date illeggibili contano come vecchissime; a parità di data l'ordine è stabile", () => {
    const broken: AiTraceMetaEntry = { activityId: "rotta", bookId: "b", createdAt: "non-una-data", kept: false };
    expect(expiredAiTraceIds([broken, entry("ok", 1)], retention, NOW)).toEqual(["rotta"]);
    const same = [entry("b", 5), entry("a", 5), entry("c", 5), entry("d", 5)];
    expect(expiredAiTraceIds(same, { maxTasks: 2, maxMinutes: 60 }, NOW)).toEqual(["c", "d"]);
  });
  it("non modifica l'elenco ricevuto", () => {
    const entries = [entry("a", 5), entry("b", 4)];
    const copy = structuredClone(entries);
    expiredAiTraceIds(entries, { maxTasks: 1, maxMinutes: 60 }, NOW);
    expect(entries).toEqual(copy);
  });
});
