import {afterEach,describe,expect,it,vi} from "vitest";
import {listLocIiifCandidates,inspectLocIiif} from "./loc-iiif";
import {trustedLocIiifInfoUrl} from "../domain/loc-iiif";
import type {LocOcrExcerpt} from "../domain/loc-ocr";
import type {LocScanCollation} from "../domain/loc-scan-collation";
const at="2026-11-06T11:00:00.000Z",hash="a".repeat(64);
const infoUrl="https://tile.loc.gov/image-services/iiif/service:tests:telegraph-page/info.json";
const source:LocOcrExcerpt={
 id:"lococr:2020123456:"+Date.parse(at)+":"+hash.slice(0,16),
 provider:"loc.gov-ocr",itemId:"2020123456",catalogItemId:"loc:2020123456:1793980800000",
 inspectionId:"locdetail:2020123456:1793980860000",title:"Telegram correspondence",
 url:"https://www.loc.gov/item/2020123456/",
 textUrl:"https://tile.loc.gov/storage-services/service/a/letter.txt",
 excerpt:"The telegraph apparatus was operated in the station during winter.",
 contentSha256:hash,contentLength:400,excerptOffset:8,acquiredAt:at,
 rightsBasis:"permission",rightsNote:"Permesso per la breve citazione di questo passaggio.",
 rightsAttested:true,evidenceStatus:"institutional_ocr_unverified",
 rightsStatus:"author_attested_unverified",
};
const scan:LocScanCollation={
 id:"locscan:2020123456:"+Date.parse(at)+":"+hash.slice(0,16),
 itemId:source.itemId,ocrSourceId:source.id,ocrContentSha256:hash,
 catalogItemId:source.catalogItemId,inspectionId:source.inspectionId,
 scanPageUrl:source.url,pageLocator:"Pagina 12, colonna 2",
 observedText:"The telegraph apparatus was operated in the station during winter.",
 observedAt:at,observedOriginalAttested:true,excerptRightsAttested:true,
 comparison:"text_overlap",evidenceStatus:"author_visual_transcription_unverified",
 rightsStatus:"author_attested_unverified",
};
const meta={item:{id:"http://www.loc.gov/item/2020123456/",access_restricted:false},
  resources:[{info:infoUrl,fulltext_file:source.textUrl}]};
function mock(data:unknown=meta,detail:unknown={
 "@id":infoUrl.slice(0,-"/info.json".length),width:2000,height:3000,
}){
 const spy=vi.fn(async(url:string,options:RequestInit)=>{
   if(url===source.url+"?fo=json")return new Response(JSON.stringify(data),{
     headers:{"content-type":"application/json"}});
   if(url===infoUrl)return new Response(JSON.stringify(detail),{
     headers:{"content-type":"application/json"}});
   throw new Error("Unexpected resource "+options.method);
 });
 vi.stubGlobal("fetch",spy);return spy;
}
afterEach(()=>vi.unstubAllGlobals());
describe("LoC IIIF metadata source safety",()=>{
 it("reads only item metadata and declared IIIF info.json",async()=>{
   const spy=mock();
   const candidates=await listLocIiifCandidates(source.itemId);
   expect(candidates).toEqual([{infoUrl,resourceIndex:0,fileIndex:-1}]);
   const result=await inspectLocIiif(source,scan,candidates[0]!);
   expect(result).toMatchObject({infoUrl,width:2000,height:3000,
     itemId:source.itemId,ocrSourceId:source.id,collationId:scan.id,
     evidenceStatus:"institutional_iiif_metadata_unverified"});
   expect(result.infoSha256).toMatch(/^[a-f0-9]{64}$/);
   expect(spy).toHaveBeenCalledTimes(3);
   expect(spy.mock.calls.map(x=>x[0])).toEqual([
     source.url+"?fo=json",source.url+"?fo=json",infoUrl,
   ]);
   for(const [url,opts] of spy.mock.calls){
     expect(url).not.toContain(source.excerpt);
     expect(opts.method).toBe("GET");
     expect(opts.credentials).toBe("omit");
     expect(opts.redirect).toBe("error");
     expect(opts.referrerPolicy).toBe("no-referrer");
   }
 });
 it("rejects non-IIIF URLs, query tokens and non-institutional domains",()=>{
   expect(trustedLocIiifInfoUrl(infoUrl)).toBe(true);
   for(const value of [
     "http://tile.loc.gov/image-services/iiif/service:a/info.json",
     "https://example.org/image-services/iiif/service:a/info.json",
     "https://tile.loc.gov/image-services/iiif/service:a/info.json?key=1",
     "https://tile.loc.gov/image-services/iiif/service:a/full/max/0/default.jpg",
   ])expect(trustedLocIiifInfoUrl(value)).toBe(false);
 });
 it("does not inspect a resource withdrawn from the same catalog",async()=>{
   const spy=mock({...meta,resources:[]});
   await expect(inspectLocIiif(source,scan,{infoUrl,resourceIndex:0,fileIndex:-1}))
     .rejects.toThrow(/non è più pubblicata/);
   expect(spy).toHaveBeenCalledTimes(1);
 });
 it("blocks access restrictions and rejects mismatched IIIF identity",async()=>{
   const spy=mock({...meta,item:{...meta.item,access_restricted:true}});
   await expect(listLocIiifCandidates(source.itemId)).rejects.toThrow(/restrizioni/);
   expect(spy).toHaveBeenCalledTimes(1);
   mock(meta,{"@id":"https://example.org/other",width:2000,height:3000});
   await expect(inspectLocIiif(source,scan,{infoUrl,resourceIndex:0,fileIndex:-1}))
     .rejects.toThrow(/non corrispondenti/);
 });
 it("network failures and 429 are errors, never proof of a valid image",async()=>{
   vi.stubGlobal("fetch",vi.fn(async()=>{throw new TypeError("Failed to fetch");}));
   await expect(listLocIiifCandidates(source.itemId)).rejects.toThrow(/Failed to fetch/);
   vi.stubGlobal("fetch",vi.fn(async()=>new Response("limit",{status:429})));
   await expect(listLocIiifCandidates(source.itemId)).rejects.toThrow(/429/);
 });
});
