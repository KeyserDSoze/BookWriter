import { describe, expect, it } from "vitest";
import { newBook } from "./types";
import { githubPublicationBlocker } from "./github-publication";

describe("Collegamento distinto dalla pubblicazione editoriale", () => {
  it("un libro locale già scritto rimane collegabile, ma spiega il gate di pubblicazione", () => {
    const book = newBook("Idea", "Titolo", "", "");
    book.phase = "chapterReview";
    book.chapters = [{ id: "ch-1", number: 1, title: "Capitolo", purpose: "Uno scopo narrativo.", scenes: [
      { id: "scene-1", number: 1, title: "Scena", objective: "Uno scopo narrativo.", text: "Prosa locale da conservare.", status: "canon" },
    ] }];
    const before = structuredClone(book);
    expect(githubPublicationBlocker(book)).toContain("Completa la redazione");
    expect(book).toEqual(before);
    book.chapters[0]!.frozenAt = new Date().toISOString();
    expect(githubPublicationBlocker(book)).toBeUndefined();
  });

  it("distingue piano non ancora scritto, revisioni e scene fuse da approvare", () => {
    const book = newBook("Idea", "Titolo", "", "");
    expect(githubPublicationBlocker(book)).toBeUndefined();
    book.phase = "revision";
    expect(githubPublicationBlocker(book)).toContain("revisione in corso");
    book.editorialReviewSceneIds = ["scene-1"];
    expect(githubPublicationBlocker(book)).toContain("scene fuse");
  });
});
