import type { ChapterHistoricalDossier } from "./historical-research";
import { activeArchivalItems,locItemUrl } from "./archival-catalog";
import { activeInstitutionalInspections } from "./institutional-inspection";

/** The LoC OCR *as retrieved*, never authenticated against the historical original.
 * Rights basis is an explicit author's assertion, never computed from API metadata.
 */
export interface LocOcrExcerpt {
  id:string;
  provider:"loc.gov-ocr";
  catalogItemId:string;
  inspectionId:string;
  itemId:string;
  title:string;
  url:string;
  textUrl:string;
  excerpt:string;
  contentSha256:string;
  contentLength:number;
  excerptOffset:number;
  acquiredAt:string;
  rightsBasis:"public_domain"|"permission";
  rightsNote:string;
  rightsAttested:true;
  evidenceStatus:"institutional_ocr_unverified";
  rightsStatus:"author_attested_unverified";
}
export interface ChapterLocOcr {
  excerpts:LocOcrExcerpt[];
  activeExcerptIds:string[];
  updatedAt:string;
}
export interface LocOcrRights {
  rightsBasis:LocOcrExcerpt["rightsBasis"];
  rightsNote:string;
  rightsAttested:true;
}

/** Only an HTTPS plaintext file under LoC's static storage service is eligible.
 * Never trust redirects, arbitrary external URLs or a file found in JSON `files`.
 */
export function trustedLocTextUrl(value:string):boolean{
  try{
    const u=new URL(value);
    return u.protocol==="https:"&&u.hostname==="tile.loc.gov"&&!u.port&&
      !u.username&&!u.password&&!u.search&&!u.hash&&
      u.pathname.startsWith("/storage-services/")&&
      /^\/storage-services\/(?:service|master)\/[a-zA-Z0-9/_.%-]+\.txt$/.test(u.pathname)&&
      !u.pathname.split("/").some(seg=>seg==="."||seg===".."||
        /%2f|%5c|%2e/i.test(seg));
  }catch{return false;}
}
export function validLocOcrExcerpt(item:LocOcrExcerpt):boolean{
  try{
    const t=Date.parse(item.acquiredAt);
    return !!item&&item.provider==="loc.gov-ocr"&&
      Number.isSafeInteger(t)&&typeof item.itemId==="string"&&
      item.url===locItemUrl(item.itemId)&&
      typeof item.catalogItemId==="string"&&
      /^loc:[a-zA-Z0-9._-]+:\d+$/.test(item.catalogItemId)&&
      item.catalogItemId.startsWith("loc:"+item.itemId+":")&&
      typeof item.inspectionId==="string"&&
      /^locdetail:[a-zA-Z0-9._-]+:\d+$/.test(item.inspectionId)&&
      item.inspectionId.startsWith("locdetail:"+item.itemId+":")&&
      typeof item.title==="string"&&item.title.trim().length>=2&&item.title.length<=300&&
      typeof item.textUrl==="string"&&trustedLocTextUrl(item.textUrl)&&
      typeof item.contentSha256==="string"&&/^[a-f0-9]{64}$/.test(item.contentSha256)&&
      item.id==="lococr:"+item.itemId+":"+t+":"+item.contentSha256.slice(0,16)&&
      typeof item.excerpt==="string"&&item.excerpt.trim().length>=24&&item.excerpt.length<=1000&&
      Number.isSafeInteger(item.contentLength)&&item.contentLength>=24&&item.contentLength<=160_000&&
      Number.isSafeInteger(item.excerptOffset)&&item.excerptOffset>=0&&
      item.excerptOffset+item.excerpt.length<=item.contentLength&&
      (item.rightsBasis==="public_domain"||item.rightsBasis==="permission")&&
      typeof item.rightsNote==="string"&&item.rightsNote.trim().length>=16&&
      item.rightsNote.length<=280&&item.rightsAttested===true&&
      item.evidenceStatus==="institutional_ocr_unverified"&&
      item.rightsStatus==="author_attested_unverified";
  }catch{return false;}
}
export function allLocOcrExcerpts(dossier?:ChapterHistoricalDossier):LocOcrExcerpt[]{
  const records=dossier?.locOcr?.excerpts;
  return Array.isArray(records)?records.filter(validLocOcrExcerpt):[];
}
export function activeLocOcrExcerpts(dossier?:ChapterHistoricalDossier):LocOcrExcerpt[]{
  const ids=dossier?.locOcr?.activeExcerptIds;
  if(!Array.isArray(ids))return [];
  const active=new Set(ids);
  const catalog=new Set(activeArchivalItems(dossier).map(x=>x.id));
  const inspections=new Set(activeInstitutionalInspections(dossier).map(x=>x.id));
  return allLocOcrExcerpts(dossier).filter(item=>active.has(item.id)&&
    catalog.has(item.catalogItemId)&&inspections.has(item.inspectionId));
}
export function appendLocOcrExcerpt(
  previous:ChapterHistoricalDossier|undefined,source:LocOcrExcerpt,
):ChapterHistoricalDossier{
  if(!validLocOcrExcerpt(source))
    throw new Error("Estratto OCR o attestazione dei diritti non validi.");
  const catalog=activeArchivalItems(previous).find(x=>x.id===source.catalogItemId&&
    x.itemId===source.itemId&&x.title===source.title);
  const inspection=activeInstitutionalInspections(previous)
    .find(x=>x.id===source.inspectionId&&x.catalogItemId===source.catalogItemId);
  if(!catalog||!inspection||inspection.accessRestricted===true||
    !inspection.hasTextResourceLink)
    throw new Error("Ispezione non attiva, accesso ristretto o nessuna risorsa testuale dichiarata.");
  const old=allLocOcrExcerpts(previous);
  const duplicate=old.find(x=>x.id===source.id);
  if(duplicate&&JSON.stringify(duplicate)!==JSON.stringify(source))
    throw new Error("Conflitto di estratti OCR: snapshot storico non sovrascrivibile.");
  if(old.length>=40&&!duplicate)
    throw new Error("Massimo 40 estratti OCR storici: effettua un backup.");
  const remain=activeLocOcrExcerpts(previous).filter(x=>x.itemId!==source.itemId)
    .map(x=>x.id);
  if(remain.length>=4)throw new Error("Massimo quattro documenti OCR attivi per capitolo.");
  return {
    ...previous,
    queries:previous?.queries??[],sources:previous?.sources??[],
    activeSourceIds:previous?.activeSourceIds??[],
    searchedAt:previous?.searchedAt??source.acquiredAt,
    unansweredQueries:previous?.unansweredQueries??[],
    locOcr:{excerpts:duplicate?old:[...old,source],
      activeExcerptIds:[...remain,source.id],updatedAt:source.acquiredAt},
  };
}
