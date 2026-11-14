import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { DEFAULT_SETTINGS, newBook, type Activity } from "../domain/types";
import { getBook, getDb, loadSettings, saveActivity, saveBook, saveSettings } from "./db";
import { enableFailedTaskRetries } from "./failed-task-retry";

beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "settings", "meta"]) await db.clear(store);
});

it("attiva soltanto l'endpoint del task fallito senza mutare libro o altre impostazioni", async () => {
  const book = newBook("Idea", "Libro", "", ""); book.status = "error";
  await saveBook(book, false);
  const settings = structuredClone(DEFAULT_SETTINGS);
  await saveSettings(settings);
  const activity: Activity = { id: crypto.randomUUID(), bookId: book.id, runId: "run", phase: "chapterReview",
    title: "Redazione", reason: "Verifica", nextStep: "Giudice", status: "failed", aiRequested: true,
    endpointId: settings.endpoints[0]!.id, createdAt: new Date().toISOString() };
  await saveActivity(activity);
  const saved = await enableFailedTaskRetries(book.id, activity.id, 2);
  expect(saved.endpoints[0]).toEqual({ ...settings.endpoints[0], autoRetry: true, autoRetryMax: 2 });
  expect(saved.endpoints.slice(1)).toEqual(settings.endpoints.slice(1));
  expect(await getBook(book.id)).toEqual(book);
  const other = newBook("Altro", "Altro libro", "", ""); other.status = "error"; await saveBook(other, false);
  await expect(enableFailedTaskRetries(other.id, activity.id, 2)).rejects.toThrow(/task o l'endpoint/);
  expect(await loadSettings()).toEqual(saved);
});
