import { afterEach,describe,expect,it,vi } from "vitest";
import { fetchLocOcrExcerpt,selectLocOcrExcerpt } from "./loc-ocr";
import { trustedLocTextUrl } from "../domain/loc-ocr";

const itemId="2020123456",catalogItemId="loc:2020123456:1793980800000",
  inspectionId="locdetail:2020123456:1793980860000";
const title="Telegraph correspondence";
const sourceUrl="https://tile.loc.gov/storage-services/service/gdc/telegraph_letters.txt";
const rights={rightsBasis:"public_domain" as const,
  rightsNote:"Ho consultato la dichiarazione di pubblico dominio del documento.",rightsAttested:true as const};
const raw="The telegraph apparatus was operated at the station during the winter of 1848.\n"+ 
  "Letters were carried through the countryside for the following several weeks.\n";
const meta={item:{id:"http://www.loc.gov/item/2020123456/",access_restricted:false,
  rights_advisory:["Conditions vary by jurisdiction"]},
  resources:[{fulltext_file:sourceUrl,pdf:"https://other.invalid/danger.pdf"}]};
function respond(data:unknown,contentType="application/json",status=200){
  return new Response(typeof data==="string"?data:JSON.stringify(data),{
    status,headers:{"content-type":contentType}});
}
function mockApis(metadata:unknown=meta,text:unknown=raw){
  const spy=vi.fn(async(url:string,opts:RequestInit)=>{
    if(url.startsWith("https://www.loc.gov/item/"))return respond(metadata);
    if(url===sourceUrl)return respond(text,"text/plain; charset=utf-8");
    throw new Error("URL non ammessa: "+url+" "+opts.method);
  });
  vi.stubGlobal("fetch",spy);return spy;
}
afterEach(()=>vi.unstubAllGlobals());

describe("LoC OCR: no arbitrary downloads, literal content only",()=>{
  it("recupera due sole risorse LoC consentite e associa la citazione all'OCR realmente ricevuto",async()=>{
    const spy=mockApis();
    const result=await fetchLocOcrExcerpt(itemId,catalogItemId,inspectionId,title,rights);
    expect(spy).toHaveBeenCalledTimes(2);
    const first=new URL(spy.mock.calls[0]![0]),second=new URL(spy.mock.calls[1]![0]);
    expect(first.origin).toBe("https://www.loc.gov");
    expect(first.pathname).toBe("/item/2020123456/");
    expect(first.searchParams.get("fo")).toBe("json");
    expect(second.href).toBe(sourceUrl);
    for(const [,init]of spy.mock.calls){
      expect(init.method).toBe("GET");
      expect(init.credentials).toBe("omit");
      expect(init.redirect).toBe("error");
      expect(init.referrerPolicy).toBe("no-referrer");
      expect(init.headers).toBeUndefined();
    }
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Ho consultato");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Telegraph correspondence");
    expect(result.id).toMatch(/^lococr:2020123456:\d+:[0-9a-f]{16}$/);
    expect(result.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.contentLength).toBe(raw.length);
    expect(raw.slice(result.excerptOffset,result.excerptOffset+result.excerpt.length)).toBe(result.excerpt);
    expect(result.excerpt).toContain("apparatus");
    expect(result.rightsStatus).toBe("author_attested_unverified");
    expect(result.evidenceStatus).toBe("institutional_ocr_unverified");
    expect(result.textUrl).toBe(sourceUrl);
    expect(result.rightsBasis).toBe("public_domain");
  });
  it("rifiuta host falsi, redirect, url parametrizzate e risorse pericolose",async()=>{
    const badUrls=[
      "https://evil.invalid/storage-services/service/x.txt",
      "https://tile.loc.gov.evil.invalid/storage-services/service/x.txt",
      "http://tile.loc.gov/storage-services/service/x.txt",
      "https://tile.loc.gov/storage-services/service/x.pdf",
      "https://tile.loc.gov/storage-services/service/x.txt?token=1",
      "https://tile.loc.gov/streaming-services/service/x.txt",
      "https://tile.loc.gov/storage-services/service/%2e%2e/x.txt",
    ];
    for(const url of badUrls)expect(trustedLocTextUrl(url)).toBe(false);
    for(const value of badUrls){
      const spy=mockApis({...meta,resources:[{fulltext_file:value}]});
      await expect(fetchLocOcrExcerpt(itemId,catalogItemId,inspectionId,title,rights))
        .rejects.toThrow(/non espone/);
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });
  it("se il record ha accesso ristretto o identità differente non accede al file",async()=>{
    for(const metadata of [
      {...meta,item:{...meta.item,access_restricted:true}},
      {...meta,item:{...meta.item,id:"https://www.loc.gov/item/other123/"}},
      {...meta,item:{...meta.item,id:"https://www.loc.gov.evil.invalid/item/2020123456/"}},
    ]){
      const spy=mockApis(metadata);
      await expect(fetchLocOcrExcerpt(itemId,catalogItemId,inspectionId,title,rights))
        .rejects.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });
  it("non scarica risorse contrassegnate come rights/download restricted",async()=>{
    for(const property of ["download_restricted","rights_restricted"] as const){
      const spy=mockApis({...meta,resources:[{fulltext_file:sourceUrl,[property]:true}]});
      await expect(fetchLocOcrExcerpt(itemId,catalogItemId,inspectionId,title,rights))
        .rejects.toThrow(/non espone/);
      expect(spy).toHaveBeenCalledTimes(1);
    }
    for(const flag of ["true",0]){
      const spy=mockApis({...meta,item:{...meta.item,access_restricted:flag}});
      await expect(fetchLocOcrExcerpt(itemId,catalogItemId,inspectionId,title,rights))
        .rejects.toThrow(/Flag/);
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });
  it("senza attestazione o collocazione non invia alcuna richiesta",async()=>{
    const spy=mockApis();
    await expect(fetchLocOcrExcerpt(itemId,catalogItemId,inspectionId,title,
      {...rights,rightsNote:"breve"})).rejects.toThrow(/diritti/);
    await expect(fetchLocOcrExcerpt(itemId,"loc:foreign:123",inspectionId,title,rights))
      .rejects.toThrow(/Identificativi/);
    expect(spy).not.toHaveBeenCalled();
  });
  it("seconda GET fallita, errore CORS, risposta HTML e body eccessivo non producono evidenze",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
      if(url.includes("www.loc.gov"))return respond(meta);
      return new Response("Service unavailable",{status:503});
    }));
    await expect(fetchLocOcrExcerpt(itemId,catalogItemId,inspectionId,title,rights))
      .rejects.toThrow(/503/);
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new TypeError("Failed to fetch");}));
    await expect(fetchLocOcrExcerpt(itemId,catalogItemId,inspectionId,title,rights))
      .rejects.toThrow(/Failed to fetch/);
    mockApis(meta,"<html>not text</html>");
    // Valid plaintext MIME alone does not prove that a document is historical.
    await expect(fetchLocOcrExcerpt(itemId,catalogItemId,inspectionId,title,rights))
      .rejects.toThrow(/non è un file OCR testuale/);
    mockApis(meta,"x".repeat(160_001));
    await expect(fetchLocOcrExcerpt(itemId,catalogItemId,inspectionId,title,rights))
      .rejects.toThrow(/troppo grande/);
  });
  it("seleziona un frammento OCR letterale senza inferire parole mancanti",()=>{
    const text="TITLE\nThe telegraph station was busy during the cold winter of eighteen forty-eight.\n";
    const selected=selectLocOcrExcerpt(text)!;
    expect(text.slice(selected.offset,selected.offset+selected.excerpt.length)).toBe(selected.excerpt);
    expect(selectLocOcrExcerpt("{{only templates}}\n")).toBeUndefined();
  });
});
