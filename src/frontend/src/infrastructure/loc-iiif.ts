import {locItemUrl} from "../domain/archival-catalog";
import {
  trustedLocIiifInfoUrl,type LocIiifCandidate,
  type LocIiifReference,
} from "../domain/loc-iiif";
import type {LocOcrExcerpt} from "../domain/loc-ocr";
import type {LocScanCollation} from "../domain/loc-scan-collation";

const MAX_ITEM_BYTES=240_000,MAX_IIIF_BYTES=96_000,TIMEOUT_MS=12_000;
type Data=Record<string,unknown>;
const object=(v:unknown):v is Data=>!!v&&typeof v==="object"&&!Array.isArray(v);
function exactIdentity(value:unknown,itemId:string):boolean{
  if(typeof value!=="string")return false;
  try{
    const u=new URL(value);
    return (u.protocol==="http:"||u.protocol==="https:")&&
      u.hostname==="www.loc.gov"&&!u.port&&!u.username&&!u.password&&
      !u.search&&!u.hash&&u.pathname==="/item/"+itemId+"/";
  }catch{return false;}
}
async function jsonGet(url:string,maxBytes:number,signal?:AbortSignal):Promise<Data>{
  const controller=new AbortController();
  const onAbort=()=>controller.abort();
  const timeout=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  signal?.addEventListener("abort",onAbort,{once:true});
  try{
    if(signal?.aborted)throw new DOMException("Richiesta annullata.","AbortError");
    const response=await fetch(url,{method:"GET",credentials:"omit",
      redirect:"error",referrerPolicy:"no-referrer",cache:"no-store",
      signal:controller.signal});
    if(!response.ok)throw new Error("Risorsa LoC HTTP "+response.status+".");
    const mime=response.headers.get("content-type")??"";
    if(mime&&!mime.toLowerCase().includes("json"))
      throw new Error("Il servizio istituzionale non ha restituito JSON.");
    const n=Number(response.headers.get("content-length")??0);
    if(!Number.isFinite(n)||n>maxBytes)
      throw new Error("Risposta LoC troppo grande.");
    const reader=response.body?.getReader();
    const decoder=new TextDecoder("utf-8",{fatal:true});
    let body="",bytes=0;
    if(reader){
      try{
        while(true){
          const chunk=await reader.read();
          if(chunk.done)break;
          bytes+=chunk.value.byteLength;
          if(bytes>maxBytes){
            await reader.cancel();throw new Error("Risposta LoC troppo grande.");
          }
          body+=decoder.decode(chunk.value,{stream:true});
        }
        body+=decoder.decode();
      }finally{reader.releaseLock();}
    }else{
      // Without a readable stream, response.text() would buffer an unbounded
      // remote payload before enforcing MAX_ITEM_BYTES / MAX_IIIF_BYTES.
      throw new Error("Risposta LoC priva di streaming limitabile.");
    }
    let parsed:unknown;
    try{parsed=JSON.parse(body);}catch{throw new Error("Risposta IIIF/LoC JSON non valido.");}
    if(!object(parsed))throw new Error("Risposta IIIF/LoC priva di un oggetto.");
    return parsed;
  }catch(error){
    if(signal?.aborted)throw new DOMException("Richiesta annullata.","AbortError");
    if(controller.signal.aborted)throw new Error("Timeout LoC: verifica non archiviata.");
    throw error;
  }finally{clearTimeout(timeout);signal?.removeEventListener("abort",onAbort);}
}
function allowedCandidates(payload:Data,itemId:string):LocIiifCandidate[]{
  if(!object(payload.item)||!exactIdentity(payload.item.id,itemId))
    throw new Error("L'identità del documento LoC non coincide con la scheda.");
  const item=payload.item;
  for(const flag of ["access_restricted","download_restricted","rights_restricted"]){
    if(item[flag]!==undefined&&typeof item[flag]!=="boolean")
      throw new Error("Flag di restrizione LoC non valido.");
    if(item[flag]===true)throw new Error("Risorsa LoC soggetta a restrizioni: nessuna verifica.");
  }
  const resources=Array.isArray(payload.resources)?payload.resources:[];
  const result:LocIiifCandidate[]=[];
  resources.slice(0,100).forEach((resource,rIndex)=>{
    if(!object(resource))return;
    // Some LoC digital files expose canDownload independently of access flags.
    // Treat an explicit ban OR an invalid/ambiguous flag as non-eligible.
    if(resource.canDownload===false||
      resource.canDownload!==undefined&&typeof resource.canDownload!=="boolean")return;
    if(["access_restricted","rights_restricted","download_restricted"].some(flag=>
      resource[flag]===true || resource[flag]!==undefined&&
      typeof resource[flag]!=="boolean"))return;
    // Prefer the resource-specific IIIF image info, never item.image_url,
    // thumbnails, preview images or arbitrary file download links.
    const push=(url:unknown,fileIndex:number)=>{
      if(typeof url==="string"&&trustedLocIiifInfoUrl(url)&&
        !result.some(c=>c.infoUrl===url))
        result.push({infoUrl:url,resourceIndex:rIndex,fileIndex});
    };
    push(resource.info,-1);
    if(Array.isArray(resource.files)){
      // LoC resources can have nested [pages][files]; indices describe
      // discovery order, NOT proof that OCR is from this page.
      let file=0;
      for(const group of resource.files){
        const entries=Array.isArray(group)?group:[group];
        for(const part of entries){
          if(file>499)break;
          if(object(part)&&part.canDownload!==false&&
            (part.canDownload===undefined||typeof part.canDownload==="boolean")&&
            !["access_restricted","rights_restricted","download_restricted"].some(flag=>
              part[flag]===true||part[flag]!==undefined&&typeof part[flag]!=="boolean"))
            push(part.info,file);
          file++;
        }
      }
    }
  });
  return result.slice(0,30);
}
export async function listLocIiifCandidates(
  itemId:string,signal?:AbortSignal,
):Promise<LocIiifCandidate[]>{
  const base=locItemUrl(itemId);
  const payload=await jsonGet(base+"?fo=json",MAX_ITEM_BYTES,signal);
  return allowedCandidates(payload,itemId);
}
/** Re-read the item to fence a stale candidate before requesting IIIF info.
 * Never fetch image pixels; only info.json with verified service identity.
 */
export async function inspectLocIiif(
  source:LocOcrExcerpt,scan:LocScanCollation,
  candidate:LocIiifCandidate,signal?:AbortSignal,
):Promise<LocIiifReference>{
  if(scan.ocrSourceId!==source.id||scan.itemId!==source.itemId||
    scan.catalogItemId!==source.catalogItemId||
    scan.inspectionId!==source.inspectionId||
    !trustedLocIiifInfoUrl(candidate?.infoUrl))
    throw new Error("Identificativi OCR, scansione o IIIF non coerenti.");
  const current=await listLocIiifCandidates(source.itemId,signal);
  if(!current.some(c=>c.infoUrl===candidate.infoUrl&&
    c.resourceIndex===candidate.resourceIndex&&c.fileIndex===candidate.fileIndex))
    throw new Error("La risorsa IIIF non è più pubblicata o non è ammessa.");
  const info=await jsonGet(candidate.infoUrl,MAX_IIIF_BYTES,signal);
  const serviceUrl=candidate.infoUrl.slice(0,-"/info.json".length);
  // IIIF v2 uses @id, v3 uses id. If both are supplied they must agree;
  // accepting only the first would hide a conflicting service identity.
  if((info["@id"]===undefined&&info.id===undefined)||
    (info["@id"]!==undefined&&info["@id"]!==serviceUrl)||
    (info.id!==undefined&&info.id!==serviceUrl)||
    !Number.isSafeInteger(info.width)||!Number.isSafeInteger(info.height)||
    (info.width as number)<1||(info.width as number)>200_000||
    (info.height as number)<1||(info.height as number)>200_000)
    throw new Error("Metadati IIIF non corrispondenti o dimensioni non valide.");
  const canonical=JSON.stringify({
    serviceUrl,width:info.width,height:info.height,
    resourceIndex:candidate.resourceIndex,fileIndex:candidate.fileIndex,
  });
  if(!crypto?.subtle?.digest)throw new Error("Web Crypto richiesto per il fingerprint IIIF.");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical));
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  const inspectedAt=new Date().toISOString();
  return {
    id:"lociiif:"+source.itemId+":"+Date.parse(inspectedAt)+":"+hash.slice(0,16),
    itemId:source.itemId,catalogItemId:source.catalogItemId,
    inspectionId:source.inspectionId,ocrSourceId:source.id,
    collationId:scan.id,pageLocator:scan.pageLocator,itemUrl:source.url,
    infoUrl:candidate.infoUrl,imageServiceUrl:serviceUrl,
    resourceIndex:candidate.resourceIndex,fileIndex:candidate.fileIndex,
    width:info.width as number,height:info.height as number,
    infoSha256:hash,inspectedAt,samePageAttested:true,
    rightsAttested:true,evidenceStatus:"institutional_iiif_metadata_unverified",
    rightsStatus:"author_attested_unverified",
  };
}
