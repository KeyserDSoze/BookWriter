import { describe, expect, it } from "vitest";
import { newBook } from "./types";
import { projectBook, slugify } from "./narrarium";

describe("Proiezione deterministica Narrarium", () => {
  it("crea gerarchia del libro con metadati per capitoli, scene, segreti e timeline", () => {
    const book = newBook("Un mistero a Roma", "La città nascosta", "Visuale e concreto", "Lettori esigenti");
    book.chapters.push({
      id: "chapter:001", number: 1, title: "L'ultima via", purpose: "Un arrivo pericoloso",
      scenes: [{
        id: "scene:001:001", number: 1, title: "Là dove tutto inizia",
        objective: "L'eroe perde un indizio", text: "«Vieni», disse Mara.\n\nEra già tardi.",
        status: "canon", characters: ["character:mara"], locations: ["location:roma"],
        secret_refs: ["secret:lettera"],
      }],
    });
    book.memory.secrets.lettera = "Mara nasconde una lettera di famiglia";
    book.memory.timeline = ["Primo giorno a Roma"];
    const projected = projectBook(book, []);
    expect(projected.files["book.md"]).toContain("La città nascosta");
    expect(projected.files["chapters/001-l-ultima-via/001-la-dove-tutto-inizia.md"]).toContain('"secret:lettera"');
    expect(projected.files["secrets/lettera.md"]).toContain("Mara nasconde");
    expect(projected.files["timelines/main.md"]).toContain("Primo giorno");
    expect(projected.manifest.paths).toContain(".bookwriter/project.json");
    expect(projected.manifest.paths).toContain("chapters/001-l-ultima-via/chapter.md");
  });

  it("non include credenziali GitHub o metadati locali di sync nel canon", () => {
    const book = newBook("Un libro", "Prova", "Teso", "Adulti");
    book.remote = {
      owner: "someone", repository: "repo", branch: "main",
      lastSyncedCommit: "abc123", lastSyncedLocalUpdatedAt: book.updatedAt,
    };
    const output = projectBook(book, []);
    const all = JSON.stringify(output.files);
    expect(all).not.toContain("lastSyncedCommit");
    expect(all).not.toContain("abc123");
    expect(output.files[".bookwriter/project.json"]).not.toContain('"remote"');
  });

  it("normalizza i titoli in path sicuri con numerazione stabile", () => {
    expect(slugify("../../L'Île: nuova storia!")).toBe("l-ile-nuova-storia");
  });
});
