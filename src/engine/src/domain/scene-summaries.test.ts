import { describe, expect, it } from "vitest";
import { knowledgeBook } from "./__fixtures__/knowledge";
import { createEditorialCycle } from "./editorial-board";
import { describeNextAutopilotStep } from "./autopilot-step";
import { applySceneSummaries, MAX_SUMMARY_SCENE_CHARS, scenesNeedingSummary, summaryBatch } from "./scene-summaries";
import { editScene } from "./book-editing";
import { elementReviewState, setReviewState } from "./book-edits";

describe("Riassunti delle scene: mai un taglio del testo", () => {
  it("chiede i riassunti delle sole scene scritte segnate da aggiornare, escluse quelle troppo lunghe", () => {
    const book = knowledgeBook(), chapter = book.chapters[0]!;
    expect(scenesNeedingSummary(chapter)).toEqual([]);
    chapter.scenes[1]!.summaryStale = true;
    chapter.scenes[0]!.summaryStale = true; chapter.scenes[0]!.text = "x".repeat(MAX_SUMMARY_SCENE_CHARS + 1);
    expect(scenesNeedingSummary(chapter).map(s => s.id)).toEqual(["scene:001:002"]);
  });
  it("un lotto resta piccolo: al massimo 8 scene, e una scena lunga va da sola", () => {
    const scenes = Array.from({ length: 12 }, (_, i) => ({ id: "s" + i, number: i + 1, title: "S", objective: "", text: "breve testo", status: "canon" as const }));
    expect(summaryBatch(scenes)).toHaveLength(8);
    const long = [{ ...scenes[0]!, text: "y".repeat(50_000) }, scenes[1]!];
    expect(summaryBatch(long)).toHaveLength(1);
  });
  it("ogni scena chiesta deve avere il suo riassunto; una scena cambiata durante la chiamata resta da aggiornare", () => {
    const book = knowledgeBook();
    const [a, b] = book.chapters[0]!.scenes;
    a!.summaryStale = true; b!.summaryStale = true;
    const expected = [{ id: a!.id, text: a!.text }, { id: b!.id, text: b!.text }];
    expect(() => applySceneSummaries(book, expected, { sceneSummaries: { [a!.id]: "Elena ricorda la notte in cui il fratello sparì." } })).toThrow(/Mancano i riassunti/);
    expect(() => applySceneSummaries(book, expected, { sceneSummaries: { [a!.id]: "corto", [b!.id]: "Elena trova una firma cancellata nel registro." } })).toThrow();
    b!.text += " Poi esce.";
    const applied = applySceneSummaries(book, expected, { sceneSummaries: {
      [a!.id]: "Elena ricorda la notte in cui il fratello sparì.", [b!.id]: "Elena trova una firma cancellata nel registro." } });
    expect(applied).toBe(1);
    expect(a).toMatchObject({ summary: "Elena ricorda la notte in cui il fratello sparì." });
    expect(a!.summaryStale).toBeUndefined();
    expect(b!.summaryStale).toBe(true);
  });
  it("un nuovo riassunto dallo stesso testo non annulla la review già superata della scena", () => {
    const book = knowledgeBook();
    const ctx = { now: "2026-11-14T10:00:00.000Z", origin: "manual" as const };
    editScene(book, "scene:001:002", { text: "Elena sfoglia il registro e trova una firma cancellata, poi la ricopia." }, ctx);
    const target = { kind: "scene" as const, id: "scene:001:002" };
    setReviewState(book, [target], "review_passed");
    expect(elementReviewState(book, target)).toBe("review_passed");
    const scene = book.chapters[0]!.scenes[1]!;
    expect(scene.summaryStale).toBe(true);
    applySceneSummaries(book, [{ id: scene.id, text: scene.text }], { sceneSummaries: { [scene.id]: "Elena trova e ricopia una firma cancellata nel registro." } });
    expect(elementReviewState(book, target)).toBe("review_passed");
    // A real change of the text after the review still needs a new one.
    editScene(book, "scene:001:002", { text: scene.text + " Esce." }, { ...ctx, now: "2026-11-14T11:00:00.000Z" });
    expect(elementReviewState(book, target)).toBe("modified_unreviewed");
  });
  it("la Dashboard dice che prima dei revisori arrivano i riassunti", () => {
    const book = knowledgeBook();
    book.chapters[0]!.frozenAt = undefined;
    book.chapters[0]!.scenes[1]!.summaryStale = true;
    book.editorialCycle = createEditorialCycle("chapter:001", book);
    book.phase = "chapterReview";
    expect(describeNextAutopilotStep(book).headline).toContain("Riassunti delle scene del capitolo 1");
  });
});
