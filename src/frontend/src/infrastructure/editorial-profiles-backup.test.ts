import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { profileBook } from "@engine/domain/__fixtures__/editorial-profiles";
import { createEditorialCycle, chapterSegments, validateReport } from "@engine/domain/editorial-board";
import { readEditorialProfileDocuments } from "@engine/domain/editorial-profiles";
import { projectBook } from "@engine/domain/narrarium";
import { summarizeBook } from "@engine/domain/cloud-profile";
import { createBackup, importBackup, readBackup } from "./backup";
import { getDb, listBooks, saveBook } from "./db";

beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta", "settings", "mergeDrafts"]) await db.clear(store);
});
describe("Profili e cartelle aggiuntive negli archivi", () => {
  it("round-trip content/full, snapshot dei cicli, import additivo e privacy cloud", async () => {
    const book = profileBook(), chapter = book.chapters[0]!;
    book.editorialCycle = createEditorialCycle(chapter.id, book);
    const segment = chapterSegments(chapter)[0]!;
    book.editorialCycle.reports.push(validateReport(book.editorialCycle, "continuity", segment, 1,
      JSON.stringify({ verdict: "pass", summary: "Lettura completata senza osservazioni.", memoryNote: "", findings: [] }), chapter, book));
    book.markdownSource = { "research/nested/notes.md": "Extra privato da conservare integralmente." };
    await saveBook(book, false);
    for (const kind of ["content", "full"] as const) {
      const file = await createBackup(kind, kind === "full" ? "synthetic-long-password" : undefined);
      const data = await readBackup(file as File, kind === "full" ? "synthetic-long-password" : undefined);
      expect(data.books[0]!.editorialProfiles).toEqual(book.editorialProfiles);
      expect(data.books[0]!.editorialCycle).toEqual(book.editorialCycle);
      expect(data.books[0]!.markdownSource).toEqual(book.markdownSource);
      if (kind === "content") { await importBackup(data, false); expect(await listBooks()).toHaveLength(2); }
    }
    const summary = JSON.stringify(summarizeBook(book, { id: crypto.randomUUID(), name: "PC" }, book.updatedAt));
    for (const secret of ["WRITER_ONLY", "READER_ONE_ONLY", "editorialProfiles", "profileSettings", "Extra privato"]) expect(summary).not.toContain(secret);
  });
  it("i Markdown dei template si caricano come bozza esplicita e non come un'autorizzazione", () => {
    const book = profileBook(), files = projectBook(book, []).files;
    const draft = readEditorialProfileDocuments(files);
    expect(draft).toEqual(book.editorialProfiles);
    expect(readEditorialProfileDocuments({ ...files, "other/extra.md": "# Una nota" })).toEqual(draft);
    const wrong = { ...files, "profiles/readers/bookwriter-readerGenre.md": files["profiles/readers/bookwriter-readerGenre.md"]!.replace('role: "readerGenre"', 'role: "historical"') };
    expect(() => readEditorialProfileDocuments(wrong)).toThrow(/Profili editoriali/);
  });
  it("ZIP ostili non possono aggiungere ruoli privilegiati, perdere template del ciclo o saltare lo scrittore", async () => {
    const book = profileBook(); book.editorialCycle = createEditorialCycle(book.chapters[0]!.id, book);
    await saveBook(book, false);
    const zip = await createBackup("content"), parts = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    for (const corrupt of [
      (data: { books: typeof book[] }) => { data.books[0]!.editorialProfiles!.readers[0]!.role = "historical" as never; },
      (data: { books: typeof book[] }) => { delete data.books[0]!.editorialCycle!.profileSettings; },
      (data: { books: typeof book[] }) => { data.books[0]!.editorialCycle!.roles = data.books[0]!.editorialCycle!.roles!.filter(r => r !== "writerReview"); },
    ]) {
      const data = JSON.parse(strFromU8(parts["content.json"]!)); corrupt(data);
      const file = new Blob([new Uint8Array(zipSync({ "manifest.json": parts["manifest.json"]!, "content.json": strToU8(JSON.stringify(data)) }))]) as File;
      await expect(readBackup(file)).rejects.toThrow(/Schema backup/);
    }
  });
});
