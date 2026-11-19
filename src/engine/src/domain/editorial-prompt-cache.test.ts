import { describe, expect, it } from "vitest";
import { newBook } from "./types";
import { EDITORIAL_ROLES, chapterSegments, createEditorialCycle, reviewerPrompt } from "./editorial-board";

describe("Prompt dei revisori adatti alla cache del prefisso", () => {
  it("le istruzioni generiche sono identiche per i ruoli non storici e il ruolo è l'ultima parte", () => {
    const book = newBook("Il porto", "Brief", "Sobrio", "Adulti");
    book.chapters = [{ id: "ch-1", number: 1, title: "Il porto", purpose: "Inizio", scenes: [
      { id: "s-1", number: 1, title: "Arrivo", objective: "Arrivare", status: "canon",
        text: "Mara scende dalla nave e trova una lettera sul molo." }] }];
    const cycle = createEditorialCycle("ch-1");
    const segment = chapterSegments(book.chapters[0]!)[0]!;
    const systems = EDITORIAL_ROLES.filter(role => role !== "historical")
      .map(role => reviewerPrompt(book, cycle, role, segment, 1).system);
    const [first, ...others] = systems;
    let common = first!.length;
    for (const other of others) {
      let i = 0;
      while (i < common && i < other.length && first![i] === other[i]) i++;
      common = i;
    }
    expect(common).toBeGreaterThan(2500);
    for (const system of systems) {
      expect(Math.abs(system.indexOf("RUOLO ASSEGNATO A QUESTA CHIAMATA") - common)).toBeLessThan(40);
      expect(system).toContain("INDIPENDENTE");
    }
  });
});
