import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { newBook } from "@engine/domain/types";
import { chapterSegments, createEditorialCycle, validateJudgment, validateReport } from "@engine/domain/editorial-board";
import { getDb, saveBook } from "./db";
import { createBackup, readBackup } from "./backup";

beforeEach(async () => {
  const db = await getDb();
  await db.clear("books"); await db.clear("activities"); await db.clear("outbox");
});

describe("ZIP: tornate archiviate di un capitolo rivalutato più volte", () => {
  it("un capitolo riaperto e congelato di nuovo conserva tutte le tornate e il backup si reimporta", async () => {
    const book = newBook("Una lettera", "Capitolo rivalutato", "Prosa", "Adulti");
    const quote = "Mara trova una lettera dietro la porta";
    book.chapters = [{ id: "c1", number: 1, title: "Un segreto", purpose: "Mistero",
      scenes: [{ id: "s1", number: 1, title: "La porta", objective: "Sorpresa", status: "canon", text: quote + ". Elio osserva in silenzio." }] }];
    const chapter = book.chapters[0]!, cycle = createEditorialCycle(chapter.id), segment = chapterSegments(chapter)[0]!;
    const report = validateReport(cycle, "style", segment, 1, JSON.stringify({ verdict: "issues", summary: "Un punto di ritmo da valutare.", memoryNote: "",
      findings: [{ sceneId: "s1", category: "ritmo", severity: "minor", evidence: quote, reason: "La frase iniziale è lunga ma resta chiara.", remediation: "Accorciarla." }] }), chapter, book);
    cycle.reports.push(report);
    cycle.judgment = validateJudgment(cycle, JSON.stringify({ reasoning: "Il rilievo è una preferenza di stile, non un difetto della scena.",
      decisions: [{ findingId: report.findings[0]!.id, action: "reject", rationale: "La lunghezza della frase serve al ritmo voluto dall'autore.", remediation: "" }] }), chapter, book);
    chapter.frozenAt = "2026-11-15T10:00:00.000Z";
    // Five rounds: one review, then a reopening (Rivaluta) with more rounds.
    chapter.editorialRounds = Array.from({ length: 5 }, (_, i) => ({ round: (i % 3) + 1, reports: structuredClone(cycle.reports), judgment: structuredClone(cycle.judgment!) }));
    await saveBook(book, false);
    const data = await readBackup(await createBackup("content") as File);
    expect(data.books.find(b => b.title === book.title)!.chapters[0]!.editorialRounds).toHaveLength(5);
  });
});
