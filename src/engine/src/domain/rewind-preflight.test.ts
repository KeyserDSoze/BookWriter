import { describe, expect, it } from "vitest";
import type { Activity } from "./types";
import { analyzeRewindPreflight, type RewindPreflightBook } from "./rewind-preflight";

const fixture = (id: string, createdAt: string, extras: Partial<Activity> = {}): Activity => ({
  id, bookId: "book-a", runId: "run-1", phase: "prose",
  title: "Task " + id, reason: "Verifica", nextStep: "Prosegui",
  createdAt, status: "succeeded", output: "SEGRETO_OUTPUT_DI_NON_CONDIVIDERE",
  ...extras,
});
const book: RewindPreflightBook = {
  id: "book-a", status: "paused", editorialReviewSceneIds: ["scene-a", "scene-b", "scene-b"],
  chapters: [
    { id: "ch-a", number: 1, title: "Inizio", purpose: "Sviluppo",
      frozenAt: "2026-11-12T10:00:00.000Z", scenes: [
        { id: "scene-a", number: 1, title: "Scena", objective: "Obiettivo",
          text: "SEGRETO_SCENA_CANON", status: "canon" },
        { id: "scene-b", number: 2, title: "Bozza", objective: "Obiettivo",
          text: "SEGRETO_SCENA_DRAFT", status: "draft" },
      ] },
    { id: "ch-b", number: 2, title: "Dopo", purpose: "Proseguimento",
      scenes: [
        { id: "scene-c", number: 1, title: "Ultima", objective: "Obiettivo",
          text: "SEGRETO_SCENA", status: "canon" },
      ] },
  ],
};

describe("preflight rewind non distruttivo #165", () => {
  it("isola il libro, ordina le attività successive e distingue date uguali/invalide", () => {
    const entries = [
      fixture("future-b", "2026-11-12T10:00:01Z"),
      fixture("target", "2026-11-12T09:00:00.000Z"),
      fixture("past", "2026-11-12T08:59:59.999Z"),
      fixture("same", "2026-11-12T10:00:00+01:00"),
      fixture("future-a", "2026-11-12T09:00:01.000Z",
        { status: "running" }),
      fixture("bad", "2026-02-30T11:00:00Z"),
      fixture("other", "2026-11-12T11:00:00Z",
        { bookId: "book-b", status: "running" }),
    ];
    const before = JSON.stringify({ book, entries });
    const report = analyzeRewindPreflight(book, entries, "target");
    expect(report).toEqual({
      kind: "ready", taskId: "target", laterTaskCount: 2,
      laterTaskSample: [
        { id: "future-a", title: "Task future-a", phase: "prose", status: "running" },
        { id: "future-b", title: "Task future-b", phase: "prose", status: "succeeded" },
      ],
      sameTimeCount: 1, invalidTimeCount: 1, runningTaskCount: 1,
      currentChapterCount: 2, currentFrozenChapterCount: 1,
      currentCanonSceneCount: 2, currentPendingReviewCount: 2,
    });
    expect(JSON.stringify(report)).not.toMatch(/SEGRETO|book-b/);
    expect(JSON.stringify({ book, entries })).toEqual(before);
  });
  it("non considera automaticamente sicuro un task senza successori certi", () => {
    const result = analyzeRewindPreflight(book, [
      fixture("target", "2026-11-12T09:00:00Z"),
      fixture("unknown", "2026-11-12T09:00:00", { status: "failed" }),
      fixture("same", "2026-11-12T09:00:00.000Z"),
    ], "target");
    expect(result).toMatchObject({
      kind: "ready", laterTaskCount: 0,
      sameTimeCount: 1, invalidTimeCount: 1,
    });
  });
  it("non crea anteprime di date non affidabili o ID ambigui", () => {
    const valid = fixture("target", "2026-11-12T09:00:00Z");
    expect(analyzeRewindPreflight(book, [], "target")).toEqual({
      kind: "unavailable", reason: "missing_task",
    });
    expect(analyzeRewindPreflight(book, [valid], "missing")).toEqual({
      kind: "unavailable", reason: "missing_task",
    });
    expect(analyzeRewindPreflight(book, [
      { ...valid, bookId: "book-b" },
    ], "target")).toEqual({
      kind: "unavailable", reason: "wrong_book",
    });
    expect(analyzeRewindPreflight(book, [valid, valid], "target")).toEqual({
      kind: "unavailable", reason: "duplicate_task",
    });
    for (const invalid of [
      "ieri", "", "2026-02-30T09:00:00Z",
      "2026-11-12T09:00:00", "2026-11-12T09:00:00+15:00",
    ]) expect(analyzeRewindPreflight(book, [
      { ...valid, createdAt: invalid },
    ], "target")).toEqual({
      kind: "unavailable", reason: "invalid_task_time",
    });
  });
  it("limita l'anteprima a cinque metadati anche su molti task", () => {
    const entries = [
      fixture("target", "2026-11-12T09:00:00Z"),
      ...Array.from({ length: 12 }, (_, index) => fixture(
        "future-" + index,
        new Date(Date.parse("2026-11-12T09:01:00Z") + index * 1000).toISOString(),
      )),
    ];
    const result = analyzeRewindPreflight(book, entries, "target");
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.laterTaskCount).toBe(12);
    expect(result.laterTaskSample).toHaveLength(5);
    expect(result.laterTaskSample[0]!.id).toBe("future-0");
    expect(result.laterTaskSample[4]!.id).toBe("future-4");
    expect(result.laterTaskSample[0]).not.toHaveProperty("output");
  });
});
