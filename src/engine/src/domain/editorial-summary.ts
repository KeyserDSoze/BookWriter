import type { Chapter } from "./types";

export const EDITORIAL_SUMMARY_MIN_EFFECTIVE_CHARS = 25;
export const EDITORIAL_CHAPTER_SUMMARY_MAX_CHARS = 6000;
export const EDITORIAL_BOOK_SUMMARY_MAX_CHARS = 9000;
/** Lengths asked of the model, well below the hard limits: a synopsis that grows at every
 * segment and every chapter would otherwise reach the limit and be rejected. */
export const EDITORIAL_CHAPTER_SUMMARY_TARGET_CHARS = 2500;
export const EDITORIAL_BOOK_SUMMARY_TARGET_CHARS = 6000;

export function isValidEditorialSummary(value: unknown, maximum: number): value is string {
  return typeof value === "string" &&
    value.length <= maximum &&
    value.trim().length >= EDITORIAL_SUMMARY_MIN_EFFECTIVE_CHARS;
}

/**
 * Restore the last validated public synopsis before a retroactive edit.
 * Newer chapters preserve their full rolling synopsis at freeze. Old data
 * can fall back to joining chapter summaries only if nothing is truncated.
 */
export function synopsisBeforeChapter(chapters: readonly Chapter[], chapterNumber: number): string {
  const prior = chapters
    .filter(ch => ch.number < chapterNumber && !!ch.frozenAt)
    .sort((a, b) => a.number - b.number);
  if (!prior.length) return "";
  const last = prior[prior.length - 1]!;
  if (last.bookSummaryAtFreeze !== undefined) return last.bookSummaryAtFreeze;
  const legacy = prior.map(ch => {
    if (!ch.summary) {
      throw new Error("Una sinossi precedente manca: crea un backup e completa il riassunto prima della revisione retroattiva.");
    }
    return ch.summary;
  }).join("\n");
  if (legacy.length > 8000) {
    throw new Error("Le sinossi precedenti sono troppo lunghe e non esiste una snapshot completa: non verranno troncate. Crea un backup e riassumile prima della revisione.");
  }
  return legacy;
}
