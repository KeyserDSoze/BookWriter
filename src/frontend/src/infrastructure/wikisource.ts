import {
  normalizeWikisourceQueries, validateWikisourceExcerpt,
  wikisourcePageUrl, type WikisourceExcerpt,
} from "../domain/wikisource-excerpts";

const API="https://it.wikisource.org/w/api.php";
const TIMEOUT_MS=12_000;
const MAX_BYTES=150_000;
interface Page {
  pageid?:unknown; ns?:unknown; title?:unknown; extract?:unknown;
  revisions?:Array<{revid?:unknown;timestamp?:unknown}>;
}
interface ResponseData {
  batchcomplete?:unknown;
  error?:unknown;
  query?:{pages?:Page[]};
}
/** Public, author-approved search only. Never send manuscript, secrets or credentials.
 * MediaWiki TextExtracts returns short community transcriptions. Revision metadata
 * is not proof of the historical work or its copyright status.
 */
export async function searchWikisource(
  requested:readonly string[], signal?:AbortSignal,
):Promise<WikisourceExcerpt[]>{
  const queries=normalizeWikisourceQueries(requested);
  const result:WikisourceExcerpt[]=[];
  const retrievedAt=new Date().toISOString();
  for(const query of queries){
    const params=new URLSearchParams({
      action:"query",generator:"search",gsrsearch:query,gsrnamespace:"0",gsrlimit:"2",
      prop:"extracts|revisions",explaintext:"1",exchars:"1000",
      rvprop:"ids|timestamp",rvlimit:"1",
      format:"json",formatversion:"2",origin:"*",
    });
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
      const contentType=response.headers.get("content-type")??"";
      if(!/application\/json/i.test(contentType))
        throw new Error("Wikisource non ha restituito JSON.");
      const length=Number(response.headers.get("content-length")??0);
      if(length>MAX_BYTES)throw new Error("Risposta Wikisource troppo grande.");
      const raw=await response.text();
      if(new TextEncoder().encode(raw).byteLength>MAX_BYTES)
        throw new Error("Risposta Wikisource troppo grande.");
      let data:ResponseData;
      try{data=JSON.parse(raw) as ResponseData;}
      catch{throw new Error("Risposta Wikisource non contiene JSON valido.");}
      if(!data || typeof data!=="object" || data.error ||
        (data.query?.pages !== undefined && !Array.isArray(data.query.pages)) ||
        (data.query?.pages === undefined && data.batchcomplete!==true))
        throw new Error("Formato della risposta Wikisource non valido.");
      let accepted=0;
      for(const page of (data.query?.pages??[]).slice(0,20)){
        if(accepted>=2)break;
        if(!page || page.ns!==0 || !Number.isSafeInteger(page.pageid) ||
          !Number.isSafeInteger(page.revisions?.[0]?.revid) ||
          typeof page.revisions?.[0]?.timestamp!=="string" ||
          typeof page.title!=="string" || typeof page.extract!=="string")continue;
        let url:string;
        try{url=wikisourcePageUrl(page.title);}catch{continue;}
        const doc:WikisourceExcerpt={
          id:"itws:"+page.pageid+":"+page.revisions![0]!.revid,
          provider:"it.wikisource.org",
          pageId:page.pageid as number,
          revisionId:page.revisions![0]!.revid as number,
          revisionAt:page.revisions![0]!.timestamp as string,
          title:page.title,url,
          excerpt:page.extract.replace(/\s+/g," ").trim().slice(0,1200),
          query,retrievedAt,
          evidenceStatus:"community_transcription_unverified",
          rightsStatus:"work_rights_not_verified",
        };
        if(validateWikisourceExcerpt(doc) && !result.some(x=>x.id===doc.id)){
          result.push(doc);accepted++;
        }
      }
    }catch(error){
      if(signal?.aborted)throw new DOMException("Ricerca Wikisource interrotta.","AbortError");
      if(ctrl.signal.aborted)throw new Error("Timeout Wikisource: nessun estratto salvato.");
      throw error;
    }finally{
      clearTimeout(timeout);
      signal?.removeEventListener("abort",onAbort);
    }
  }
  return result;
}
