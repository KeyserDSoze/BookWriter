import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import {
  EDITORIAL_ROLES, LIGHT_EDITORIAL_ROLES, assertEditorialReviewCoverage, chapterSegments, createEditorialCycle,
  cycleRoles, lightRolesFor, nextReviewSlot, validateReport, type ChapterEditorialCycle,
} from "./editorial-board";

function sample(): BookProject {
  const book = newBook("Un incontro al castello.", "Il castello", "Sobrio", "Adulti");
  book.chapters = [{
    id: "ch-1", number: 1, title: "La porta", purpose: "Inizio",
    scenes: [
      { id: "scene-1", number: 1, title: "Ingresso", objective: "Entrare",
        text: "Mara vede il guardiano mentre apre il portone del castello.", status: "canon" },
      { id: "scene-2", number: 2, title: "La stanza", objective: "Osservare",
        text: "Il guardiano resta immobile davanti alla porta chiusa.", status: "canon" },
    ],
  }];
  return book;
}
const pass = () => JSON.stringify({
  verdict: "pass", summary: "Non sono stati individuati problemi nel segmento.",
  findings: [], memoryNote: "Prosa pubblica letta.",
});
function fillAll(book: BookProject, cycle: ChapterEditorialCycle): void {
  const chapter = book.chapters[0]!;
  const segments = chapterSegments(chapter);
  const roles = cycleRoles(book, cycle);
  for (let slot = cycle.reports.length; slot < roles.length * segments.length; slot++)
    cycle.reports.push(validateReport(cycle, roles[Math.floor(slot / segments.length)]!,
      segments[slot % segments.length]!, segments.length, pass(), chapter, book));
}

describe("Redazione leggera opt-in", () => {
  it("senza opzione usa sempre i 12 revisori", () => {
    const book = sample();
    expect(cycleRoles(book, createEditorialCycle("ch-1"))).toEqual(EDITORIAL_ROLES);
  });
  it("in modalità leggera usa 5 revisori in ordine canonico", () => {
    const book = sample();
    book.editorialMode = "light";
    const cycle = createEditorialCycle("ch-1");
    expect(cycleRoles(book, cycle)).toEqual(LIGHT_EDITORIAL_ROLES);
    expect(lightRolesFor(book.chapters[0]!)).toHaveLength(5);
    expect(assertEditorialReviewCoverage(book, cycle)).toMatchObject({ expectedCount: 10, segmentCount: 2 });
  });
  it("il ciclo conserva i propri revisori anche se la modalità del libro cambia", () => {
    const book = sample();
    book.editorialMode = "light";
    const cycle = createEditorialCycle("ch-1");
    cycle.roles = [...cycleRoles(book, cycle)];
    fillAll(book, cycle);
    delete book.editorialMode;
    expect(cycleRoles(book, cycle)).toEqual(LIGHT_EDITORIAL_ROLES);
    expect(nextReviewSlot(book, cycle)).toBeUndefined();
    expect(assertEditorialReviewCoverage(book, cycle, true).reportCount).toBe(10);
  });
  it("una copertura leggera incompleta blocca il giudice", () => {
    const book = sample();
    book.editorialMode = "light";
    const cycle = createEditorialCycle("ch-1");
    cycle.roles = [...cycleRoles(book, cycle)];
    expect(() => assertEditorialReviewCoverage(book, cycle, true)).toThrow(/Redazione incompleta/);
  });
  it("sanifica ruoli importati inventati e ricade sui 12", () => {
    const book = sample();
    const cycle = createEditorialCycle("ch-1");
    cycle.roles = ["__proto__", "hacker"] as never;
    expect(cycleRoles(book, cycle)).toEqual(EDITORIAL_ROLES);
    cycle.roles = ["style", "hacker", "continuity"] as never;
    expect(cycleRoles(book, cycle)).toEqual(["continuity", "style"]);
  });
});
