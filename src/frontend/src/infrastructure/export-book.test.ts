import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { newBook, type BookProject, type Chapter, type Scene } from "../domain/types";
import { buildEpub } from "./export-book";

const modified = new Date("2026-11-09T13:42:15.000Z");
function scene(number: number, status: Scene["status"], text: string, title = "Scena"): Scene {
  return { id: crypto.randomUUID(), number, title, objective: "Obiettivo", text, status };
}
function chapter(number: number, title: string, scenes: Scene[]): Chapter {
  return { id: crypto.randomUUID(), number, title, purpose: "Svolta narrativa", scenes };
}
function manuscript(): BookProject {
  const book = newBook("BRIEF-SUPER-PRIVATO", "L'eco & il tempo <infinito>", "Lirico", "Adulti");
  book.memory.secrets["plot"] = "SEGRETO-NON-ESPORTARE";
  book.chapters = [
    chapter(1, 'L\'inizio & "il patto"', [
      scene(1, "canon", "La città è viva. 🎭 & <ombra>\nRiga seconda\n\nUn nuovo paragrafo.", 'Prima "luce"'),
      scene(2, "draft", "PROSA-DRAFT-MAI-ESPORTARE"),
      scene(3, "planned", "PROSA-PLANNED-MAI-ESPORTARE"),
    ]),
    chapter(2, "Capitolo solo draft", [scene(1, "draft", "NON-CANON")]),
    chapter(3, "Il finale", [scene(1, "canon", "E poi tutto finì. ✨", "Conclusione")]),
  ];
  return book;
}
function decode(files: Record<string, Uint8Array>, path: string): string {
  expect(files[path], "missing EPUB entry: " + path).toBeDefined();
  return strFromU8(files[path]);
}

describe("EPUB 3 portable canon export", () => {
  it("produce un ZIP EPUB con mimetype primo e STORED, package e spine coerenti", () => {
    const book = manuscript();
    const bytes = buildEpub(book, modified);
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(header.getUint32(0, true)).toBe(0x04034b50);
    expect(header.getUint16(8, true)).toBe(0); // compression method: STORE, not DEFLATE
    const nameLength = header.getUint16(26, true);
    const extraLength = header.getUint16(28, true);
    expect(extraLength).toBe(0);
    const name = strFromU8(bytes.subarray(30, 30 + nameLength));
    expect(name).toBe("mimetype");
    expect(strFromU8(bytes.subarray(30 + nameLength, 30 + nameLength + extraLength + 20)))
      .toBe("application/epub+zip");

    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual([
      "mimetype", "META-INF/container.xml", "OEBPS/style.css",
      "OEBPS/chapter-1.xhtml", "OEBPS/chapter-2.xhtml",
      "OEBPS/nav.xhtml", "OEBPS/content.opf",
    ]);
    expect(decode(files, "META-INF/container.xml")).toContain('full-path="OEBPS/content.opf"');
    const opf = decode(files, "OEBPS/content.opf");
    expect(opf).toContain('<package xmlns="http://www.idpf.org/2007/opf" version="3.0"');
    expect(opf).toContain('<dc:identifier id="uid">urn:uuid:' + book.id + "</dc:identifier>");
    expect(opf).toContain("<dc:title>L&#39;eco &amp; il tempo &lt;infinito&gt;</dc:title>");
    expect(opf).toContain("<meta property=\"dcterms:modified\">2026-11-09T13:42:15Z</meta>");
    expect(opf.match(/<itemref idref="chapter-\d+"\/>/g)).toEqual([
      '<itemref idref="chapter-1"/>', '<itemref idref="chapter-2"/>',
    ]);
    expect(opf).not.toContain("Capitolo solo draft");

    const nav = decode(files, "OEBPS/nav.xhtml");
    expect(nav).toContain('<nav epub:type="toc"');
    expect(nav).toContain('<a href="chapter-1.xhtml">L&#39;inizio &amp; &quot;il patto&quot;</a>');
    expect(nav).toContain('<a href="chapter-2.xhtml">Il finale</a>');
    expect(nav).not.toContain("Capitolo solo draft");
  });

  it("serializza solo scene canoniche, gestisce Unicode valido ed effettua escaping XML", () => {
    const files = unzipSync(buildEpub(manuscript(), modified));
    const first = decode(files, "OEBPS/chapter-1.xhtml");
    const last = decode(files, "OEBPS/chapter-2.xhtml");
    expect(first).toContain("<h2>Prima &quot;luce&quot;</h2>");
    expect(first).toContain("La città è viva. 🎭 &amp; &lt;ombra&gt;<br/>Riga seconda");
    expect(first).toContain("<p>Un nuovo paragrafo.</p>");
    expect(last).toContain("<h1>Capitolo 3 — Il finale</h1>");
    expect(last).toContain("E poi tutto finì. ✨");
    const whole = Object.values(files).map(x => strFromU8(x)).join("\n");
    for (const forbidden of [
      "PROSA-DRAFT-MAI-ESPORTARE", "PROSA-PLANNED-MAI-ESPORTARE",
      "SEGRETO-NON-ESPORTARE", "BRIEF-SUPER-PRIVATO", "NON-CANON",
    ]) expect(whole).not.toContain(forbidden);
  });

  it("non inserisce code point proibiti in XHTML e OPF, senza distruggere emoji", () => {
    const book = manuscript();
    book.title = "Titolo\u0000\u0007 sicuro 🪶 \uD800";
    book.chapters[0].title = "Capitolo\u0001 & \uDC00";
    book.chapters[0].scenes[0].text = "Ciao\u0003\u000B mondo 😃\n\nUn'eco \uD800 avanti.";
    const files = unzipSync(buildEpub(book, modified));
    const combined = ["OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/chapter-1.xhtml"]
      .map(path => decode(files, path)).join("\n");
    expect(combined).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u);
    expect(combined).toContain("🪶");
    expect(combined).toContain("😃");
    expect(combined).toContain("�");
    expect(combined).toContain("Un&#39;eco");
  });

  it("senza scene canoniche rifiuta la produzione senza creare un EPUB vuoto", () => {
    const book = manuscript();
    for (const ch of book.chapters) for (const sc of ch.scenes) sc.status = "draft";
    expect(() => buildEpub(book, modified)).toThrow(/almeno una scena canonizzata/);
    expect(() => buildEpub(newBook("Idea", "Vuoto", "", ""), modified))
      .toThrow(/almeno una scena canonizzata/);
  });
});
