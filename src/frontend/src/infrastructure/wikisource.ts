import {
  normalizeWikisourceQueries, validateWikisourceExcerpt,
  wikisourcePageUrl, type WikisourceExcerpt,
} from "../domain/wikisource-excerpts";

const API="https://it.wikisource.org/w/api.php";
const TIMEOUT_MS=12_000;
const MAX_BYTES=150_000;
const MAX_WIKITEXT_CHARS=140_000;
interface Revision {
  revid?:unknown;
  timestamp?:unknown;
  slots?:{main?:{content?:unknown;contentmodel?:unknown}};
}
interface Page {
  pageid?:unknown; ns?:unknown; title?:unknown;
  revisions?:Revision[];
}
interface ResponseData {
  batchcomplete?:unknown;
  error?:unknown;
  query?:{pages?:Page[]};
}

/** Find a *literal contiguous slice* in the returned revision's raw wikitext.
 * Deliberately skip markup and template-only lines instead of pretending that
 * transcluded/rendered text was part of the immutable revision itself.
 */
export function selectLiteralWikisourceExcerpt(text:string):{excerpt:string;offset:number}|undefined{
  if(typeof text!=="string" || !text.length || text.length>MAX_WIKITEXT_CHARS)return undefined;
  for(const match of text.matchAll(/[^\r\n]+/g)){
    const line=match[0];
    const trimmed=line.trim();
    if(trimmed.length<36 || /[{}\[\]<>|]/.test(trimmed) ||
      /^(?:[#*;:=!]|__|\/\/|\\)/.test(trimmed))continue;
    if((trimmed.match(/\p{L}{2,}/gu)??[]).length<7)continue;
    const offset=(match.index??0)+line.indexOf(trimmed);
    const excerpt=trimmed.slice(0,1000);
    if(excerpt.length>=36 && text.slice(offset,offset+excerpt.length)===excerpt)
      return {excerpt,offset};
  }
  return undefined;
}
async function readMediaWiki(
  params:URLSearchParams, signal?:AbortSignal,
):Promise<ResponseData>{
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),TIMEOUT_MS);
  const onAbort=()=>ctrl.abort();
  signal?.addEventListener("abort",onAbort,{once:true});
  try{
    if(signal?.aborted)throw new DOMException("Ricerca interrotta.","AbortError");
    const response=await fetch(API+"?"+params.toString(),{
      method:"GET",credentials:"omit",redirect:"error",referrerPolicy:"no-referrer",
      cache:"no-store",signal:ctrl.signal,
    });
    if(!response.ok)throw new Error("Wikisource non disponibile (HTTP "+response.status+").");
    if(!/application\/json/i.test(response.headers.get("content-type")??""))
      throw new Error("Wikisource non ha restituito JSON.");
    const declared=Number(response.headers.get("content-length")??0);
    if(!Number.isFinite(declared) || declared>MAX_BYTES)
      throw new Error("Risposta Wikisource troppo grande.");
    // Revision wikitext can be large: stop streaming as soon as the byte cap
    // is exceeded instead of allocating an unbounded response in memory.
    const reader=response.body?.getReader();
    let raw="";
    if(reader){
      const decoder=new TextDecoder();
      let bytes=0;
      try{
        while(true){
          const chunk=await reader.read();
          if(chunk.done)break;
          bytes+=chunk.value.byteLength;
          if(bytes>MAX_BYTES){
            await reader.cancel();
            throw new Error("Risposta Wikisource troppo grande.");
          }
          raw+=decoder.decode(chunk.value,{stream:true});
        }
        raw+=decoder.decode();
      }finally{reader.releaseLock();}
    }else{
      raw=await response.text();
      if(new TextEncoder().encode(raw).byteLength>MAX_BYTES)
        throw new Error("Risposta Wikisource troppo grande.");
    }
    let data:ResponseData;
    try{data=JSON.parse(raw) as ResponseData;}
    catch{throw new Error("Risposta Wikisource non contiene JSON valido.");}
    if(!data || typeof data!=="object" || data.error ||
      (data.query?.pages!==undefined && !Array.isArray(data.query.pages)) ||
      (data.query?.pages===undefined && data.batchcomplete!==true))
      throw new Error("Formato della risposta Wikisource non valido.");
    return data;
  }catch(error){
    if(signal?.aborted)throw new DOMException("Ricerca Wikisource interrotta.","AbortError");
    if(ctrl.signal.aborted)throw new Error("Timeout Wikisource: nessun estratto salvato.");
    throw error;
  }finally{
    clearTimeout(timeout);
    signal?.removeEventListener("abort",onAbort);
  }
}
async function hashWikitext(raw:string):Promise<string>{
  if(!crypto?.subtle?.digest)
    throw new Error("Web Crypto richiesto per verificare il contenuto esatto della revisione.");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
/** Public author-approved search, then a *separate* read by immutable revids.
 * TextExtracts is intentionally NOT used: it can mix current page text and
 * unrelated revision metadata. The short snippet must be a byte-for-byte
 * (JavaScript substring) slice of the exact retrieved revision's main wikitext.
 * This does NOT authenticate the original work or certify its reuse rights.
 */
export async function searchWikisource(
  requested:readonly string[],signal?:AbortSignal,
):Promise<WikisourceExcerpt[]>{
  const queries=normalizeWikisourceQueries(requested);
  const result:WikisourceExcerpt[]=[];
  const retrievedAt=new Date().toISOString();
  for(const query of queries){
    const search=new URLSearchParams({
      action:"query",generator:"search",gsrsearch:query,gsrnamespace:"0",gsrlimit:"2",
      prop:"revisions",rvprop:"ids|timestamp",rvlimit:"1",
      format:"json",formatversion:"2",origin:"*",
    });
    const candidates=(await readMediaWiki(search,signal)).query?.pages??[];
    let accepted=0;
    for(const candidate of candidates.slice(0,20)){
      if(accepted>=2)break;
      if(!candidate || candidate.ns!==0 ||
        !Number.isSafeInteger(candidate.pageid) || (candidate.pageid as number)<=0 ||
        typeof candidate.title!=="string" ||
        !Number.isSafeInteger(candidate.revisions?.[0]?.revid) ||
        (candidate.revisions![0]!.revid as number)<=0 ||
        typeof candidate.revisions?.[0]?.timestamp!=="string")continue;
      const pageId=candidate.pageid as number;
      const revisionId=candidate.revisions![0]!.revid as number;
      const revisionAt=candidate.revisions![0]!.timestamp as string;
      let url:string;
      try{url=wikisourcePageUrl(candidate.title);}catch{continue;}
      if(!Number.isFinite(Date.parse(revisionAt)))continue;

      // Never follow a server-supplied URL. The second request is anchored to
      // the numeric revision chosen by the author-approved query.
      const exact=new URLSearchParams({
        action:"query",prop:"revisions",revids:String(revisionId),
        rvprop:"ids|timestamp|content",rvslots:"main",
        format:"json",formatversion:"2",origin:"*",
      });
      const data=await readMediaWiki(exact,signal);
      const pages=data.query?.pages;
      if(!Array.isArray(pages) || pages.length!==1)
        throw new Error("La revisione richiesta non è disponibile: nessun dato salvato.");
      const page=pages[0];
      const rev=page?.revisions?.[0];
      if(page?.pageid!==pageId || page?.title!==candidate.title ||
        page?.ns!==0 || rev?.revid!==revisionId || rev?.timestamp!==revisionAt)
        throw new Error("Identità o data della revisione Wikisource non coincidente: ricerca bloccata.");
      const slot=rev?.slots?.main;
      if(slot?.contentmodel!=="wikitext" || typeof slot.content!=="string")
        throw new Error("Il contenuto wikitext della revisione richiesta non è disponibile.");
      const raw=slot.content;
      if(raw.length>MAX_WIKITEXT_CHARS)
        throw new Error("Il wikitext revisionato è troppo grande: ricerca bloccata.");
      const snippet=selectLiteralWikisourceExcerpt(raw);
      if(!snippet)continue; // A template or transclusion is NOT a quoted primary document.
      const digest=await hashWikitext(raw);
      const source:WikisourceExcerpt={
        id:"itwsr:"+pageId+":"+revisionId+":"+digest.slice(0,16),
        provider:"it.wikisource.org",pageId,revisionId,revisionAt,
        title:candidate.title,url,excerpt:snippet.excerpt,query,retrievedAt,
        evidenceStatus:"community_transcription_unverified",
        rightsStatus:"work_rights_not_verified",
        revisionProof:{
          method:"exact_revid_wikitext",contentSha256:digest,
          contentLength:raw.length,excerptOffset:snippet.offset,
        },
      };
      if(!validateWikisourceExcerpt(source))
        throw new Error("Impossibile convalidare lo snapshot della revisione Wikisource.");
      if(!result.some(x=>x.id===source.id)){result.push(source);accepted++;}
    }
  }
  return result;
}
