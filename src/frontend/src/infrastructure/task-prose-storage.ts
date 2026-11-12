import type { BookProject } from "../domain/types";
import {
  estimateNextProsePairBytes, estimateProsePayloadBytes, validProseLimitMiB,
  validTaskProseUsageLedger, type TaskProseUsageLedger,
} from "../domain/task-prose-storage";
import { getDb } from "./db";
import { taskProseKey, taskProseUsageKey } from "./task-prose-checkpoint";

export function taskProseLimitKey(bookId: string): string {
  return "task-prose-limit:v1:" + bookId;
}
export function taskProseRemovalKey(bookId: string, activityId: string): string {
  return "task-prose-removed:v1:" + bookId + ":" + activityId;
}
export interface TaskProseStorageInventory {
  bookId: string;
  estimatedBytes: number;
  records: number;
  nextPairEstimateBytes: number;
  limitMiB: number | null;
  entries: Array<{ activityId: string; estimatedBytes: number }>;
}

/**
 * Read-only per-book accounting for stored JSON payloads, not the browser's
 * physical IndexedDB quota. Deliberately never returns scene text.
 */
export async function loadTaskProseInventory(bookId: string): Promise<TaskProseStorageInventory | null> {
  if (!bookId) return null;
  const db = await getDb();
  const tx = db.transaction(["books", "meta"], "readonly");
  const book = await tx.objectStore("books").get(bookId) as BookProject | undefined;
  if (!book) { await tx.done; return null; }
  const meta = tx.objectStore("meta");
  const rawLimit = await meta.get(taskProseLimitKey(bookId)) as unknown;
  if (rawLimit !== undefined && !validProseLimitMiB(rawLimit))
    throw new Error("Limite locale non valido: verifica la configurazione.");
  const prefix = taskProseKey(bookId, "");
  const entries: TaskProseStorageInventory["entries"] = [];
  let estimatedBytes = 0;
  let cursor = await meta.openCursor(IDBKeyRange.bound(prefix, prefix + "\uffff"));
  while (cursor) {
    const activityId = (cursor.key as string).slice(prefix.length);
    const bytes = estimateProsePayloadBytes(cursor.value);
    estimatedBytes += bytes;
    entries.push({ activityId, estimatedBytes: bytes });
    cursor = await cursor.continue();
  }
  await tx.done;
  return { bookId, records: entries.length, estimatedBytes,
    nextPairEstimateBytes: estimateNextProsePairBytes(book),
    limitMiB: rawLimit === undefined ? null : rawLimit as number,
    entries };
}

/** No automatic pruning. A limit is a fail-closed guard, not a deletion policy. */
export async function setTaskProseLimit(bookId: string, limitMiB: number | null): Promise<void> {
  if (!bookId || (limitMiB !== null && !validProseLimitMiB(limitMiB)))
    throw new Error("Limite non valido: scegli da 1 a 1024 MiB oppure nessun limite.");
  const db = await getDb();
  const tx = db.transaction(["books", "meta"], "readwrite");
  void tx.done.catch(() => {});
  if (!await tx.objectStore("books").get(bookId)) {
    await tx.done;
    throw new Error("Libro non trovato.");
  }
  const meta = tx.objectStore("meta");
  if (limitMiB === null) await meta.delete(taskProseLimitKey(bookId));
  else {
    // One-time index of legacy #167 copies; future capped task commits update
    // this ledger atomically in O(1) rather than rereading every long scene.
    const rawLedger = await meta.get(taskProseUsageKey(bookId)) as unknown;
    if (rawLedger !== undefined && !validTaskProseUsageLedger(rawLedger,bookId)){
      tx.abort();
      throw new Error("Indice dello spazio locale non verificabile.");
    }
    if (rawLedger === undefined) {
      const prefix = taskProseKey(bookId,"");
      let cursor = await meta.openCursor(IDBKeyRange.bound(prefix,prefix+"\uffff"));
      let estimatedBytes = 0, records = 0;
      while(cursor){
        estimatedBytes += estimateProsePayloadBytes(cursor.value);
        records++;
        cursor=await cursor.continue();
      }
      const ledger:TaskProseUsageLedger={
        schemaVersion:1,bookId,estimatedBytes,records,
      };
      await meta.put(ledger,taskProseUsageKey(bookId));
    }
    await meta.put(limitMiB, taskProseLimitKey(bookId));
  }
  await tx.done;
}

function validateSelection(bookId: string, activityIds: readonly string[]): void {
  if (!bookId || !Array.isArray(activityIds) || activityIds.length === 0 ||
      activityIds.length > 20 || new Set(activityIds).size !== activityIds.length ||
      activityIds.some(id => typeof id !== "string" || !id || id.length > 500))
    throw new Error("Seleziona da 1 a 20 task distinti dello stesso libro.");
}

/**
 * Atomic manual deletion: removes ONLY text snapshots, keeps durable
 * metadata tombstones so old tasks never look like recoverable history.
 */
export async function deleteSelectedTaskProse(
  bookId: string, activityIds: readonly string[],
): Promise<number> {
  validateSelection(bookId, activityIds);
  const db = await getDb();
  const tx = db.transaction(["books", "meta"], "readwrite");
  void tx.done.catch(() => {});
  if (!await tx.objectStore("books").get(bookId)) {
    await tx.done;
    throw new Error("Libro non trovato.");
  }
  const meta = tx.objectStore("meta");
  const rawLedger = await meta.get(taskProseUsageKey(bookId)) as unknown;
  if(rawLedger!==undefined&&!validTaskProseUsageLedger(rawLedger,bookId)){
    tx.abort();
    throw new Error("Indice dello spazio locale non verificabile.");
  }
  const ledger:TaskProseUsageLedger|null =
    rawLedger === undefined ? null : rawLedger as TaskProseUsageLedger;
  let removed = 0, removedBytes = 0;
  const timestamp = new Date().toISOString();
  for (const activityId of activityIds) {
    const key = taskProseKey(bookId, activityId);
    const existing = await meta.get(key);
    if (existing === undefined) continue;
    removedBytes += estimateProsePayloadBytes(existing);
    await meta.delete(key);
    await meta.put({
      schemaVersion: 1, bookId, activityId,
      reason: "author_selected", deletedAt: timestamp,
    }, taskProseRemovalKey(bookId, activityId));
    removed++;
  }
  if(ledger&&removed>0){
    if(ledger.records<removed||ledger.estimatedBytes<removedBytes){
      tx.abort();
      throw new Error("Indice dello spazio locale non coerente: nessuna copia eliminata.");
    }
    await meta.put({...ledger,records:ledger.records-removed,
      estimatedBytes:ledger.estimatedBytes-removedBytes},taskProseUsageKey(bookId));
  }
  await tx.done;
  return removed;
}

export async function wasTaskProseManuallyRemoved(
  bookId: string, activityId: string,
): Promise<boolean> {
  if (!bookId || !activityId) return false;
  const db = await getDb();
  const record = await db.get("meta", taskProseRemovalKey(bookId, activityId)) as
    { bookId?: string; activityId?: string; reason?: string } | undefined;
  return record?.bookId === bookId && record.activityId === activityId &&
    record.reason === "author_selected";
}
