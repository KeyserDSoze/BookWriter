import { describe, expect, it } from "vitest";
import { createEditorialCycle } from "./editorial-board";
import {
  assertCurrentHistoricalPromptDossier, captureHistoricalPromptDossier,
  type ChapterHistoricalDossier,
} from "./historical-research";
import { newBook, type BookProject } from "./types";

const stamp = "2026-11-11T18:30:00.000Z";
function dossier(): ChapterHistoricalDossier {
  return {
    queries: ["Telegrafo in Italia 1848"],
    sources: [{
      id: "itwiki:42:210", provider: "it.wikipedia.org",
      pageId: 42, revisionId: 210, title: "Cronache della linea",
      url: "https://it.wikipedia.org/wiki/Telegrafo",
      excerpt: "Il telegrafo compare in una cronaca datata 1848, da verificare.",
      query: "Telegrafo in Italia 1848", retrievedAt: stamp,
    }],
    activeSourceIds: ["itwiki:42:210"],
    searchedAt: stamp, unansweredQueries: [],
  };
}
function fixture(): BookProject {
  const book = newBook("Romanzo ambientato nel 1848.", "Il telegrafo", "Prosa sobria", "Adulti");
  book.phase = "chapterReview";
  book.chapters = [{
    id: "chapter-1", number: 1, title: "La linea", purpose: "Ambientazione",
    scenes: [{
      id: "scene-1", number: 1, title: "La notizia", objective: "Comunicare",
      text: "Mara corre verso il telegrafo in una città del 1848.",
      status: "canon",
    }],
    historicalDossier: dossier(),
  }];
  book.editorialCycle = createEditorialCycle("chapter-1");
  return book;
}

describe("Freschezza del dossier storico del revisore e del giudice", () => {
  it("accetta dossier e checkpoint identici, anche se il libro non ha fonti", () => {
    const book = fixture();
    const expected = captureHistoricalPromptDossier(book, "chapter-1", "review");
    const before = structuredClone(book);
    expect(() => assertCurrentHistoricalPromptDossier(book, expected)).not.toThrow();
    expect(book).toEqual(before);
    book.chapters[0]!.historicalDossier = undefined;
    const empty = captureHistoricalPromptDossier(book, "chapter-1", "review");
    expect(() => assertCurrentHistoricalPromptDossier(book, empty)).not.toThrow();
    expect(() => assertCurrentHistoricalPromptDossier(book, expected))
      .toThrow(/Fonti storiche cambiate/);
  });

  it("rifiuta ogni cambiamento del contesto, inclusi estratto, revisione, attivi e provenienza", () => {
    const mutations: Array<(book: BookProject) => void> = [
      book => { book.chapters[0]!.historicalDossier!.sources[0]!.excerpt += " Testo alterato."; },
      book => { book.chapters[0]!.historicalDossier!.sources[0]!.revisionId = 211; },
      book => { book.chapters[0]!.historicalDossier!.activeSourceIds = []; },
      book => { book.chapters[0]!.historicalDossier!.queries.push("Una nuova ricerca pubblica"); },
      book => { book.chapters[0]!.historicalDossier!.sourceRelations = [{
        id: "srcrel:1794421800000:0", sourceAId: "itwiki:1:1",
        sourceBId: "itwiki:2:2", relation: "derived",
        note: "Nota di provenienza diversa inserita durante la chiamata.",
        recordedAt: stamp,
      }]; },
      book => { book.chapters[0]!.historicalDossier = undefined; },
    ];
    for (const mutate of mutations) {
      const book = fixture();
      const expected = captureHistoricalPromptDossier(book, "chapter-1", "review");
      mutate(book);
      const before = structuredClone(book);
      expect(() => assertCurrentHistoricalPromptDossier(book, expected))
        .toThrow(/Fonti storiche cambiate/);
      expect(book).toEqual(before);
    }
  });

  it("rifiuta il cambiamento di fase, capitolo, stage, tornata e prefisso report", () => {
    const mutations: Array<(book: BookProject) => void> = [
      book => { book.phase = "prose"; },
      book => { book.editorialCycle!.stage = "adjudicate"; },
      book => { book.editorialCycle!.chapterId = "altro-capitolo"; },
      book => { book.editorialCycle!.round = 2; },
      book => { book.editorialCycle!.reports.push({} as never); },
      book => { book.chapters[0]!.frozenAt = stamp; },
      book => { book.editorialCycle = undefined; },
    ];
    for (const mutate of mutations) {
      const book = fixture();
      const expected = captureHistoricalPromptDossier(book, "chapter-1", "review");
      mutate(book);
      const before = structuredClone(book);
      expect(() => assertCurrentHistoricalPromptDossier(book, expected))
        .toThrow(/Checkpoint delle fonti storiche|Fonti storiche cambiate/);
      expect(book).toEqual(before);
    }
  });

  it("il giudice rifiuta un dossier obsoleto senza cambiare il verdetto", () => {
    const book = fixture();
    book.editorialCycle!.stage = "adjudicate";
    const snapshot = captureHistoricalPromptDossier(book, "chapter-1", "adjudicate");
    expect(() => assertCurrentHistoricalPromptDossier(book, snapshot)).not.toThrow();
    book.chapters[0]!.historicalDossier!.sources[0]!.title = "Fonte corretta manualmente";
    const before = structuredClone(book);
    let failure: unknown;
    try { assertCurrentHistoricalPromptDossier(book, snapshot); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/Fonti storiche cambiate/);
    expect((failure as Error).message).not.toContain("Fonte corretta manualmente");
    expect((failure as Error).message).not.toContain("1848");
    expect(book).toEqual(before);
  });
});
