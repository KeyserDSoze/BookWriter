import type { ChapterHistoricalDossier } from "./historical-research";

/** A Crossref record is bibliographic metadata: it is NOT a quotation from
 * the underlying publication, and cannot substantiate a historical claim. */
export interface BibliographicWork {
  id: string;
  provider: "crossref";
  doi: string;
  title: string;
  authors: string[];
  publicationYear?: number;
  venue?: string;
  publisher?: string;
  workType: string;
  url: string;
  retrievedAt: string;
}
export interface ChapterBibliography {
  works: BibliographicWork[];
  activeWorkIds: string[];
  missingDois: string[];
  lookedUpAt: string;
}

/** Accept a pasted doi.org URL or DOI token, but never forward arbitrary URLs. */
export function normalizeDoi(value: string): string {
  const raw = value.trim().replace(/^doi:\s*/i, "").replace(/^https:\/\/doi\.org\//i, "");
  if (raw.length < 10 || raw.length > 180 ||
      !/^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i.test(raw)) {
    throw new Error("DOI non valido: inserisci soltanto un identificativo 10.xxxx/… o un link https://doi.org/… senza parametri.");
  }
  return raw.toLowerCase();
}
export function normalizeDois(values: readonly string[]): string[] {
  if (values.length < 1 || values.length > 5) throw new Error("Indica da uno a cinque DOI pubblici.");
  const valuesNormalized = values.map(normalizeDoi);
  return [...new Set(valuesNormalized)];
}
export function isValidBibliographicWork(work: BibliographicWork): boolean {
  try {
    if (!work || typeof work !== "object" || typeof work.doi !== "string" ||
        typeof work.id !== "string" || typeof work.title !== "string" ||
        typeof work.workType !== "string" || typeof work.url !== "string" ||
        typeof work.retrievedAt !== "string" || !Array.isArray(work.authors) ||
        work.authors.some(a => typeof a !== "string")) return false;
    const doi = normalizeDoi(work.doi);
    return work.provider === "crossref" && doi === work.doi &&
      work.id === "crossref:" + doi + ":" + Date.parse(work.retrievedAt) &&
      work.url === "https://doi.org/" + doi &&
      work.title.length >= 2 && work.title.length <= 300 &&
      work.workType.length >= 2 && work.workType.length <= 90 &&
      work.authors.length <= 8 && work.authors.every(a => a.length >= 1 && a.length <= 120) &&
      (!work.publisher || work.publisher.length <= 180) &&
      (!work.venue || work.venue.length <= 180) &&
      (work.publicationYear === undefined ||
        Number.isSafeInteger(work.publicationYear) && work.publicationYear >= 1400 &&
        work.publicationYear <= 2200);
  } catch { return false; }
}
export function activeBibliography(dossier?: ChapterHistoricalDossier): BibliographicWork[] {
  if (!dossier?.bibliography) return [];
  if (!Array.isArray(dossier.bibliography.works) ||
      !Array.isArray(dossier.bibliography.activeWorkIds)) return [];
  const active = new Set(dossier.bibliography.activeWorkIds);
  return dossier.bibliography.works.filter(w => isValidBibliographicWork(w) && active.has(w.id));
}
export function extendChapterBibliography(
  previous: ChapterHistoricalDossier | undefined,
  submitted: readonly string[],
  found: readonly BibliographicWork[],
  now: string,
): ChapterHistoricalDossier {
  const dois = normalizeDois(submitted);
  if (!Number.isFinite(Date.parse(now)) || found.length > 5 ||
      found.some(w => !isValidBibliographicWork(w) || !dois.includes(w.doi)))
    throw new Error("Riferimenti DOI esterni invalidi: il dossier non viene modificato.");
  const archive = new Map((previous?.bibliography?.works ?? []).map(w => [w.id,w]));
  for(const w of found) {
    const old = archive.get(w.id);
    if (old && JSON.stringify(old) !== JSON.stringify(w))
      throw new Error("Conflitto tra metadati con la stessa identificazione: bibliografia non modificata.");
    archive.set(w.id, w);
  }
  if(archive.size > 80) throw new Error("Troppe versioni bibliografiche: effettua un backup prima di aggiornare.");
  const bibliography: ChapterBibliography = {
    works: [...archive.values()],
    activeWorkIds: [...new Set(found.map(w => w.id))],
    missingDois: dois.filter(doi => !found.some(w => w.doi === doi)),
    lookedUpAt: now,
  };
  return {
    queries: previous?.queries ?? [],
    sources: previous?.sources ?? [],
    activeSourceIds: previous?.activeSourceIds ?? [],
    searchedAt: previous?.searchedAt ?? now,
    unansweredQueries: previous?.unansweredQueries ?? [],
    bibliography,
    ...(previous?.archiveCatalog ? {archiveCatalog:previous.archiveCatalog} : {}),
    ...(previous?.manualEvidence ? {manualEvidence:previous.manualEvidence} : {}),
    ...(previous?.wikisource ? {wikisource:previous.wikisource} : {}),
    ...(previous?.locOcr ? {locOcr:previous.locOcr} : {}),
    ...(previous?.sourceRelations ? {sourceRelations:previous.sourceRelations} : {}),
  };
}
