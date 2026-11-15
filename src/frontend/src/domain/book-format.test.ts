import { describe, expect, it } from "vitest";
import { knowledgeBook } from "./__fixtures__/knowledge";
import { BOOK_FORMAT_VERSION, migrateBook, NewerBookFormatError, pendingMigrations } from "./book-format";
import { newBook } from "./types";

describe("Formato dei dati del libro e migrazioni esplicite", () => {
  it("un libro nuovo è già al formato corrente; uno senza versione è il formato 0", () => {
    expect(newBook("idea", "Titolo", "", "").formatVersion).toBe(BOOK_FORMAT_VERSION);
    const legacy = knowledgeBook();
    delete legacy.formatVersion;
    expect(pendingMigrations(legacy)).toHaveLength(BOOK_FORMAT_VERSION);
    expect(pendingMigrations(migrateBook(legacy))).toEqual([]);
  });
  it("0 → 1: un riassunto che era solo il taglio del testo diventa «da aggiornare», gli altri restano", () => {
    const book = knowledgeBook();
    delete book.formatVersion;
    const [cut, real] = book.chapters[0]!.scenes;
    cut!.text = "Elena ricorda la notte della sparizione. ".repeat(30);
    cut!.summary = cut!.text.slice(0, 520);
    real!.summary = "Elena trova una firma cancellata nel registro.";
    const prose = JSON.stringify(book.chapters.map(c => c.scenes.map(s => [s.text, s.summary])));
    migrateBook(book);
    expect(book.formatVersion).toBe(BOOK_FORMAT_VERSION);
    expect(cut!.summaryStale).toBe(true);
    expect(real!.summaryStale).toBeUndefined();
    // Prose and summaries are never rewritten by a migration.
    expect(JSON.stringify(book.chapters.map(c => c.scenes.map(s => [s.text, s.summary])))).toBe(prose);
    // Idempotent: a second run changes nothing.
    const once = JSON.stringify(book);
    migrateBook(book);
    expect(JSON.stringify(book)).toBe(once);
  });
  it("un libro salvato da un'app più recente o con una versione non valida non viene toccato", () => {
    const book = knowledgeBook();
    book.formatVersion = BOOK_FORMAT_VERSION + 1;
    const before = JSON.stringify(book);
    expect(() => migrateBook(book)).toThrow(NewerBookFormatError);
    expect(() => migrateBook(book)).toThrow(/versione più recente di BookWriter/);
    expect(JSON.stringify(book)).toBe(before);
    for (const bad of [-1, 1.5, "1"]) {
      const odd = knowledgeBook();
      (odd as { formatVersion?: unknown }).formatVersion = bad;
      expect(() => migrateBook(odd)).toThrow(/non valida/);
    }
  });
});
