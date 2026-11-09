import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { newBook, type BookProject, type Chapter, type Scene } from "../domain/types";
import { buildDocx, buildEpub, buildPdf } from "./export-book";

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
  const entry = files[path];
  if (!entry) throw new Error("Missing package entry: " + path);
  return strFromU8(entry);
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
      "mimetype", "META-INF/container.xml", "OEBPS/style.css", "OEBPS/titlepage.xhtml",
      "OEBPS/chapter-1.xhtml", "OEBPS/chapter-2.xhtml",
      "OEBPS/nav.xhtml", "OEBPS/content.opf",
    ]);
    expect(decode(files, "META-INF/container.xml")).toContain('full-path="OEBPS/content.opf"');
    const opf = decode(files, "OEBPS/content.opf");
    expect(opf).toContain('<package xmlns="http://www.idpf.org/2007/opf" version="3.0"');
    expect(opf).toContain('<dc:identifier id="uid">urn:uuid:' + book.id + "</dc:identifier>");
    expect(opf).toContain("<dc:title>L&#39;eco &amp; il tempo &lt;infinito&gt;</dc:title>");
    expect(opf).toContain("<meta property=\"dcterms:modified\">2026-11-09T13:42:15Z</meta>");
    expect(opf.match(/<itemref idref="[^"]+"\/>/g)).toEqual([
      '<itemref idref="titlepage"/>',
      '<itemref idref="chapter-1"/>', '<itemref idref="chapter-2"/>',
    ]);
    expect(opf).toContain('<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>');
    const front = decode(files, "OEBPS/titlepage.xhtml");
    expect(front).toContain('<section epub:type="titlepage" aria-labelledby="book-title">');
    expect(front).toContain('<h1 id="book-title">L&#39;eco &amp; il tempo &lt;infinito&gt;</h1>');
    expect(front).not.toContain("L&#39;inizio");
    expect(front).not.toContain("SEGRETO");
    expect(opf).not.toContain("Capitolo solo draft");

    const nav = decode(files, "OEBPS/nav.xhtml");
    expect(nav).toContain('<nav epub:type="toc"');
    expect(nav).toContain('<nav epub:type="landmarks" id="landmarks">');
    expect(nav.match(/<nav epub:type="landmarks"/g)).toHaveLength(1);
    expect(nav).toContain('<a epub:type="titlepage" href="titlepage.xhtml">Frontespizio</a>');
    expect(nav).toContain('<a epub:type="bodymatter" href="chapter-1.xhtml">Inizio del libro</a>');
    expect(nav).not.toContain('epub:type="toc" href="#toc"');
    expect(nav).toContain('<a href="chapter-1.xhtml">Capitolo 1 — L&#39;inizio &amp; &quot;il patto&quot;</a>');
    expect(nav).toContain('<a href="chapter-2.xhtml">Capitolo 3 — Il finale</a>');
    expect(nav).toContain('<a href="chapter-1.xhtml#scene-1">Prima &quot;luce&quot;</a>');
    expect(nav).toContain('<a href="chapter-2.xhtml#scene-1">Conclusione</a>');
    expect(nav).not.toContain("Capitolo solo draft");
  });

  it("serializza solo scene canoniche, gestisce Unicode valido ed effettua escaping XML", () => {
    const files = unzipSync(buildEpub(manuscript(), modified));
    const first = decode(files, "OEBPS/chapter-1.xhtml");
    const last = decode(files, "OEBPS/chapter-2.xhtml");
    expect(first).toContain('<section id="scene-1" aria-labelledby="scene-1-title">');
    expect(first).toContain('<h2 id="scene-1-title">Prima &quot;luce&quot;</h2>');
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

  it("indice per scena canonica con frammenti univoci, ordine e titoli XML-safe", () => {
    const book = manuscript();
    book.chapters[0]!.scenes.push(
      scene(4, "canon", "Dopo una bozza esclusa.", 'Ultima & <voce> "udibile"'),
      scene(5, "canon", "   "),
    );
    const files = unzipSync(buildEpub(book, modified));
    const nav = decode(files, "OEBPS/nav.xhtml");
    const first = decode(files, "OEBPS/chapter-1.xhtml");
    expect(nav).toContain('<a href="chapter-1.xhtml#scene-2">Ultima &amp; &lt;voce&gt; &quot;udibile&quot;</a>');
    expect(nav.match(/href="chapter-1.xhtml#scene-\d+"/g)).toEqual([
      'href="chapter-1.xhtml#scene-1"',
      'href="chapter-1.xhtml#scene-2"',
    ]);
    expect(first.match(/<section id="scene-\d+"/g)).toEqual([
      '<section id="scene-1"',
      '<section id="scene-2"',
    ]);
    expect(first).toContain('<section id="scene-2" aria-labelledby="scene-2-title">');
    expect(first).toContain('<h2 id="scene-2-title">Ultima &amp; &lt;voce&gt; &quot;udibile&quot;</h2>');
    expect(nav).not.toContain("Appunti");
    expect(nav).not.toContain("Capitolo solo draft");
    expect(nav).not.toContain("PROSA-DRAFT-MAI-ESPORTARE");
    expect(nav).not.toContain("scene-3");
    expect(first).not.toContain("scene-3");
  });

  it("non inserisce code point proibiti in XHTML e OPF, senza distruggere emoji", () => {
    const book = manuscript();
    book.title = "Titolo\u0000\u0007 sicuro 🪶 \uD800";
    const chapter = book.chapters[0]!;
    chapter.title = "Capitolo\u0001 & \uDC00";
    chapter.scenes[0]!.text = "Ciao\u0003\u000B mondo 😃\n\nUn'eco \uD800 avanti.";
    const files = unzipSync(buildEpub(book, modified));
    const combined = ["OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/titlepage.xhtml", "OEBPS/chapter-1.xhtml"]
      .map(path => decode(files, path)).join("\n");
    expect(decode(files, "OEBPS/titlepage.xhtml")).toContain("Titolo sicuro 🪶 �");
    expect(decode(files, "OEBPS/titlepage.xhtml")).not.toContain("\uD800");
    expect(combined).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u);
    expect(combined).toContain("🪶");
    expect(combined).toContain("😃");
    expect(combined).toContain("�");
    expect(combined).toContain("Un&#39;eco");
  });


  it("landmarks e lettura partono dal primo capitolo pubblicato, anche quando i primi sono draft", () => {
    const book = manuscript();
    book.chapters[0]!.scenes.forEach(item => { item.status = "draft"; });
    const files = unzipSync(buildEpub(book, modified));
    const opf = decode(files, "OEBPS/content.opf");
    const nav = decode(files, "OEBPS/nav.xhtml");
    expect(Object.keys(files)).toEqual([
      "mimetype", "META-INF/container.xml", "OEBPS/style.css", "OEBPS/titlepage.xhtml",
      "OEBPS/chapter-1.xhtml", "OEBPS/nav.xhtml", "OEBPS/content.opf",
    ]);
    expect(opf.match(/<itemref idref="[^"]+"\/>/g)).toEqual([
      '<itemref idref="titlepage"/>', '<itemref idref="chapter-1"/>',
    ]);
    expect(nav).toContain('<a href="chapter-1.xhtml">Capitolo 3 — Il finale</a>');
    expect(nav).toContain('<a epub:type="bodymatter" href="chapter-1.xhtml">Inizio del libro</a>');
    expect(decode(files, "OEBPS/chapter-1.xhtml")).toContain('<body epub:type="bodymatter">');
    expect(decode(files, "OEBPS/chapter-1.xhtml")).toContain("Capitolo 3 — Il finale");
    expect(nav).not.toContain("Capitolo 1");
    expect(nav).not.toContain("Capitolo solo draft");
  });

  it("senza scene canoniche rifiuta la produzione senza creare un EPUB vuoto", () => {
    const book = manuscript();
    for (const ch of book.chapters) for (const sc of ch.scenes) sc.status = "draft";
    expect(() => buildEpub(book, modified)).toThrow(/almeno una scena canonizzata/);
    expect(() => buildEpub(newBook("Idea", "Vuoto", "", ""), modified))
      .toThrow(/almeno una scena canonizzata/);
  });
});

describe("DOCX canonico, OPC e WordprocessingML", () => {
  it("genera uno ZIP DOCX ispezionabile con capitoli/scena in ordine ed esclude contenuti privati", async () => {
    const files = unzipSync(await buildDocx(manuscript()));
    for (const path of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "docProps/core.xml"])
      expect(files[path], path).toBeDefined();
    expect(decode(files, "[Content_Types].xml")).toContain("wordprocessingml.document.main+xml");
    const body = decode(files, "word/document.xml");
    const core = decode(files, "docProps/core.xml");
    expect(body).toContain("Capitolo 1");
    expect(body).toContain("Capitolo 3");
    expect(body).toContain("Prima");
    expect(body).toContain("Conclusione");
    expect(body).toContain("La città è viva. 🎭");
    expect(body).toContain("E poi tutto finì. ✨");
    expect(core).toContain("BookWriter");
    expect(body.indexOf("Capitolo 1")).toBeLessThan(body.indexOf("Prima"));
    expect(body.indexOf("Prima")).toBeLessThan(body.indexOf("Capitolo 3"));
    expect(body.indexOf("Capitolo 3")).toBeLessThan(body.indexOf("Conclusione"));
    const allXml = Object.entries(files).filter(([name]) => name.endsWith(".xml") || name.endsWith(".rels"))
      .map(([, bytes]) => strFromU8(bytes)).join("\n");
    for (const forbidden of [
      "PROSA-DRAFT-MAI-ESPORTARE", "PROSA-PLANNED-MAI-ESPORTARE",
      "SEGRETO-NON-ESPORTARE", "BRIEF-SUPER-PRIVATO",
      "Capitolo solo draft", "NON-CANON",
    ]) expect(allXml).not.toContain(forbidden);
  });

  it("sanitizza controlli e surrogate isolate in titolo, intestazioni e prosa DOCX", async () => {
    const book = manuscript();
    book.title = "Titolo\u0000 & <sicuro> 🪶 \uD800";
    book.chapters[0]!.title = "Luogo\u0001 & \uDC00";
    book.chapters[0]!.scenes[0]!.title = "Scena\u0002 <uno>";
    book.chapters[0]!.scenes[0]!.text = "Ciao\u0003 mondo 😃 & <ombra>\n\nUn'eco \uD800 avanti.";
    const files = unzipSync(await buildDocx(book));
    const word = decode(files, "word/document.xml");
    const core = decode(files, "docProps/core.xml");
    expect(word + core).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u);
    expect(word).toContain("😃");
    expect(word).toContain("🪶");
    expect(word).toContain("�");
    expect(word).toContain("Ciao mondo");
    expect(word).toContain("&amp;");
    expect(word).toContain("&lt;ombra&gt;");
    expect(core).toContain("&lt;sicuro&gt;");
  });

  it("rifiuta un libro privo di scene canoniche", async () => {
    await expect(buildDocx(newBook("Idea", "Vuoto", "", "")))
      .rejects.toThrow(/almeno una scena canonizzata/);
    const book = manuscript();
    book.chapters.forEach(ch => ch.scenes.forEach(sc => { sc.status = "draft"; }));
    await expect(buildDocx(book)).rejects.toThrow(/almeno una scena canonizzata/);
  });
});


describe("PDF standard — preflight charset e file verificabile", () => {
  function pdfManuscript(): BookProject {
    const book = manuscript();
    book.chapters[0]!.scenes[0]!.text = "La città è viva. L’ombra — €\n\nFINE-CANON-ONE.";
    book.chapters[2]!.scenes[0]!.text = "FINE-CANON-TWO.";
    return book;
  }

  it("genera un PDF leggibile strutturalmente con soli capitoli canonici", async () => {
    const book = pdfManuscript();
    const bytes = await buildPdf(book);
    const pdf = new TextDecoder("latin1").decode(bytes);
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect((pdf.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(3);
    expect(pdf).toContain("Capitolo 1");
    expect(pdf).toContain("Capitolo 3");
    expect(pdf.indexOf("Capitolo 1")).toBeLessThan(pdf.indexOf("Capitolo 3"));
    expect([...pdf.matchAll(/Pagina (\d+) di (\d+)/g)].map(m => m[0]))
      .toEqual(["Pagina 1 di 2", "Pagina 2 di 2"]);
    for (const secret of [
      "BRIEF-SUPER-PRIVATO", "SEGRETO-NON-ESPORTARE", "PROSA-DRAFT-MAI-ESPORTARE",
      "PROSA-PLANNED-MAI-ESPORTARE", "Capitolo solo draft", "NON-CANON",
    ]) expect(pdf).not.toContain(secret);
  });

  it("numera ogni pagina canonica anche quando un capitolo prosegue su più fogli", async () => {
    const book = pdfManuscript();
    book.chapters[0]!.scenes[0]!.text =
      Array(380).fill("La città si svegliava, e la storia continuava.").join(" ");
    const pdf = new TextDecoder("latin1").decode(await buildPdf(book));
    const pages = (pdf.match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(3);
    const folios = [...pdf.matchAll(/Pagina (\d+) di (\d+)/g)]
      .map(match => ({ current: Number(match[1]), total: Number(match[2]) }));
    expect(folios).toEqual(Array.from({ length: pages - 1 }, (_, index) => ({
      current: index + 1, total: pages - 1,
    })));
    expect(pdf).not.toContain("SEGRETO-NON-ESPORTARE");
    expect(pdf).not.toContain("PROSA-DRAFT-MAI-ESPORTARE");
  });

  it("lascia non numerato il frontespizio anche quando il titolo occupa più pagine", async () => {
    const book = pdfManuscript();
    book.title = "Titolo editoriale " + "molto lungo ".repeat(320);
    const pdf = new TextDecoder("latin1").decode(await buildPdf(book));
    const pages = (pdf.match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(3);
    // There are only two short canonical chapter pages; the other pages are title matter.
    expect([...pdf.matchAll(/Pagina (\d+) di (\d+)/g)].map(match => match[0]))
      .toEqual(["Pagina 1 di 2", "Pagina 2 di 2"]);
  });

  it("consente accenti italiani e segni WinAnsi, ignora caratteri fuori standard nelle bozze", async () => {
    const book = pdfManuscript();
    book.title = "L’eco — città €: “parole”";
    book.chapters[0]!.scenes[1]!.text = "BOZZA-EMOJI-🙈";
    book.memory.secrets["privato"] = "PRIVATO-🙂";
    await expect(buildPdf(book)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("incorpora offline PT Serif TTF e tabella ToUnicode per latino esteso e cirillico", async () => {
    const book = pdfManuscript();
    book.title = "Łódź, città & Привет";
    book.chapters[0]!.title = "Życie e Дорога";
    book.chapters[0]!.scenes[0]!.title = "Scena: Čechov";
    book.chapters[0]!.scenes[0]!.text = "Il cammino da Łódź. Привет, мир!\n\nIl cielo di Šibenik.";
    const bytes = await buildPdf(book);
    const pdf = new TextDecoder("latin1").decode(bytes);
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect((pdf.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(3);
    expect(pdf).toContain("/FontFile2");
    expect(pdf).toContain("/ToUnicode");
    expect(pdf).toContain("PTSerif");
    expect(bytes.byteLength).toBeGreaterThan(75_000);
    expect(pdf).not.toContain("SEGRETO-NON-ESPORTARE");
    expect(pdf).not.toContain("PROSA-DRAFT-MAI-ESPORTARE");
  });

  it("rifiuta i glifi senza cmap e le scritture non verificate, senza file parziale", async () => {
    for (const unsupported of ["中文", "α", "😀", "ش", "\uD800"]) {
      const book = pdfManuscript();
      book.chapters[0]!.scenes[0]!.text = "Testo " + unsupported;
      await expect(buildPdf(book)).rejects.toThrow(/Il PDF non supporta il carattere U\+.*EPUB o DOCX/);
    }
  });

  it("blocca caratteri non rappresentabili in ogni elemento effettivamente esportato", async () => {
    const edit = [
      (book: BookProject) => { book.title = "Titolo 🪶"; },
      (book: BookProject) => { book.chapters[0]!.title = "Capitolo 中文"; },
      (book: BookProject) => { book.chapters[0]!.scenes[0]!.title = "Scena \uD800"; },
      (book: BookProject) => { book.chapters[0]!.scenes[0]!.text = "Testo 😃"; },
    ];
    for (const mutate of edit) {
      const book = pdfManuscript();
      mutate(book);
      await expect(buildPdf(book)).rejects.toThrow(/Il PDF non supporta il carattere U\+.*EPUB o DOCX/);
    }
  });

  it("non crea PDF senza alcuna scena canonica", async () => {
    const book = pdfManuscript();
    book.chapters.forEach(ch => ch.scenes.forEach(s => { s.status = "draft"; }));
    await expect(buildPdf(book)).rejects.toThrow(/almeno una scena canonizzata/);
  });
});
