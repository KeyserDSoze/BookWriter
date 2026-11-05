import { isTrustedHistoricalUrl, normalizeResearchQueries, type HistoricalSource } from "../domain/historical-research";

/** Anonymous read-only Wikipedia IT Action API. No manuscript, secret, AI key,
 * author profile, cookie or GitHub credential is included in this request.
 * Source extracts are tertiary research leads, not independent verification.
 */
const API = "https://it.wikipedia.org/w/api.php";
const REQUEST_TIMEOUT = 12_000;
const MAX_RESPONSE_BYTES = 170_000;

interface WikiPage {
  pageid?: number; title?: string; canonicalurl?: string; extract?: string;
  revisions?: Array<{ revid?: number }>;
}
interface WikiSearchResponse {
  error?: { code?: string };
  query?: { pages?: WikiPage[] };
}

export async function searchHistoricalWikipedia(
  requestedQueries: readonly string[],
  signal?: AbortSignal,
): Promise<HistoricalSource[]> {
  const queries = normalizeResearchQueries(requestedQueries);
  const output: HistoricalSource[] = [];
  const searchedAt = new Date().toISOString();
  for (const query of queries) {
    const params = new URLSearchParams({
      action: "query", generator: "search", gsrsearch: query,
      gsrnamespace: "0", gsrlimit: "3", prop: "extracts|info|revisions",
      inprop: "url", explaintext: "1", exintro: "1", exchars: "1000",
      rvprop: "ids", rvlimit: "1", format: "json",
      formatversion: "2", origin: "*",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    const abortParent = () => controller.abort();
    signal?.addEventListener("abort", abortParent, { once: true });
    try {
      if (signal?.aborted) throw new DOMException("Ricerca interrotta.", "AbortError");
      const response = await fetch(API + "?" + params.toString(), {
        method: "GET", credentials: "omit", redirect: "error",
        referrerPolicy: "no-referrer", cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error("Wikipedia non disponibile (HTTP " + response.status + ").");
      const declaredSize = Number(response.headers.get("content-length") || "0");
      if (declaredSize > MAX_RESPONSE_BYTES) throw new Error("Risposta storica troppo grande.");
      const raw = await response.text();
      if (raw.length > MAX_RESPONSE_BYTES) throw new Error("Risposta storica troppo grande.");
      let data: WikiSearchResponse;
      try { data = JSON.parse(raw) as WikiSearchResponse; }
      catch { throw new Error("La risposta storica non contiene JSON valido."); }
      if (!data || typeof data !== "object" || data.error)
        throw new Error("La ricerca Wikipedia non ha restituito un risultato valido.");
      const pages = data.query?.pages;
      if (pages !== undefined && !Array.isArray(pages)) throw new Error("Formato pagina non valido.");
      let accepted = 0;
      for (const page of (pages ?? []).slice(0, 20)) {
        if (accepted >= 3) break;
        if (!Number.isSafeInteger(page.pageid) || !page.pageid || page.pageid <= 0 ||
            typeof page.title !== "string" || !page.title.trim() ||
            typeof page.canonicalurl !== "string" ||
            !isTrustedHistoricalUrl(page.canonicalurl) ||
            typeof page.extract !== "string" || !page.extract.trim()) continue;
        const revision = page.revisions?.[0]?.revid;
        const revisionId = Number.isSafeInteger(revision) && revision! > 0 ? revision : undefined;
        const source: HistoricalSource = {
          id: "itwiki:" + page.pageid + ":" + (revisionId ?? 0),
          provider: "it.wikipedia.org",
          pageId: page.pageid,
          ...(revisionId ? {revisionId} : {}),
          title: page.title.trim().slice(0, 220),
          url: page.canonicalurl,
          excerpt: page.extract.replace(/\s+/g, " ").trim().slice(0, 1300),
          query, retrievedAt: searchedAt,
        };
        const duplicate = output.find(s => s.id === source.id);
        if (!duplicate) { output.push(source); accepted++; }
      }
    } catch (error) {
      if (signal?.aborted) throw new DOMException("Ricerca storica interrotta.", "AbortError");
      if (controller.signal.aborted) throw new Error("Timeout nella ricerca storica: nessuna fonte salvata.");
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortParent);
    }
  }
  return output;
}
