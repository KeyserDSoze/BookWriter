import type { ResearchSource } from "../domain/web-research";

/** Anonymous read-only Wikipedia Action API for the autopilot's web research.
 * Only the query (screened on the device) leaves the browser: no manuscript,
 * secret, key, cookie or referrer. A tertiary source, never a verification. */
const REQUEST_TIMEOUT = 12_000;
const MAX_RESPONSE_BYTES = 200_000;

interface WikiPage { pageid?: number; title?: string; canonicalurl?: string; extract?: string; index?: number }

function trustedPageUrl(value: string, language: "it" | "en"): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === language + ".wikipedia.org" && url.pathname.startsWith("/wiki/") &&
      !url.username && !url.password;
  } catch { return false; }
}

export async function searchWikipedia(query: string, language: "it" | "en", signal?: AbortSignal): Promise<{ summary: string; sources: ResearchSource[] }> {
  const params = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: query, gsrnamespace: "0", gsrlimit: "3",
    prop: "extracts|info", inprop: "url", explaintext: "1", exintro: "1", exchars: "900",
    format: "json", formatversion: "2", origin: "*",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  const abortParent = () => controller.abort();
  signal?.addEventListener("abort", abortParent, { once: true });
  try {
    if (signal?.aborted) throw new DOMException("Ricerca interrotta.", "AbortError");
    const response = await fetch(`https://${language}.wikipedia.org/w/api.php?` + params.toString(), {
      method: "GET", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store", signal: controller.signal,
    });
    if (!response.ok) throw new Error("Wikipedia non disponibile (HTTP " + response.status + ").");
    if (Number(response.headers.get("content-length") || "0") > MAX_RESPONSE_BYTES) throw new Error("Risposta di Wikipedia troppo grande.");
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) throw new Error("Risposta di Wikipedia troppo grande.");
    let data: { error?: unknown; query?: { pages?: WikiPage[] } };
    try { data = JSON.parse(raw); } catch { throw new Error("Wikipedia non ha restituito JSON valido."); }
    if (!data || typeof data !== "object" || data.error) throw new Error("Wikipedia non ha restituito un risultato valido.");
    const pages = data.query?.pages ?? [];
    if (!Array.isArray(pages)) throw new Error("Formato della risposta di Wikipedia non valido.");
    const sources: ResearchSource[] = [];
    for (const page of [...pages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).slice(0, 10)) {
      if (sources.length >= 3) break;
      if (typeof page.title !== "string" || !page.title.trim() || typeof page.canonicalurl !== "string" ||
          !trustedPageUrl(page.canonicalurl, language) || typeof page.extract !== "string" || !page.extract.trim()) continue;
      sources.push({ title: page.title.trim().slice(0, 200), url: page.canonicalurl,
        excerpt: page.extract.replace(/\s+/g, " ").trim().slice(0, 600) });
    }
    const summary = sources.length ? sources.map(s => `${s.title}: ${s.excerpt}`).join(" ").slice(0, 4000)
      : "Nessuna voce di Wikipedia trovata per questa ricerca.";
    return { summary, sources };
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Ricerca interrotta.", "AbortError");
    if (controller.signal.aborted) throw new Error("Timeout nella ricerca su Wikipedia.");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortParent);
  }
}
