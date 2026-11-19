/** Line-based three-way merge, pure and bounded. It never guesses: overlapping or touching edits are a conflict. */
const MAX_CELLS = 4_000_000;
interface Hunk { start: number; end: number; lines: string[] }

/** Aligned equal lines (base index, other index) of one longest common subsequence, or undefined when too large. */
function matches(base: string[], other: string[]): Array<[number, number]> | undefined {
  const n = base.length, m = other.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return undefined;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    table[i * width + j] = base[i] === other[j] ? table[(i + 1) * width + j + 1]! + 1
      : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  const pairs: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (base[i] === other[j]) { pairs.push([i, j]); i++; j++; }
    else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
    else j++;
  }
  return pairs;
}
function hunksOf(base: string[], other: string[]): Hunk[] | undefined {
  const pairs = matches(base, other);
  if (!pairs) return undefined;
  const result: Hunk[] = [];
  let baseAt = 0, otherAt = 0;
  for (const [i, j] of [...pairs, [base.length, other.length] as [number, number]]) {
    if (i > baseAt || j > otherAt) result.push({ start: baseAt, end: i, lines: other.slice(otherAt, j) });
    baseAt = i + 1; otherAt = j + 1;
  }
  return result;
}
const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((line, i) => line === b[i]);
const touches = (a: Hunk, b: Hunk) => a.start <= b.end && b.start <= a.end;

/** The merged text, or null when both sides changed the same place differently (or the text is too large to align). */
export function mergeText3(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours;
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  const baseLines = base.split("\n");
  const ourHunks = hunksOf(baseLines, ours.split("\n"));
  const theirHunks = hunksOf(baseLines, theirs.split("\n"));
  if (!ourHunks || !theirHunks) return null;
  const all = [...ourHunks.map(hunk => ({ hunk, side: 0 })), ...theirHunks.map(hunk => ({ hunk, side: 1 }))]
    .sort((a, b) => a.hunk.start - b.hunk.start || a.hunk.end - b.hunk.end || a.side - b.side);
  const output: string[] = [];
  let at = 0;
  for (let index = 0; index < all.length; index++) {
    const current = all[index]!;
    const next = all[index + 1];
    if (next && current.side !== next.side && touches(current.hunk, next.hunk)) {
      // Identical edits made on both sides are the same edit, not a conflict.
      if (current.hunk.start === next.hunk.start && current.hunk.end === next.hunk.end &&
          sameLines(current.hunk.lines, next.hunk.lines)) { index++; }
      else return null;
    }
    output.push(...baseLines.slice(at, current.hunk.start), ...current.hunk.lines);
    at = Math.max(at, current.hunk.end);
  }
  output.push(...baseLines.slice(at));
  return output.join("\n");
}
