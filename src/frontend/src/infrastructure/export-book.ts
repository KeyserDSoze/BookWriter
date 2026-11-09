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
  const spine: string[] = [];
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
      '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="it"><head><title>' +
      html(chapter.title) + '</title><link href="style.css" rel="stylesheet" type="text/css"/></head><body>' +
      "<h1>Capitolo " + chapter.number + " — " + html(chapter.title) + "</h1>" + body +
      "</body></html>",
    );
  });
  entries["OEBPS/nav.xhtml"] = strToU8(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="it">' +
    '<head><title>Indice</title></head><body><nav epub:type="toc" id="toc"><h1>Indice</h1><ol>' +
    nav.join("") + "</ol></nav></body></html>",
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

export async function exportDocx(book: BookProject): Promise<void> {
  const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
  const chapters = ensureChapters(book);
  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ text: book.title, heading: HeadingLevel.TITLE, pageBreakBefore: false }),
  ];
  for (const { chapter, scenes } of chapters) {
    children.push(new Paragraph({
      text: "Capitolo " + chapter.number + " — " + chapter.title,
      heading: HeadingLevel.HEADING_1, pageBreakBefore: true,
    }));
    for (const scene of scenes) {
      children.push(new Paragraph({ text: scene.title, heading: HeadingLevel.HEADING_2 }));
      for (const p of paragraphs(scene.text)) {
        children.push(new Paragraph({ text: p, spacing: { after: 180 }, indent: { firstLine: 300 } }));
      }
    }
  }
  const document = new Document({
    creator: "BookWriter", title: book.title,
    sections: [{ properties: {}, children }],
  });
  const blob = await Packer.toBlob(document);
  download(blob, cleanName(book.title) + ".docx");
}

export async function exportPdf(book: BookProject): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const chapters = ensureChapters(book);
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = 210;
  const top = 22; const bottom = 276; const margin = 23;
  let y = top;
  function ensureLine(height: number): void {
    if (y + height > bottom) { pdf.addPage(); y = top; }
  }
  function addWrapped(text: string, fontSize: number, bold = false, lineHeight = 6) {
    pdf.setFont("times", bold ? "bold" : "normal");
    pdf.setFontSize(fontSize);
    // The standard PDF font has limited Unicode support. jsPDF replaces unsupported characters.
    const lines = pdf.splitTextToSize(text, pageWidth - 2 * margin) as string[];
    for (const line of lines) {
      ensureLine(lineHeight);
      pdf.text(line, margin, y);
      y += lineHeight;
    }
  }
  addWrapped(book.title, 21, true, 9);
  for (const { chapter, scenes } of chapters) {
    pdf.addPage(); y = top;
    addWrapped("Capitolo " + chapter.number + " - " + chapter.title, 17, true, 8);
    y += 5;
    for (const scene of scenes) {
      ensureLine(18);
      addWrapped(scene.title, 13, true, 7);
      y += 3;
      for (const p of paragraphs(scene.text)) {
        addWrapped(p, 11, false, 5.7);
        y += 4;
      }
    }
  }
  pdf.save(cleanName(book.title) + ".pdf");
}
