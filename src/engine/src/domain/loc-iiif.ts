import type { ChapterHistoricalDossier } from "./historical-research";
import { activeLocOcrExcerpts } from "./loc-ocr";
import { activeLocScanCollations } from "./loc-scan-collation";
import { activeInstitutionalInspections } from "./institutional-inspection";
import { locItemUrl } from "./archival-catalog";

/** Technical IIIF *metadata*, not an image viewed by the application and not
 * evidence that a page's pixels match the author-transcribed text or OCR.
 */
export interface LocIiifReference {
  id:string;
  itemId:string;
  catalogItemId:string;
  inspectionId:string;
  ocrSourceId:string;
  collationId:string;
  pageLocator:string;
  itemUrl:string;
  infoUrl:string;
  imageServiceUrl:string;
  resourceIndex:number;
  fileIndex:number;
  width:number;
  height:number;
  infoSha256:string;
  inspectedAt:string;
  samePageAttested:true;
  rightsAttested:true;
  evidenceStatus:"institutional_iiif_metadata_unverified";
  rightsStatus:"author_attested_unverified";
}
export interface ChapterLocIiifReferences {
  references:LocIiifReference[];
  activeReferenceIds:string[];
}
export interface LocIiifCandidate {
  infoUrl:string;
  resourceIndex:number;
  fileIndex:number;
}

/** Only the LOC IIIF Image API's info.json endpoint, never an arbitrary
 * image/resource URL imported from an untrusted JSON backup.
 */
export function trustedLocIiifInfoUrl(value:string):boolean{
  if(typeof value!=="string" || value.includes("%") || value.includes("\\") ||
    value.includes("..") || value.length>1100)return false;
  try{
    const url=new URL(value);
    return url.protocol==="https:" && url.hostname==="tile.loc.gov" &&
      !url.username&&!url.password&&!url.port&&!url.hash&&!url.search &&
      /^\/image-services\/iiif\/(?:service|master):[A-Za-z0-9_:/.-]+\/info\.json$/
        .test(url.pathname);
  }catch{return false;}
}
export function validLocIiifReference(entry:LocIiifReference):boolean{
  try{
    if(!entry || typeof entry.itemId!=="string" ||
      entry.itemUrl!==locItemUrl(entry.itemId) ||
      !trustedLocIiifInfoUrl(entry.infoUrl) ||
      entry.imageServiceUrl!==entry.infoUrl.slice(0,-"/info.json".length) ||
      typeof entry.catalogItemId!=="string" ||
      !/^loc:[a-zA-Z0-9._-]+:\d+$/.test(entry.catalogItemId) ||
      !entry.catalogItemId.startsWith("loc:"+entry.itemId+":") ||
      typeof entry.inspectionId!=="string" ||
      !/^locdetail:[a-zA-Z0-9._-]+:\d+$/.test(entry.inspectionId) ||
      !entry.inspectionId.startsWith("locdetail:"+entry.itemId+":") ||
      typeof entry.ocrSourceId!=="string" ||
      !entry.ocrSourceId.startsWith("lococr:"+entry.itemId+":") ||
      typeof entry.collationId!=="string" ||
      !entry.collationId.startsWith("locscan:"+entry.itemId+":") ||
      typeof entry.pageLocator!=="string"||
      entry.pageLocator.trim()!==entry.pageLocator ||
      entry.pageLocator.length<4||entry.pageLocator.length>140 ||
      /[\u0000-\u001f]/.test(entry.pageLocator) ||
      !Number.isSafeInteger(entry.resourceIndex)||
      entry.resourceIndex<0||entry.resourceIndex>99||
      !Number.isSafeInteger(entry.fileIndex)||
      entry.fileIndex< -1||entry.fileIndex>499||
      !Number.isSafeInteger(entry.width)||entry.width<1||entry.width>200_000||
      !Number.isSafeInteger(entry.height)||entry.height<1||entry.height>200_000||
      !/^[a-f0-9]{64}$/.test(entry.infoSha256)||
      entry.samePageAttested!==true||entry.rightsAttested!==true||
      entry.evidenceStatus!=="institutional_iiif_metadata_unverified"||
      entry.rightsStatus!=="author_attested_unverified")return false;
    const stamp=Date.parse(entry.inspectedAt);
    return Number.isSafeInteger(stamp)&&
      entry.id==="lociiif:"+entry.itemId+":"+stamp+":"+entry.infoSha256.slice(0,16);
  }catch{return false;}
}
export function allLocIiifReferences(dossier?:ChapterHistoricalDossier):LocIiifReference[]{
  const items=dossier?.locOcr?.iiif?.references;
  return Array.isArray(items)?items.filter(validLocIiifReference):[];
}
export function activeLocIiifReferences(dossier?:ChapterHistoricalDossier):LocIiifReference[]{
  const ids=dossier?.locOcr?.iiif?.activeReferenceIds;
  if(!Array.isArray(ids))return [];
  const selected=new Set(ids);
  const ocr=new Map(activeLocOcrExcerpts(dossier).map(x=>[x.id,x]));
  const collations=new Map(activeLocScanCollations(dossier).map(x=>[x.id,x]));
  const inspections=new Set(activeInstitutionalInspections(dossier).map(x=>x.id));
  return allLocIiifReferences(dossier).filter(x=>{
    const source=ocr.get(x.ocrSourceId),scan=collations.get(x.collationId);
    return selected.has(x.id)&&!!source&&!!scan&&
      inspections.has(x.inspectionId)&&
      x.catalogItemId===source.catalogItemId&&
      x.inspectionId===source.inspectionId&&
      x.itemId===source.itemId&&
      x.collationId===scan.id&&scan.ocrSourceId===source.id&&
      x.pageLocator===scan.pageLocator;
  });
}
export function appendLocIiifReference(
  previous:ChapterHistoricalDossier|undefined,entry:LocIiifReference,
):ChapterHistoricalDossier{
  if(!validLocIiifReference(entry))
    throw new Error("Riferimento IIIF o attestazioni non validi.");
  const source=activeLocOcrExcerpts(previous).find(x=>x.id===entry.ocrSourceId);
  const scan=activeLocScanCollations(previous).find(x=>x.id===entry.collationId);
  if(!source||!scan||source.itemId!==entry.itemId||
    source.catalogItemId!==entry.catalogItemId||
    source.inspectionId!==entry.inspectionId||
    scan.ocrSourceId!==source.id||scan.pageLocator!==entry.pageLocator)
    throw new Error("Collazione, OCR o ispezione LoC non più attivi.");
  const records=allLocIiifReferences(previous);
  const prior=records.find(x=>x.id===entry.id);
  if(prior&&JSON.stringify(prior)!==JSON.stringify(entry))
    throw new Error("Conflitto: snapshot IIIF immutabile con stesso ID.");
  if(records.length>=40&&!prior)
    throw new Error("Archivio IIIF pieno (40): effettua un backup.");
  const existing=activeLocIiifReferences(previous).filter(x=>x.collationId!==scan.id)
    .map(x=>x.id);
  const locOcr=previous?.locOcr;
  if(!locOcr)throw new Error("Dossier OCR mancante.");
  return {
    ...previous!,
    locOcr:{
      ...locOcr,
      iiif:{references:prior?records:[...records,entry],
        activeReferenceIds:[...existing,entry.id]},
    },
  };
}
