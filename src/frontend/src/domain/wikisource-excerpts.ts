import type { ChapterHistoricalDossier } from "./historical-research";

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
export function validateWikisourceExcerpt(item:WikisourceExcerpt):boolean{
  try{
    return !!item && item.provider==="it.wikisource.org" &&
      Number.isSafeInteger(item.pageId) && item.pageId>0 &&
      Number.isSafeInteger(item.revisionId) && item.revisionId>0 &&
      item.id==="itws:"+item.pageId+":"+item.revisionId &&
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
  return allWikisourceExcerpts(dossier).filter(s=>ids.has(s.id));
}
export function extendWikisourceDossier(
  previous:ChapterHistoricalDossier|undefined,
  queries:readonly string[], found:readonly WikisourceExcerpt[], searchedAt:string,
):ChapterHistoricalDossier{
  const approved=normalizeWikisourceQueries(queries);
  if(!Number.isFinite(Date.parse(searchedAt)) || !Array.isArray(found) || found.length>6 ||
      found.some(item=>!validateWikisourceExcerpt(item)||!approved.includes(item.query)))
    throw new Error("Gli estratti Wikisource non corrispondono alle query e revisioni approvate.");
  const all=new Map(allWikisourceExcerpts(previous).map(item=>[item.id,item]));
  for(const item of found){
    const older=all.get(item.id);
    if(older && (older.excerpt!==item.excerpt || older.url!==item.url ||
      older.revisionAt!==item.revisionAt || older.title!==item.title))
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
