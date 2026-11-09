import { zipSync, strToU8 } from "fflate";
import type { BookProject, Chapter, Scene } from "../domain/types";

/** XHTML/OPF are XML 1.0 documents: an LLM or imported draft may contain
 * invisible control bytes or lone UTF-16 surrogates. Keep valid Unicode and
 * normal line breaks, but never emit forbidden XML code points. */
function safeXmlText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}
function html(text: string): string {
  return safeXmlText(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function cleanName(text: string): string {
  return text.normalize("NFKD").replace(/[^A-Za-z0-9 _-]/g, "").trim()
    .replace(/\s+/g, "-").slice(0, 60) || "bookwriter";
}
function canonChapters(book: BookProject): Array<{ chapter: Chapter; scenes: Scene[] }> {
  return book.chapters.map(chapter => ({
    chapter, scenes: chapter.scenes.filter(s => s.status === "canon" && s.text.trim()),
  })).filter(entry => entry.scenes.length > 0);
}
function ensureChapters(book: BookProject) {
  const chapters = canonChapters(book);
  if (!chapters.length) throw new Error("Per esportare il libro serve almeno una scena canonizzata.");
  return chapters;
}
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = name; anchor.href = url;
  document.body.appendChild(anchor);
  anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
function paragraphs(text: string): string[] {
  return text.replaceAll("\r\n", "\n").split(/\n\s*\n/g).map(x => x.trim()).filter(Boolean);
}

/** Pure EPUB 3 generator: ZIP bytes are independently inspectable and testable.
 * The packaging contains ONLY canonical scenes, never draft prose or keys. */
export function buildEpub(book: BookProject, modifiedAt = new Date()): Uint8Array {
  const chapters = ensureChapters(book);
  const uid = "urn:uuid:" + book.id;
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/style.css": strToU8(
      "body{font-family:serif;line-height:1.5;margin:1em;}h1{text-align:center;margin:2em 0 1em;}h2{margin:1.5em 0 1em;}p{text-indent:1em;margin:0 0 .75em;}",
    ),
  };
  const nav: string[] = [];
  const manifest: string[] = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="style" href="style.css" media-type="text/css"/>',
  ];
  // The front matter is first in reading order; only canonical chapters follow.
  entries["OEBPS/titlepage.xhtml"] = strToU8(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="it">' +
    '<head><title>' + html(book.title) +
    '</title><link href="style.css" rel="stylesheet" type="text/css"/></head>' +
    '<body><section epub:type="titlepage" aria-labelledby="book-title">' +
    '<h1 id="book-title">' + html(book.title) + '</h1></section></body></html>',
  );
  manifest.push('<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>');
  const spine: string[] = ['<itemref idref="titlepage"/>'];
  chapters.forEach(({ chapter, scenes }, i) => {
    const id = "chapter-" + (i + 1);
    const path = id + ".xhtml";
    nav.push(
      '<li><a href="' + path + '">Capitolo ' + chapter.number + " — " +
      html(chapter.title) + "</a><ol>" +
      scenes.map((scene, j) =>
        '<li><a href="' + path + '#scene-' + (j + 1) + '">' + html(scene.title) + "</a></li>",
      ).join("") + "</ol></li>",
    );
    manifest.push('<item id="' + id + '" href="' + path + '" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="' + id + '"/>');
    const body = scenes.map((scene, j) =>
      '<section id="scene-' + (j + 1) + '" aria-labelledby="scene-' + (j + 1) + '-title">' +
      '<h2 id="scene-' + (j + 1) + '-title">' + html(scene.title) + "</h2>" +
      paragraphs(scene.text).map(p => "<p>" + html(p).replaceAll("\n", "<br/>") + "</p>").join("") +
      "</section>",
    ).join("\n");
    entries["OEBPS/" + path] = strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="it"><head><title>' +
      html(chapter.title) + '</title><link href="style.css" rel="stylesheet" type="text/css"/></head><body epub:type="bodymatter">' +
      "<h1>Capitolo " + chapter.number + " — " + html(chapter.title) + "</h1>" + body +
      "</body></html>",
    );
  });
  entries["OEBPS/nav.xhtml"] = strToU8(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="it">' +
    '<head><title>Indice</title></head><body><nav epub:type="toc" id="toc"><h1>Indice</h1><ol>' +
    nav.join("") + '</ol></nav>' +
    '<nav epub:type="landmarks" id="landmarks"><h2>Sezioni del libro</h2><ol>' +
    '<li><a epub:type="titlepage" href="titlepage.xhtml">Frontespizio</a></li>' +
    '<li><a epub:type="bodymatter" href="chapter-1.xhtml">Inizio del libro</a></li>' +
    '</ol></nav></body></html>',
  );
  entries["OEBPS/content.opf"] = strToU8(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="it">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:identifier id="uid">' + html(uid) + "</dc:identifier>" +
    "<dc:title>" + html(book.title) + "</dc:title><dc:language>it</dc:language>" +
    '<meta property="dcterms:modified">' + modifiedAt.toISOString().slice(0, 19) + "Z</meta>" +
    "</metadata><manifest>" + manifest.join("") + "</manifest><spine>" + spine.join("") + "</spine></package>",
  );
  return zipSync(entries, { level: 6 });
}

export function exportEpub(book: BookProject): void {
  const bytes = buildEpub(book);
  download(new Blob([new Uint8Array(bytes)], { type: "application/epub+zip" }),
    cleanName(book.title) + ".epub");
}

/** Pure DOCX export: generate an inspectable OPC package without browser download.
 * AI/imported text is sanitized before the WordprocessingML encoder sees it. */
export async function buildDocx(book: BookProject): Promise<Uint8Array> {
  const chapters = ensureChapters(book);
  const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ text: safeXmlText(book.title), heading: HeadingLevel.TITLE, pageBreakBefore: false }),
  ];
  for (const { chapter, scenes } of chapters) {
    children.push(new Paragraph({
      text: safeXmlText("Capitolo " + chapter.number + " — " + chapter.title),
      heading: HeadingLevel.HEADING_1, pageBreakBefore: true,
    }));
    for (const scene of scenes) {
      children.push(new Paragraph({ text: safeXmlText(scene.title), heading: HeadingLevel.HEADING_2 }));
      for (const p of paragraphs(scene.text)) {
        children.push(new Paragraph({
          text: safeXmlText(p), spacing: { after: 180 }, indent: { firstLine: 300 },
        }));
      }
    }
  }
  const document = new Document({
    creator: "BookWriter", title: safeXmlText(book.title),
    sections: [{ properties: {}, children }],
  });
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportDocx(book: BookProject): Promise<void> {
  const bytes = await buildDocx(book);
  download(new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }), cleanName(book.title) + ".docx");
}

/** jsPDF's built-in Times font uses WinAnsi, not arbitrary Unicode.
 * Reject text that would lose glyphs rather than silently corrupt the manuscript. */
const PDF_WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function normalizePdfText(value: string): string {
  return safeXmlText(value).replaceAll("\t", "    ");
}
function isWinAnsiPdfChar(character: string): boolean {
  const cp = character.codePointAt(0)!;
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) ||
    cp === 0x0a || cp === 0x0d || PDF_WINANSI_EXTRA.includes(character);
}

/** Generate inspectable PDF bytes without triggering a download or network request.
 * For non-WinAnsi prose, embed licensed PT Serif font bytes from a lazy local
 * JS chunk, with a glyph-by-glyph cmap preflight to prevent silent corruption. */
export async function buildPdf(book: BookProject): Promise<Uint8Array> {
  const chapters = ensureChapters(book);
  const title = normalizePdfText(book.title);
  const safeChapters = chapters.map(({ chapter, scenes }) => ({
    title: normalizePdfText("Capitolo " + chapter.number + " - " + chapter.title),
    scenes: scenes.map(scene => ({
      title: normalizePdfText(scene.title),
      paragraphs: paragraphs(scene.text).map(normalizePdfText),
    })),
  }));
  const publishedTexts = [title, ...safeChapters.flatMap(chapter => [
    chapter.title, ...chapter.scenes.flatMap(scene => [scene.title, ...scene.paragraphs]),
  ])];
  const needsUnicodeFont = publishedTexts.some(text =>
    Array.from(text).some(character => !isWinAnsiPdfChar(character)));
  const unicodeFont = needsUnicodeFont ? await import("./pdf-unicode-font") : null;
  // Finish checking every publishable field before beginning any PDF rendering.
  if (unicodeFont) publishedTexts.forEach(unicodeFont.assertPdfUnicodeText);
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: false });
  if (unicodeFont) unicodeFont.registerPdfUnicodeFonts(pdf);
  const fontFamily = unicodeFont?.PDF_UNICODE_FAMILY ?? "times";
  const pageWidth = 210;
  const top = 22; const bottom = 276; const margin = 23;
  let y = top;
  function ensureLine(height: number): void {
    if (y + height > bottom) { pdf.addPage(); y = top; }
  }
  function addWrapped(text: string, fontSize: number, bold = false, lineHeight = 6) {
    pdf.setFont(fontFamily, bold ? "bold" : "normal");
    pdf.setFontSize(fontSize);
    const lines = pdf.splitTextToSize(text, pageWidth - 2 * margin) as string[];
    for (const line of lines) {
      ensureLine(lineHeight);
      pdf.text(line, margin, y);
      y += lineHeight;
    }
  }
  addWrapped(title, 21, true, 9);
  let firstBodyPage = 0;
  for (const chapter of safeChapters) {
    pdf.addPage(); y = top;
    if (!firstBodyPage) firstBodyPage = pdf.getNumberOfPages();
    addWrapped(chapter.title, 17, true, 8);
    y += 5;
    for (const scene of chapter.scenes) {
      ensureLine(18);
      addWrapped(scene.title, 13, true, 7);
      y += 3;
      for (const p of scene.paragraphs) {
        addWrapped(p, 11, false, 5.7);
        y += 4;
      }
    }
  }
  // Apply folios only after layout has finished, including automatic page breaks.
  // The entire title matter remains unnumbered, even if a long title spans pages.
  const lastPage = pdf.getNumberOfPages();
  const contentPageCount = lastPage - firstBodyPage + 1;
  for (let page = firstBodyPage; page <= lastPage; page++) {
    pdf.setPage(page);
    pdf.setFont(fontFamily, "normal");
    pdf.setFontSize(9);
    pdf.text("Pagina " + (page - firstBodyPage + 1) + " di " + contentPageCount,
      pageWidth / 2, 286, { align: "center" });
  }
  return new Uint8Array(pdf.output("arraybuffer"));
}

export async function exportPdf(book: BookProject): Promise<void> {
  const bytes = await buildPdf(book);
  download(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    cleanName(book.title) + ".pdf");
}
