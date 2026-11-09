import type { jsPDF } from "jspdf";
import regularDataUri from "./pdf-fonts/PT_Serif-Web-Regular.ttf?inline";
import boldDataUri from "./pdf-fonts/PT_Serif-Web-Bold.ttf?inline";

/**
 * Bundled, original PT Serif font assets, SIL OFL 1.1 (pdf-fonts/OFL.txt).
 * ?inline forces Vite to embed the bytes in this lazy-loaded JS chunk, so an
 * offline PDF export never downloads a font from an external or local URL.
 */
export const PDF_UNICODE_FAMILY = "PT Serif";
const REGULAR_FILE = "PT_Serif-Web-Regular.ttf";
const BOLD_FILE = "PT_Serif-Web-Bold.ttf";

function extractBase64(dataUri: string): string {
  const split = dataUri.indexOf(",");
  if (split === -1 || !/^data:[^,]*;base64,/i.test(dataUri.slice(0, split + 1)))
    throw new Error("Font PDF incorporato non valido: asset non inlined.");
  return dataUri.slice(split + 1);
}

/** TrueType cmap format 4: resolve a BMP code point to its real glyph ID.
 * A code point mapped to .notdef (glyph 0) must never pass the PDF preflight.
 */
function glyphIndex(fontDataUri: string): (codePoint: number) => number {
  const binary = atob(extractBase64(fontDataUri));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number): number => view.getUint16(at, false);
  const u32 = (at: number): number => view.getUint32(at, false);
  const i16 = (at: number): number => view.getInt16(at, false);
  let cmap = -1;
  for (let i = 0; i < u16(4); i++) {
    const offset = 12 + i * 16;
    if (String.fromCharCode(...bytes.subarray(offset, offset + 4)) === "cmap")
      cmap = u32(offset + 8);
  }
  if (cmap === -1) throw new Error("Font PDF incorporato senza tabella cmap.");
  let table = -1;
  for (let i = 0; i < u16(cmap + 2); i++) {
    const offset = cmap + 4 + i * 8;
    const platform = u16(offset);
    const encoding = u16(offset + 2);
    const subtable = cmap + u32(offset + 4);
    if (u16(subtable) === 4 && (platform === 0 || (platform === 3 && encoding === 1)))
      table = subtable;
  }
  if (table === -1) throw new Error("Font PDF incorporato privo di cmap Unicode BMP.");
  const segments = u16(table + 6) / 2;
  const ends = table + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  return (codePoint: number): number => {
    if (codePoint > 0xffff) return 0;
    for (let i = 0; i < segments; i++) {
      const start = u16(starts + i * 2);
      const end = u16(ends + i * 2);
      if (codePoint < start || codePoint > end) continue;
      const range = u16(ranges + i * 2);
      if (!range) return (codePoint + i16(deltas + i * 2)) & 0xffff;
      const pos = ranges + i * 2 + range + (codePoint - start) * 2;
      const glyph = u16(pos);
      return glyph ? (glyph + i16(deltas + i * 2)) & 0xffff : 0;
    }
    return 0;
  };
}

let regularGlyph: ((cp: number) => number) | undefined;
let boldGlyph: ((cp: number) => number) | undefined;

/** All publishable glyphs must exist in both the regular and bold font.
 * This is deliberately conservative: no emoji, CJK or complex shaping.
 */
export function assertPdfUnicodeText(text: string): void {
  regularGlyph ??= glyphIndex(regularDataUri);
  boldGlyph ??= glyphIndex(boldDataUri);
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (cp === 0x0a || cp === 0x0d) continue;
    // Do not claim complex right-to-left shaping without explicit tests.
    const scriptSafe = (cp >= 0x20 && cp <= 0x052f) ||
      (cp >= 0x1e00 && cp <= 0x1eff) ||
      (cp >= 0x2000 && cp <= 0x20cf) ||
      (cp >= 0x2110 && cp <= 0x218f);
    if (!scriptSafe || !regularGlyph(cp) || !boldGlyph(cp)) {
      throw new Error("Il PDF non supporta il carattere U+" +
        cp.toString(16).toUpperCase().padStart(4, "0") +
        " con i font disponibili. Esporta in EPUB o DOCX per conservarlo.");
    }
  }
}

export function registerPdfUnicodeFonts(pdf: jsPDF): void {
  pdf.addFileToVFS(REGULAR_FILE, extractBase64(regularDataUri));
  pdf.addFileToVFS(BOLD_FILE, extractBase64(boldDataUri));
  pdf.addFont(REGULAR_FILE, PDF_UNICODE_FAMILY, "normal");
  pdf.addFont(BOLD_FILE, PDF_UNICODE_FAMILY, "bold");
}
