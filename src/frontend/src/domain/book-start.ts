import type { AuthorChapterSynopsis, BookProject } from "./types";

export const MAX_SYNOPSIS_CHAPTERS = 80;
export const MAX_CHAPTER_SYNOPSIS_CHARS = 4000;
export const MAX_SYNOPSIS_TOTAL_CHARS = 60_000;
export const MAX_CHAPTER_TITLE_CHARS = 160;
export const MAX_TARGET_CHAPTERS = 80;

export interface ParsedChapterSynopses {
  chapters: AuthorChapterSynopsis[];
  /** Text before the first recognised chapter heading (general notes). */
  preamble: string;
  format: "headings" | "numbered" | "paragraphs" | "empty";
  /** Blocking problems, in Italian, shown before the book is created. */
  problems: string[];
}

const NUMBER_WORDS = new Set([
  "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci",
  "undici", "dodici", "tredici", "quattordici", "quindici", "sedici", "diciassette",
  "diciotto", "diciannove", "venti", "primo", "secondo", "terzo", "quarto", "quinto",
  "sesto", "settimo", "ottavo", "nono", "decimo",
]);
const SEPARATOR = /^[:.)\-–—]+/;

/** A chapter keyword followed by an explicit number. Lowercase "di", "dopo"
 * etc. must not be mistaken for Roman numerals: those are uppercase only. */
function keywordHeading(line: string): { title?: string } | undefined {
  const match = /^\s*(?:#{1,6}\s*)?(capitolo|cap\.|chapter)\s+(\S+)(.*)$/i.exec(line);
  if (!match) return undefined;
  const raw = match[2]!;
  const token = raw.replace(/[:.)\-–—,]+$/, "");
  const numeric = /^\d{1,3}$/.test(token) || /^[IVXLC]{1,7}$/.test(token) ||
    NUMBER_WORDS.has(token.toLocaleLowerCase("it"));
  if (!numeric) return undefined;
  const rest = (raw.slice(token.length) + match[3]!).trim().replace(SEPARATOR, "").trim();
  return rest ? { title: rest } : {};
}
function markdownHeading(line: string): { title?: string } | undefined {
  const markdown = /^\s*#{1,6}\s+(\S.*)$/.exec(line);
  return markdown ? { title: markdown[1]!.trim() } : undefined;
}

function numberedLine(line: string): string | undefined {
  const match = /^\s*\d{1,3}\s*[.)]\s+(\S.*)$/.exec(line);
  return match?.[1]?.trim();
}

/** Short heading-like prefix ("L'arrivo: Marco arriva…") becomes the title. */
function splitTitle(first: string): { title?: string; rest: string } {
  const match = /^(.{2,80}?)\s*(?::|\s[—–-]\s)\s*(\S.*)$/.exec(first);
  return match ? { title: match[1]!.trim(), rest: match[2]!.trim() } : { rest: first };
}

function finalize(
  raw: Array<{ title?: string; body: string[] }>,
  preamble: string, format: ParsedChapterSynopses["format"],
): ParsedChapterSynopses {
  const problems: string[] = [];
  const chapters: AuthorChapterSynopsis[] = [];
  raw.forEach((entry, index) => {
    let title = entry.title?.trim() || undefined;
    let synopsis = entry.body.join("\n").trim();
    // A long first line after "Capitolo N:" is prose, not a title.
    if (title && title.length > 100) {
      synopsis = (title + (synopsis ? "\n" + synopsis : "")).trim();
      title = undefined;
    }
    if (!synopsis && title) synopsis = title;
    if (!synopsis) {
      problems.push(`Il capitolo ${index + 1} non contiene né titolo né sinossi.`);
      return;
    }
    if (title && title.length > MAX_CHAPTER_TITLE_CHARS)
      problems.push(`Il titolo del capitolo ${index + 1} supera ${MAX_CHAPTER_TITLE_CHARS} caratteri.`);
    if (synopsis.length > MAX_CHAPTER_SYNOPSIS_CHARS)
      problems.push(`La sinossi del capitolo ${index + 1} supera ${MAX_CHAPTER_SYNOPSIS_CHARS} caratteri: riassumila.`);
    chapters.push(title ? { title, synopsis } : { synopsis });
  });
  if (chapters.length > MAX_SYNOPSIS_CHAPTERS)
    problems.push(`Massimo ${MAX_SYNOPSIS_CHAPTERS} capitoli: ne sono stati rilevati ${chapters.length}.`);
  return { chapters, preamble: preamble.trim(), format, problems };
}

/**
 * Deterministic, local reading of a chapter-by-chapter synopsis.
 * Supported: "Capitolo 1: Titolo" / "Cap. II" / "# Titolo" headings, numbered
 * lists ("1. …") or paragraphs separated by blank lines. No AI call.
 */
export function parseChapterSynopses(text: string): ParsedChapterSynopses {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return { chapters: [], preamble: "", format: "empty",
    problems: ["Scrivi la sinossi: almeno un capitolo."] };
  if (normalized.length > MAX_SYNOPSIS_TOTAL_CHARS) return { chapters: [], preamble: "",
    format: "empty", problems: [`La sinossi supera ${MAX_SYNOPSIS_TOTAL_CHARS} caratteri: riassumila.`] };
  const lines = normalized.split("\n");

  // "Capitolo N" headings win: a markdown document title is then just preamble.
  const heading = lines.some(line => keywordHeading(line)) ? keywordHeading :
    lines.some(line => markdownHeading(line)) ? markdownHeading : undefined;
  if (heading) {
    const preamble: string[] = [];
    const raw: Array<{ title?: string; body: string[] }> = [];
    for (const line of lines) {
      const found = heading(line);
      if (found) raw.push({ title: found.title, body: [] });
      else if (raw.length) raw.at(-1)!.body.push(line);
      else preamble.push(line);
    }
    return finalize(raw, preamble.join("\n"), "headings");
  }

  if (lines.filter(line => numberedLine(line) !== undefined).length >= 2) {
    const preamble: string[] = [];
    const raw: Array<{ title?: string; body: string[] }> = [];
    for (const line of lines) {
      const first = numberedLine(line);
      if (first !== undefined) {
        const { title, rest } = splitTitle(first);
        raw.push({ title, body: [rest] });
      } else if (raw.length) raw.at(-1)!.body.push(line);
      else preamble.push(line);
    }
    return finalize(raw, preamble.join("\n"), "numbered");
  }

  const blocks = normalized.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
  return finalize(blocks.map(block => ({ body: [block] })), "", "paragraphs");
}

/** Optional idea-mode target. Empty input means the AI chooses. */
export function parseTargetChapterCount(value: string): number | undefined | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^\d{1,3}$/.test(trimmed)) return "invalid";
  const count = Number(trimmed);
  return count >= 1 && count <= MAX_TARGET_CHAPTERS ? count : "invalid";
}

/** Binding chapter list in a compact, numbered form for prompts. */
export function formatAuthorSynopsis(chapters: readonly AuthorChapterSynopsis[]): string {
  return chapters.map((chapter, index) =>
    `${index + 1}. ${chapter.title ? chapter.title + " — " : ""}${chapter.synopsis}`).join("\n");
}

/** Untrusted snapshot: start options survive only when well-formed and bounded. */
export function sanitizeBookStart(value: Record<string, unknown>): Pick<BookProject,
  "startMode" | "authorChapterSynopses" | "targetChapterCount" | "pauseAfterOutline"> {
  const synopses = Array.isArray(value.authorChapterSynopses) &&
    value.authorChapterSynopses.length <= MAX_SYNOPSIS_CHAPTERS &&
    value.authorChapterSynopses.every(entry => !!entry && typeof entry === "object" &&
      typeof (entry as AuthorChapterSynopsis).synopsis === "string" &&
      (entry as AuthorChapterSynopsis).synopsis.length > 0 &&
      (entry as AuthorChapterSynopsis).synopsis.length <= MAX_CHAPTER_SYNOPSIS_CHARS &&
      ((entry as AuthorChapterSynopsis).title === undefined ||
        (typeof (entry as AuthorChapterSynopsis).title === "string" &&
          (entry as AuthorChapterSynopsis).title!.length <= MAX_CHAPTER_TITLE_CHARS)))
    ? (value.authorChapterSynopses as AuthorChapterSynopsis[]).map(entry =>
      entry.title ? { title: entry.title, synopsis: entry.synopsis } : { synopsis: entry.synopsis })
    : undefined;
  const target = value.targetChapterCount;
  return {
    ...(value.startMode === "synopsis" && synopses?.length
      ? { startMode: "synopsis" as const, authorChapterSynopses: synopses }
      : value.startMode === "idea" ? { startMode: "idea" as const } : {}),
    ...(typeof target === "number" && Number.isInteger(target) && target >= 1 && target <= MAX_TARGET_CHAPTERS
      ? { targetChapterCount: target } : {}),
    ...(value.pauseAfterOutline === true ? { pauseAfterOutline: true } : {}),
  };
}
