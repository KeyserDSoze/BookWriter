/** Portable frontmatter profile, not a general YAML interpreter. No tags,
 * aliases, nested objects, executable values or implicit date conversion. */
export type MarkdownValue = string | number | boolean | null | string[];
export interface MarkdownDocument { metadata: Record<string, MarkdownValue>; body: string }
export const MAX_MARKDOWN_FILES = 1200;
export const MAX_MARKDOWN_BYTES = 12 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const forbidden = new Set(["__proto__", "constructor", "prototype"]);

export function isSceneDocumentPath(path: string): boolean {
  return /^chapters\/[0-9]{3}-[a-zA-Z0-9][a-zA-Z0-9_-]*\/[0-9]{3}-[a-zA-Z0-9][a-zA-Z0-9_-]*\.md$/.test(path);
}
export function isCoreNarrativePath(path: string): boolean {
  if (path.length > 300 || path.includes("..") || path.includes("\\") || /[%\x00-\x1f]/.test(path)) return false;
  return /^(?:book|context|ideas|story-design|plot)\.md$/.test(path) ||
    /^(?:characters|locations|factions|items|secrets|guidelines|reviews|state|timeline|timelines|events|ghostwriters|evaluations)\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.md$/.test(path) ||
    /^chapters\/[0-9]{3}-[a-zA-Z0-9][a-zA-Z0-9_-]*\/(?:chapter|[0-9]{3}-[a-zA-Z0-9][a-zA-Z0-9_-]*)\.md$/.test(path);
}
/** The base structure is not a closed folder whitelist. Extra Markdown is
 * portable DATA, never an instruction file, credential store or executable. */
export function isNarrativePath(path: string): boolean {
  if (path.length > 300 || path.includes("..") || path.includes("\\") || /[%\x00-\x1f]/.test(path)) return false;
  const parts = path.split("/");
  if (parts.length > 8 || parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(part))) return false;
  if (["tools", "scripts", "node_modules", "dist", "oauth", "assets"].includes(parts[0]!)) return false;
  if (/^(?:AGENTS|CLAUDE|GEMINI|SYSTEM_PROMPT|README|LICENSE|CHANGELOG)\.md$/i.test(parts.at(-1)!)) return false;
  if (path.startsWith("chapters/") && /\/(?:chapter|\d+-[^/]+)\.md$/.test(path) && !isCoreNarrativePath(path)) return false;
  return path.endsWith(".md");
}
function invalid(): never { throw new Error("Frontmatter Markdown non valido: usa campi semplici e liste di stringhe, senza chiavi duplicate, tag o alias YAML."); }
function scalar(raw: string): MarkdownValue {
  const value = raw.trim();
  if (!value || value === "null" || value === "~") return null;
  if (value.startsWith('"')) {
    try { const parsed: unknown = JSON.parse(value); if (typeof parsed === "string") return parsed; } catch { /* fixed error */ }
    return invalid();
  }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(value)) return invalid();
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith("[")) {
    // Flow lists of quoted or plain strings, split only outside quotes.
    if (!value.endsWith("]")) return invalid();
    const inside = value.slice(1, -1);
    if (!inside.trim()) return [];
    const parts = inside.match(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+/g);
    if (!parts || parts.join(",").replace(/\s/g, "") !== inside.replace(/\s/g, "")) return invalid();
    const list = parts.map(part => scalar(part));
    if (list.some(item => typeof item !== "string") || list.length > 200) return invalid();
    return list as string[];
  }
  if (/^(?:true|false)$/.test(value)) return value === "true";
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    const n = Number(value); if (!Number.isFinite(n)) return invalid(); return n;
  }
  if (/^[!&*\[\]{}>|%@`]/.test(value) || /(?:^|\s)#|:\s/.test(value)) return invalid();
  return value;
}

export function readMarkdownDocument(text: string, required = true): MarkdownDocument {
  if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES || text.includes("\0"))
    throw new Error("Documento Markdown troppo grande o non valido.");
  // CRLF in the header is allowed; the prose is NEVER normalized or trimmed.
  const start = /^(?:\uFEFF)?---\r?\n/.exec(text);
  if (!start) { if (required) return invalid(); return { metadata: {}, body: text }; }
  const end = /^---\r?$/gm;
  end.lastIndex = start[0].length;
  const close = end.exec(text);
  if (!close || close.index > 64 * 1024) return invalid();
  const lines = text.slice(start[0].length, close.index).replace(/\r\n/g, "\n").split("\n");
  const metadata: Record<string, MarkdownValue> = Object.create(null);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([a-zA-Z_][a-zA-Z0-9_-]{0,63}):(?:[ \t]*(.*))$/.exec(line);
    if (!match || forbidden.has(match[1]!) || Object.hasOwn(metadata, match[1]!)) return invalid();
    const key = match[1]!;
    const raw = match[2] ?? "";
    if (!raw.trim() && /^  - /.test(lines[i + 1] ?? "")) {
      const list: string[] = [];
      while (/^  - /.test(lines[i + 1] ?? "")) {
        const value = scalar(lines[++i]!.slice(4));
        if (typeof value !== "string" || list.length >= 200) return invalid();
        list.push(value);
      }
      metadata[key] = list;
    } else metadata[key] = scalar(raw);
  }
  let body = text.slice(close.index + close[0].length).replace(/^\r?\n/, "");
  body = body.replace(/^\r?\n/, ""); // one optional separator, not prose whitespace
  return { metadata, body };
}

export function writeMarkdownDocument(metadata: Record<string, MarkdownValue>, body: string): string {
  return "---\n" + Object.entries(metadata).map(([key, value]) => key + ": " + JSON.stringify(value)).join("\n") + "\n---\n\n" + body;
}
export function readStoredMarkdown(path: string, text: string): MarkdownDocument {
  return isCoreNarrativePath(path) ? readMarkdownDocument(text, path === "book.md" || path.startsWith("chapters/")) :
    { metadata: {}, body: text };
}

/** Also used by the strict ZIP schema; never admit scripts or arbitrary paths. */
export function validMarkdownSource(files: unknown): files is Record<string, string> {
  if (!files || typeof files !== "object" || Array.isArray(files)) return false;
  const entries = Object.entries(files);
  return entries.length <= MAX_MARKDOWN_FILES && entries.every(([path, text]) =>
    isNarrativePath(path) && typeof text === "string" && !text.includes("\0") && new TextEncoder().encode(text).byteLength <= MAX_DOCUMENT_BYTES) &&
    new TextEncoder().encode(JSON.stringify(files)).byteLength <= MAX_MARKDOWN_BYTES;
}
