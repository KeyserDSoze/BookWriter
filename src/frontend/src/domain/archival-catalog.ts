import type { ChapterHistoricalDossier } from "./historical-research";
import type { ChapterInstitutionalInspections } from "./institutional-inspection";

/** LoC catalogue metadata is an archival LEAD, not a quotation from a document. */
export interface ArchivalCatalogItem {
  id: string;
  provider: "loc.gov";
  itemId: string;
  title: string;
  url: string;
  query: string;
  retrievedAt: string;
  date?: string;
  description?: string;
}
export interface ChapterArchiveCatalog {
  queries: string[];
  items: ArchivalCatalogItem[];
  activeItemIds: string[];
  missingQueries: string[];
  searchedAt: string;
  inspections?: ChapterInstitutionalInspections;
}
export function normalizeArchiveQueries(input: readonly string[]): string[] {
  if (!input.length || input.length > 3)
    throw new Error("Inserisci da una a tre ricerche pubbliche per la Library of Congress.");
  const queries: string[] = [];
  for (const raw of input) {
    const query = raw.trim().replace(/\s+/g, " ");
    if (query.length < 5 || query.length > 110 || /[<>\\\u0000-\u001f]/.test(query) ||
        /(?:https?:\/\/|github_pat_|ghp_|sk-[\w-]{10,}|-----BEGIN)/i.test(query))
      throw new Error("Le ricerche archivistiche devono essere frasi pubbliche da 5 a 110 caratteri, senza URL o credenziali.");
    if (!queries.some(q => q.toLocaleLowerCase("it") === query.toLocaleLowerCase("it")))
      queries.push(query);
  }
  return queries;
}
export function locItemUrl(itemId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(itemId))
    throw new Error("Identificativo della Library of Congress non valido.");
  return "https://www.loc.gov/item/" + itemId + "/";
}
export function isValidArchivalCatalogItem(item: ArchivalCatalogItem): boolean {
  try {
    if (!item || item.provider !== "loc.gov" ||
        typeof item.id !== "string" || typeof item.itemId !== "string" ||
        typeof item.url !== "string" || typeof item.title !== "string" ||
        typeof item.query !== "string" || typeof item.retrievedAt !== "string")
      return false;
    const stamp = Date.parse(item.retrievedAt);
    return Number.isFinite(stamp) &&
      item.id === "loc:" + item.itemId + ":" + stamp &&
      item.url === locItemUrl(item.itemId) &&
      item.title.trim().length >= 2 && item.title.length <= 300 &&
      normalizeArchiveQueries([item.query])[0] === item.query &&
      (item.date === undefined || typeof item.date === "string" && item.date.length <= 100) &&
      (item.description === undefined || typeof item.description === "string" &&
        item.description.length <= 450);
  } catch { return false; }
}
export function activeArchivalItems(dossier?: ChapterHistoricalDossier): ArchivalCatalogItem[] {
  const catalog = dossier?.archiveCatalog;
  if (!catalog || !Array.isArray(catalog.items) || !Array.isArray(catalog.activeItemIds))
    return [];
  const active = new Set(catalog.activeItemIds);
  return catalog.items.filter(item => active.has(item.id) && isValidArchivalCatalogItem(item));
}
export function extendArchiveCatalog(
  previous: ChapterHistoricalDossier | undefined,
  queries: readonly string[], found: readonly ArchivalCatalogItem[], at: string,
): ChapterHistoricalDossier {
  const normalized = normalizeArchiveQueries(queries);
  if (!Number.isFinite(Date.parse(at)) || found.length > 9 ||
      found.some(item => !isValidArchivalCatalogItem(item) || !normalized.includes(item.query)))
    throw new Error("Record d'archivio non validi: nessuna modifica salvata.");
  const archive = new Map((previous?.archiveCatalog?.items ?? []).map(item => [item.id, item]));
  for (const item of found) {
    const old = archive.get(item.id);
    if (old && JSON.stringify(old) !== JSON.stringify(item))
      throw new Error("Un record d'archivio ha cambiato contenuto sotto lo stesso ID.");
    archive.set(item.id, item);
  }
  if (archive.size > 80)
    throw new Error("Archivio locale troppo grande: effettua prima un backup.");
  return {
    queries: previous?.queries ?? [],
    sources: previous?.sources ?? [],
    activeSourceIds: previous?.activeSourceIds ?? [],
    searchedAt: previous?.searchedAt ?? at,
    unansweredQueries: previous?.unansweredQueries ?? [],
    ...(previous?.bibliography ? {bibliography: previous.bibliography} : {}),
    ...(previous?.manualEvidence ? {manualEvidence:previous.manualEvidence} : {}),
    ...(previous?.wikisource ? {wikisource:previous.wikisource} : {}),
    archiveCatalog: {
      queries: normalized, items: [...archive.values()],
      activeItemIds: [...new Set(found.map(item => item.id))],
      missingQueries: normalized.filter(query => !found.some(item => item.query === query)),
      searchedAt: at,
      ...(previous?.archiveCatalog?.inspections ? {inspections:previous.archiveCatalog.inspections}:{}),
    },
  };
}
