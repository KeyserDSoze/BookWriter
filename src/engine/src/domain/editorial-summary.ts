import type { Chapter } from "./types";

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
