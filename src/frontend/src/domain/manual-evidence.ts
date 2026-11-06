import type { ChapterHistoricalDossier } from "./historical-research";
import { activeArchivalItems, locItemUrl } from "./archival-catalog";

/** Author-transcribed material, NOT independently fetched or authenticated. */
export interface ManualDocumentExcerpt {
  id: string;
  provider: "author-transcribed-loc";
  catalogItemId: string;
  itemId: string;
  title: string;
  url: string;
  locator: string;
  text: string;
  documentDate?: string;
  rightsBasis: "public_domain" | "permission";
  rightsNote: string;
  rightsAttested: true;
  submittedAt: string;
}
export interface ChapterManualEvidence {
  excerpts: ManualDocumentExcerpt[];
  activeExcerptIds: string[];
  updatedAt: string;
}
export interface ManualExcerptInput {
  catalogItemId: string;
  locator: string;
  text: string;
  documentDate?: string;
  rightsBasis: ManualDocumentExcerpt["rightsBasis"];
  rightsNote: string;
  /** Required even when the author manually calls this use case. */
  rightsAttested: true;
}
export function validateManualExcerpt(item: ManualDocumentExcerpt): boolean {
  try {
    const stamp = Date.parse(item.submittedAt);
    return item.provider === "author-transcribed-loc" && Number.isFinite(stamp) &&
      item.id === "locex:" + item.itemId + ":" + stamp &&
      item.url === locItemUrl(item.itemId) &&
      typeof item.catalogItemId === "string" && /^loc:[a-zA-Z0-9._-]+:\d+$/.test(item.catalogItemId) &&
      item.catalogItemId.startsWith("loc:" + item.itemId + ":") &&
      typeof item.title === "string" && item.title.length >= 2 && item.title.length <= 300 &&
      typeof item.locator === "string" && item.locator.trim().length >= 4 && item.locator.length <= 140 &&
      typeof item.text === "string" && item.text.trim().length >= 24 && item.text.length <= 1200 &&
      (item.documentDate === undefined || typeof item.documentDate === "string" &&
        item.documentDate.trim().length >= 4 && item.documentDate.length <= 100) &&
      (item.rightsBasis === "public_domain" || item.rightsBasis === "permission") &&
      typeof item.rightsNote === "string" &&
      item.rightsNote.trim().length >= 16 && item.rightsNote.length <= 280 &&
      item.rightsAttested === true;
  } catch { return false; }
}
/** Historical snapshots must remain viewable, even when no longer eligible for new citations. */
export function allManualEvidence(dossier?: ChapterHistoricalDossier): ManualDocumentExcerpt[] {
  const items = dossier?.manualEvidence?.excerpts;
  return Array.isArray(items) ? items.filter(validateManualExcerpt) : [];
}
/** Only approved snapshots whose exact catalogue record is still active can be cited. */
export function activeManualEvidence(dossier?: ChapterHistoricalDossier): ManualDocumentExcerpt[] {
  const data = dossier?.manualEvidence;
  if (!data || !Array.isArray(data.activeExcerptIds)) return [];
  const active = new Set(data.activeExcerptIds);
  const catalog = new Set(activeArchivalItems(dossier).map(item => item.id));
  return allManualEvidence(dossier).filter(item => active.has(item.id) &&
    catalog.has(item.catalogItemId));
}
export function appendManualEvidence(
  previous: ChapterHistoricalDossier | undefined,
  input: ManualExcerptInput,
  submittedAt: string,
): ChapterHistoricalDossier {
  if (!input || input.rightsAttested !== true ||
      !["public_domain","permission"].includes(input.rightsBasis))
    throw new Error("Devi confermare esplicitamente i diritti di riutilizzo dell'estratto.");
  const catalogItem = activeArchivalItems(previous).find(x => x.id === input.catalogItemId);
  if (!catalogItem) throw new Error("La scheda d'archivio non è attiva o non appartiene al capitolo.");
  if (!Number.isFinite(Date.parse(submittedAt))) throw new Error("Data di trascrizione non valida.");
  const entry: ManualDocumentExcerpt = {
    id:"locex:" + catalogItem.itemId + ":" + Date.parse(submittedAt),
    provider:"author-transcribed-loc",
    catalogItemId:catalogItem.id,
    itemId:catalogItem.itemId,
    title:catalogItem.title,
    url:catalogItem.url,
    locator:input.locator?.trim() ?? "",
    text:input.text?.trim() ?? "",
    ...(input.documentDate?.trim()?{documentDate:input.documentDate.trim()}:{}),
    rightsBasis:input.rightsBasis,
    rightsNote:input.rightsNote?.trim() ?? "",
    rightsAttested:true,
    submittedAt,
  };
  if (!validateManualExcerpt(entry))
    throw new Error("Estratto non valido: verifica localizzatore, testo (24–1200), data e motivazione diritti (16–280).");
  const previousItems = previous?.manualEvidence?.excerpts ?? [];
  if (previousItems.some(x => x.id === entry.id))
    throw new Error("Conflitto tra snapshot: non sovrascrivere una trascrizione precedente.");
  if (previousItems.length >= 40)
    throw new Error("Archivio estratti pieno: effettua un backup prima di aggiungere altri documenti.");
  const activePrevious=activeManualEvidence(previous)
    .filter(x => x.itemId !== entry.itemId).map(x => x.id);
  if (activePrevious.length >= 5)
    throw new Error("Massimo cinque documenti attivi per capitolo.");
  return {
    queries: previous?.queries ?? [],
    sources: previous?.sources ?? [],
    activeSourceIds: previous?.activeSourceIds ?? [],
    searchedAt: previous?.searchedAt ?? submittedAt,
    unansweredQueries: previous?.unansweredQueries ?? [],
    ...(previous?.bibliography ? {bibliography:previous.bibliography} : {}),
    ...(previous?.archiveCatalog ? {archiveCatalog:previous.archiveCatalog} : {}),
    ...(previous?.wikisource ? {wikisource:previous.wikisource} : {}),
    ...(previous?.locOcr ? {locOcr:previous.locOcr} : {}),
    manualEvidence: {
      excerpts:[...previousItems, entry],
      activeExcerptIds:[...activePrevious,entry.id],
      updatedAt:submittedAt,
    },
  };
}
