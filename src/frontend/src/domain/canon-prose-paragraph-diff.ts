import type { CanonProseScene, TaskProseCheckpoint } from "./task-prose-checkpoint";

/**
 * Read-only editorial preview: exact paragraph alignment, explicitly bounded
 * work/memory. It is NOT a whole-manuscript patch, merge, or restore.
 */
export const MAX_DIFF_PARAGRAPHS = 160;
export const MAX_DIFF_SOURCE_CHARS = 300_000;
export const MAX_DIFF_PREVIEW_ROWS = 32;
export const MAX_DIFF_PREVIEW_CHARS = 1800;

export type ParagraphPreview = {
  kind: "before" | "after";
  position: number;
  text: string;
  originalCharacters: number;
  shortened: boolean;
};
export type ParagraphDiff =
  | {
      kind: "too_large";
      beforeParagraphs: number;
      afterParagraphs: number;
      reason: "paragraphs" | "characters";
    }
  | {
      kind: "ready";
      beforeParagraphs: number;
      afterParagraphs: number;
      changes: number;
      previews: ParagraphPreview[];
      hiddenChanges: number;
    };

export type CanonSceneIdentity = { chapterId: string; sceneId: string };
export type CanonSceneEditorialSelection =
  | { kind: "unavailable"; reason: "missing" | "unchanged" }
  | { kind: "ready"; before: string; after: string };

/** Never return prose for a scene not explicitly selected by both IDs. */
export function selectCanonSceneText(
  checkpoint: TaskProseCheckpoint,
  id: CanonSceneIdentity,
): CanonSceneEditorialSelection {
  const matches = (scenes: readonly CanonProseScene[]) =>
    scenes.filter(scene => scene.chapterId === id.chapterId && scene.sceneId === id.sceneId);
  const before = matches(checkpoint.before.scenes);
  const after = matches(checkpoint.after.scenes);
  if (before.length > 1 || after.length > 1 || (!before.length && !after.length))
    return { kind: "unavailable", reason: "missing" };
  const original = before[0]?.text ?? "";
  const changed = after[0]?.text ?? "";
  if (before.length === after.length && original === changed)
    return { kind: "unavailable", reason: "unchanged" };
  return { kind: "ready", before: original, after: changed };
}

/** Preserve every character, including the blank-line separators. */
export function splitProseParagraphs(text: string): string[] {
  if (text.length === 0) return [];
  const segments = text.split(/(\r?\n[ \t]*\r?\n)/);
  const paragraphs: string[] = [];
  for (let i = 0; i < segments.length; i += 2) {
    const paragraph = (segments[i] ?? "") + (segments[i + 1] ?? "");
    if (paragraph.length) paragraphs.push(paragraph);
  }
  return paragraphs;
}

function safePreview(text: string): Pick<ParagraphPreview, "text"|"originalCharacters"|"shortened"> {
  if (text.length <= MAX_DIFF_PREVIEW_CHARS)
    return { text, originalCharacters: text.length, shortened: false };
  const half = Math.floor(MAX_DIFF_PREVIEW_CHARS / 2);
  return {
    text: text.slice(0, half) +
      "\n[…anteprima abbreviata: testo intermedio omesso…]\n" +
      text.slice(-half),
    originalCharacters: text.length,
    shortened: true,
  };
}

/**
 * LCS of exact paragraphs. O(n*m) but never above 160x160 cells; when the
 * bound is exceeded return "too_large" instead of an inaccurate partial diff.
 * Preview rows and individual long paragraphs are explicitly abbreviated.
 */
export function diffProseParagraphs(before: string, after: string): ParagraphDiff {
  if (before.length > MAX_DIFF_SOURCE_CHARS || after.length > MAX_DIFF_SOURCE_CHARS)
    return {
      kind: "too_large", reason: "characters",
      beforeParagraphs: splitProseParagraphs(before).length,
      afterParagraphs: splitProseParagraphs(after).length,
    };
  const left = splitProseParagraphs(before);
  const right = splitProseParagraphs(after);
  if (left.length > MAX_DIFF_PARAGRAPHS || right.length > MAX_DIFF_PARAGRAPHS)
    return {
      kind: "too_large", reason: "paragraphs",
      beforeParagraphs: left.length, afterParagraphs: right.length,
    };
  const n = left.length, m = right.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = left[i] === right[j]
        ? 1 + lcs[i + 1]![j + 1]!
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const previews: ParagraphPreview[] = [];
  let i = 0, j = 0, changes = 0;
  while (i < n || j < m) {
    if (i < n && j < m && left[i] === right[j]) { i++; j++; continue; }
    let kind: "before" | "after";
    let position: number;
    let text: string;
    if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      kind = "after";
      position = ++j;
      text = right[j - 1]!;
    } else {
      kind = "before";
      position = ++i;
      text = left[i - 1]!;
    }
    changes++;
    if (previews.length < MAX_DIFF_PREVIEW_ROWS)
      previews.push({ kind, position, ...safePreview(text) });
  }
  return {
    kind: "ready", beforeParagraphs: n, afterParagraphs: m,
    changes, previews, hiddenChanges: changes - previews.length,
  };
}
