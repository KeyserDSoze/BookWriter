import { getDb } from "./db";

/**
 * The writer sessions THIS browser opened for each book. A GitHub lease whose session is in
 * this list was left by a page of this same browser: once the caller holds the book's writer
 * Web Lock, that page is certainly gone (a reload or a closed tab cannot release the lease).
 * Device-local (meta store): never exported in a ZIP, never written to GitHub or the cloud.
 * This is not authentication: it only recognises our own leftovers, it never lets a lease of
 * another device be taken over.
 */
const KEEP = 8;
const key = (bookId: string) => "writer-sessions:v1:" + bookId;
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export async function rememberWriterSession(bookId: string, sessionId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("meta", "readwrite");
  const current = ids(await tx.store.get(key(bookId)));
  await tx.store.put([...current.filter(id => id !== sessionId), sessionId].slice(-KEEP), key(bookId));
  await tx.done;
}

export async function isOwnWriterSession(bookId: string, sessionId: string): Promise<boolean> {
  try {
    const db = await getDb();
    return ids(await db.get("meta", key(bookId))).includes(sessionId);
  } catch { return false; }
}
