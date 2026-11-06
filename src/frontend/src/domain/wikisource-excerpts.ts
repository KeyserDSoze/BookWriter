import type { ChapterHistoricalDossier } from "./historical-research";

/** Hash and exact offset of a literal slice of a specific MediaWiki revision's raw wikitext.
 * This is a provenance check against the API response, NOT proof of authorship, history or copyright.
 */
export interface WikisourceRevisionProof {
  method: "exact_revid_wikitext";
  contentSha256: string;
  contentLength: number;
  excerptOffset: number;
}
/** A remotely retrieved, community-edited transcription; NOT an authenticated original. */
export interface WikisourceExcerpt {
  id: string;
  provider: "it.wikisource.org";
  pageId: number;
  revisionId: number;
  revisionAt: string;
  title: string;
  url: string;
  excerpt: string;
  query: string;
  retrievedAt: string;
  evidenceStatus: "community_transcription_unverified";
  rightsStatus: "work_rights_not_verified";
  /** Absent on legacy v0.9.5 TextExtracts records (kept only for audit). */
  revisionProof?: WikisourceRevisionProof;
}
export interface ChapterWikisourceExcerpts {
  queries: string[];
  excerpts: WikisourceExcerpt[];
  activeExcerptIds: string[];
  missingQueries: string[];
  searchedAt: string;
}
export function normalizeWikisourceQueries(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 3)
    throw new Error("Inserisci da una a tre ricerche pubbliche per Wikisource.");
  const result:string[]=[];
  for(const input of values){
    if(typeof input!=="string") throw new Error("Ricerca Wikisource non valida.");
    const query=input.trim().replace(/\s+/g," ");
    if(query.length<5 || query.length>110 || /[<>\\\u0000-\u001f]/.test(query) ||
      /(?:https?:\/\/|github_pat_|ghp_|sk-[\w-]{10,}|-----BEGIN)/i.test(query))
      throw new Error("Usa ricerche pubbliche da 5 a 110 caratteri, senza URL, segreti o credenziali.");
    if(!result.some(q=>q.toLocaleLowerCase("it")===query.toLocaleLowerCase("it")))
      result.push(query);
  }
  return result;
}
export function wikisourcePageUrl(title:string):string{
  if(typeof title!=="string" || title.trim()!==title || !title || title.length>220 ||
      /[?#<>\\\u0000-\u001f]/.test(title) || title.split("/").some(part=>!part || part==="." || part===".."))
    throw new Error("Titolo Wikisource non valido.");
  return "https://it.wikisource.org/wiki/"+title.split("/").map(part=>
    encodeURIComponent(part.replace(/ /g,"_"))).join("/");
}
export function wikisourceRevisionUrl(revisionId:number):string{
  if(!Number.isSafeInteger(revisionId) || revisionId<=0)
    throw new Error("Revisione Wikisource non valida.");
  return "https://it.wikisource.org/w/index.php?oldid="+revisionId;
}
/** v0.9.6 sources must have a digest of the raw revision and a literal text offset. */
export function hasExactRevisionProof(item:WikisourceExcerpt):boolean{
  const p=item?.revisionProof;
  return !!p && p.method==="exact_revid_wikitext" &&
    typeof p.contentSha256==="string" && /^[0-9a-f]{64}$/.test(p.contentSha256) &&
    Number.isSafeInteger(p.contentLength) && p.contentLength>=24 && p.contentLength<=140_000 &&
    Number.isSafeInteger(p.excerptOffset) && p.excerptOffset>=0 &&
    p.excerptOffset+(typeof item.excerpt==="string"?item.excerpt.length:0)<=p.contentLength &&
    item.id==="itwsr:"+item.pageId+":"+item.revisionId+":"+p.contentSha256.slice(0,16);
}
export function validateWikisourceExcerpt(item:WikisourceExcerpt):boolean{
  try{
    return !!item && item.provider==="it.wikisource.org" &&
      Number.isSafeInteger(item.pageId) && item.pageId>0 &&
      Number.isSafeInteger(item.revisionId) && item.revisionId>0 &&
      (item.revisionProof===undefined
        ? item.id==="itws:"+item.pageId+":"+item.revisionId
        : hasExactRevisionProof(item)) &&
      typeof item.title==="string" && item.title.length>=2 && item.title.length<=220 &&
      item.url===wikisourcePageUrl(item.title) &&
      typeof item.excerpt==="string" && item.excerpt.trim().length>=24 &&
      item.excerpt.length<=1200 &&
      typeof item.query==="string" && normalizeWikisourceQueries([item.query])[0]===item.query &&
      typeof item.retrievedAt==="string" && Number.isFinite(Date.parse(item.retrievedAt)) &&
      typeof item.revisionAt==="string" && Number.isFinite(Date.parse(item.revisionAt)) &&
      item.evidenceStatus==="community_transcription_unverified" &&
      item.rightsStatus==="work_rights_not_verified";
  }catch{return false;}
}
export function allWikisourceExcerpts(dossier?:ChapterHistoricalDossier):WikisourceExcerpt[]{
  const items=dossier?.wikisource?.excerpts;
  return Array.isArray(items)?items.filter(validateWikisourceExcerpt):[];
}
export function activeWikisourceExcerpts(dossier?:ChapterHistoricalDossier):WikisourceExcerpt[]{
  const active=dossier?.wikisource?.activeExcerptIds;
  if(!Array.isArray(active))return [];
  const ids=new Set(active);
  // Legacy v0.9.5 TextExtracts snippets may have come from a *different* revision.
  // Keep those records visible for previous audit, but NEVER cite them in a new review.
  return allWikisourceExcerpts(dossier).filter(s=>ids.has(s.id)&&hasExactRevisionProof(s));
}
export function extendWikisourceDossier(
  previous:ChapterHistoricalDossier|undefined,
  queries:readonly string[], found:readonly WikisourceExcerpt[], searchedAt:string,
):ChapterHistoricalDossier{
  const approved=normalizeWikisourceQueries(queries);
  if(!Number.isFinite(Date.parse(searchedAt)) || !Array.isArray(found) || found.length>6 ||
      found.some(item=>!validateWikisourceExcerpt(item)||!hasExactRevisionProof(item)||
        !approved.includes(item.query)))
    throw new Error("Gli estratti Wikisource non corrispondono alle query e revisioni approvate.");
  const all=new Map(allWikisourceExcerpts(previous).map(item=>[item.id,item]));
  for(const item of found){
    const older=all.get(item.id);
    if(older && (older.excerpt!==item.excerpt || older.url!==item.url ||
      older.revisionAt!==item.revisionAt || older.title!==item.title ||
      JSON.stringify(older.revisionProof)!==JSON.stringify(item.revisionProof)))
      throw new Error("La stessa revisione Wikisource ha restituito testo differente: aggiornamento bloccato.");
    if(!older)all.set(item.id,item);
  }
  if(all.size>70) throw new Error("Archivio Wikisource pieno: salva prima un backup.");
  return {
    queries:previous?.queries??[], sources:previous?.sources??[],
    activeSourceIds:previous?.activeSourceIds??[],
    searchedAt:previous?.searchedAt??searchedAt,
    unansweredQueries:previous?.unansweredQueries??[],
    ...(previous?.bibliography?{bibliography:previous.bibliography}:{}),
    ...(previous?.archiveCatalog?{archiveCatalog:previous.archiveCatalog}:{}),
    ...(previous?.manualEvidence?{manualEvidence:previous.manualEvidence}:{}),
    wikisource:{
      queries:approved,excerpts:[...all.values()],
      activeExcerptIds:[...new Set(found.map(item=>item.id))],
      missingQueries:approved.filter(query=>!found.some(item=>item.query===query)),
      searchedAt,
    },
  };
}
