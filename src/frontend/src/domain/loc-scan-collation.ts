import type { ChapterHistoricalDossier } from "./historical-research";
import { activeLocOcrExcerpts,type LocOcrExcerpt } from "./loc-ocr";
import { activeInstitutionalInspections } from "./institutional-inspection";
import { locItemUrl } from "./archival-catalog";

/** Author's manually observed transcription from an institutional item's visual scan.
 * NOT an independently downloaded or machine-authenticated image comparison.
 * Two text strings are compared locally, never the pixels of a scan.
 */
export interface LocScanCollation {
  id:string;
  itemId:string;
  ocrSourceId:string;
  ocrContentSha256:string;
  catalogItemId:string;
  inspectionId:string;
  scanPageUrl:string;
  pageLocator:string;
  observedText:string;
  observedAt:string;
  observedOriginalAttested:true;
  excerptRightsAttested:true;
  comparison:"text_overlap"|"text_discrepancy";
  evidenceStatus:"author_visual_transcription_unverified";
  rightsStatus:"author_attested_unverified";
}
export interface ChapterLocScanCollations {
  records:LocScanCollation[];
  activeCollationIds:string[];
}
export interface LocScanCollationInput {
  ocrSourceId:string;
  pageLocator:string;
  observedText:string;
  observedOriginalAttested:true;
  excerptRightsAttested:true;
}

function comparable(value:string):string{
  return value.normalize("NFKC").replace(/\s+/g," ").trim().toLocaleLowerCase("it");
}
/** A mechanical string comparison only. It cannot inspect images or infer truth. */
export function compareScanTranscription(ocrText:string,observedText:string):
  LocScanCollation["comparison"] {
  return comparable(ocrText).includes(comparable(observedText))
    ?"text_overlap":"text_discrepancy";
}
export function validLocScanCollation(record:LocScanCollation):boolean{
  try{
    if(!record || record.observedOriginalAttested!==true ||
      record.excerptRightsAttested!==true ||
      record.evidenceStatus!=="author_visual_transcription_unverified" ||
      record.rightsStatus!=="author_attested_unverified" ||
      typeof record.itemId!=="string" ||
      !/^[a-zA-Z0-9._-]+$/.test(record.itemId) ||
      record.scanPageUrl!==locItemUrl(record.itemId) ||
      typeof record.ocrContentSha256!=="string" ||
      !/^[0-9a-f]{64}$/.test(record.ocrContentSha256) ||
      typeof record.ocrSourceId!=="string" ||
      !record.ocrSourceId.startsWith("lococr:"+record.itemId+":") ||
      typeof record.catalogItemId!=="string" ||
      !/^loc:[a-zA-Z0-9._-]+:\d+$/.test(record.catalogItemId) ||
      !record.catalogItemId.startsWith("loc:"+record.itemId+":") ||
      typeof record.inspectionId!=="string" ||
      !/^locdetail:[a-zA-Z0-9._-]+:\d+$/.test(record.inspectionId) ||
      !record.inspectionId.startsWith("locdetail:"+record.itemId+":") ||
      typeof record.pageLocator!=="string" ||
      record.pageLocator.trim()!==record.pageLocator ||
      record.pageLocator.length<4 || record.pageLocator.length>140 ||
      /[\u0000-\u001f]/.test(record.pageLocator) ||
      typeof record.observedText!=="string" ||
      record.observedText.trim()!==record.observedText ||
      record.observedText.length<36 || record.observedText.length>900 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(record.observedText) ||
      !["text_overlap","text_discrepancy"].includes(record.comparison) ||
      typeof record.observedAt!=="string")return false;
    const timestamp=Date.parse(record.observedAt);
    return Number.isSafeInteger(timestamp)&&
      record.id==="locscan:"+record.itemId+":"+timestamp+":"+
        record.ocrContentSha256.slice(0,16);
  }catch{return false;}
}
export function allLocScanCollations(dossier?:ChapterHistoricalDossier):LocScanCollation[]{
  const raw=dossier?.locOcr?.collations?.records;
  return Array.isArray(raw)?raw.filter(validLocScanCollation):[];
}
/** Only a check against the exact still-active OCR snapshot is current.
 * Tampered historical backups are not silently promoted to verified evidence.
 */
export function activeLocScanCollations(dossier?:ChapterHistoricalDossier):LocScanCollation[]{
  const ids=dossier?.locOcr?.collations?.activeCollationIds;
  if(!Array.isArray(ids))return [];
  const activeIds=new Set(ids);
  const activeSources=new Map(activeLocOcrExcerpts(dossier).map(s=>[s.id,s]));
  const activeInspections=new Set(activeInstitutionalInspections(dossier).map(i=>i.id));
  return allLocScanCollations(dossier).filter(record=>{
    const source=activeSources.get(record.ocrSourceId);
    return activeIds.has(record.id)&&!!source&&
      activeInspections.has(record.inspectionId)&&
      record.ocrContentSha256===source.contentSha256&&
      record.catalogItemId===source.catalogItemId&&
      record.inspectionId===source.inspectionId&&
      record.scanPageUrl===source.url&&
      record.comparison===compareScanTranscription(source.excerpt,record.observedText);
  });
}
export function appendLocScanCollation(
  previous:ChapterHistoricalDossier|undefined,source:LocOcrExcerpt,
  input:LocScanCollationInput,at:string,
):ChapterHistoricalDossier{
  if(!input||input.observedOriginalAttested!==true||
    input.excerptRightsAttested!==true||
    typeof input.pageLocator!=="string"||
    typeof input.observedText!=="string"||
    typeof input.ocrSourceId!=="string")
    throw new Error("Occorre attestare la consultazione visiva della scansione e i diritti di trascrizione.");
  if(!activeLocOcrExcerpts(previous).some(s=>s.id===source.id&&s.id===input.ocrSourceId))
    throw new Error("L'estratto OCR non è più attivo nel dossier.");
  const inspection=activeInstitutionalInspections(previous).find(i=>
    i.id===source.inspectionId&&i.catalogItemId===source.catalogItemId);
  if(!inspection||inspection.accessRestricted===true)
    throw new Error("La scheda originale non ha un'ispezione attiva consultabile.");
  const stamp=Date.parse(at);
  const observedText=input.observedText.trim();
  const entry:LocScanCollation={
    id:"locscan:"+source.itemId+":"+stamp+":"+source.contentSha256.slice(0,16),
    itemId:source.itemId,
    ocrSourceId:source.id,
    ocrContentSha256:source.contentSha256,
    catalogItemId:source.catalogItemId,
    inspectionId:source.inspectionId,
    scanPageUrl:source.url,
    pageLocator:input.pageLocator.trim(),
    observedText,
    observedAt:at,
    observedOriginalAttested:true,
    excerptRightsAttested:true,
    comparison:compareScanTranscription(source.excerpt,observedText),
    evidenceStatus:"author_visual_transcription_unverified",
    rightsStatus:"author_attested_unverified",
  };
  if(!validLocScanCollation(entry))
    throw new Error("Collazione non valida: controlla pagina e trascrizione (36–900 caratteri).");
  const old=allLocScanCollations(previous);
  const existing=old.find(x=>x.id===entry.id);
  if(existing&&JSON.stringify(existing)!==JSON.stringify(entry))
    throw new Error("Conflitto: collazione con stesso ID e contenuto differente.");
  if(old.length>=40&&!existing)
    throw new Error("Massimo 40 collazioni storiche: salva un backup.");
  const keepActive=activeLocScanCollations(previous)
    .filter(x=>x.ocrSourceId!==source.id).map(x=>x.id);
  const base=previous?.locOcr;
  if(!base)throw new Error("Dossier OCR non disponibile.");
  return {
    ...previous!,
    locOcr:{
      ...base,
      collations:{
        records:existing?old:[...old,entry],
        activeCollationIds:[...keepActive,entry.id],
      },
    },
  };
}
