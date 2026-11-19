import { describe,expect,it } from "vitest";
import { extendArchiveCatalog } from "./archival-catalog";
import { extendChapterBibliography } from "./bibliography";
import { adjudicationPrompt,chapterSegments,createEditorialCycle,
  reviewerPrompt,validateReport } from "./editorial-board";
import { extendHistoricalDossier,validateHistoricalClaim } from "./historical-research";
import { appendInstitutionalInspection } from "./institutional-inspection";
import { appendLocOcrExcerpt,type LocOcrExcerpt } from "./loc-ocr";
import {
  activeLocScanCollations,allLocScanCollations,appendLocScanCollation,
  compareScanTranscription,validLocScanCollation,
} from "./loc-scan-collation";
import { newBook } from "./types";

const at="2026-11-06T11:00:00.000Z";
const inspectedAt="2026-11-06T11:01:00.000Z";
const capturedAt="2026-11-06T11:02:00.000Z";
const verifiedAt="2026-11-06T11:03:00.000Z";
const catalog={id:"loc:2020123456:"+Date.parse(at),provider:"loc.gov" as const,
  itemId:"2020123456",title:"Telegraph correspondence",
  url:"https://www.loc.gov/item/2020123456/",retrievedAt:at,
  query:"telegraph correspondence 1848"};
const inspection={id:"locdetail:2020123456:"+Date.parse(inspectedAt),provider:"loc.gov" as const,
  itemId:catalog.itemId,catalogItemId:catalog.id,url:catalog.url,inspectedAt,
  digitized:true,accessRestricted:false,rightsAdvisory:[],accessAdvisory:[],
  hasDigitalResources:true,hasTextResourceLink:true,
  evidenceStatus:"catalog_metadata_only" as const,rightsStatus:"undetermined" as const};
const hash="a".repeat(64);
const source:LocOcrExcerpt={
  id:"lococr:2020123456:"+Date.parse(capturedAt)+":"+hash.slice(0,16),
  itemId:catalog.itemId,catalogItemId:catalog.id,inspectionId:inspection.id,
  provider:"loc.gov-ocr",title:catalog.title,url:catalog.url,
  textUrl:"https://tile.loc.gov/storage-services/service/gdc/letter.txt",
  excerpt:"The telegraph station received urgent messages during the bitter winter of 1848.",
  contentSha256:hash,contentLength:500,excerptOffset:7,acquiredAt:capturedAt,
  rightsBasis:"permission",rightsNote:"L'autore ha autorizzazione scritta per breve citazione.",
  rightsAttested:true,evidenceStatus:"institutional_ocr_unverified",
  rightsStatus:"author_attested_unverified",
};
const base=()=>appendLocOcrExcerpt(appendInstitutionalInspection(
  extendArchiveCatalog(undefined,[catalog.query],[catalog],at),inspection),source);
const input={
  ocrSourceId:source.id,
  pageLocator:"Pagina 12, colonna 2",
  observedText:"The telegraph station received urgent messages during the bitter winter of 1848.",
  observedOriginalAttested:true as const,excerptRightsAttested:true as const,
};
describe("Collazione dichiarata OCR e scansione originale",()=>{
  it("compara soltanto testo digitato, mai i pixel e mai come autenticazione storica",()=>{
    expect(compareScanTranscription(source.excerpt,
      "  THE  telegraph station received urgent messages during the bitter winter of 1848. "))
      .toBe("text_overlap");
    expect(compareScanTranscription(source.excerpt,
      "The station was inoperable for weeks in the bitter winter of 1848."))
      .toBe("text_discrepancy");
    const dossier=appendLocScanCollation(base(),source,input,verifiedAt);
    const records=activeLocScanCollations(dossier);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      scanPageUrl:catalog.url,ocrSourceId:source.id,ocrContentSha256:hash,
      comparison:"text_overlap",rightsStatus:"author_attested_unverified",
      evidenceStatus:"author_visual_transcription_unverified",
    });
    expect(validLocScanCollation(records[0]!)).toBe(true);
    expect(validLocScanCollation({...records[0]!,scanPageUrl:"https://evil.invalid/scan.jpg"}))
      .toBe(false);
    expect(validLocScanCollation({...records[0]!,rightsStatus:"verified" as never}))
      .toBe(false);
    expect(validLocScanCollation({...records[0]!,observedOriginalAttested:false as never}))
      .toBe(false);
    expect(()=>appendLocScanCollation(base(),source,{...input,
      excerptRightsAttested:false as never},verifiedAt)).toThrow(/attestare/);
  });
  it("storicizza differenze e non sovrascrive la prima osservazione; ripristina solo snapshot validi",()=>{
    let d=appendLocScanCollation(base(),source,input,verifiedAt);
    const secondAt="2026-11-06T11:04:00.000Z";
    const changed={...input,
      observedText:"The station was inoperable throughout the whole bitter winter of 1848."};
    d=appendLocScanCollation(d,source,changed,secondAt);
    expect(allLocScanCollations(d)).toHaveLength(2);
    expect(activeLocScanCollations(d)).toHaveLength(1);
    expect(activeLocScanCollations(d)[0]?.comparison).toBe("text_discrepancy");
    expect(()=>appendLocScanCollation(d,source,input,secondAt)).toThrow(/Conflitto/);
    const altered={...d,locOcr:{...d.locOcr!,collations:{
      ...d.locOcr!.collations!,records:d.locOcr!.collations!.records.map(x=>
        x.comparison==="text_discrepancy"?
          {...x,comparison:"text_overlap" as const}:x),
    }}};
    expect(activeLocScanCollations(altered)).toHaveLength(0);
    const nextSource={...source,acquiredAt:"2026-11-06T11:05:00.000Z",
      id:"lococr:2020123456:"+Date.parse("2026-11-06T11:05:00.000Z")+":"+hash.slice(0,16)};
    const refreshed=appendLocOcrExcerpt(d,nextSource);
    expect(allLocScanCollations(refreshed)).toHaveLength(2);
    expect(activeLocScanCollations(refreshed)).toEqual([]);
  });
  it("preserva storico nei refresh e impedisce di citare locscan come documento indipendente",()=>{
    let d=appendLocScanCollation(base(),source,input,verifiedAt);
    d=extendHistoricalDossier(d,["Telegrafo nel 1848"],[],at);
    d=extendChapterBibliography(d,["10.1000/example"],[],at);
    expect(activeLocScanCollations(d)).toHaveLength(1);
    const entry=activeLocScanCollations(d)[0]!;
    expect(()=>validateHistoricalClaim({claim:"Il telegrafo funzionava.",
      assessment:"consistent_with_excerpt",sourceIds:[entry.id],
      sourceEvidence:[{sourceId:entry.id,quote:entry.observedText.slice(0,45)}]},d)).toThrow();
    const refreshed=extendArchiveCatalog(d,[catalog.query],[{
      ...catalog,id:"loc:2020123456:"+(Date.parse(at)+1000),
      retrievedAt:"2026-11-06T11:00:01.000Z"}],"2026-11-06T11:00:01.000Z");
    expect(allLocScanCollations(refreshed)).toHaveLength(1);
    expect(activeLocScanCollations(refreshed)).toEqual([]);
  });
  it("rende visibile la discordanza solo allo storico e al giudice critico, non agli altri undici agenti",()=>{
    const statement="The station was inoperable throughout the bitter winter of 1848.";
    const d=appendLocScanCollation(base(),source,{...input,observedText:statement},verifiedAt);
    const b=newBook("Mara attraversa l'Italia","Libro","Sobrio","Adulti");
    b.chapters=[{id:"c1",number:1,title:"Il segreto",purpose:"Lettere",
      scenes:[{id:"s1",number:1,title:"Telegramma",objective:"Scrivere",
        text:"Mara invia un telegramma nel 1848.",status:"canon"}],
      historicalDossier:d}];
    const chapter=b.chapters[0]!,cycle=createEditorialCycle("c1");
    const segment=chapterSegments(chapter)[0]!;
    const specialist=reviewerPrompt(b,cycle,"historical",segment,1);
    expect(specialist.prompt).toContain(statement);
    expect(specialist.prompt).toContain("text_discrepancy");
    for(const role of ["continuity","timeline","secrets","style","readerCasual","readerMystery"] as const)
      expect(reviewerPrompt(b,cycle,role,segment,1).prompt).not.toContain(statement);
    const report=validateReport(cycle,"historical",segment,1,JSON.stringify({
      verdict:"issues",summary:"Possibile errore della trascrizione OCR.",
      memoryNote:"Richiesta verifica dell'originale visuale.",
      findings:[{sceneId:"s1",category:"storia",severity:"minor",
        evidence:"Mara invia un telegramma",reason:"La collazione è discordante.",
        remediation:"Ricontrollare la pagina 12.",
        historical:{claim:"Il telegrafo era attivo.",assessment:"unverified",
          sourceIds:[],sourceEvidence:[]}}],
    }),chapter);
    cycle.reports.push(report);
    const judge=adjudicationPrompt(b,cycle);
    expect(judge.prompt).toContain(statement);
    expect(judge.prompt).toContain("text_discrepancy");
    expect(judge.system).toContain("collazioni locscan:");
  });
});
