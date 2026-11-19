import type { BookProject } from "./types";

/** Explicit, ordered migrations of the stored book data. Each step brings a book from
 * version N to N+1; a missing `formatVersion` is version 0 (books saved before 0.22).
 * Migrations are pure, idempotent and only touch derived or local data: they never
 * rewrite prose, sheets or the author's decisions. They run when a book is read or
 * imported; the migrated copy is saved by the next ordinary save. */
const MIGRATIONS: ReadonlyArray<{ description: string; run: (book: BookProject) => void }> = [
  // New migrations are appended below, never inserted before an existing version.
  {
    // Before 0.22 a review or a retroactive rewrite set the scene summary to the first
    // 520 characters of the prose. That is not a summary: mark it «da aggiornare» so the
    // autopilot rewrites it from the text before the chapter's next editorial review.
    description: "Riassunti ricavati dal taglio del testo segnati da aggiornare",
    run: book => {
      for (const chapter of book.chapters) for (const scene of chapter.scenes)
        if (scene.summary !== undefined && scene.text.length > 0 && scene.summary === scene.text.slice(0, 520)) scene.summaryStale = true;
    },
  },
  {
    description: "Autorità server opzionale; i libri esistenti restano locali",
    run: () => { /* Absence deliberately stays local; no consent is inferred. */ },
  },
];
export const BOOK_FORMAT_VERSION = MIGRATIONS.length;

export class NewerBookFormatError extends Error {
  constructor(version: number) {
    super(`Questo libro è stato salvato da una versione più recente di BookWriter (formato ${version}, questa app legge fino al ${BOOK_FORMAT_VERSION}): aggiorna l'app prima di aprirlo o modificarlo. Nessun dato è stato cambiato.`);
    this.name = "NewerBookFormatError";
  }
}

/** The stored format version; throws on values this app cannot read safely. */
export function bookFormatVersion(book: { formatVersion?: unknown }): number {
  const version = book.formatVersion;
  if (version === undefined) return 0;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) throw new Error("Versione del formato del libro non valida.");
  if (version > BOOK_FORMAT_VERSION) throw new NewerBookFormatError(version);
  return version;
}

/** Brings a book to the current format, in place. Throws (changing nothing) when the
 * book comes from a newer app: older code must not reinterpret data it does not know. */
export function migrateBook<T extends BookProject>(book: T): T {
  const from = bookFormatVersion(book);
  for (let version = from; version < BOOK_FORMAT_VERSION; version++) MIGRATIONS[version]!.run(book);
  book.formatVersion = BOOK_FORMAT_VERSION;
  return book;
}

/** Steps a book of this version will go through (for documentation and tests). */
export function pendingMigrations(book: { formatVersion?: unknown }): string[] {
  return MIGRATIONS.slice(bookFormatVersion(book)).map(step => step.description);
}
