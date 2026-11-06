import {describe,expect,it} from "vitest";
import {extendArchiveCatalog} from "./archival-catalog";
import {appendInstitutionalInspection} from "./institutional-inspection";
import {appendLocOcrExcerpt,type LocOcrExcerpt} from "./loc-ocr";
import {appendLocScanCollation} from "./loc-scan-collation";
import {
  activeLocIiifReferences,allLocIiifReferences,appendLocIiifReference,
  validLocIiifReference,type LocIiifReference,
} from "./loc-iiif";
import {validateHistoricalClaim} from "./historical-research";
import {newBook} from "./types";
import {reviewerPrompt,adjudicationPrompt,createEditorialCycle,chapterSegments} from "./editorial-board";

const t="2026-11-06T11:00:00.000Z",hash="a".repeat(64);
const catalog={id:"loc:2020123456:"+Date.parse(t),provider:"loc.gov" as const,
 itemId:"2020123456",title:"Telegraph letters",url:"https://www.loc.gov/item/2020123456/",
 query:"telegraph correspondence 1848",retrievedAt:t};
const inspection={id:"locdetail:2020123456:"+Date.parse(t),
 itemId:catalog.itemId,catalogItemId:catalog.id,provider:"loc.gov" as const,
 url:catalog.url,inspectedAt:t,digitized:true,accessRestricted:false,
 rightsAdvisory:[],accessAdvisory:[],hasDigitalResources:true,hasTextResourceLink:true,
 evidenceStatus:"catalog_metadata_only" as const,rightsStatus:"undetermined" as const};
const source:LocOcrExcerpt={
 id:"lococr:2020123456:"+Date.parse(t)+":"+hash.slice(0,16),
 itemId:catalog.itemId,catalogItemId:catalog.id,inspectionId:inspection.id,
 provider:"loc.gov-ocr",title:catalog.title,url:catalog.url,
 textUrl:"https://tile.loc.gov/storage-services/service/a/letter.txt",
 excerpt:"The telegraph station received the most important message that winter.",
 contentSha256:hash,contentLength:400,excerptOffset:3,acquiredAt:t,
 rightsBasis:"permission",rightsNote:"Ho ottenuto un permesso per la breve citazione.",
 rightsAttested:true,evidenceStatus:"institutional_ocr_unverified",
 rightsStatus:"author_attested_unverified",
};
const base=()=>{
 const d=appendLocOcrExcerpt(appendInstitutionalInspection(
   extendArchiveCatalog(undefined,[catalog.query],[catalog],t),inspection),source);
 return appendLocScanCollation(d,source,{ocrSourceId:source.id,
   pageLocator:"Pagina 12, colonna 2",
   observedText:"The telegraph station received the most important message that winter.",
   observedOriginalAttested:true,excerptRightsAttested:true},
   "2026-11-06T11:01:00.000Z");
};
const record=(d:ReturnType<typeof base>):LocIiifReference=>{
 const collation=d.locOcr!.collations!.records[0]!;
 const inspectedAt="2026-11-06T11:03:00.000Z",sha="b".repeat(64);
 const infoUrl="https://tile.loc.gov/image-services/iiif/service:tests:page12/info.json";
 return {
   id:"lociiif:2020123456:"+Date.parse(inspectedAt)+":"+sha.slice(0,16),
   itemId:source.itemId,catalogItemId:source.catalogItemId,
   inspectionId:source.inspectionId,ocrSourceId:source.id,
   collationId:collation.id,pageLocator:collation.pageLocator,
   itemUrl:source.url,infoUrl,
   imageServiceUrl:infoUrl.slice(0,-"/info.json".length),
   resourceIndex:0,fileIndex:-1,width:2400,height:3000,
   infoSha256:sha,inspectedAt,samePageAttested:true,rightsAttested:true,
   evidenceStatus:"institutional_iiif_metadata_unverified",
   rightsStatus:"author_attested_unverified",
 };
};
describe("IIIF provenance snapshots",()=>{
 it("binds metadata to active OCR, scan, exact LoC record, without licensing pixels",()=>{
   const d=base(),entry=record(d);
   expect(validLocIiifReference(entry)).toBe(true);
   const next=appendLocIiifReference(d,entry);
   expect(activeLocIiifReferences(next)).toEqual([entry]);
   expect(allLocIiifReferences(next)).toEqual([entry]);
   expect(validLocIiifReference({...entry,rightsStatus:"verified" as never})).toBe(false);
   expect(validLocIiifReference({...entry,infoUrl:"https://example.org/info.json"})).toBe(false);
   expect(()=>appendLocIiifReference(next,{...entry,width:1234})).toThrow(/Conflitto/);
 });
 it("keeps the history but deactivates a withdrawn OCR and does not cite lociiif",()=>{
   const d=appendLocIiifReference(base(),record(base()));
   const refreshed=extendArchiveCatalog(d,[catalog.query],[{
     ...catalog,id:"loc:2020123456:"+(Date.parse(t)+1000),
     retrievedAt:"2026-11-06T11:00:01.000Z",
   }],"2026-11-06T11:00:01.000Z");
   expect(allLocIiifReferences(refreshed)).toHaveLength(1);
   expect(activeLocIiifReferences(refreshed)).toHaveLength(0);
   const entry=allLocIiifReferences(d)[0]!;
   expect(()=>validateHistoricalClaim({claim:"Documented telegram",
     assessment:"consistent_with_excerpt",sourceIds:[entry.id],
     sourceEvidence:[{sourceId:entry.id,quote:"The telegraph station received"}]},d))
     .toThrow(/inesistente/);
 });
 it("makes unverified technical metadata visible only to historian and critical judge",()=>{
   const d=base(),withIiif=appendLocIiifReference(d,record(d));
   const book=newBook("A private novel","Book","Sobrio","Adulti");
   book.chapters=[{id:"c1",number:1,title:"First chapter",purpose:"Telegram",
     scenes:[{id:"s1",number:1,title:"Telegram",objective:"Write",
       status:"canon",text:"Mara writes a telegram in winter."}],
     historicalDossier:withIiif}];
   const cycle=createEditorialCycle("c1"),chapter=book.chapters[0]!;
   const seg=chapterSegments(chapter)[0]!;
   const historian=reviewerPrompt(book,cycle,"historical",seg,1);
   expect(historian.prompt).toContain("lociiif:2020123456");
   for(const role of ["secrets","continuity","timeline","style","readerCasual"] as const)
     expect(reviewerPrompt(book,cycle,role,seg,1).prompt).not.toContain("lociiif:");
   const judge=adjudicationPrompt(book,cycle);
   expect(judge.prompt).toContain("lociiif:2020123456");
 });
});
