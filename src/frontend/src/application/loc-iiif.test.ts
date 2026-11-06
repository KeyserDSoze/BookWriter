import "fake-indexeddb/auto";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {extendArchiveCatalog} from "../domain/archival-catalog";
import {appendInstitutionalInspection} from "../domain/institutional-inspection";
import {appendLocOcrExcerpt,type LocOcrExcerpt} from "../domain/loc-ocr";
import {appendLocScanCollation} from "../domain/loc-scan-collation";
import {activeLocIiifReferences,allLocIiifReferences,type LocIiifReference} from "../domain/loc-iiif";
import {newBook,type BookProject} from "../domain/types";
import {getBook,getDb,listActivities,saveBook} from "../infrastructure/db";
import {getOutbox} from "../infrastructure/outbox";
const {inspectMock}=vi.hoisted(()=>({inspectMock:vi.fn()}));
vi.mock("../infrastructure/loc-iiif",()=>({inspectLocIiif:inspectMock}));
import {attachLocIiifReference} from "./loc-iiif";

const t="2026-11-06T11:00:00.000Z",hash="a".repeat(64);
const catalog={id:"loc:2020123456:"+Date.parse(t),provider:"loc.gov" as const,
  itemId:"2020123456",title:"Telegraph letters",
  url:"https://www.loc.gov/item/2020123456/",query:"telegraph correspondence 1848",retrievedAt:t};
const inspectedAt="2026-11-06T11:01:00.000Z";
const inspection={id:"locdetail:2020123456:"+Date.parse(inspectedAt),
 provider:"loc.gov" as const,itemId:catalog.itemId,catalogItemId:catalog.id,
 url:catalog.url,inspectedAt,digitized:true,accessRestricted:false,
 rightsAdvisory:[],accessAdvisory:[],hasDigitalResources:true,hasTextResourceLink:true,
 evidenceStatus:"catalog_metadata_only" as const,rightsStatus:"undetermined" as const};
const source:LocOcrExcerpt={
 id:"lococr:2020123456:"+Date.parse(t)+":"+hash.slice(0,16),
 provider:"loc.gov-ocr",itemId:catalog.itemId,catalogItemId:catalog.id,
 inspectionId:inspection.id,title:catalog.title,url:catalog.url,
 textUrl:"https://tile.loc.gov/storage-services/service/a/letter.txt",
 excerpt:"The telegraph station received several urgent letters during winter.",
 contentSha256:hash,contentLength:400,excerptOffset:6,acquiredAt:t,
 rightsBasis:"permission",rightsNote:"Permesso ottenuto per l'estratto e il modello AI.",
 rightsAttested:true,evidenceStatus:"institutional_ocr_unverified",
 rightsStatus:"author_attested_unverified",
};
const candidate={infoUrl:"https://tile.loc.gov/image-services/iiif/service:tests:page12/info.json",
 resourceIndex:0,fileIndex:-1};
const result:LocIiifReference={
 id:"lociiif:2020123456:"+Date.parse(t)+":"+"b".repeat(16),
 itemId:source.itemId,catalogItemId:source.catalogItemId,
 inspectionId:source.inspectionId,ocrSourceId:source.id,
 collationId:"locscan:2020123456:"+Date.parse(t)+":"+hash.slice(0,16),
 pageLocator:"Pagina 12, colonna 2",itemUrl:source.url,infoUrl:candidate.infoUrl,
 imageServiceUrl:candidate.infoUrl.slice(0,-"/info.json".length),
 resourceIndex:0,fileIndex:-1,width:2400,height:3100,infoSha256:"b".repeat(64),
 inspectedAt:t,samePageAttested:true,rightsAttested:true,
 evidenceStatus:"institutional_iiif_metadata_unverified",
 rightsStatus:"author_attested_unverified",
};
async function fixture(frozen=false):Promise<BookProject>{
 const book=newBook("Segreto di Mara","Titolo","Sobrio","Adulti");
 book.status="paused";book.phase="prose";
 book.memory.secrets.chiave="Non condividere il segreto con LoC.";
 const dossier=appendLocOcrExcerpt(appendInstitutionalInspection(
   extendArchiveCatalog(undefined,[catalog.query],[catalog],t),inspection),source);
 const withScan=appendLocScanCollation(dossier,source,{
   ocrSourceId:source.id,pageLocator:"Pagina 12, colonna 2",
   observedText:source.excerpt,observedOriginalAttested:true,
   excerptRightsAttested:true,
 },t);
 book.chapters=[{id:"c1",number:1,title:"Lettera",purpose:"Apertura",
   scenes:[{id:"s1",number:1,title:"Scrivere",objective:"Spedire",
     text:"Mara scrive un telegramma.",status:"canon"}],
   historicalDossier:withScan,
   ...(frozen?{frozenAt:t,summary:"Mara scrive.",bookSummaryAtFreeze:"Mara scrive."}:{})},
   {id:"c2",number:2,title:"Viaggio",purpose:"Partenza",
    scenes:[{id:"s2",number:1,title:"Carrozza",objective:"Viaggiare",
      text:"Mara parte.",status:"canon"}],
    ...(frozen?{frozenAt:t,summary:"Mara parte.",bookSummaryAtFreeze:"Mara scrive e parte."}:{})}];
 if(frozen){book.status="completed";book.phase="completed";book.bookSummary="Mara scrive e parte.";}
 book.remote={owner:"alice",repository:"novel",branch:"main",autoSync:true,
   lastSyncedCommit:"a".repeat(40)};
 await saveBook(book);return book;
}
beforeEach(async()=>{
 const db=await getDb();
 for(const store of ["books","activities","outbox"] as const)await db.clear(store);
 inspectMock.mockReset();inspectMock.mockResolvedValue(result);
 vi.stubGlobal("navigator",{locks:{request:async(_name:string,_opts:unknown,
   cb:(lock:object)=>Promise<unknown>)=>cb({name:"lock"})}});
});
afterEach(()=>vi.unstubAllGlobals());
describe("Author IIIF association transaction",()=>{
 it("saves exact reference without sending private canon or modifying prose",async()=>{
   const b=await fixture();
   const r=await attachLocIiifReference(b.id,"c1",b.updatedAt,result.collationId,
     candidate,true,true);
   expect(r).toMatchObject({reopened:false,referenceId:result.id});
   expect(inspectMock).toHaveBeenCalledTimes(1);
   expect(JSON.stringify(inspectMock.mock.calls)).not.toContain("Non condividere");
   const saved=await getBook(b.id);
   expect(activeLocIiifReferences(saved?.chapters[0]?.historicalDossier)).toEqual([result]);
   expect(saved?.chapters[0]?.scenes[0]?.text).toBe("Mara scrive un telegramma.");
   expect(saved?.remote?.autoSync).toBe(false);
   expect(await getOutbox(b.id)).toBeUndefined();
   expect((await listActivities(b.id)).some(x=>x.title.includes("IIIF LoC"))).toBe(true);
 });
 it("rewinds frozen chapter and downstream preserving story",async()=>{
   const b=await fixture(true);
   const r=await attachLocIiifReference(b.id,"c1",b.updatedAt,result.collationId,
     candidate,true,true);
   expect(r.reopened).toBe(true);
   const saved=await getBook(b.id);
   expect(saved?.chapters[0]?.frozenAt).toBeUndefined();
   expect(saved?.chapters[1]?.frozenAt).toBeUndefined();
   expect(saved?.editorialCycle?.chapterId).toBe("c1");
   expect(saved?.bookSummary).toBe("");
 });
 it("fails closed on stale book or rejected author statements",async()=>{
   const b=await fixture();
   await expect(attachLocIiifReference(b.id,"c1",b.updatedAt,result.collationId,
     candidate,false as never,true)).rejects.toThrow(/Conferma/);
   expect(inspectMock).not.toHaveBeenCalled();
   inspectMock.mockImplementationOnce(async()=>{
     const changed=(await getBook(b.id))!;
     changed.authorConstraints.push("Vincolo concorrente");
     await saveBook(changed,false);return result;
   });
   await expect(attachLocIiifReference(b.id,"c1",b.updatedAt,result.collationId,
     candidate,true,true)).rejects.toThrow(/modificato durante/);
   expect(allLocIiifReferences((await getBook(b.id))?.chapters[0]?.historicalDossier))
     .toHaveLength(0);
 });
});
