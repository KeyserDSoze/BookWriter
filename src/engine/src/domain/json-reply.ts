const FENCE = "`".repeat(3);
const MAX_START_POINTS = 40;

/** End index of the bracket-balanced value starting at `start`, ignoring brackets inside strings. */
function balancedEnd(text: string, start: number): number {
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Parse a model reply that should be JSON. Models often add a code fence, a sentence before it
 * or a note after it: take the first value that really parses. Validation stays with the caller's schema. */
export function parseJsonReply(raw: string): unknown {
  const text = raw.trim();
  const unfenced = (text.startsWith(FENCE) ? text.slice(FENCE.length).replace(/^json\s*/i, "") : text)
    .replace(/\s*$/, "").replace(new RegExp(FENCE + "$"), "").trim();
  try { return JSON.parse(unfenced) as unknown; }
  catch (first) {
    let tried = 0;
    for (let i = 0; i < unfenced.length && tried < MAX_START_POINTS; i++) {
      const ch = unfenced[i];
      if (ch !== "{" && ch !== "[") continue;
      tried++;
      const end = balancedEnd(unfenced, i);
      if (end < 0) continue;
      try { return JSON.parse(unfenced.slice(i, end + 1)) as unknown; } catch { /* try the next opening bracket */ }
    }
    throw first;
  }
}
