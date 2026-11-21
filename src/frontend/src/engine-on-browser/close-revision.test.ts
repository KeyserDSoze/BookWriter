import { describe, expect, it } from "vitest";
import { newBook, type BookProject, type Phase } from "@engine/domain/types";
import { closeRevision } from "@engine/application/autopilot";

function interrupted(beforePhase: Phase, status: "canon" | "draft"): BookProject {
  const book = newBook("Il porto.", "Il porto", "Sobrio", "Adulti");
  book.chapters = [{ id: "ch-1", number: 1, title: "Il porto", purpose: "Inizio del libro", scenes: [
    { id: "s-1", number: 1, title: "Arrivo", objective: "Arrivare al porto", status, text: "Mara scende dalla nave." },
    { id: "s-2", number: 2, title: "Lettera", objective: "Leggere la lettera", status: "planned", text: "" },
  ] }];
  book.currentSceneId = "s-1";
  book.phase = "revision";
  book.revision = { id: "r-1", instruction: "Mara arriva di notte", beforePhase, affectedSceneIds: [], cursor: 0 };
  return book;
}

describe("Chiusura di una revisione che ha interrotto una scena", () => {
  it("riprende l'aggiornamento della memoria della scena canonica rimasto in sospeso", () => {
    const book = interrupted("consolidate", "canon");
    closeRevision(book, book.revision!);
    expect(book.revision).toBeUndefined();
    expect(book.phase).toBe("consolidate");
    expect(book.currentSceneId).toBe("s-1");
  });
  it("riprende la revisione finale di una bozza invece di riscriverla da capo", () => {
    const book = interrupted("review", "draft");
    closeRevision(book, book.revision!);
    expect(book.phase).toBe("review");
    expect(book.currentSceneId).toBe("s-1");
  });
  it("torna a scrivere quando la scena non è più nello stato atteso", () => {
    const book = interrupted("review", "canon");
    closeRevision(book, book.revision!);
    expect(book.phase).toBe("prose");
    expect(book.currentSceneId).toBeUndefined();
  });
});
