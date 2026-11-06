import { locItemUrl } from "../domain/archival-catalog";
import {
  trustedLocTextUrl,validLocOcrExcerpt,
  type LocOcrExcerpt,type LocOcrRights,
} from "../domain/loc-ocr";

const MAX_METADATA_BYTES=240_000;
const MAX_TEXT_BYTES=160_000;
const TIMEOUT_MS=12_000;
type JsonObject=Record<string,unknown>;
const isObject=(x:unknown):x is JsonObject=>
  !!x&&typeof x==="object"&&!Array.isArray(x);
function trustedIdentity(value:unknown,itemId:string):boolean{
  if(typeof value!=="string")return false;
  try{
    const url=new URL(value);
    return ["http:","https:"].includes(url.protocol)&&
      url.hostname==="www.loc.gov"&&!url.port&&!url.username&&!url.password&&
      !url.search&&!url.hash&&url.pathname==="/item/"+itemId+"/";
  }catch{return false;}
}
async function boundedBody(response:Response,maxBytes:number,type:"json"|"text"):Promise<string>{
  if(!response.ok)throw new Error("Documento LoC non disponibile (HTTP "+response.status+").");
  const mime=(response.headers.get("content-type")??"").toLowerCase();
  if(type==="json"&&mime&&!mime.includes("application/json"))
    throw new Error("API LoC non ha restituito JSON.");
  if(type==="text"&&mime&&(mime.includes("html")||mime.includes("xml")||mime.includes("json")))
    throw new Error("La risorsa LoC non è testo OCR semplice.");
  const declared=Number(response.headers.get("content-length")??0);
  if(!Number.isFinite(declared)||declared>maxBytes)
    throw new Error("Risposta LoC troppo grande.");
  const stream=response.body?.getReader();
  let raw="";let bytes=0;
  const decoder=new TextDecoder("utf-8",{fatal:true});
  if(stream){
    try{
      while(true){
        const part=await stream.read();
        if(part.done)break;
        bytes+=part.value.byteLength;
        if(bytes>maxBytes){
          await stream.cancel();
          throw new Error("Risposta LoC troppo grande.");
        }
        raw+=decoder.decode(part.value,{stream:true});
      }
      raw+=decoder.decode();
    }finally{stream.releaseLock();}
  }else{
    raw=await response.text();
    if(new TextEncoder().encode(raw).byteLength>maxBytes)
      throw new Error("Risposta LoC troppo grande.");
  }
  return raw;
}
async function fixedGet(url:string,maxBytes:number,type:"json"|"text",signal?:AbortSignal){
  const controller=new AbortController();
  const abort=()=>controller.abort();
  const timeout=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  signal?.addEventListener("abort",abort,{once:true});
  try{
    if(signal?.aborted)throw new DOMException("Acquisizione annullata.","AbortError");
    const response=await fetch(url,{
      method:"GET",credentials:"omit",redirect:"error",
      referrerPolicy:"no-referrer",cache:"no-store",signal:controller.signal,
    });
    return await boundedBody(response,maxBytes,type);
  }catch(error){
    if(signal?.aborted)throw new DOMException("Acquisizione LoC annullata.","AbortError");
    if(controller.signal.aborted)throw new Error("Timeout LoC: estratto non salvato.");
    throw error;
  }finally{
    clearTimeout(timeout);
    signal?.removeEventListener("abort",abort);
  }
}
function allowedTextResources(payload:JsonObject):string[]{
  const item=payload.item;
  if(!isObject(item))throw new Error("LoC non ha restituito il record documentale.");
  for(const flag of ["access_restricted","download_restricted","rights_restricted"]){
    if(item[flag]!==undefined&&typeof item[flag]!=="boolean")
      throw new Error("Flag di accesso LoC non valido: nessuna risorsa acquisita.");
  }
  if(item.access_restricted===true || item.download_restricted===true ||
    item.rights_restricted===true)
    throw new Error("Accesso o download ristretto dichiarato dalla Library of Congress.");
  const resources=[
    ...(Array.isArray(payload.resources)?payload.resources:[]),
    ...(Array.isArray(item.resources)?item.resources:[]),
  ];
  const permitted:string[]=[];
  for(const resource of resources){
    if(!isObject(resource))continue;
    if(resource.download_restricted===true || resource.rights_restricted===true ||
      resource.access_restricted===true)continue;
    if(["download_restricted","rights_restricted","access_restricted"].some(flag=>
      resource[flag]!==undefined&&typeof resource[flag]!=="boolean"))continue;
    for(const key of ["fulltext_file","fulltext_derivative","djvu_text_file"]){
      const value=resource[key];
      if(typeof value==="string"&&trustedLocTextUrl(value)&&!permitted.includes(value))
        permitted.push(value);
    }
  }
  return permitted;
}
function findTextResource(payload:JsonObject):string{
  const first=allowedTextResources(payload)[0];
  if(!first)
    throw new Error("Il record LoC non espone un file .txt ammesso sul servizio istituzionale; nessuna acquisizione.");
  return first;
}
/** Only literal readable text, no OCR correction or reconstructed words. */
export function selectLocOcrExcerpt(raw:string):{excerpt:string;offset:number}|undefined{
  for(const line of raw.matchAll(/[^\r\n]+/g)){
    const trimmed=line[0].trim();
    if(trimmed.length<38)continue;
    if((trimmed.match(/\p{L}{2,}/gu)??[]).length<6)continue;
    const offset=(line.index??0)+line[0].indexOf(trimmed);
    const excerpt=trimmed.slice(0,900);
    if(raw.slice(offset,offset+excerpt.length)===excerpt)return {excerpt,offset};
  }
  return undefined;
}
/** A two-GET, author-attested read of only a narrow LoC OCR plaintext resource.
 * Metadata first, then one trusted static .txt; NEVER PDF, HTML, OCR endpoints,
 * page images, arbitrary URLs or external hosts. No rights inferred from LoC.
 */
export async function fetchLocOcrExcerpt(
  itemId:string,catalogItemId:string,inspectionId:string,title:string,
  rights:LocOcrRights,signal?:AbortSignal,
):Promise<LocOcrExcerpt>{
  const itemUrl=locItemUrl(itemId);
  if(typeof catalogItemId!=="string"||
    !/^loc:[a-zA-Z0-9._-]+:\d+$/.test(catalogItemId)||
    !catalogItemId.startsWith("loc:"+itemId+":")||
    typeof inspectionId!=="string"||
    !/^locdetail:[a-zA-Z0-9._-]+:\d+$/.test(inspectionId)||
    !inspectionId.startsWith("locdetail:"+itemId+":")||
    typeof title!=="string"||title.trim().length<2||title.length>300||
    rights?.rightsAttested!==true||
    !["permission","public_domain"].includes(rights.rightsBasis)||
    typeof rights.rightsNote!=="string"||
    rights.rightsNote.trim().length<16||rights.rightsNote.length>280)
    throw new Error("Identificativi o dichiarazione dei diritti non validi.");
  const response=await fixedGet(itemUrl+"?fo=json",MAX_METADATA_BYTES,"json",signal);
  let parsed:unknown;
  try{parsed=JSON.parse(response);}catch{throw new Error("API LoC non ha restituito JSON valido.");}
  if(!isObject(parsed)||!isObject(parsed.item)||
    !trustedIdentity(parsed.item.id,itemId))
    throw new Error("L'identità del documento LoC non coincide con la scheda approvata.");
  const url=findTextResource(parsed);
  // Exactly one follow-up, only to a structurally allowlisted LoC storage text.
  const raw=await fixedGet(url,MAX_TEXT_BYTES,"text",signal);
  if(raw.length>MAX_TEXT_BYTES)throw new Error("Testo OCR LoC troppo grande.");
  // A login/error HTML page must not masquerade as OCR even if mislabelled text/plain.
  if(/^\s*<(?:!doctype\s+html|html|head|body|script|\?xml)\b/i.test(raw))
    throw new Error("La risorsa LoC non è un file OCR testuale.");
  const snippet=selectLocOcrExcerpt(raw);
  if(!snippet)throw new Error("Il file non contiene un frammento OCR semplice e citabile.");
  if(!crypto?.subtle?.digest)
    throw new Error("Web Crypto non disponibile: impossibile fissare la provenienza.");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  const acquiredAt=new Date().toISOString();
  const source:LocOcrExcerpt={
    id:"lococr:"+itemId+":"+Date.parse(acquiredAt)+":"+hash.slice(0,16),
    provider:"loc.gov-ocr",catalogItemId,inspectionId,itemId,title,url:itemUrl,
    textUrl:url,excerpt:snippet.excerpt,contentSha256:hash,
    contentLength:raw.length,excerptOffset:snippet.offset,acquiredAt,
    rightsBasis:rights.rightsBasis,rightsNote:rights.rightsNote.trim(),
    rightsAttested:true,evidenceStatus:"institutional_ocr_unverified",
    rightsStatus:"author_attested_unverified",
  };
  if(!validLocOcrExcerpt(source))
    throw new Error("La provenienza OCR LoC non supera i controlli di integrità.");
  return source;
}

export type LocOcrAuditReason="match"|"identity"|"resource"|"digest"|"excerpt";
export interface LocOcrAuditResult {
  matches:boolean;
  reason:LocOcrAuditReason;
  checkedAt:string;
}
/** On-demand check against current institutional metadata AND the exact previously
 * archived OCR text URL. Never blindly trust a URL or digest imported from ZIP.
 * An unavailable file, API failure, CORS/429 and access restriction cause an
 * error, NOT a false mismatch or a claim of historical inauthenticity.
 *
 * No book, excerpt, hash, query, rights statement, key or PAT is sent to LoC.
 * The result is ephemeral: persistent quarantine requires separate author consent.
 */
export async function auditStoredLocOcrExcerpt(
  saved:LocOcrExcerpt,signal?:AbortSignal,
):Promise<LocOcrAuditResult>{
  if(!validLocOcrExcerpt(saved))
    throw new Error("Fonte OCR non valida: non è possibile verificarla online.");
  const checkedAt=new Date().toISOString();
  const itemUrl=locItemUrl(saved.itemId);
  const metadata=await fixedGet(itemUrl+"?fo=json",MAX_METADATA_BYTES,"json",signal);
  let parsed:unknown;
  try{parsed=JSON.parse(metadata);}
  catch{throw new Error("API LoC non ha restituito JSON valido.");}
  if(!isObject(parsed)||!isObject(parsed.item))
    throw new Error("Dettaglio istituzionale LoC non disponibile.");
  if(!trustedIdentity(parsed.item.id,saved.itemId))
    return {matches:false,reason:"identity",checkedAt};
  // A change in access/rights flags should block downloading, NOT be treated
  // as evidence of a forged OCR document.
  const resources=allowedTextResources(parsed);
  if(!resources.includes(saved.textUrl))
    return {matches:false,reason:"resource",checkedAt};
  const raw=await fixedGet(saved.textUrl,MAX_TEXT_BYTES,"text",signal);
  if(raw.length>MAX_TEXT_BYTES)
    throw new Error("Testo OCR LoC troppo grande.");
  if(/^\s*<(?:!doctype\s+html|html|head|body|script|\?xml)\b/i.test(raw))
    throw new Error("La risorsa LoC non è un file OCR testuale.");
  if(!crypto?.subtle?.digest)
    throw new Error("Web Crypto necessario per la verifica dell'OCR.");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  if(hash!==saved.contentSha256||raw.length!==saved.contentLength)
    return {matches:false,reason:"digest",checkedAt};
  if(raw.slice(saved.excerptOffset,saved.excerptOffset+saved.excerpt.length)!==saved.excerpt)
    return {matches:false,reason:"excerpt",checkedAt};
  return {matches:true,reason:"match",checkedAt};
}
