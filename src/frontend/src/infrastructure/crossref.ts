import { normalizeDois, type BibliographicWork } from "../domain/bibliography";

/** Direct read-only metadata lookup. An abstract or DOI record is never used
 * as evidence that the claims in the underlying paper are true. */
const API = "https://api.crossref.org/works/";
const LIMIT = 120_000;
const TIMEOUT = 12_000;
interface CrossrefMessage {
  DOI?: unknown; title?: unknown; author?: unknown;
  "container-title"?: unknown;
  publisher?: unknown; type?: unknown;
  issued?: { "date-parts"?: unknown };
}
interface CrossrefResponse { status?: string; message?: CrossrefMessage }

function clippedString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0,max) : "";
}
function firstString(value: unknown, max: number): string {
  return Array.isArray(value) ? clippedString(value[0], max) : "";
}
function authors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0,8).map(item => {
    if (!item || typeof item !== "object") return "";
    const author = item as {given?:unknown; family?:unknown; name?:unknown};
    return [clippedString(author.given,55),clippedString(author.family,65)].filter(Boolean).join(" ") ||
      clippedString(author.name,120);
  }).filter(Boolean);
}

export async function lookupCrossrefDois(
  values: readonly string[], signal?: AbortSignal,
): Promise<BibliographicWork[]> {
  const dois = normalizeDois(values);
  const lookedUpAt = new Date().toISOString();
  const output: BibliographicWork[] = [];
  for (const doi of dois) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    const parentAbort = () => controller.abort();
    signal?.addEventListener("abort", parentAbort, {once:true});
    try {
      if (signal?.aborted) throw new DOMException("Ricerca DOI annullata.","AbortError");
      const response = await fetch(API+doi.split("/").map(encodeURIComponent).join("/"),{
        method:"GET",credentials:"omit",redirect:"error",referrerPolicy:"no-referrer",
        cache:"no-store",signal:controller.signal,
      });
      // A DOI not registered in Crossref is an absence, not corroborating evidence.
      if (response.status===404) continue;
      if (!response.ok) throw new Error("Crossref non disponibile (HTTP "+response.status+").");
      if (Number(response.headers.get("content-length")??0)>LIMIT)
        throw new Error("Risposta Crossref troppo grande.");
      const raw = await response.text();
      if (raw.length>LIMIT) throw new Error("Risposta Crossref troppo grande.");
      let payload: CrossrefResponse;
      try { payload=JSON.parse(raw) as CrossrefResponse; }
      catch { throw new Error("Crossref ha restituito JSON non valido."); }
      if (!payload || payload.status!=="ok" || !payload.message)
        throw new Error("Record Crossref incompleto.");
      const message = payload.message;
      if (typeof message.DOI!=="string" ||
          message.DOI.toLowerCase()!==doi)
        throw new Error("Crossref ha restituito un DOI diverso da quello richiesto.");
      const title=firstString(message.title,300);
      if (title.length<2) continue;
      const type=clippedString(message.type,90);
      if(type.length<2) continue;
      const dateParts=message.issued?.["date-parts"];
      const first=Array.isArray(dateParts)&&Array.isArray(dateParts[0]) ? dateParts[0][0] : undefined;
      const year=Number.isSafeInteger(first)&&first>=1400&&first<=2200 ? first as number : undefined;
      output.push({
        id:"crossref:"+doi+":"+Date.parse(lookedUpAt),provider:"crossref",doi,title,
        authors:authors(message.author),workType:type,
        ...(year!==undefined?{publicationYear:year}:{}),
        ...(firstString(message["container-title"],180)?
          {venue:firstString(message["container-title"],180)}:{}),
        ...(clippedString(message.publisher,180)?
          {publisher:clippedString(message.publisher,180)}:{}),
        url:"https://doi.org/"+doi,retrievedAt:lookedUpAt,
      });
    } catch(e) {
      if(signal?.aborted) throw new DOMException("Ricerca DOI annullata.","AbortError");
      if(controller.signal.aborted) throw new Error("Timeout consultazione Crossref: nessun DOI salvato.");
      throw e;
    } finally {
      clearTimeout(timer);signal?.removeEventListener("abort",parentAbort);
    }
  }
  return output;
}
