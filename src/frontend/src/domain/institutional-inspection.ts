import type { ChapterHistoricalDossier } from "./historical-research";
import { activeArchivalItems, locItemUrl } from "./archival-catalog";

/** An institutional item's catalogue-level access/rights advisory, NOT its document text. */
export interface InstitutionalInspection {
  id: string;
  provider: "loc.gov";
  catalogItemId: string;
  itemId: string;
  url: string;
  inspectedAt: string;
  digitized: boolean | null;
  accessRestricted: boolean | null;
  rightsAdvisory: string[];
  accessAdvisory: string[];
  /** Metadata only: a digital resource or OCR link may exist; neither is fetched. */
  hasDigitalResources: boolean;
  hasTextResourceLink: boolean;
  evidenceStatus: "catalog_metadata_only";
  rightsStatus: "undetermined";
}
export interface ChapterInstitutionalInspections {
  inspections: InstitutionalInspection[];
  activeInspectionIds: string[];
}
function validNotes(notes:unknown):notes is string[] {
  return Array.isArray(notes) && notes.length<=3 &&
    notes.every(note=>typeof note==="string" && note.trim()===note &&
      note.length>=2 && note.length<=400 && !/[\u0000-\u001f]/.test(note));
}
export function validInstitutionalInspection(entry:InstitutionalInspection):boolean{
  try {
    if(!entry || entry.provider!=="loc.gov" || typeof entry.catalogItemId!=="string" ||
      !/^loc:[a-zA-Z0-9._-]+:\d+$/.test(entry.catalogItemId) ||
      !entry.catalogItemId.startsWith("loc:"+entry.itemId+":") ||
      entry.url!==locItemUrl(entry.itemId))return false;
    const at=Date.parse(entry.inspectedAt);
    return Number.isSafeInteger(at) &&
      entry.id==="locdetail:"+entry.itemId+":"+at &&
      (entry.digitized===true || entry.digitized===false || entry.digitized===null) &&
      (entry.accessRestricted===true || entry.accessRestricted===false || entry.accessRestricted===null) &&
      validNotes(entry.rightsAdvisory) && validNotes(entry.accessAdvisory) &&
      typeof entry.hasDigitalResources==="boolean" &&
      typeof entry.hasTextResourceLink==="boolean" &&
      entry.evidenceStatus==="catalog_metadata_only" &&
      entry.rightsStatus==="undetermined";
  }catch{return false;}
}
export function allInstitutionalInspections(dossier?:ChapterHistoricalDossier):InstitutionalInspection[]{
  const raw=dossier?.archiveCatalog?.inspections?.inspections;
  return Array.isArray(raw)?raw.filter(validInstitutionalInspection):[];
}
/** A historical catalogue item's inspection is active ONLY while the exact source search snapshot is active. */
export function activeInstitutionalInspections(dossier?:ChapterHistoricalDossier):InstitutionalInspection[]{
  const ids=dossier?.archiveCatalog?.inspections?.activeInspectionIds;
  if(!Array.isArray(ids))return [];
  const active=new Set(ids);
  const catalogue=new Set(activeArchivalItems(dossier).map(x=>x.id));
  return allInstitutionalInspections(dossier).filter(x=>active.has(x.id)&&catalogue.has(x.catalogItemId));
}
export function appendInstitutionalInspection(
  previous:ChapterHistoricalDossier|undefined, inspection:InstitutionalInspection,
):ChapterHistoricalDossier {
  if(!validInstitutionalInspection(inspection))
    throw new Error("Metadati istituzionali non validi: nessuna modifica salvata.");
  const catalog=previous?.archiveCatalog;
  if(!catalog || !activeArchivalItems(previous).some(x=>x.id===inspection.catalogItemId &&
    x.itemId===inspection.itemId))
    throw new Error("La scheda d'archivio non è più attiva.");
  const history=allInstitutionalInspections(previous);
  const prior=history.find(x=>x.id===inspection.id);
  if(prior && JSON.stringify(prior)!==JSON.stringify(inspection))
    throw new Error("Conflitto: stessa ispezione archivistica con dati differenti.");
  const next=prior?history:[...history,inspection];
  if(next.length>60)throw new Error("Storico ispezioni pieno: salva un backup.");
  const activePrior=activeInstitutionalInspections(previous)
    .filter(x=>x.itemId!==inspection.itemId).map(x=>x.id);
  return {
    ...previous,
    queries:previous?.queries??[],sources:previous?.sources??[],
    activeSourceIds:previous?.activeSourceIds??[],
    searchedAt:previous?.searchedAt??inspection.inspectedAt,
    unansweredQueries:previous?.unansweredQueries??[],
    archiveCatalog:{
      ...catalog,
      inspections:{
        inspections:next,
        activeInspectionIds:[...activePrior,inspection.id],
      },
    },
  };
}
