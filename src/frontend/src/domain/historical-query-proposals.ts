/** Local, bounded and deterministic historical research hints.
 *
 * NEVER copy free-form manuscript text into a search query. Proposals contain
 * only a fixed public vocabulary and (when unambiguous and nearby) a year
 * explicitly written in a scene. They are NOT approved or transmitted here.
 * Even these coarse hints need the author's manual review and network consent.
 */
const PUBLIC_TOPICS = [
  { label: "Telegrafo elettrico", re: /\btelegraf[a-zà-ÿ]*/iu },
  { label: "Trasporti ferroviari", re: /\b(?:ferrov[a-zà-ÿ]*|locomotiv[a-zà-ÿ]*|treno|treni)\b/iu },
  { label: "Illuminazione a gas", re: /\b(?:lampion[a-zà-ÿ]*|gasometr[a-zà-ÿ]*|illuminazione\s+a\s+gas)\b/iu },
  { label: "Fotografia", re: /\b(?:fotograf[a-zà-ÿ]*|dagherrotip[a-zà-ÿ]*)\b/iu },
  { label: "Vaccinazione", re: /\b(?:vaccin[a-zà-ÿ]*|vaiolo)\b/iu },
  { label: "Navigazione a vapore", re: /\b(?:piroscaf[a-zà-ÿ]*|battell[a-zà-ÿ]*\s+a\s+vapore)\b/iu },
  { label: "Stampa tipografica", re: /\b(?:tipograf[a-zà-ÿ]*|stampa\s+a\s+caratteri\s+mobili)\b/iu },
  { label: "Automobile", re: /\b(?:automobil[a-zà-ÿ]*|autovettur[a-zà-ÿ]*)\b/iu },
  { label: "Radiofonia", re: /\b(?:radiotelegraf[a-zà-ÿ]*|radiofon[a-zà-ÿ]*)\b/iu },
  { label: "Cinematografia", re: /\b(?:cinematograf[a-zà-ÿ]*|cinepresa[a-zà-ÿ]*)\b/iu },
] as const;
const MAX_SCENES = 16;
const MAX_SCENE_CHARS = 24_000;
const NEARBY_YEAR_CHARS = 110;
const MAX_PROPOSALS = 5;

export function proposeHistoricalQueriesLocally(
  scenes: readonly { text?: string }[],
): string[] {
  if (!Array.isArray(scenes)) return [];
  const candidates: Array<{ query: string; topic: string; scene: number; offset: number }> = [];
  for (const [sceneIndex, scene] of scenes.slice(0, MAX_SCENES).entries()) {
    const text = typeof scene?.text === "string"
      ? scene.text.slice(0, MAX_SCENE_CHARS) : "";
    if (!text) continue;
    const years = [...text.matchAll(/\b(?:1[3-9]\d{2}|20\d{2})\b/g)]
      .map(m => ({ year: m[0], offset: m.index ?? 0 }));
    for (const topic of PUBLIC_TOPICS) {
      const match = topic.re.exec(text);
      if (!match || match.index === undefined) continue;
      const nearby = years
        .map(y => ({ ...y, distance: Math.abs(y.offset - match.index) }))
        .filter(y => y.distance <= NEARBY_YEAR_CHARS)
        .sort((a,b) => a.distance - b.distance);
      // Two equally near, DIFFERENT dates are ambiguous: never choose one.
      const year = nearby[0] && !(nearby[1] &&
        nearby[1].distance === nearby[0].distance &&
        nearby[1].year !== nearby[0].year)
        ? nearby[0].year : "storia";
      candidates.push({
        query: topic.label + " " + year,
        topic: topic.label,
        scene: sceneIndex,
        offset: match.index,
      });
    }
  }
  candidates.sort((a,b) => a.scene - b.scene || a.offset - b.offset);
  const result: string[] = [];
  const seenTopics = new Set<string>();
  for (const candidate of candidates) {
    if (seenTopics.has(candidate.topic)) continue;
    seenTopics.add(candidate.topic);
    result.push(candidate.query);
    if (result.length >= MAX_PROPOSALS) break;
  }
  return result;
}
