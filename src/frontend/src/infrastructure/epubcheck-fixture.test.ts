import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { newBook, type BookProject, type Chapter, type Scene } from "../domain/types";
import { buildEpub } from "./export-book";

const modified = new Date("2026-11-09T13:42:15.000Z");
const privateMarkers = [
  "BRIEF-PRIVATO-MAI-ESPORTARE",
  "MEMORIA-PRIVATA-MAI-ESPORTARE",
  "PROSA-BOZZA-MAI-ESPORTARE",
  "PROSA-DRAFT-MAI-ESPORTARE",
  "PROSA-PLANNED-MAI-ESPORTARE",
];

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
function book(index: number, title: string, chapters: Chapter[]): BookProject {
  const instance = newBook("BRIEF-PRIVATO-MAI-ESPORTARE", title, "Lirico", "Adulti");
  instance.id = "00000000-0000-4000-8000-" + String(index).padStart(12, "0");
  instance.memory.secrets["finale"] = "MEMORIA-PRIVATA-MAI-ESPORTARE";
  instance.chapters = chapters;
  return instance;
}

/** All names are fixed, no author-provided filenames. Every variant uses buildEpub. */
const fixtures: Array<{
  name: string;
  project: () => BookProject;
  chapterNumbers: number[];
  sceneCount: number;
  text: string[];
}> = [
  {
    name: "mixed-canon-draft",
    project: () => book(64, "La città & il tempo <lontano> ✨", [
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
    ]),
    chapterNumbers: [2, 4],
    sceneCount: 3,
    text: ["La città si risvegliò. 🌟 &amp; &lt;ombra&gt;", "L’alba arrivò."],
  },
  {
    name: "late-first-chapter",
    project: () => book(65, "Un'ombra & <inizio> 🪶", [
      chapter(1, "Prologo non canonico", [
        scene(1, "draft", "Solo appunti", "PROSA-BOZZA-MAI-ESPORTARE"),
      ]),
      chapter(3, "Una parte pianificata", [
        scene(1, "planned", "Mai composta", "PROSA-PLANNED-MAI-ESPORTARE"),
      ]),
      chapter(17, "Il primo capitolo pubblicato", [
        scene(1, "draft", "Ipotesi", "PROSA-DRAFT-MAI-ESPORTARE"),
        scene(2, "canon", "La soglia", "La porta si aprì, finalmente."),
      ]),
    ]),
    chapterNumbers: [17],
    sceneCount: 1,
    text: ["Capitolo 17", "La porta si aprì"],
  },
  {
    name: "unicode-and-xml-safety",
    project: () => book(66, "天空 — ليلى & “città” \uD800", [
      chapter(9, "Luoghi <misteriosi> \u0001 & \uDC00", [
        scene(1, "canon", "Un titolo 🏛️ & <segno>", "中文, العربية, ελληνικά, italiano: è già qui.\n\nEmoji 🌊 e \u0007 un'eco \uD800."),
        scene(2, "canon", "Una seconda voce", "L'acqua & la montagna.\nLinea nuova <lontana>."),
        scene(3, "planned", "Inedita", "PROSA-PLANNED-MAI-ESPORTARE"),
      ]),
    ]),
    chapterNumbers: [9],
    sceneCount: 2,
    text: ["中文, العربية, ελληνικά", "Emoji 🌊", "L&#39;acqua &amp; la montagna"],
  },
  {
    name: "long-multi-chapter",
    project: () => book(67, "Romanzo lungo — città & destino", Array.from({ length: 6 }, (_, i) =>
      chapter(i + 1, "Tappa " + (i + 1) + ' & "ritorno"', [
        scene(1, "canon", "Incontro " + (i + 1), ("Il vento attraversò la strada. ").repeat(130)),
        scene(2, "draft", "Note riservate", "PROSA-DRAFT-MAI-ESPORTARE"),
        scene(3, "canon", "Risposta " + (i + 1), "La storia continua, e ogni voce trova spazio."),
      ]),
    )),
    chapterNumbers: [1, 2, 3, 4, 5, 6],
    sceneCount: 12,
    text: ["Il vento attraversò la strada.", "La storia continua"],
  },
];

describe("matrice EPUB per il validatore ufficiale W3C", () => {
  it.each(fixtures)("genera e controlla $name, senza scrittura salvo opt-in", (fixture) => {
    const project = fixture.project();
    const bytes = buildEpub(project, modified);
    const files = unzipSync(bytes);
    expect(decode(files, "mimetype")).toBe("application/epub+zip");
    const nav = decode(files, "OEBPS/nav.xhtml");
    const opf = decode(files, "OEBPS/content.opf");
    const titlepage = decode(files, "OEBPS/titlepage.xhtml");
    expect(titlepage).toContain('epub:type="titlepage"');
    expect(opf).toContain('<itemref idref="titlepage"/>');
    expect(nav).toContain('<nav epub:type="toc"');
    expect(nav).toContain('<nav epub:type="landmarks"');
    expect(nav).toContain('<a epub:type="bodymatter" href="chapter-1.xhtml">Inizio del libro</a>');

    const chapters = Object.keys(files).filter(path => /^OEBPS\/chapter-\d+\.xhtml$/.test(path));
    expect(chapters).toHaveLength(fixture.chapterNumbers.length);
    const spine = [...opf.matchAll(/<itemref idref="chapter-\d+"\/>/g)].map(match => match[0]);
    expect(spine).toEqual(fixture.chapterNumbers.map((_, i) =>
      '<itemref idref="chapter-' + (i + 1) + '"/>'));
    for (const [index, original] of fixture.chapterNumbers.entries()) {
      expect(nav).toContain('href="chapter-' + (index + 1) + '.xhtml">Capitolo ' + original);
    }
    const all = Object.values(files).map(value => strFromU8(value)).join("\n");
    const sections = chapters.reduce((sum, path) =>
      sum + (decode(files, path).match(/<section id="scene-\d+"/g) ?? []).length, 0);
    expect(sections).toBe(fixture.sceneCount);
    for (const content of fixture.text) expect(all).toContain(content);
    for (const privateText of privateMarkers) expect(all).not.toContain(privateText);
    expect(all).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u);
    expect(all).not.toContain("Capitolo di sole bozze");
    expect(all).not.toContain("Capitolo solo pianificato");

    // Normal unit tests only allocate bytes. CI opts in via a dedicated output directory.
    const outputDir = process.env.EPUBCHECK_OUTPUT_DIR;
    if (outputDir) {
      writeFileSync(join(outputDir, fixture.name + ".epub"), bytes);
      expect(bytes.byteLength).toBeGreaterThan(200);
    }
  });
});
