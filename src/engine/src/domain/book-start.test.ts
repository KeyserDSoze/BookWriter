import { describe, expect, it } from "vitest";
import {
  MAX_CHAPTER_SYNOPSIS_CHARS, MAX_SYNOPSIS_CHAPTERS, formatAuthorSynopsis,
  parseChapterSynopses, parseTargetChapterCount,
} from "./book-start";

describe("Lettura locale della sinossi capitolo per capitolo", () => {
  it("riconosce intestazioni «Capitolo N», romani maiuscoli, numeri in lettere e note iniziali", () => {
    const parsed = parseChapterSynopses([
      "Note generali: tono malinconico.",
      "",
      "Capitolo 1: L'arrivo",
      "Mara arriva al porto.",
      "Trova una lettera.",
      "Cap. II - La lettera",
      "La lettera parla del padre.",
      "## Capitolo terzo",
      "Il padre è vivo.",
    ].join("\n"));
    expect(parsed.format).toBe("headings");
    expect(parsed.problems).toEqual([]);
    expect(parsed.preamble).toBe("Note generali: tono malinconico.");
    expect(parsed.chapters).toEqual([
      { title: "L'arrivo", synopsis: "Mara arriva al porto.\nTrova una lettera." },
      { title: "La lettera", synopsis: "La lettera parla del padre." },
      { synopsis: "Il padre è vivo." },
    ]);
  });

  it("non scambia frasi come «Capitolo di transizione» per intestazioni", () => {
    const parsed = parseChapterSynopses("Capitolo di transizione in cui succede poco.\n\nUn altro paragrafo.");
    expect(parsed.format).toBe("paragraphs");
    expect(parsed.chapters).toHaveLength(2);
  });

  it("con intestazioni «Capitolo» un titolo Markdown iniziale resta una nota generale", () => {
    const parsed = parseChapterSynopses("# La mia sinossi\nCapitolo 1\nInizio.\nCapitolo 2\nFine.");
    expect(parsed.preamble).toBe("# La mia sinossi");
    expect(parsed.chapters.map(ch => ch.synopsis)).toEqual(["Inizio.", "Fine."]);
  });

  it("legge elenchi numerati separando un titolo breve", () => {
    const parsed = parseChapterSynopses("1. L'arrivo: Mara arriva.\n2) La fuga — Mara scappa\n   e si nasconde.");
    expect(parsed.format).toBe("numbered");
    expect(parsed.chapters).toEqual([
      { title: "L'arrivo", synopsis: "Mara arriva." },
      { title: "La fuga", synopsis: "Mara scappa\n   e si nasconde." },
    ]);
  });

  it("senza intestazioni usa i paragrafi separati da righe vuote", () => {
    const parsed = parseChapterSynopses("Primo capitolo: inizio.\r\n\r\nSecondo: svolta.\n\n\nTerzo: fine.");
    expect(parsed.format).toBe("paragraphs");
    expect(parsed.chapters.map(ch => ch.synopsis)).toEqual(["Primo capitolo: inizio.", "Secondo: svolta.", "Terzo: fine."]);
  });

  it("un titolo lungo dopo «Capitolo N:» diventa prosa e un capitolo senza testo usa il titolo", () => {
    const long = "Mara arriva al porto mentre infuria la tempesta e nessuno la aspetta, con una valigia piena di lettere mai spedite";
    const parsed = parseChapterSynopses(`Capitolo 1: ${long}\nCapitolo 2: Il ritorno`);
    expect(parsed.chapters).toEqual([{ synopsis: long }, { title: "Il ritorno", synopsis: "Il ritorno" }]);
  });

  it("segnala testo vuoto, capitoli troppo lunghi e troppi capitoli", () => {
    expect(parseChapterSynopses("  \n ").problems[0]).toMatch(/almeno un capitolo/);
    expect(parseChapterSynopses("Capitolo 1\n" + "x".repeat(MAX_CHAPTER_SYNOPSIS_CHARS + 1)).problems[0])
      .toMatch(/supera 4000 caratteri/);
    const many = Array.from({ length: MAX_SYNOPSIS_CHAPTERS + 1 }, (_, i) => `Capitolo ${i + 1}\nEvento ${i + 1}.`).join("\n");
    expect(parseChapterSynopses(many).problems.at(-1)).toMatch(/Massimo 80 capitoli/);
    expect(parseChapterSynopses("x".repeat(60_001)).problems[0]).toMatch(/supera 60000 caratteri/);
  });

  it("formatta l'elenco vincolante per i prompt", () => {
    expect(formatAuthorSynopsis([{ title: "Arrivo", synopsis: "Mara arriva." }, { synopsis: "Fine." }]))
      .toBe("1. Arrivo — Mara arriva.\n2. Fine.");
  });

  it("valida il numero di capitoli desiderato", () => {
    expect(parseTargetChapterCount("")).toBeUndefined();
    expect(parseTargetChapterCount(" 12 ")).toBe(12);
    expect(parseTargetChapterCount("0")).toBe("invalid");
    expect(parseTargetChapterCount("81")).toBe("invalid");
    expect(parseTargetChapterCount("dieci")).toBe("invalid");
  });
});
