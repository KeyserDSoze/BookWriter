import type { BookProject } from "../domain/types";
import {
  estimatedTaskBookBytes, summarizeTaskBookCheckpoint,
  TASK_BOOK_TOTAL_LIMIT_BYTES, validTaskBookUsage, type TaskBookCheckpointSummary,
  type TaskBookUsage,
} from "../domain/task-book-checkpoint";
import { getDb } from "./db";

export function taskBookConsentKey(bookId: string): string {
  return "task-book-consent:v1:" + bookId;
}
export function taskBookKey(bookId: string, activityId: string): string {
  return "task-book:v1:" + bookId + ":" + activityId;
}
export function taskBookUsageKey(bookId: string): string {
  return "task-book-usage:v1:" + bookId;
}

export async function loadTaskBookConsent(bookId: string): Promise<boolean> {
  if (!bookId) return false;
  const db=await getDb();
  return (await db.get("meta",taskBookConsentKey(bookId)))===true;
}

/** Per-book revocation erases all sensitive book snapshots atomically, while
 * preserving canon, Activity, structural checkpoints and prose opt-in copies.
 * Consent on starts a ledger from existing records, if any. */
export async function setTaskBookConsent(bookId: string, enabled: boolean): Promise<void> {
  if (!bookId) throw new Error("Seleziona un libro per le copie narrative.");
  const db=await getDb();
  const tx=db.transaction(["books","meta"],"readwrite");
  void tx.done.catch(()=>{});
  if (!await tx.objectStore("books").get(bookId)) {
    await tx.done;
    throw new Error("Libro non trovato.");
  }
  const meta=tx.objectStore("meta");
  const prefix=taskBookKey(bookId,"");
  if(enabled){
    const old=await meta.get(taskBookUsageKey(bookId)) as unknown;
    if(old!==undefined && !validTaskBookUsage(old,bookId)){
      tx.abort();
      throw new Error("Contatore archivio narrativo corrotto: nessuna modifica.");
    }
    if(old===undefined){
      // Legacy recovery after a partially upgraded client. No silent reset:
      // existing records must be counted or activation is refused.
      let bytes=0,records=0;
      let cursor=await meta.openCursor(IDBKeyRange.bound(prefix,prefix+"\uffff"));
      while(cursor){
        const value=cursor.value;
        if(!summarizeTaskBookCheckpoint(value,bookId,
          (cursor.key as string).slice(prefix.length))){
          tx.abort();
          throw new Error("Copia locale non valida: consenso non attivato.");
        }
        bytes+=estimatedTaskBookBytes(value);
        records++;
        if(bytes>TASK_BOOK_TOTAL_LIMIT_BYTES){
          tx.abort();
          throw new Error("Archivio già sopra il limite cumulativo di 128 MiB.");
        }
        cursor=await cursor.continue();
      }
      await meta.put({schemaVersion:1,bookId,estimatedBytes:bytes,records},
        taskBookUsageKey(bookId));
    }
    await meta.put(true,taskBookConsentKey(bookId));
  }else{
    await meta.put(false,taskBookConsentKey(bookId));
    let cursor=await meta.openCursor(IDBKeyRange.bound(prefix,prefix+"\uffff"));
    while(cursor){
      await cursor.delete();
      cursor=await cursor.continue();
    }
    await meta.delete(taskBookUsageKey(bookId));
  }
  await tx.done;
}

export interface TaskBookInventory {
  bookId: string;
  records: number;
  estimatedBytes: number;
  totalLimitBytes: number;
}

/** Metadata-only read; never expose any BookProject text to a UI caller. */
export async function loadTaskBookInventory(bookId:string):Promise<TaskBookInventory|null>{
  if(!bookId)return null;
  const db=await getDb();
  const tx=db.transaction(["books","meta"],"readonly");
  const book=await tx.objectStore("books").get(bookId) as BookProject|undefined;
  if(!book){await tx.done;return null;}
  const meta=tx.objectStore("meta");
  const consent=await meta.get(taskBookConsentKey(bookId));
  const usage=await meta.get(taskBookUsageKey(bookId)) as unknown;
  await tx.done;
  if(consent!==true)return {
    bookId,records:0,estimatedBytes:0,totalLimitBytes:TASK_BOOK_TOTAL_LIMIT_BYTES,
  };
  if(!validTaskBookUsage(usage,bookId))
    throw new Error("Contatore locale non valido: aggiorna il consenso.");
  return {
    bookId, records:usage.records,estimatedBytes:usage.estimatedBytes,
    totalLimitBytes:TASK_BOOK_TOTAL_LIMIT_BYTES,
  };
}

/** Consent and payload read together to serialize against revocation. Returns
 * only counts and revision IDs, never the sensitive before/after documents. */
export async function inspectTaskBookCheckpoint(
  bookId:string,activityId:string,
):Promise<TaskBookCheckpointSummary|null>{
  if(!bookId||!activityId)return null;
  const db=await getDb();
  const tx=db.transaction("meta","readonly");
  const meta=tx.objectStore("meta");
  const consent=await meta.get(taskBookConsentKey(bookId));
  const value=consent===true?await meta.get(taskBookKey(bookId,activityId)):null;
  await tx.done;
  return consent===true?summarizeTaskBookCheckpoint(value,bookId,activityId):null;
}
