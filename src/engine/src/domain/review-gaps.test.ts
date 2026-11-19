import { describe, expect, it } from "vitest";
import { knowledgeBook } from "./__fixtures__/knowledge";
import type { BookProject } from "./types";
import { elementReviewState } from "./book-edits";
import { editEntity, editEvent, editScene, editStructure } from "./book-editing";
import { buildReviewUnits } from "./manual-review";
import { createManualReview, nextManualReviewStep } from "./manual-review-flow";
import { mergeKnowledgeReply } from "./knowledge";

const NOW = "2026-11-15T10:00:00.000Z";
const ctx = { now: NOW, origin: "manual" as const };
const pass = JSON.stringify({ verdict: "pass", summary: "Coerente con schede e scene vicine.", findings: [] });
function run(book: BookProject): void {
  for (let guard = 0; guard < 200; guard++) {
    const step = nextManualReviewStep(book);
    if (!step) return;
    if (step.type === "local") step.run(book, NOW); else step.apply(book, pass, NOW);
  }
  throw new Error("La review non termina.");
}

describe("Review su richiesta: casi limite", () => {
  it("una modifica di struttura si rivede sulle scene spostate e sui capitoli toccati", () => {
    const book = knowledgeBook();
    editStructure(book, { op: "moveScene", sceneId: "scene:002:002", chapterId: "chapter:002", index: 0 }, ctx);
    const keys = buildReviewUnits(book, "targeted", [{ kind: "structure", id: "book" }]).map(u => u.key);
    expect(keys).toEqual(expect.arrayContaining(["chapter|chapter:002", "scene|scene:002:002"]));
    const review = createManualReview(book, { scope: "targeted", mode: "check", targets: [{ kind: "structure", id: "book" }] }, NOW);
    expect(review.units.length).toBeGreaterThan(0);
    book.status = "running";
    run(book);
    expect(elementReviewState(book, { kind: "structure", id: "book" })).toBe("review_passed");
  });
  it("la review completa chiude anche le modifiche non selezionate", () => {
    const book = knowledgeBook();
    editScene(book, "scene:002:001", { text: "Markus aspetta sul molo al tramonto. Dice di conoscere il Consiglio cittadino." }, ctx);
    editEntity(book, "character:markus", { summary: "Informatore che teme il Consiglio." }, ctx);
    const review = createManualReview(book, { scope: "full", mode: "check", targets: [] }, NOW);
    expect(review.targets.map(t => t.id)).toEqual(expect.arrayContaining(["scene:002:001", "character:markus"]));
    book.status = "running";
    run(book);
    expect(elementReviewState(book, { kind: "scene", id: "scene:002:001" })).toBe("review_passed");
    expect(elementReviewState(book, { kind: "entity", id: "character:markus" })).toBe("review_passed");
    expect(book.chapters.every(c => !c.reviewStale)).toBe(true);
  });
});

describe("Schede ed eventi usati da capitoli congelati", () => {
  it("cambiare una scheda segna da rivedere i capitoli congelati che la usano, senza toccare il testo", () => {
    const book = knowledgeBook();
    const text = JSON.stringify(book.chapters.map(c => c.scenes.map(s => s.text)));
    const edit = editEntity(book, "character:markus", { attributes: { personality: "Impulsivo e aggressivo" } }, ctx);
    expect(book.chapters[1]!.reviewStale?.editIds).toEqual([edit.id]);
    expect(book.chapters[0]!.reviewStale).toBeUndefined();
    expect(book.chapters.every(c => c.frozenAt)).toBe(true);
    expect(JSON.stringify(book.chapters.map(c => c.scenes.map(s => s.text)))).toBe(text);
  });
  it("cambiare un evento segna i capitoli delle sue scene", () => {
    const book = knowledgeBook();
    const edit = editEvent(book, "event:primo-indizio", { summary: "Una firma strappata dal registro." }, ctx);
    expect(book.chapters[0]!.reviewStale?.editIds).toEqual([edit.id]);
    expect(book.chapters[1]!.reviewStale).toBeUndefined();
  });
});

describe("Fusione delle schede dall'AI", () => {
  it("un cambio delle sole cause è una nuova versione dell'evento, con storico", () => {
    const book = knowledgeBook();
    const before = book.knowledge!.events.find(e => e.title === "Rivelazione del complotto")!;
    const merged = mergeKnowledgeReply(book.knowledge!, { events: [{ title: "Rivelazione del complotto", causes: ["Primo indizio"] }] },
      { origin: "written", reason: "consolidamento", now: NOW });
    const after = merged.events.find(e => e.id === before.id)!;
    expect(after.causes).toEqual(expect.arrayContaining([...before.causes, merged.events.find(e => e.title === "Primo indizio")!.id]));
    expect(after.version).toBe(before.version + 1);
    expect(after.history?.at(-1)).toMatchObject({ version: before.version, reason: "consolidamento" });
  });
});
