import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { newBook, type Chapter, type Scene } from "../domain/types";
import { buildEpub } from "./export-book";

/** A synthetic, representative book. Never use authors' actual IndexedDB data in CI. */
function scene(number: number, status: Scene["status"], title: string, text: string): Scene {
  return { id: crypto.randomUUID(), number, status, title, text, objective: "Scena sintetica" };
}
function chapter(number: number, title: string, scenes: Scene[]): Chapter {
  return { id: crypto.randomUUID(), number, title, scenes, purpose: "Capitolo sintetico" };
}
function decode(files: Record<string, Uint8Array>, name: string): string {
  const bytes = files[name];
  if (!bytes) throw new Error("Risorsa EPUB mancante nel campione: " + name);
  return strFromU8(bytes);
}

describe("campione EPUB per il validatore ufficiale W3C", () => {
  it("esporta scene canoniche XML-safe e scrive un file solo con opt-in esplicito della CI", () => {
    const book = newBook("BRIEF-PRIVATO-MAI-ESPORTARE", "La città & il tempo <lontano> ✨", "Lirico", "Adulti");
    book.id = "00000000-0000-4000-8000-000000000063";
    book.memory.secrets["finale"] = "MEMORIA-PRIVATA-MAI-ESPORTARE";
    book.chapters = [
      chapter(1, "Capitolo di sole bozze", [
        scene(1, "draft", "Da rivedere", "PROSA-BOZZA-MAI-ESPORTARE"),
      ]),
      chapter(2, "Il viaggio & la notte", [
        scene(1, "canon", 'Prima "luce"', "La città si risvegliò. 🌟 & <ombra>\nRiga successiva.\n\nIl vento tornò.\u0001"),
        scene(2, "draft", "Scena privata", "PROSA-DRAFT-MAI-ESPORTARE"),
        scene(3, "canon", "Ultima & <voce>", "Un secondo incontro, poi la strada."),
        scene(4, "canon", "Scena vuota", "   "),
      ]),
      chapter(3, "Capitolo solo pianificato", [
        scene(1, "planned", "Da scrivere", "PROSA-PLANNED-MAI-ESPORTARE"),
      ]),
      chapter(4, "Il ritorno", [
        scene(1, "canon", "Conclusione", "L’alba arrivò. Fine della storia."),
      ]),
    ];

    const epub = buildEpub(book, new Date("2026-11-09T13:42:15.000Z"));
    const files = unzipSync(epub);
    expect(decode(files, "mimetype")).toBe("application/epub+zip");
    const nav = decode(files, "OEBPS/nav.xhtml");
    const opf = decode(files, "OEBPS/content.opf");
    expect(opf).toContain('<itemref idref="titlepage"/>');
    expect(opf).toContain('<itemref idref="chapter-1"/>');
    expect(opf).toContain('<itemref idref="chapter-2"/>');
    expect(nav).toContain('<a epub:type="bodymatter" href="chapter-1.xhtml">Inizio del libro</a>');
    expect(nav).toContain('href="chapter-1.xhtml#scene-2"');
    const all = Object.values(files).map(value => strFromU8(value)).join("\n");
    expect(all).toContain("La città si risvegliò. 🌟 &amp; &lt;ombra&gt;");
    expect(all).toContain("L’alba arrivò.");
    expect(all).not.toContain("\u0001");
    for (const forbidden of [
      "BRIEF-PRIVATO-MAI-ESPORTARE", "MEMORIA-PRIVATA-MAI-ESPORTARE",
      "PROSA-BOZZA-MAI-ESPORTARE", "PROSA-DRAFT-MAI-ESPORTARE",
      "PROSA-PLANNED-MAI-ESPORTARE", "Capitolo di sole bozze",
      "Capitolo solo pianificato", "Scena vuota",
    ]) expect(all).not.toContain(forbidden);

    // Normal unit tests never write a file. The official-check job explicitly opts in.
    const output = process.env.EPUBCHECK_OUTPUT;
    if (output) {
      writeFileSync(output, epub);
      expect(epub.byteLength).toBeGreaterThan(200);
    }
  });
});
