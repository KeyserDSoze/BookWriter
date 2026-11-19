/** Reversible text segmentation for browser speech synthesis.
 * Unlike a fixed prefix, every codepoint of the selected scene is spoken
 * exactly once. Prefer sentence or word boundaries without collapsing spaces.
 */
export const SPEECH_CHUNK_CHARACTERS = 700;
/** Safety bound: reject oversized scenes explicitly, never silently truncate. */
export const SPEECH_MAX_SCENE_CHARACTERS = 280_000;

export function speechSegments(text: string, chunkSize = SPEECH_CHUNK_CHARACTERS): string[] {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 32 || chunkSize > 2_000)
    throw new Error("Dimensione del blocco vocale non valida.");
  const clean = text.trim();
  if (!clean) return [];
  const points = Array.from(clean);
  if (points.length > SPEECH_MAX_SCENE_CHARACTERS)
    throw new Error("Scena troppo lunga per la lettura vocale: suddividi il testo in scene più brevi.");
  const result: string[] = [];
  let cursor = 0;
  while (cursor < points.length) {
    const end = Math.min(cursor + chunkSize, points.length);
    let boundary = end;
    if (end < points.length) {
      const minimum = cursor + Math.floor(chunkSize * 0.45);
      // Prefer a sentence boundary followed by a space. Keep punctuation
      // and the separator in exactly one segment.
      for (let i = end - 1; i >= minimum; i--) {
        if (/[.!?…]/u.test(points[i]!) && /\s/u.test(points[i + 1] ?? "")) {
          boundary = i + 1;
          break;
        }
      }
      if (boundary === end) {
        for (let i = end - 1; i >= minimum; i--) {
          if (/\s/u.test(points[i]!)) { boundary = i + 1; break; }
        }
      }
    }
    if (boundary <= cursor) throw new Error("Impossibile suddividere la scena in blocchi vocali.");
    result.push(points.slice(cursor,boundary).join(""));
    cursor = boundary;
  }
  return result;
}
