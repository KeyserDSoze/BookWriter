import { describe, expect, it } from "vitest";
import { syntheticNarrarium } from "./__fixtures__/narrarium";
import { readNarrarium } from "./narrarium-reader";
import { projectBook } from "./narrarium";
import { readMarkdownDocument, validMarkdownSource, writeMarkdownDocument } from "./markdown-document";
import { newBook } from "./types";
import { chapterSegments, createEditorialCycle, EDITORIAL_ROLES, reviewerPrompt } from "./editorial-board";
import { summarizeBook } from "./cloud-profile";
import { readFileSync } from "node:fs";

const read = (files = syntheticNarrarium) => readNarrarium(files, "7ed7ead8-673a-44d0-9637-1455fc9ed205", "2026-11-14T12:00:00.000Z");
const scenePath = "chapters/001-arrivo/001-il-molo.md";

describe("Contratto Markdown indipendente dall'operatore", () => {
  it("gli esempi pubblicati nella guida formano davvero un libro importabile", () => {
    const guide = readFileSync(new URL("../../../../docs/markdown-book-format.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const examples = Object.fromEntries([...guide.matchAll(/`([^`\n]+\.md)`:\n\n```markdown\n([\s\S]*?)\n```/g)]
      .map(match => [match[1]!, match[2]!]));
    expect(Object.keys(examples)).toHaveLength(5);
    expect(read(examples).chapters[0]!.scenes[0]!.viewpoint).toBe("character:mara");
  });
  it("legge solo file manuali, prosa esatta, ID testuali, liste e schede senza snapshot o AI", () => {
    const book = read();
    expect(book.title).toBe("Il porto di prova");
    expect(book.chapters[0]!.id).toBe("chapter:arrivo");
    expect(book.chapters[0]!.scenes[0]!.text).toBe(readMarkdownDocument(syntheticNarrarium[scenePath]!).body);
    expect(book.chapters[0]!.scenes[0]!.viewpoint).toBe("character:mara");
    expect(book.memory.characters.Mara).toContain("Una navigatrice");
    expect(book.memory.timeline).toEqual([syntheticNarrarium["timeline/events.md"]]);
    expect(book.status).toBe("paused");
    expect(book.chapters[0]!.frozenAt).toBeUndefined();
    expect(book.editorialCycle).toBeUndefined();
    expect(book.remote).toBeUndefined();
    expect(book.modelRoutes).toBeUndefined();
  });

  it("riscrive dati leggibili senza perdere note extra, frontmatter, ID o prosa", () => {
    const book = read();
    const files = projectBook(book, []).files;
    const scene = readMarkdownDocument(files[scenePath]!);
    expect(scene.metadata.custom_label).toBe("Scritto a mano");
    expect(scene.metadata.id).toBe("scene:arrivo:molo");
    expect(scene.metadata.pov).toBe("character:mara");
    expect(scene.body).toBe(book.chapters[0]!.scenes[0]!.text);
    expect(files["reviews/sinossi-autore.md"]).toBe(syntheticNarrarium["reviews/sinossi-autore.md"]);
    const md = Object.fromEntries(Object.entries(files).filter(([p]) => p.endsWith(".md")));
    const again = read(md);
    expect(again.chapters).toEqual(book.chapters);
    expect(again.memory).toEqual(book.memory);
    expect(again.writingStyle).toBe(book.writingStyle);
    expect(book.markdownSource).toEqual(syntheticNarrarium);
  });

  it("le rimozioni non fanno risorgere scene o schede dai documenti originali", () => {
    const book = read();
    book.chapters = [];
    book.memory.characters = {};
    const files = projectBook(book, []).files;
    expect(files[scenePath]).toBeUndefined();
    expect(files["characters/mara.md"]).toBeUndefined();
    expect(files["reviews/sinossi-autore.md"]).toBeDefined();
  });

  it("conserva metadati delle linee guida e spostamenti, ma non riattiva summary rimossi", () => {
    const files = structuredClone(syntheticNarrarium);
    files["guidelines/style.md"] = writeMarkdownDocument({ type: "guideline", custom_note: "Privata" }, "Stile originale");
    files[scenePath] = files[scenePath]!.replace("type: scene", "summary: Vecchio riassunto\ntype: scene");
    const book = read(files);
    delete book.chapters[0]!.scenes[0]!.summary;
    book.chapters[0]!.number = 2;
    book.writingStyle = "Stile aggiornato";
    const output = projectBook(book, []).files;
    expect(output[scenePath]).toBeUndefined();
    const scene = readMarkdownDocument(output["chapters/002-arrivo/001-il-molo.md"]!);
    expect(scene.metadata.summary).toBeUndefined();
    expect(scene.metadata.custom_label).toBe("Scritto a mano");
    const style = readMarkdownDocument(output["guidelines/style.md"]!);
    expect(style.metadata.custom_note).toBe("Privata");
    expect(style.body).toBe("Stile aggiornato");
  });

  it("non sovrascrive una nota extra quando genera un file di riassunto", () => {
    const files = { ...syntheticNarrarium, "reviews/summary-001.md": "Una nota manuale distinta" };
    const book = read(files);
    book.chapters[0]!.summary = "La nuova sintesi del capitolo";
    const output = projectBook(book, []).files;
    expect(output["reviews/summary-001.md"]).toBe("Una nota manuale distinta");
    expect(output["reviews/summary-001-2.md"]).toContain("La nuova sintesi del capitolo");
  });

  it("le note extra e i metadati privati non diventano nuovi prompt o dati cloud", () => {
    const files = { ...syntheticNarrarium, "reviews/private.md": "PRIVATE_SOURCE_ONLY_SENTINEL" };
    const book = read(files), chapter = book.chapters[0]!;
    const segment = chapterSegments(chapter)[0]!;
    const cycle = createEditorialCycle(chapter.id);
    for (const role of EDITORIAL_ROLES) {
      const prompt = JSON.stringify(reviewerPrompt(book, cycle, role, segment, 1));
      expect(prompt).not.toContain("PRIVATE_SOURCE_ONLY_SENTINEL");
      expect(prompt).not.toContain("Scritto a mano");
    }
    const summary = JSON.stringify(summarizeBook(book, { id: crypto.randomUUID(), name: "PC" }, "2026-11-14T12:00:00.000Z"));
    expect(summary).not.toContain("markdownSource");
    expect(summary).not.toContain("PRIVATE_SOURCE_ONLY_SENTINEL");
  });

  it("conserva cartelle estese e note sotto chapters senza interpretarne lo YAML o creare scene", () => {
    const extra = {
      "research/private/deep/notes.md": "---\nnested:\n  object: opaque\n---\n\nPRIVATE_EXTENSION_ONLY",
      "chapters/001-arrivo/notes.md": "---\ntype: scene\nid: scene:not-structural\n---\n\nUna nota, non una nuova scena.",
      "chapters/001-arrivo/research/notes.md": "---\nalias: &opaque\n---\n\nNota del capitolo.",
      "profiles/readers/manual.md": "---\ntype: reader_profile\n---\n\nNon attivare automaticamente.",
    };
    const book = read({ ...syntheticNarrarium, ...extra });
    expect(book.chapters[0]!.scenes).toHaveLength(1);
    expect(book.editorialProfiles).toBeUndefined();
    book.chapters = [];
    const files = projectBook(book, []).files;
    for (const [path, text] of Object.entries(extra)) expect(files[path]).toBe(text);
    expect(files[scenePath]).toBeUndefined();
  });

  it("produce scene, pov, riferimenti risolvibili, timeline e riassunti da un libro nuovo", () => {
    const book = newBook("Premessa", "Titolo", "Stile", "Adulti");
    book.chapters = [{ id: "ch-1", number: 1, title: "Arrivo", purpose: "Un obiettivo", summary: "Riassunto capitolo",
      scenes: [{ id: "sc-1", number: 1, title: "Molo", objective: "Obiettivo scena", text: "  Prosa\r\n\r\nintatta 🌊\n",
        status: "draft", summary: "Riassunto scena", characters: ["Mara"], viewpoint: "Mara" }] }];
    book.bookSummary = "Riassunto libro";
    const files = projectBook(book, []).files;
    const portable = read(Object.fromEntries(Object.entries(files).filter(([path]) => path.endsWith(".md"))));
    expect(portable.chapters[0]!.scenes[0]!.text).toBe(book.chapters[0]!.scenes[0]!.text);
    expect(portable.chapters[0]!.scenes[0]!.summary).toBe("Riassunto scena");
    expect(portable.chapters[0]!.summary).toBe("Riassunto capitolo");
    expect(portable.bookSummary).toBe("Riassunto libro");
    expect(portable.memory.characters.Mara).toBe("");
    expect(files["timeline/events.md"]).toBeDefined();
    expect(files["reviews/synopsis.md"]).toBeDefined();
  });

  it.each([
    ["id duplicato", (f: Record<string, string>) => { f[scenePath] = f[scenePath]!.replace("scene:arrivo:molo", "chapter:arrivo"); }],
    ["capitolo errato", (f: Record<string, string>) => { f[scenePath] = f[scenePath]!.replace("chapter: chapter:arrivo", "chapter: chapter:altro"); }],
    ["numero diverso dal file", (f: Record<string, string>) => { f[scenePath] = f[scenePath]!.replace("number: 1", "number: 2"); }],
    ["riferimento mancante", (f: Record<string, string>) => { delete f["characters/mara.md"]; }],
    ["chiave ostile", (f: Record<string, string>) => { f[scenePath] = f[scenePath]!.replace("type: scene", "__proto__: hostile\ntype: scene"); }],
    ["numero duplicato", (f: Record<string, string>) => { f["chapters/001-arrivo/001-altra.md"] = f[scenePath]!.replace("scene:arrivo:molo", "scene:arrivo:altro"); }],
  ])("rifiuta atomicamente %s", (_label, corrupt) => {
    const files = structuredClone(syntheticNarrarium); corrupt(files);
    expect(() => read(files)).toThrow();
  });
});

describe("Profilo YAML semplice, limitato e non eseguibile", () => {
  it("accetta JSON quoting, apici YAML, liste flow/block, CRLF, null e commenti", () => {
    const input = `---\r\ntype: scene\r\nname: 'L''arrivo'\r\nempty: null\r\nlist: ["a,b", 'c', character:mara]\r\n# comment\r\n---\r\n\r\n  Testo\r\n`;
    const doc = readMarkdownDocument(input);
    expect(doc.metadata.name).toBe("L'arrivo");
    expect(doc.metadata.list).toEqual(["a,b", "c", "character:mara"]);
    expect(doc.body).toBe("  Testo\r\n");
    expect(readMarkdownDocument(writeMarkdownDocument(doc.metadata, doc.body))).toEqual(doc);
  });
  it.each(["type: scene\ntype: book", "x: &anchor value", "x: *anchor", "x: !!js/function x", "x: |\n  nested", "x:\n  y: z", "constructor: x", "x: [a,,b]"])("rifiuta %s senza eseguire o correggere", header => {
    expect(() => readMarkdownDocument("---\n" + header + "\n---\n\nbody")).toThrow();
  });
  it("non ammette script, traversal, URL, percorsi cifrati o documenti oltre limite", () => {
    for (const path of ["../book.md", "tools/run.py", "tools/notes.md", "scripts/note.md", "AGENTS.md", "research/CLAUDE.md",
      ".github/workflows/note.md", ".bookwriter/project.json", "https://evil/book.md", "chapters/001-a/%2e.md",
      "chapters/001-a/01-ambiguous.md", "chapters/manual/chapter.md", "chapters/001-a/nested/002-ambiguous.md"])
      expect(validMarkdownSource({ [path]: "text" })).toBe(false);
    expect(() => readMarkdownDocument("x".repeat(2 * 1024 * 1024 + 1), false)).toThrow();
  });
});
