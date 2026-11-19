import { describe, expect, it } from "vitest";
import type { Chapter } from "./types";
import { synopsisBeforeChapter } from "./editorial-summary";

const chapter = (number: number, summary: string, snapshot?: string): Chapter => ({
  id: "ch-" + number, number, title: "Capitolo " + number, purpose: "Continuare",
  scenes: [], frozenAt: "2026-11-05T00:00:00.000Z", summary,
  ...(snapshot === undefined ? {} : { bookSummaryAtFreeze: snapshot }),
});

describe("Ripristino delle sinossi dopo modifiche retroattive", () => {
  it("usa l'ultima fotografia globale congelata, senza ricostruire o troncare", () => {
    const veryLong = "Indizio antico. ".repeat(800);
    const chapters = [chapter(1,"L'inizio.", veryLong),chapter(2,"Seconda scena.",veryLong+" Nuovo evento.")];
    expect(synopsisBeforeChapter(chapters,2)).toBe(veryLong);
    expect(synopsisBeforeChapter(chapters,3)).toBe(veryLong+" Nuovo evento.");
    expect(synopsisBeforeChapter(chapters,1)).toBe("");
  });
  it("con romanzi legacy senza snapshot unisce tutte le sinossi, ma soltanto senza perdita", () => {
    const chapters=[chapter(1,"Indizio A."),chapter(2,"Indizio B.")];
    expect(synopsisBeforeChapter(chapters,3)).toBe("Indizio A.\nIndizio B.");
  });
  it("blocca il rewind legacy se non può garantire l'integrità della sinossi", () => {
    const chapters=[chapter(1,"Indizio essenziale. ".repeat(600)),chapter(2,"Qualcosa.")];
    expect(() => synopsisBeforeChapter(chapters,3)).toThrow(/non verranno troncate/);
    expect(chapters[0]?.frozenAt).toBeDefined();
  });
  it("rifiuta riassunti legacy mancanti, invece di cancellare indizi", () => {
    const one=chapter(1,"Riassunto");
    one.summary=undefined;
    expect(() => synopsisBeforeChapter([one],2)).toThrow(/manca/);
  });
  it("ignora capitoli non congelati e ordinamento fisico", () => {
    const chunks=[chapter(3,"Tre","A+B+C"),chapter(1,"Uno","A"),chapter(2,"Due","A+B")];
    chunks[0]!.frozenAt=undefined;
    expect(synopsisBeforeChapter(chunks,4)).toBe("A+B");
  });
});
