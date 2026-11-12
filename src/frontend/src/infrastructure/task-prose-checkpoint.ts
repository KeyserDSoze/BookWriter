import { getDb } from "./db";
import { validatedTaskProseCheckpoint, type TaskProseCheckpoint } from "../domain/task-prose-checkpoint";

export function taskProseConsentKey(bookId: string): string {
  return "task-prose-consent:v1:" + bookId;
}
export function taskProseKey(bookId: string, activityId: string): string {
  return "task-prose:v1:" + bookId + ":" + activityId;
}
export async function loadTaskProseConsent(bookId: string): Promise<boolean> {
  if (!bookId) return false;
  const db = await getDb();
  return (await db.get("meta", taskProseConsentKey(bookId))) === true;
}
/**
 * Author's explicit, local per-book choice. Revocation and removal share
 * a readwrite transaction with the consent value, so concurrent task commits
 * cannot leave a surviving prose copy after the revocation completes.
 */
export async function setTaskProseConsent(bookId: string, enabled: boolean): Promise<void> {
  if (!bookId) throw new Error("Seleziona un libro prima di gestire le copie locali.");
  const db = await getDb();
  const tx = db.transaction(["meta", "books"], "readwrite");
  void tx.done.catch(() => {});
  const book = await tx.objectStore("books").get(bookId);
  if (!book) {
    await tx.done;
    throw new Error("Libro non trovato: nessuna preferenza modificata.");
  }
  const meta = tx.objectStore("meta");
  await meta.put(enabled === true, taskProseConsentKey(bookId));
  if (!enabled) {
    const prefix = taskProseKey(bookId, "");
    let cursor = await meta.openCursor();
    while (cursor) {
      if (typeof cursor.key === "string" && cursor.key.startsWith(prefix))
        await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  await tx.done;
}
/** A local read requested explicitly by the author; no ZIP or GitHub sync. */
export async function loadTaskProseCheckpoint(
  bookId: string, activityId: string,
): Promise<TaskProseCheckpoint | null> {
  if (!bookId || !activityId) return null;
  const db = await getDb();
  // Check consent and read the record within a single readonly transaction:
  // an opt-out cannot race with a read and disclose a revoked snapshot.
  const tx = db.transaction("meta", "readonly");
  const meta = tx.objectStore("meta");
  const allowed = (await meta.get(taskProseConsentKey(bookId))) === true;
  const value = allowed ? await meta.get(taskProseKey(bookId, activityId)) : null;
  await tx.done;
  return allowed ? validatedTaskProseCheckpoint(value, bookId, activityId) : null;
}
