import { afterEach,describe,expect,it,vi } from "vitest";
import { auditStoredLocOcrExcerpt,fetchLocOcrExcerpt } from "./loc-ocr";

const itemId="2020123456";
const catalogId="loc:2020123456:1793980800000";
const inspectionId="locdetail:2020123456:1793980860000";
const title="Telegraph correspondence";
const textUrl="https://tile.loc.gov/storage-services/service/gdc/telegraph_letters.txt";
const raw="The telegraph apparatus was operated at the station during the winter of 1848.\n"+
  "Letters were carried across the countryside during the following weeks.\n";
const metadata={item:{id:"http://www.loc.gov/item/2020123456/",
    access_restricted:false,rights_advisory:["No guarantee of copyright clearance."]},
  resources:[{fulltext_file:textUrl}]};
const rights={rightsBasis:"permission" as const,rightsNote:"Permesso scritto per questo estratto e AI.",
  rightsAttested:true as const};
function response(data:unknown,type="application/json",status=200):Response{
  return new Response(typeof data==="string"?data:JSON.stringify(data),{
    status,headers:{"content-type":type}});
}
function mock(data:unknown=metadata,body=raw){
  const spy=vi.fn(async(url:string,_options:RequestInit)=>{
    if(url==="https://www.loc.gov/item/2020123456/?fo=json")return response(data);
    if(url===textUrl)return response(body,"text/plain");
    throw new Error("URL arbitraria: "+url);
  });
  vi.stubGlobal("fetch",spy);return spy;
}
async function source(){
  mock();
  return fetchLocOcrExcerpt(itemId,catalogId,inspectionId,title,rights);
}
afterEach(()=>vi.unstubAllGlobals());

describe("Riverifica OCR LoC: risorsa dichiarata, SHA-256 e frase letterale",()=>{
  it("ripete due soli GET pubblici senza inviare hash, diritti, query o manoscritto",async()=>{
    const saved=await source();
    const spy=mock();
    const outcome=await auditStoredLocOcrExcerpt(saved);
    expect(outcome).toMatchObject({matches:true,reason:"match"});
    expect(Number.isFinite(Date.parse(outcome.checkedAt))).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map(x=>x[0])).toEqual([
      "https://www.loc.gov/item/2020123456/?fo=json",textUrl,
    ]);
    for(const [url,opts]of spy.mock.calls){
      expect(url).not.toContain(saved.excerpt);
      expect(url).not.toContain(saved.contentSha256);
      expect(url).not.toContain(saved.rightsNote);
      expect(opts.method).toBe("GET");
      expect(opts.credentials).toBe("omit");
      expect(opts.redirect).toBe("error");
      expect(opts.referrerPolicy).toBe("no-referrer");
      expect(opts.headers).toBeUndefined();
    }
  });
  it("rileva backup con hash, testo o offset falsificato, senza falso successo",async()=>{
    const saved=await source();
    mock();
    expect(await auditStoredLocOcrExcerpt({...saved,
      contentSha256:"b".repeat(64),
      id:saved.id.replace(saved.contentSha256.slice(0,16),"b".repeat(16))}))
      .toMatchObject({matches:false,reason:"digest"});
    const changed={...saved,excerpt:saved.excerpt.replace("apparatus","machine")};
    expect(await auditStoredLocOcrExcerpt(changed))
      .toMatchObject({matches:false,reason:"excerpt"});
    const moved={...saved,excerptOffset:saved.excerptOffset+1};
    expect(await auditStoredLocOcrExcerpt(moved))
      .toMatchObject({matches:false,reason:"excerpt"});
  });
  it("rileva che il documento rinominato o il file non è più elencato, senza seguire link diversi",async()=>{
    const saved=await source();
    let spy=mock({...metadata,item:{...metadata.item,id:"http://www.loc.gov/item/another/"}}); 
    expect(await auditStoredLocOcrExcerpt(saved)).toMatchObject({matches:false,reason:"identity"});
    expect(spy).toHaveBeenCalledTimes(1);
    spy=mock({...metadata,resources:[{
      fulltext_file:"https://tile.loc.gov/storage-services/service/other/new-file.txt",
    }]});
    expect(await auditStoredLocOcrExcerpt(saved)).toMatchObject({matches:false,reason:"resource"});
    expect(spy).toHaveBeenCalledTimes(1);
    spy=mock({...metadata,resources:[{fulltext_file:textUrl,download_restricted:true}]});
    expect(await auditStoredLocOcrExcerpt(saved)).toMatchObject({matches:false,reason:"resource"});
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("se la LoC indica ora accesso ristretto non scarica file e non dichiara falso mismatch",async()=>{
    const saved=await source();
    for(const item of [{...metadata.item,access_restricted:true},
      {...metadata.item,download_restricted:true},
      {...metadata.item,rights_restricted:true}]){
      const spy=mock({...metadata,item});
      await expect(auditStoredLocOcrExcerpt(saved)).rejects.toThrow(/ristretto/);
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });
  it("distinguere CORS/429/503/HTML/missing content da una vera discrepanza",async()=>{
    const saved=await source();
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new TypeError("Failed to fetch");}));
    await expect(auditStoredLocOcrExcerpt(saved)).rejects.toThrow(/Failed to fetch/);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("too many",{status:429})));
    await expect(auditStoredLocOcrExcerpt(saved)).rejects.toThrow(/429/);
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
      if(url.includes("www.loc.gov"))return response(metadata);
      return response("<html>Sign in required</html>","text/plain");
    }));
    await expect(auditStoredLocOcrExcerpt(saved)).rejects.toThrow(/non è un file OCR/);
  });
  it("rifiuta un record di backup strutturalmente falso prima della rete",async()=>{
    const saved=await source();
    const spy=mock();
    await expect(auditStoredLocOcrExcerpt({...saved,
      textUrl:"https://evil.invalid/password.txt"})).rejects.toThrow(/non valida/);
    expect(spy).not.toHaveBeenCalled();
  });
});
