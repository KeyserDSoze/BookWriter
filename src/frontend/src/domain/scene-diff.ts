/** An informational, non-destructive diff; never a merge algorithm. */
export interface DiffPiece {
  kind: "same" | "local" | "remote";
  text: string;
}
export interface SceneDiff {
  pieces: DiffPiece[];
  mode: "words" | "paragraphs" | "whole";
  fallback: boolean;
}
function compact(changes: DiffPiece[]): DiffPiece[] {
  const result: DiffPiece[] = [];
  for (const piece of changes) {
    if (!piece.text) continue;
    const last = result[result.length - 1];
    if (last?.kind === piece.kind) last.text += piece.text;
    else result.push({ ...piece });
  }
  return result;
}
/** O(n*m) is capped to prevent untrusted chapter text from freezing mobile. */
function boundedLcs(a: string[], b: string[], maxTokens: number): DiffPiece[] | null {
  if (a.length > maxTokens || b.length > maxTokens) return null;
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const index = i * width + j;
      table[index] = a[i] === b[j]
        ? 1 + table[(i + 1) * width + j + 1]!
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const changes: DiffPiece[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      changes.push({ kind: "same", text: a[i++]! }); j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      changes.push({ kind: "local", text: a[i++]! });
    } else {
      changes.push({ kind: "remote", text: b[j++]! });
    }
  }
  while (i < a.length) changes.push({ kind: "local", text: a[i++]! });
  while (j < b.length) changes.push({ kind: "remote", text: b[j++]! });
  return compact(changes);
}
function tokens(text: string): string[] {
  return text.match(/\s+|[^\s]+/gu) ?? [];
}
function paragraphs(text: string): string[] {
  // Split on blank lines while preserving the separators for an exact display.
  return text.match(/(?:[^\n]|\n(?!\s*\n))*(?:\n\s*\n+|$)/gu)?.filter(Boolean) ?? [];
}
export function diffSceneText(local: string, remote: string): SceneDiff {
  if (local === remote) return { pieces: [{ kind: "same", text: local }], mode: "words", fallback: false };
  const words = boundedLcs(tokens(local), tokens(remote), 750);
  if (words) return { pieces: words, mode: "words", fallback: false };
  const blocks = boundedLcs(paragraphs(local), paragraphs(remote), 240);
  if (blocks) return { pieces: blocks, mode: "paragraphs", fallback: true };
  return {
    pieces: compact([{ kind: "local", text: local }, { kind: "remote", text: remote }]),
    mode: "whole", fallback: true,
  };
}
