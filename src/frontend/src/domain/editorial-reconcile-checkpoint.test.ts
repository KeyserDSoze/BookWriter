import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import {
  assertCurrentEditorialReconcileStep,
  captureEditorialReconcileStep,
  createEditorialCycle,
} from "./editorial-board";

function fixture(): BookProject {
  const book = newBook("Una storia privata.", "Il guardiano", "Narrativo", "Adulti");
  book.phase = "chapterReview";
  book.memory.currentState = "Mara è al castello e cerca una porta.";
  book.memory.secrets.chiave = "La chiave rivela un passaggio nascosto.";
  book.chapters = [{
    id: "chapter-1", number: 1, title: "Il castello", purpose: "Inizio",
    scenes: [{
      id: "scene-1", number: 1, title: "La porta", objective: "Entrare",
      text: "Mara trova il guardiano davanti alla porta del castello.",
      status: "draft",
    }],
  }];
  book.editorialCycle = createEditorialCycle("chapter-1");
  book.editorialCycle.stage = "reconcile";
  book.editorialCycle.reconcileCursor = 0;
  return book;
}

describe("Riconciliazione della memoria dopo remediation — checkpoint live", () => {
  it("accetta il solo checkpoint esatto ed espone il capitolo corrente, senza mutazioni", () => {
    const book = fixture();
    const before = structuredClone(book);
    const expected = captureEditorialReconcileStep(book);
    const current = assertCurrentEditorialReconcileStep(book, expected);
    expect(current.cycle).toBe(book.editorialCycle);
    expect(current.chapter).toBe(book.chapters[0]);
    expect(expected).toMatchObject({
      chapterId: "chapter-1", cursor: 0, segmentCount: 1, sceneId: "scene-1",
      segmentText: "Mara trova il guardiano davanti alla porta del castello.",
    });
    expect(book).toEqual(before);
  });

  it("rifiuta testo, status, ordine, titolo e aggiunta scena cambiati durante la risposta AI", () => {
    const changes: Array<(book: BookProject) => void> = [
      book => { book.chapters[0]!.scenes[0]!.text += " Non è più la stessa scena."; },
      book => { book.chapters[0]!.scenes[0]!.status = "canon"; },
      book => { book.chapters[0]!.scenes[0]!.title = "Titolo modificato"; },
      book => { book.chapters[0]!.scenes[0]!.number = 2; },
      book => { book.chapters[0]!.scenes.push({
        id: "scene-2", number: 2, title: "Altrove", objective: "Continuare",
        text: "Altra scena non presente nella richiesta.", status: "draft",
      }); },
    ];
    for (const change of changes) {
      const book = fixture();
      const snapshot = captureEditorialReconcileStep(book);
      change(book);
      const before = structuredClone(book);
      expect(() => assertCurrentEditorialReconcileStep(book, snapshot))
        .toThrow(/Riconciliazione obsoleta/);
      expect(book).toEqual(before);
    }
  });

  it("rifiuta memoria narrativa o segreti mutati; l'errore non riporta il dato privato", () => {
    const book = fixture();
    const snapshot = captureEditorialReconcileStep(book);
    book.memory.secrets.chiave = "NUOVO SEGRETO RISERVATO";
    const before = structuredClone(book);
    let failure: unknown;
    try { assertCurrentEditorialReconcileStep(book, snapshot); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/Riconciliazione obsoleta/);
    expect((failure as Error).message).not.toContain("NUOVO SEGRETO RISERVATO");
    expect((failure as Error).message).not.toContain("passaggio nascosto");
    expect(book).toEqual(before);
  });

  it("rifiuta cambi di capitolo, fase, stage e cursore invece di aggiornare la memoria", () => {
    const mutations: Array<(book: BookProject) => void> = [
      book => { book.phase = "prose"; },
      book => { book.editorialCycle!.stage = "summary"; },
      book => { book.editorialCycle!.chapterId = "altro-capitolo"; },
      book => { book.editorialCycle!.reconcileCursor = 1; },
      book => { book.editorialCycle!.reconcileCursor = undefined; },
      book => { book.editorialCycle!.reconcileCursor = Number.NaN; },
      book => { book.chapters[0]!.frozenAt = new Date().toISOString(); },
      book => { book.editorialCycle = undefined; },
    ];
    for (const mutate of mutations) {
      const book = fixture();
      const snapshot = captureEditorialReconcileStep(book);
      mutate(book);
      const before = structuredClone(book);
      expect(() => assertCurrentEditorialReconcileStep(book, snapshot))
        .toThrow(/Checkpoint di riconciliazione|Riconciliazione obsoleta/);
      expect(book).toEqual(before);
    }
  });

  it("rifiuta checkpoint legacy senza cursore prima di costruire un prompt AI", () => {
    const book = fixture();
    book.editorialCycle!.reconcileCursor = undefined;
    expect(() => captureEditorialReconcileStep(book))
      .toThrow(/Checkpoint di riconciliazione non valido/);
  });

  it("valida solo il segmento corrente di una riconciliazione multi-segmento", () => {
    const book = fixture();
    book.chapters[0]!.scenes[0]!.text = "La porta del castello è chiusa. ".repeat(400);
    const first = captureEditorialReconcileStep(book);
    expect(first.segmentCount).toBeGreaterThan(1);
    book.editorialCycle!.reconcileCursor = 1;
    const second = captureEditorialReconcileStep(book);
    expect(second.cursor).toBe(1);
    expect(second.segmentText).not.toBe(first.segmentText);
    expect(() => assertCurrentEditorialReconcileStep(book, first))
      .toThrow(/Riconciliazione obsoleta/);
    expect(assertCurrentEditorialReconcileStep(book, second).cycle)
      .toBe(book.editorialCycle);
  });
});
