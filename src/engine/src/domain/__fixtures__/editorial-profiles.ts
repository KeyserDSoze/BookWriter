import { newBook } from "../types";
import { defaultEditorialProfiles } from "../editorial-profiles";

export function profileBook() {
  const book = newBook("Un porto misterioso.", "Profilo sintetico", "Sobrio", "Adulti");
  book.phase = "prose";
  book.chapters = [{ id: "chapter:001", number: 1, title: "Il molo", purpose: "Incontrare Mara.", scenes: [
    { id: "scene:001:001", number: 1, title: "Arrivo", objective: "Un incontro", status: "canon", text: "Mara attraversa il porto e osserva la nave silenziosa." },
  ] }];
  book.memory.secrets.private = "PRIVATE_CANON_SENTINEL";
  book.editorialProfiles = defaultEditorialProfiles();
  book.editorialProfiles.readers[0]!.name = "Lettrice attenta alla noia";
  book.editorialProfiles.readers[0]!.instructions = "READER_ONE_ONLY: valuta dove cala l'interesse senza chiedere informazioni superflue.";
  book.editorialProfiles.readers.push({ id: "extra-reader", role: "readerExtra1", enabled: true, name: "Lettore dei dialoghi",
    instructions: "EXTRA_READER_ONLY: valuta dialoghi e sottotesto." });
  book.editorialProfiles.writers = [{ id: "show-writer", name: "Scrittore essenziale", strength: "strict", reviewEnabled: true,
    writingPrompt: "WRITER_ONLY: mostra azioni e dialoghi; niente spiegazioni ridondanti o informazioni inutili.",
    reviewPrompt: "WRITER_REVIEW_ONLY: cita spiegazioni superflue e valuta se sono davvero necessarie." }];
  book.editorialProfiles.selectedWriterId = "show-writer";
  return book;
}
