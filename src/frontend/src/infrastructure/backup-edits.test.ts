import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createBackup, importBackup, readBackup } from "./backup";
import { getDb, listBooks, saveBook, saveSettings } from "./db";
import { DEFAULT_SETTINGS } from "../domain/types";
import { knowledgeBook } from "../domain/__fixtures__/knowledge";
import { editScene } from "../domain/book-editing";
import { createManualReview } from "../domain/manual-review-flow";
import { elementReviewState } from "../domain/book-edits";
import { defaultWebResearchSettings } from "../domain/web-research";

const NOW = "2026-11-14T10:00:00.000Z";
beforeEach(async () => {
  const db = await getDb();
  for (const store of ["books", "activities", "outbox", "meta", "mergeDrafts"]) await db.clear(store);
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
});

describe("ZIP: modifiche tracciate, review e ricerca web", () => {
  it("conserva storico e review, ma l'import interrompe le review e spegne la ricerca", async () => {
    const book = knowledgeBook();
    editScene(book, "scene:002:001", { text: "Markus aspetta sul molo al tramonto. Dice di conoscere il Consiglio cittadino." }, { now: NOW, origin: "manual" });
    createManualReview(book, { scope: "targeted", mode: "check", targets: [{ kind: "scene", id: "scene:002:001" }] }, NOW);
    book.webResearch = defaultWebResearchSettings(NOW);
    await saveBook(book, false);
    const zip = await createBackup("content");
    const parsed = await readBackup(zip as File);
    const copy = parsed.books[0]!;
    expect(copy.edits).toHaveLength(1);
    expect(copy.manualReviews![0]!.status).toBe("pending");
    expect(copy.chapters[1]!.reviewStale!.editIds).toEqual([copy.edits![0]!.id]);
    expect(copy.chapters[1]!.scenes[0]!.summaryStale).toBe(true);
    await importBackup(parsed, false);
    const imported = (await listBooks()).find(b => b.title.endsWith("(importato)"))!;
    expect(imported.manualReviews![0]).toMatchObject({ status: "cancelled" });
    expect(elementReviewState(imported, { kind: "scene", id: "scene:002:001" })).toBe("modified_unreviewed");
    expect(imported.webResearch!.enabled).toBe(false);

    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const hostile = (mutate: (book: { edits: Array<Record<string, unknown>>; manualReviews: Array<Record<string, unknown>> }) => void) => {
      const content = JSON.parse(strFromU8(entries["content.json"]!));
      mutate(content.books[0]);
      return new Blob([new Uint8Array(zipSync({ "manifest.json": entries["manifest.json"]!, "content.json": strToU8(JSON.stringify(content)) }))]) as File;
    };
    await expect(readBackup(hostile(b => { b.edits[0]!.reviewState = "approvata"; }))).rejects.toThrow(/Schema backup non valido/);
    await expect(readBackup(hostile(b => { b.edits[0]!.extra = "x"; }))).rejects.toThrow(/Schema backup non valido/);
    await expect(readBackup(hostile(b => { b.manualReviews[0]!.mode = "riscrivi-tutto"; }))).rejects.toThrow(/Schema backup non valido/);
  });
});
