import type { GitHubRemote, BookProject } from "@engine/domain/types";
import { prepareGitHubImport, readGitHubMarkdownCopy, RemoteConflict, validateRemote } from "@engine/infrastructure/github-sync";
import { getDb } from "./db";

/**
 * Opening a repository's book in this browser. What is read, validated and made safe lives in the
 * engine; storing it in IndexedDB is the browser's part.
 */

/** Restore only if the book ID does not exist locally. Never overwrite browser data. */
export async function importGitHubBook(
  remote: GitHubRemote, isCurrent: () => boolean = () => true, expectedHead?: string,
): Promise<BookProject> {
  const { book, activities } = await prepareGitHubImport(remote, expectedHead);
  const db = await getDb();
  if (!isCurrent()) throw new Error("Importazione superata: ripeti la scelta del libro.");
  const tx = db.transaction(["books", "activities"], "readwrite");
  void tx.done.catch(() => undefined);
  const existing = await tx.objectStore("books").get(book.id);
  if (existing) {
    await tx.done;
    throw new RemoteConflict("Questo libro è già presente in IndexedDB. Esporta un backup e risolvi il conflitto prima di importare.");
  }
  if (!isCurrent()) { tx.abort(); await tx.done.catch(() => undefined); throw new Error("Importazione superata: ripeti la scelta del libro."); }
  try {
    await tx.objectStore("books").add(book, book.id);
    for (const activity of activities) await tx.objectStore("activities").add(activity, activity.id);
    await tx.done;
  } catch {
    try { tx.abort(); } catch { /* already aborted */ }
    await tx.done.catch(() => undefined);
    throw new Error("Importazione non completata: spazio insufficiente o identificatori già presenti. Nessun libro o attività sostituito.");
  }
  return book;
}

/** Explicit escape hatch for external Markdown edits: a detached new book,
 * never a replacement, merge, snapshot recovery or permission import. */
export async function importGitHubMarkdownCopy(remote: GitHubRemote, expectedHead: string,
  isCurrent: () => boolean = () => true): Promise<BookProject> {
  const target = validateRemote(remote);
  const book = await readGitHubMarkdownCopy(target, expectedHead);
  const db = await getDb();
  if (!isCurrent()) throw new Error("Importazione superata: ripeti la scelta del libro.");
  const tx = db.transaction("books", "readwrite");
  void tx.done.catch(() => undefined);
  await tx.store.add(book, book.id);
  await tx.done;
  return book;
}
