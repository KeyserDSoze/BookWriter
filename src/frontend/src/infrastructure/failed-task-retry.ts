import type { Activity, AppSettings, BookProject } from "@engine/domain/types";
import { getDb } from "./db";
import { markCloudProfileDirty } from "./cloud/cloud-dirty";
import { rotateRetrySettingsEpoch } from "./retry-settings-epoch";

/** Change only the failed task's endpoint policy, not unsaved React settings.
 * Validate task ownership and write the cloud dirty marker in the same commit. */
export async function enableFailedTaskRetries(bookId: string, activityId: string, max: number): Promise<AppSettings> {
  if (!Number.isSafeInteger(max) || max < 1 || max > 5) throw new Error("Numero di tentativi non valido.");
  const db = await getDb();
  const tx = db.transaction(["books", "activities", "settings", "meta"], "readwrite");
  void tx.done.catch(() => undefined);
  const book = await tx.objectStore("books").get(bookId) as BookProject | undefined;
  const activity = await tx.objectStore("activities").get(activityId) as Activity | undefined;
  const saved = await tx.objectStore("settings").get("global") as AppSettings | undefined;
  if (!book || book.status !== "error" || activity?.bookId !== bookId || activity.status !== "failed" ||
      !activity.aiRequested || !activity.endpointId || !saved?.endpoints.some(endpoint => endpoint.id === activity.endpointId)) {
    await tx.done;
    throw new Error("Il task o l'endpoint sono cambiati. Ricarica il libro prima di attivare i tentativi.");
  }
  const next = { ...saved, endpoints: saved.endpoints.map(endpoint => endpoint.id === activity.endpointId
    ? { ...endpoint, autoRetry: true, autoRetryMax: max } : endpoint) };
  try {
    await tx.objectStore("settings").put(next, "global");
    await rotateRetrySettingsEpoch(tx.objectStore("meta"), saved, next);
    await markCloudProfileDirty(tx.objectStore("meta"), saved, next);
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* already aborted */ }
    throw error;
  }
  return next;
}
