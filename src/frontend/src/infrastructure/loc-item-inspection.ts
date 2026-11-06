import { locItemUrl } from "../domain/archival-catalog";
import type { InstitutionalInspection } from "../domain/institutional-inspection";

const MAX_BYTES=240_000;
const TIMEOUT_MS=12_000;
function normalizedNotes(value:unknown):string[]{
  const values=Array.isArray(value)?value:typeof value==="string"?[value]:[];
  const result:string[]=[];
  for(const x of values){
    if(typeof x!=="string")continue;
    const value=x.replace(/[\u0000-\u001f]/g," ").replace(/\s+/g," ").trim().slice(0,400);
    if(value.length>=2&&!result.includes(value))result.push(value);
    if(result.length===3)break;
  }
  return result;
}
function exactLocIdentity(value:unknown,itemId:string):boolean{
  if(typeof value!=="string")return false;
  try {
    const url=new URL(value);
    return ["http:","https:"].includes(url.protocol) &&
      url.hostname==="www.loc.gov" && !url.port && !url.username &&
      !url.password && !url.search && !url.hash &&
      url.pathname==="/item/"+itemId+"/";
  }catch{return false;}
}
function objects(value:unknown):Record<string,unknown>[] {
  return Array.isArray(value)?value.filter(
    (x):x is Record<string,unknown>=>!!x&&typeof x==="object"&&!Array.isArray(x)): [];
}
async function boundedJson(response:Response):Promise<unknown>{
  if(!response.ok)throw new Error("Scheda LoC non disponibile (HTTP "+response.status+").");
  const mime=response.headers.get("content-type")??"";
  if(mime && !/application\/json/i.test(mime))
    throw new Error("Il dettaglio LoC non contiene JSON.");
  const n=Number(response.headers.get("content-length")??0);
  if(!Number.isFinite(n)||n>MAX_BYTES)throw new Error("Dettaglio LoC troppo grande.");
  const reader=response.body?.getReader();
  let raw="";
  if(reader){
    const decoder=new TextDecoder();let size=0;
    try {
      while(true){
        const chunk=await reader.read();if(chunk.done)break;
        size+=chunk.value.byteLength;
        if(size>MAX_BYTES){await reader.cancel();throw new Error("Dettaglio LoC troppo grande.");}
        raw+=decoder.decode(chunk.value,{stream:true});
      }
      raw+=decoder.decode();
    }finally{reader.releaseLock();}
  }else{
    raw=await response.text();
    if(new TextEncoder().encode(raw).byteLength>MAX_BYTES)
      throw new Error("Dettaglio LoC troppo grande.");
  }
  try{return JSON.parse(raw) as unknown;}
  catch{throw new Error("Il dettaglio LoC non contiene JSON valido.");}
}
/** Author-initiated inspection of a SINGLE already catalogued public LoC item.
 * It retrieves descriptive access/rights metadata ONLY; it neither reads
 * originals or OCR nor licenses them for quotation.
 */
export async function inspectLocItem(
  itemId:string,catalogItemId:string,signal?:AbortSignal,
):Promise<InstitutionalInspection>{
  const url=locItemUrl(itemId);
  if(typeof catalogItemId!=="string" ||
    !/^loc:[a-zA-Z0-9._-]+:\d+$/.test(catalogItemId) ||
    !catalogItemId.startsWith("loc:"+itemId+":"))
    throw new Error("Scheda LoC di origine non valida.");
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),TIMEOUT_MS);
  const abort=()=>ctrl.abort();
  signal?.addEventListener("abort",abort,{once:true});
  try {
    if(signal?.aborted)throw new DOMException("Ispezione annullata.","AbortError");
    const response=await fetch(url+"?fo=json",{
      method:"GET",credentials:"omit",redirect:"error",
      referrerPolicy:"no-referrer",cache:"no-store",signal:ctrl.signal,
    });
    const json=await boundedJson(response);
    if(!json||typeof json!=="object"||Array.isArray(json))
      throw new Error("Dettaglio istituzionale LoC malformato.");
    const data=json as Record<string,unknown>;
    const record=data.item;
    if(!record||typeof record!=="object"||Array.isArray(record))
      throw new Error("La risposta LoC non include l'oggetto richiesto.");
    const item=record as Record<string,unknown>;
    if(!exactLocIdentity(item.id,itemId))
      throw new Error("Identità LoC differente dall'oggetto richiesto: ispezione respinta.");
    if(item.access_restricted!==undefined&&typeof item.access_restricted!=="boolean")
      throw new Error("Flag LoC di restrizione accesso non valido.");
    if(item.digitized!==undefined&&typeof item.digitized!=="boolean")
      throw new Error("Flag LoC di digitalizzazione non valido.");
    const resources=[...objects(data.resources),...objects(item.resources)];
    // Only existence of *descriptive links*, not a guarantee of availability.
    const hasTextResourceLink=
      typeof data.fulltext_service==="string"&&data.fulltext_service.length>0 ||
      resources.some(r=>typeof r.fulltext_file==="string"||
        typeof r.fulltext_derivative==="string"||typeof r.word_coordinates==="string");
    const inspectedAt=new Date().toISOString();
    return {
      id:"locdetail:"+itemId+":"+Date.parse(inspectedAt),
      provider:"loc.gov",catalogItemId,itemId,url,inspectedAt,
      digitized:typeof item.digitized==="boolean"?item.digitized:null,
      accessRestricted:typeof item.access_restricted==="boolean"?item.access_restricted:null,
      rightsAdvisory:normalizedNotes(item.rights_advisory??item.rights),
      accessAdvisory:normalizedNotes(item.access_advisory),
      hasDigitalResources:item.digitized===true || resources.length>0,
      hasTextResourceLink:!!hasTextResourceLink,
      evidenceStatus:"catalog_metadata_only",
      rightsStatus:"undetermined",
    };
  }catch(error){
    if(signal?.aborted)throw new DOMException("Ispezione LoC annullata.","AbortError");
    if(ctrl.signal.aborted)throw new Error("Timeout LoC: nessuna ispezione salvata.");
    throw error;
  }finally{
    clearTimeout(timeout);
    signal?.removeEventListener("abort",abort);
  }
}
