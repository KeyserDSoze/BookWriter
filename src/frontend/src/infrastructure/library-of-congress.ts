import {
  locItemUrl, normalizeArchiveQueries, type ArchivalCatalogItem,
} from "../domain/archival-catalog";

/** Library of Congress public search API. Results are catalogue metadata only.
 * Never send manuscript content, canon, secrets, PAT or AI keys. */
const ENDPOINT = "https://www.loc.gov/search/";
const MAX_RESPONSE = 240_000;
const TIMEOUT = 12_000;

function clipped(value: unknown, limit: number): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, limit);
  if (Array.isArray(value)) {
    const first = value.find(v => typeof v === "string");
    return typeof first === "string" ? clipped(first, limit) : "";
  }
  return "";
}
function itemIdFromLocUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (!["http:","https:"].includes(url.protocol) || url.hostname !== "www.loc.gov" ||
        url.username || url.password || url.port || url.search || url.hash) return;
    const matched = /^\/item\/([a-zA-Z0-9][a-zA-Z0-9._-]{2,79})\/?$/.exec(url.pathname);
    if (!matched) return;
    locItemUrl(matched[1]!);
    return matched[1];
  } catch { return; }
}
interface SearchResult {
  id?: unknown;
  title?: unknown;
  date?: unknown;
  description?: unknown;
}
interface SearchResponse {
  results?: unknown;
}

export async function searchLibraryOfCongress(
  authorQueries: readonly string[], signal?: AbortSignal,
): Promise<ArchivalCatalogItem[]> {
  const queries = normalizeArchiveQueries(authorQueries);
  const retrievedAt = new Date().toISOString();
  const items: ArchivalCatalogItem[] = [];
  for (const query of queries) {
    const params = new URLSearchParams({fo:"json",q:query,c:"3",sp:"1"});
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);
    const abortParent = () => controller.abort();
    signal?.addEventListener("abort",abortParent,{once:true});
    try {
      if (signal?.aborted) throw new DOMException("Ricerca archivistica annullata.","AbortError");
      const response = await fetch(ENDPOINT + "?" + params.toString(),{
        method:"GET",credentials:"omit",redirect:"error",referrerPolicy:"no-referrer",
        cache:"no-store",signal:controller.signal,
      });
      if (!response.ok)
        throw new Error("Library of Congress non disponibile (HTTP " + response.status + ").");
      if (Number(response.headers.get("content-length") || "0") > MAX_RESPONSE)
        throw new Error("Risposta archivistica troppo grande.");
      const raw = await response.text();
      if (raw.length > MAX_RESPONSE) throw new Error("Risposta archivistica troppo grande.");
      let payload:SearchResponse;
      try {payload=JSON.parse(raw) as SearchResponse;}
      catch {throw new Error("Risposta archivistica senza JSON valido.");}
      if (!payload || typeof payload !== "object" || !Array.isArray(payload.results))
        throw new Error("Formato dei risultati d'archivio non valido.");
      for (const entry of (payload.results as SearchResult[]).slice(0,3)) {
        if (!entry || typeof entry !== "object") continue;
        const itemId=itemIdFromLocUrl(entry.id);
        const title=clipped(entry.title,300);
        if (!itemId || title.length < 2) continue;
        const id="loc:"+itemId+":"+Date.parse(retrievedAt);
        if (items.some(item => item.id === id)) continue;
        const date=clipped(entry.date,100);
        const description=clipped(entry.description,450);
        items.push({
          id,provider:"loc.gov",itemId,title,
          url:locItemUrl(itemId),query,retrievedAt,
          ...(date?{date}:{}),...(description?{description}:{}),
        });
      }
    } catch(err) {
      if (signal?.aborted) throw new DOMException("Ricerca archivistica annullata.","AbortError");
      if (controller.signal.aborted) throw new Error("Timeout Library of Congress: nessuna ricerca salvata.");
      throw err;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort",abortParent);
    }
  }
  return items;
}
