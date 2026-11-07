import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import { buildNarrativeEventCandidateIndex } from "./narrative-event-candidates";
import { createNarrativeEventDecision, currentNarrativeEventDecision, MAX_EVENT_DECISIONS }
  from "./narrative-event-decisions";

function sample() {
  const book = newBook("Un romanzo", "Il libro", "Prosa", "Adulti");
  book.chapters = [{
    id: "ch1", number: 1, title: "Capitolo", purpose: "Prologo",
    frozenAt: "2026-11-07T10:00:00.000Z",
    scenes: [{ id: "s1", number: 1, title: "Scena", objective: "Incidente",
      text: "Mara consegna la chiave a Elio. Elio scompare.", status: "canon" }],
  }];
  return { book, candidate: buildNarrativeEventCandidateIndex(book).events[0]! };
}
const decide = (book: BookProject, candidate: ReturnType<typeof sample>["candidate"],
  verdict: "affirmed" | "dismissed" = "affirmed", note = "L'autore conferma la scena.") =>
  createNarrativeEventDecision(book, candidate, verdict, note, crypto.randomUUID(),
    "2026-11-07T12:00:00.000Z");

describe("Decisioni esplicite e non canoniche dell'autore", () => {
  it("ancora una decisione alla scena congelata senza scrivere memoria o cambiare testo", () => {
    const { book, candidate } = sample();
    const original = structuredClone(book);
    const decision = decide(book, candidate);
    book.narrativeEventDecisions = [decision];
    expect(currentNarrativeEventDecision(book, candidate)).toEqual(decision);
    expect(book.memory).toEqual(original.memory);
    expect(book.chapters).toEqual(original.chapters);
    expect(decision).toMatchObject({verdict: "affirmed", quote: candidate.quote,
      offset: candidate.offset, sourceFrozenAt: original.chapters[0]!.frozenAt});
  });
  it("mantiene la cronologia delle rettifiche senza riattivare attestazioni obsolete", () => {
    const {book,candidate} = sample();
    const first = decide(book,candidate);
    book.narrativeEventDecisions = [first];
    const second = decide(book,candidate,"dismissed","Era solo una bugia del guardiano.");
    book.narrativeEventDecisions.push(second);
    expect(currentNarrativeEventDecision(book,candidate)?.verdict).toBe("dismissed");
    book.chapters[0]!.frozenAt = undefined;
    expect(currentNarrativeEventDecision(book,candidate)).toBeUndefined();
    book.chapters[0]!.frozenAt = "2026-11-08T10:00:00.000Z";
    expect(currentNarrativeEventDecision(book,candidate)).toBeUndefined();
    expect(book.narrativeEventDecisions).toHaveLength(2);
  });
  it("invalida attestazioni quando il testo cambia anche fuori dalla citazione", () => {
    const {book,candidate} = sample();
    book.narrativeEventDecisions = [decide(book,candidate)];
    book.chapters[0]!.scenes[0]!.text += " Qualcosa cambia nella scena.";
    expect(currentNarrativeEventDecision(book,candidate)).toBeUndefined();
  });
  it("rifiuta citazioni contraffatte, capitoli riaperti, motivazioni brevi e archivio pieno", () => {
    const {book,candidate} = sample();
    expect(() => decide(book,{...candidate,quote:"Citazione inventata"})).toThrow();
    expect(() => decide(book,candidate,"affirmed","no")).toThrow(/12/);
    book.chapters[0]!.frozenAt = undefined;
    expect(() => decide(book,candidate)).toThrow(/congelato/);
    book.chapters[0]!.frozenAt = "2026-11-07T10:00:00.000Z";
    book.narrativeEventDecisions = Array(MAX_EVENT_DECISIONS).fill(decide(book,candidate));
    expect(() => decide(book,candidate)).toThrow(/limite/);
  });
});
