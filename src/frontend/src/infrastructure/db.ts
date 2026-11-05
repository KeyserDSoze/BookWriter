import { openDB, type IDBPDatabase } from "idb";
import type { Activity, AppSettings, BookProject } from "../domain/types";
import { DEFAULT_SETTINGS } from "../domain/types";

const DB_NAME = "bookwriter";
const DB_VERSION = 1;
let database: Promise<IDBPDatabase> | undefined;

export function getDb(): Promise<IDBPDatabase> {
  database ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      for (const store of ["books", "activities", "settings", "meta", "outbox"]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    },
  });
  return database;
}

export async function loadSettings(): Promise<AppSettings> {
  const db = await getDb();
  const stored = (await db.get("settings", "global")) as AppSettings | undefined;
  return stored ?? structuredClone(DEFAULT_SETTINGS);
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await getDb();
  await db.put("settings", settings, "global");
}

export async function listBooks(): Promise<BookProject[]> {
  const db = await getDb();
  const all = (await db.getAll("books")) as BookProject[];
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBook(id: string): Promise<BookProject | undefined> {
  const db = await getDb();
  return (await db.get("books", id)) as BookProject | undefined;
}

export async function saveBook(book: BookProject): Promise<void> {
  book.updatedAt = new Date().toISOString();
  const db = await getDb();
  await db.put("books", book, book.id);
}

export async function saveActivity(activity: Activity): Promise<void> {
  const db = await getDb();
  await db.put("activities", activity, activity.id);
}

export async function saveBookAndActivity(book: BookProject, activity: Activity): Promise<void> {
  const db = await getDb();
  book.updatedAt = new Date().toISOString();
  const tx = db.transaction(["books", "activities"], "readwrite");
  await Promise.all([
    tx.objectStore("books").put(book, book.id),
    tx.objectStore("activities").put(activity, activity.id),
  ]);
  await tx.done;
}

export async function listActivities(bookId: string): Promise<Activity[]> {
  const db = await getDb();
  const items = (await db.getAll("activities")) as Activity[];
  return items.filter(item => item.bookId === bookId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function recoverInterruptedRuns(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("books", "readwrite");
  const store = tx.objectStore("books");
  let cursor = await store.openCursor();
  while (cursor) {
    const book = cursor.value as BookProject;
    if (book.status === "running") {
      book.status = "paused";
      book.previousError = "La pagina è stata interrotta. Riprendi dall'ultimo checkpoint.";
      await cursor.update(book);
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}
