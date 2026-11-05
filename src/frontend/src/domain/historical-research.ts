/** Research is deliberately separate from narrative canon and model assertions.
 * Wikipedia entries are tertiary leads; they are never certified historical truth.
 * Only author-approved search strings leave the browser.
 */
export interface HistoricalSource {
  id: string;
  provider: "it.wikipedia.org";
  pageId: number;
  revisionId?: number;
  title: string;
  url: string;
  excerpt: string;
  query: string;
  retrievedAt: string;
}
export interface ChapterHistoricalDossier {
  queries: string[];
  /** All cited revisions retained for traceability across redaction rounds. */
  sources: HistoricalSource[];
  /** Only these source snapshots are included in new reviewer prompts. */
  activeSourceIds: string[];
  searchedAt: string;
  unansweredQueries: string[];
}
export type HistoricalAssessment = "consistent_with_excerpt" | "contradicts_excerpt" | "unverified";
export interface HistoricalClaim {
  claim: string;
  assessment: HistoricalAssessment;
  sourceIds: string[];
  sourceQuote?: string;
}

export function normalizeResearchQueries(queries: readonly string[]): string[] {
  if (!queries.length || queries.length > 5)
    throw new Error("Indica da uno a cinque argomenti storici pubblici per capitolo.");
  const result: string[] = [];
  for (const query of queries) {
    const cleaned = query.trim().replace(/\s+/g, " ");
    if (cleaned.length < 5 || cleaned.length > 110 || /[<>\\\u0000-\u001f]/.test(cleaned))
      throw new Error("Ogni ricerca deve essere una frase pubblica di 5–110 caratteri, senza codici o dati privati.");
    if (/(?:https?:\/\/|github_pat_|sk-[\w-]{10,}|-----BEGIN)/i.test(cleaned))
      throw new Error("Non inserire link, token o credenziali negli argomenti inviati a Wikipedia.");
    if (!result.some(existing => existing.toLocaleLowerCase("it") === cleaned.toLocaleLowerCase("it")))
      result.push(cleaned);
  }
  return result;
}
export function isTrustedHistoricalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "it.wikipedia.org" &&
      !url.username && !url.password && url.port === "" &&
      url.pathname.startsWith("/wiki/") && !url.search && !url.hash;
  } catch { return false; }
}
export function validateHistoricalSource(s: HistoricalSource): boolean {
  return s.provider === "it.wikipedia.org" && Number.isSafeInteger(s.pageId) &&
    s.pageId > 0 && !!s.id.match(/^itwiki:\d+:\d+$/) &&
    s.id === "itwiki:" + s.pageId + ":" + (s.revisionId ?? 0) &&
    (s.revisionId === undefined || Number.isSafeInteger(s.revisionId) && s.revisionId > 0) &&
    isTrustedHistoricalUrl(s.url) &&
    s.title.length > 0 && s.title.length <= 220 &&
    s.excerpt.length > 0 && s.excerpt.length <= 1300 &&
    s.query.length >= 5 && s.query.length <= 110 &&
    Number.isFinite(Date.parse(s.retrievedAt));
}
export function activeHistoricalSources(dossier?: ChapterHistoricalDossier): HistoricalSource[] {
  if (!dossier) return [];
  const active = new Set(dossier.activeSourceIds);
  return dossier.sources.filter(s => active.has(s.id) && validateHistoricalSource(s));
}
export function validateHistoricalClaim(
  claim: HistoricalClaim | undefined, dossier?: ChapterHistoricalDossier,
): void {
  if (!claim) throw new Error("Il revisore storico deve distinguere evidenza documentale e ipotesi.");
  const references = claim.sourceIds;
  if (new Set(references).size !== references.length || references.length > 3)
    throw new Error("Fonti storiche duplicate o troppe fonti per un rilievo.");
  if (claim.assessment === "unverified") {
    if (references.length || claim.sourceQuote?.trim())
      throw new Error("Una segnalazione storica non verificata non può citare fonti come prova.");
    return;
  }
  if (!references.length || !claim.sourceQuote?.trim())
    throw new Error("Un rilievo storico documentato deve citare una fonte e una frase originale.");
  const byId = new Map(activeHistoricalSources(dossier).map(s => [s.id, s]));
  const sources = references.map(id => byId.get(id));
  if (sources.some(s => !s)) throw new Error("Fonte storica inesistente, obsoleta o non approvata.");
  const quote = claim.sourceQuote.trim().toLocaleLowerCase("it");
  if (quote.length < 12 || !sources.some(s => s!.excerpt.toLocaleLowerCase("it").includes(quote)))
    throw new Error("La citazione storica non compare nell'estratto recuperato dal servizio.");
}
export function extendHistoricalDossier(
  previous: ChapterHistoricalDossier | undefined,
  queries: readonly string[], newSources: readonly HistoricalSource[],
  searchedAt: string,
): ChapterHistoricalDossier {
  const normalized = normalizeResearchQueries(queries);
  if (newSources.length > 15 || newSources.some(s => !validateHistoricalSource(s) ||
      !normalized.includes(s.query)))
    throw new Error("Le fonti ricevute non superano la validazione di origine, dimensione e corrispondenza.");
  const all = new Map((previous?.sources ?? []).map(s => [s.id,s]));
  for (const source of newSources) {
    const earlier = all.get(source.id);
    if (earlier && (earlier.excerpt !== source.excerpt || earlier.url !== source.url)) {
      throw new Error("La stessa revisione enciclopedica ha contenuto differente: aggiornamento rifiutato.");
    }
    all.set(source.id,source);
  }
  if (all.size > 100) throw new Error("Archivio delle fonti troppo grande: non cancellare citazioni storiche già approvate.");
  const activeSourceIds = [...new Set(newSources.map(s => s.id))];
  return {
    queries: normalized, sources: [...all.values()], activeSourceIds, searchedAt,
    unansweredQueries: normalized.filter(q => !newSources.some(s => s.query === q)),
  };
}
