import { describe,expect,it } from "vitest";
import { extendArchiveCatalog } from "./archival-catalog";
import { appendInstitutionalInspection } from "./institutional-inspection";
import { extendHistoricalDossier,validateHistoricalClaim } from "./historical-research";
import { extendChapterBibliography } from "./bibliography";
import { extendWikisourceDossier } from "./wikisource-excerpts";
import { appendLocOcrExcerpt,activeLocOcrExcerpts,allLocOcrExcerpts,
  validLocOcrExcerpt,type LocOcrExcerpt } from "./loc-ocr";
import { newBook } from "./types";
import { adjudicationPrompt,chapterSegments,createEditorialCycle,
  reviewerPrompt,validateReport } from "./editorial-board";
const at="2026-11-06T11:00:00.000Z";
const catalog={id:"loc:2020123456:"+Date.parse(at),provider:"loc.gov" as const,
  itemId:"2020123456",url:"https://www.loc.gov/item/2020123456/",
  title:"Telegraph correspondence",query:"telegraph historical correspondence",
  retrievedAt:at};
const inspectionTime="2026-11-06T11:02:00.000Z";
const inspection={id:"locdetail:2020123456:"+Date.parse(inspectionTime),
  provider:"loc.gov" as const,itemId:"2020123456",catalogItemId:catalog.id,
  url:catalog.url,inspectedAt:inspectionTime,digitized:true,
  accessRestricted:false,rightsAdvisory:["Rights must be assessed by the user."],
  accessAdvisory:[],hasDigitalResources:true,hasTextResourceLink:true,
  evidenceStatus:"catalog_metadata_only" as const,rightsStatus:"undetermined" as const};
const acquiredAt="2026-11-06T11:05:00.000Z";
const hash="a".repeat(64);
const source:LocOcrExcerpt={
  id:"lococr:2020123456:"+Date.parse(acquiredAt)+":"+hash.slice(0,16),
  provider:"loc.gov-ocr",catalogItemId:catalog.id,
  inspectionId:inspection.id,itemId:"2020123456",title:catalog.title,
  url:catalog.url,textUrl:"https://tile.loc.gov/storage-services/service/gdc/letter.txt",
  excerpt:"The telegraph apparatus was operated at the station during the winter of 1848.",
  contentSha256:hash,contentLength:600,excerptOffset:12,acquiredAt,
  rightsBasis:"public_domain",rightsNote:"Ho controllato personalmente il pubblico dominio del documento.",
  rightsAttested:true,evidenceStatus:"institutional_ocr_unverified",
  rightsStatus:"author_attested_unverified",
};
const base=()=>appendInstitutionalInspection(
  extendArchiveCatalog(undefined,[catalog.query],[catalog],at),inspection);
describe("Evidenza OCR LoC con attestazione dei diritti e provenienza immutabile",()=>{
  it("conserva solo un testo attestato e non permette cataloghi o ispezioni obsolete",()=>{
    expect(validLocOcrExcerpt(source)).toBe(true);
    const dossier=appendLocOcrExcerpt(base(),source);
    expect(activeLocOcrExcerpts(dossier)).toEqual([source]);
    expect(allLocOcrExcerpts(dossier)).toHaveLength(1);
    expect(validLocOcrExcerpt({...source,rightsStatus:"licensed" as never})).toBe(false);
    expect(validLocOcrExcerpt({...source,textUrl:"https://evil.invalid/a.txt"})).toBe(false);
    expect(validLocOcrExcerpt({...source,excerptOffset:600})).toBe(false);
    expect(()=>appendLocOcrExcerpt(dossier,{...source,excerpt:"A fake transcript unlinked to the downloaded content."}))
      .toThrow(/Conflitto/);
    const refreshed=extendArchiveCatalog(dossier,[catalog.query],[{
      ...catalog,retrievedAt:"2026-11-06T12:00:00.000Z",
      id:"loc:2020123456:"+Date.parse("2026-11-06T12:00:00.000Z"),
    }],"2026-11-06T12:00:00.000Z");
    expect(allLocOcrExcerpts(refreshed)).toEqual([source]);
    expect(activeLocOcrExcerpts(refreshed)).toEqual([]);
    const newInspection={...inspection,inspectedAt:"2026-11-06T12:02:00.000Z",
      id:"locdetail:2020123456:"+Date.parse("2026-11-06T12:02:00.000Z")};
    const reinspection=appendInstitutionalInspection(dossier,newInspection);
    expect(activeLocOcrExcerpts(reinspection)).toEqual([]);
  });
  it("cita OCR solo con sourceEvidence per fonte, senza fingere corroborazione indipendente",()=>{
    const dossier=appendLocOcrExcerpt(base(),source);
    const claim={
      claim:"Il telegrafo operava nella stazione nel 1848.",
      assessment:"consistent_with_excerpt" as const,sourceIds:[source.id],
      sourceEvidence:[{sourceId:source.id,quote:"The telegraph apparatus was operated"}],
    };
    expect(()=>validateHistoricalClaim(claim,dossier)).not.toThrow();
    expect(()=>validateHistoricalClaim({...claim,
      sourceEvidence:[{sourceId:source.id,quote:"Invented a phrase of historical text"}]},
      dossier)).toThrow(/non compare/);
    expect(()=>validateHistoricalClaim({...claim,sourceIds:[catalog.id],
      sourceEvidence:[{sourceId:catalog.id,quote:"Rights must be assessed"}]},dossier)).toThrow();
    const copied={...source,id:"lococr:2020123456:"+(Date.parse(acquiredAt)+1000)+":"
      +hash.slice(0,16),acquiredAt:"2026-11-06T11:05:01.000Z"};
    const duplicates=appendLocOcrExcerpt(dossier,copied);
    expect(()=>validateHistoricalClaim({...claim,sourceIds:[source.id,copied.id],
      sourceEvidence:[{sourceId:source.id,quote:claim.sourceEvidence[0]!.quote},
        {sourceId:copied.id,quote:claim.sourceEvidence[0]!.quote}]},duplicates))
      .toThrow(/non sono fonti indipendenti/);
  });
  it("preserva evidenza OCR attraverso refresh Wikipedia, DOI e Wikisource",()=>{
    let dossier=appendLocOcrExcerpt(base(),source);
    dossier=extendHistoricalDossier(dossier,["Telegrafo nel 1848"],[],at);
    dossier=extendChapterBibliography(dossier,["10.1000/xyz123"],[],at);
    expect(activeLocOcrExcerpts(dossier)).toHaveLength(1);
    expect(dossier.locOcr?.excerpts[0]?.id).toBe(source.id);
  });
  it("solo storico e giudice vedono OCR; nemmeno gli altri sei specialisti o i lettori ciechi",()=>{
    const book=newBook("Mara e il telegrafo","Romanzo","Sobrio","Adulti");
    book.memory.secrets.chiave="Dietro il camino si trova una stanza privata.";
    book.chapters=[{id:"ch1",number:1,title:"Lettera",purpose:"Comunicare",
      scenes:[{id:"s1",number:1,title:"Telegramma",objective:"Inviare un avviso",
        text:"Mara invia un telegramma nel 1848.",status:"canon"}],
      historicalDossier:appendLocOcrExcerpt(base(),source)}];
    const chapter=book.chapters[0]!,cycle=createEditorialCycle("ch1");
    const seg=chapterSegments(chapter)[0]!;
    const historic=reviewerPrompt(book,cycle,"historical",seg,1);
    expect(historic.prompt).toContain("lococr:2020123456");
    expect(historic.prompt).toContain("The telegraph apparatus was operated");
    for(const role of ["timeline","continuity","style","readerCasual","readerMystery"] as const)
      expect(reviewerPrompt(book,cycle,role,seg,1).prompt)
        .not.toContain("The telegraph apparatus was operated");
    const report=validateReport(cycle,"historical",seg,1,JSON.stringify({
      verdict:"issues",summary:"Il testo OCR esiste, ma potrebbe essere inaccurato.",
      memoryNote:"Confrontare il documento originale prima della correzione.",
      findings:[{sceneId:"s1",category:"storia",severity:"minor",
        evidence:"Mara invia un telegramma",reason:"Si deve controllare l'accuratezza dell'OCR.",
        remediation:"Verificare l'edizione originale.",
        historical:{claim:"Il telegrafo era in uso nel 1848.",
          assessment:"consistent_with_excerpt",sourceIds:[source.id],
          sourceEvidence:[{sourceId:source.id,quote:"The telegraph apparatus was operated"}]}}],
    }),chapter);
    cycle.reports.push(report);
    const judge=adjudicationPrompt(book,cycle);
    expect(judge.prompt).toContain("The telegraph apparatus was operated");
    expect(judge.prompt).toContain('"quoteMatches":true');
    expect(judge.system).toContain("L'OCR LoC lococr:");
  });
});
