import type { TraceStore } from "@engine/core/host";
import { discardLiveAiPreviews, type AiLocalTrace } from "@engine/infrastructure/ai-observability";
import { expiredAiTraceIds, type AiTraceMetaEntry, type AiTraceRetention } from "@engine/domain/ai-trace-policy";
import { getDb } from "./db";

/**
 * The conversations of AI tasks, in the IndexedDB `meta` store of this browser. The engine
 * only knows the `TraceStore` port; reading, summarising and deleting them is a browser feature.
 */
const KEY_PREFIX = "ai-trace:";
const META_PREFIX = "ai-trace-meta:";
export function aiTraceKey(activityId: string): string { return KEY_PREFIX + activityId; }
export function aiTraceMetaKey(activityId: string): string { return META_PREFIX + activityId; }
// ':' sorts right before ';': these ranges cover exactly the keys with each prefix.
const traceRange = () => IDBKeyRange.bound(KEY_PREFIX, "ai-trace;");
const metaRange = () => IDBKeyRange.bound(META_PREFIX, "ai-trace-meta;");

export async function loadAiTrace(bookId: string, activityId: string): Promise<AiLocalTrace | null> {
  const db = await getDb();
  const trace = await db.get("meta", aiTraceKey(activityId)) as AiLocalTrace | undefined;
  return trace?.bookId === bookId && trace.activityId === activityId ? trace : null;
}

/** Traces written before 0.15 have no metadata record. The author had asked to keep
 * them, so they become «kept»: nothing the author chose to keep is deleted by surprise. */
export async function adoptLegacyAiTraces(): Promise<number> {
  const db = await getDb();
  const [traceKeys, metaKeys] = await Promise.all([
    db.getAllKeys("meta", traceRange()), db.getAllKeys("meta", metaRange()),
  ]);
  const known = new Set(metaKeys.map(String));
  let adopted = 0;
  for (const key of traceKeys.map(String)) {
    const id = key.slice(KEY_PREFIX.length);
    if (known.has(aiTraceMetaKey(id))) continue;
    const trace = await db.get("meta", key) as AiLocalTrace | undefined;
    if (!trace || typeof trace.bookId !== "string" || typeof trace.createdAt !== "string") continue;
    await db.put("meta", { activityId: id, bookId: trace.bookId, createdAt: trace.createdAt, kept: true } satisfies AiTraceMetaEntry,
      aiTraceMetaKey(id));
    adopted++;
  }
  return adopted;
}

export interface AiTraceInventory { temporary: number; kept: number }
export async function summarizeAiTraces(): Promise<AiTraceInventory> {
  const db = await getDb();
  const metas = await db.getAll("meta", metaRange()) as AiTraceMetaEntry[];
  const kept = metas.filter(entry => entry.kept).length;
  return { temporary: metas.length - kept, kept };
}

/** Explicit «delete everything»: stored conversations AND the text still in memory.
 * A request in flight stops saving; its text keeps arriving on screen from now on. */
export async function clearAiTraces(): Promise<number> {
  discardLiveAiPreviews();
  const db = await getDb();
  const count = await db.count("meta", traceRange());
  const tx = db.transaction("meta", "readwrite");
  await Promise.all([tx.store.delete(traceRange()), tx.store.delete(metaRange()), tx.done]);
  return count;
}

/** The browser's implementation of the engine's trace port. */
export function createTraceStore(): TraceStore {
  return {
    /** Writes the conversation and its small metadata record in ONE transaction. The
     * `isCurrent` fence and the writes are adjacent: no await between them. */
    async save(trace, isCurrent = () => true) {
      const db = await getDb();
      const meta: AiTraceMetaEntry = { activityId: trace.activityId, bookId: trace.bookId, createdAt: trace.createdAt, kept: trace.kept !== false };
      const tx = db.transaction("meta", "readwrite");
      void tx.done.catch(() => undefined);
      if (!isCurrent()) { tx.abort(); return; }
      await Promise.all([
        tx.store.put(trace, aiTraceKey(trace.activityId)),
        tx.store.put(meta, aiTraceMetaKey(trace.activityId)),
        tx.done,
      ]);
    },
    async prune(retention: AiTraceRetention, now, inFlight) {
      const db = await getDb();
      const metas = (await db.getAll("meta", metaRange()) as unknown[]).filter((entry): entry is AiTraceMetaEntry =>
        !!entry && typeof entry === "object" && typeof (entry as AiTraceMetaEntry).activityId === "string");
      const ids = expiredAiTraceIds(metas, retention, now, inFlight);
      if (!ids.length) return 0;
      const tx = db.transaction("meta", "readwrite");
      await Promise.all([
        ...ids.flatMap(id => [tx.store.delete(aiTraceKey(id)), tx.store.delete(aiTraceMetaKey(id))]),
        tx.done,
      ]);
      return ids.length;
    },
    async collectKept(bookId, budgetBytes, maxFiles) {
      const db = await getDb();
      const metas = (await db.getAll("meta", metaRange()) as AiTraceMetaEntry[])
        .filter(entry => entry.kept && entry.bookId === bookId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.activityId.localeCompare(b.activityId));
      const traces: AiLocalTrace[] = [];
      let used = 0;
      for (const entry of metas) {
        if (traces.length >= maxFiles) break;
        const trace = await db.get("meta", aiTraceKey(entry.activityId)) as AiLocalTrace | undefined;
        if (!trace || trace.bookId !== bookId || trace.activityId !== entry.activityId) continue;
        const size = JSON.stringify(trace).length;
        if (used + size > budgetBytes) break;
        used += size; traces.push(trace);
      }
      return { traces, omitted: metas.length - traces.length };
    },
  };
}
