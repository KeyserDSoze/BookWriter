import { host } from "../core/host";

/**
 * The writer sessions THIS device opened for each book. A GitHub lease whose session is in
 * this list was left by a page (or process) of this same device: once the caller holds the book's
 * writer lock, that holder is certainly gone (a reload or a closed tab cannot release the lease).
 * Device-local: never exported in a ZIP, never written to GitHub or the cloud.
 * This is not authentication: it only recognises our own leftovers, it never lets a lease of
 * another device be taken over.
 */
const KEEP = 8;
const key = (bookId: string) => "writer-sessions:v1:" + bookId;
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export async function rememberWriterSession(bookId: string, sessionId: string): Promise<void> {
  const known = ids(await host().getMeta(key(bookId)));
  await host().putMeta(key(bookId), [...known.filter(id => id !== sessionId), sessionId].slice(-KEEP));
}

export async function isOwnWriterSession(bookId: string, sessionId: string): Promise<boolean> {
  try { return ids(await host().getMeta(key(bookId))).includes(sessionId); } catch { return false; }
}
