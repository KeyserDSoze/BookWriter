import { describe, expect, it } from "vitest";
import { newBook } from "./types";
import { githubPublicationBlocker } from "./github-publication";

describe("Salvataggio su GitHub di un libro in lavorazione", () => {
  it("un libro scritto ma non congelato, in revisione o con un ciclo editoriale si salva", () => {
    const book = newBook("Idea", "Titolo", "", "");
    book.phase = "chapterReview";
    book.chapters = [{ id: "ch-1", number: 1, title: "Capitolo", purpose: "Uno scopo narrativo.", scenes: [
      { id: "scene-1", number: 1, title: "Scena", objective: "Uno scopo narrativo.", text: "Prosa locale da conservare.", status: "canon" },
      { id: "scene-2", number: 2, title: "Altra", objective: "Un altro scopo narrativo.", text: "Bozza.", status: "draft" },
    ] }];
    const before = structuredClone(book);
    expect(githubPublicationBlocker(book)).toBeUndefined();
    book.phase = "revision";
    expect(githubPublicationBlocker(book)).toBeUndefined();
    expect(book).toEqual({ ...before, phase: "revision" });
    book.chapters[0]!.frozenAt = new Date().toISOString();
    expect(githubPublicationBlocker(book)).toBeUndefined();
  });

  it("l'unico blocco rimasto sono le scene fuse in attesa di conferma dell'autore", () => {
    const book = newBook("Idea", "Titolo", "", "");
    expect(githubPublicationBlocker(book)).toBeUndefined();
    book.editorialReviewSceneIds = ["scene-1"];
    expect(githubPublicationBlocker(book)).toContain("scene fuse");
    book.editorialReviewSceneIds = [];
    expect(githubPublicationBlocker(book)).toBeUndefined();
  });
});
