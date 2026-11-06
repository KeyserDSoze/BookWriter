import { describe,expect,it } from "vitest";
import { newBook } from "./types";
import { extendArchiveCatalog } from "./archival-catalog";
import { extendHistoricalDossier,validateHistoricalClaim } from "./historical-research";
import { extendChapterBibliography } from "./bibliography";
import { appendInstitutionalInspection,activeInstitutionalInspections,
  allInstitutionalInspections,validInstitutionalInspection,
  type InstitutionalInspection } from "./institutional-inspection";
import { adjudicationPrompt,chapterSegments,createEditorialCycle,reviewerPrompt,
  validateReport } from "./editorial-board";

const at="2026-11-06T11:00:00.000Z";
const query="telegraph correspondence 1848";
const item={id:"loc:2020123456:"+Date.parse(at),provider:"loc.gov" as const,
  itemId:"2020123456",title:"Telegraph correspondence 1848",
  url:"https://www.loc.gov/item/2020123456/",query,retrievedAt:at};
const inspectedAt="2026-11-06T11:01:00.000Z";
const inspection:InstitutionalInspection={
  id:"locdetail:2020123456:"+Date.parse(inspectedAt),
  provider:"loc.gov",itemId:item.itemId,catalogItemId:item.id,url:item.url,
  inspectedAt,digitized:true,accessRestricted:false,
  rightsAdvisory:["Rights and access information must be evaluated per item."],
  accessAdvisory:["Consult the institution for permissions."],
  hasDigitalResources:true,hasTextResourceLink:false,
  evidenceStatus:"catalog_metadata_only",rightsStatus:"undetermined",
};
const base=()=>extendArchiveCatalog(undefined,[query],[item],at);
describe("LoC document-level inspection: metadata, not a right to publish",()=>{
  it("preserva scheda e quote, ma rifiuta ispezioni contraffatte e diritti inventati",()=>{
    const dossier=appendInstitutionalInspection(base(),inspection);
    expect(activeInstitutionalInspections(dossier)).toEqual([inspection]);
    expect(validInstitutionalInspection(inspection)).toBe(true);
    expect(validInstitutionalInspection({...inspection,url:"https://www.loc.gov.evil.invalid/item/2020123456/"})).toBe(false);
    expect(validInstitutionalInspection({...inspection,rightsStatus:"public_domain" as never})).toBe(false);
    expect(validInstitutionalInspection({...inspection,accessRestricted:"no" as never})).toBe(false);
    expect(validInstitutionalInspection({...inspection,rightsAdvisory:["x".repeat(500)]})).toBe(false);
    expect(()=>appendInstitutionalInspection(base(),{...inspection,
      catalogItemId:"loc:other123:"+Date.parse(at)})).toThrow(/non più attiva/);
    expect(()=>validateHistoricalClaim({
      claim:"La stazione era in funzione.",assessment:"consistent_with_excerpt",
      sourceIds:[inspection.id],sourceEvidence:[{sourceId:inspection.id,
        quote:"Rights and access information"}],
    },dossier)).toThrow();
  });
  it("storicizza ogni consultazione; un refresh del catalogo disattiva la vecchia ispezione",()=>{
    let dossier=appendInstitutionalInspection(base(),inspection);
    const changed={...inspection,inspectedAt:"2026-11-06T11:02:00.000Z",
      id:"locdetail:2020123456:"+Date.parse("2026-11-06T11:02:00.000Z"),
      accessRestricted:true};
    dossier=appendInstitutionalInspection(dossier,changed);
    expect(allInstitutionalInspections(dossier)).toHaveLength(2);
    expect(activeInstitutionalInspections(dossier)).toEqual([changed]);
    expect(()=>appendInstitutionalInspection(dossier,{...changed,digitized:false}))
      .toThrow(/Conflitto/);
    const itemLater={...item,retrievedAt:"2026-11-06T11:05:00.000Z",
      id:"loc:2020123456:"+Date.parse("2026-11-06T11:05:00.000Z")};
    const refreshed=extendArchiveCatalog(dossier,[query],[itemLater],itemLater.retrievedAt);
    expect(allInstitutionalInspections(refreshed)).toHaveLength(2);
    expect(activeInstitutionalInspections(refreshed)).toEqual([]);
  });
  it("Wikipedia, DOI e Wikisource preservano le ispezioni senza renderle documenti primari",()=>{
    let dossier=appendInstitutionalInspection(base(),inspection);
    dossier=extendHistoricalDossier(dossier,["Telegrafo nel 1848"],[],at);
    dossier=extendChapterBibliography(dossier,["10.1000/xyz123"],[],at);
    expect(activeInstitutionalInspections(dossier)).toEqual([inspection]);
  });
  it("solo lo storico e il giudice ricevono avvisi LoC; non diventano fonti per un claim",()=>{
    const book=newBook("Mara usa un telegrafo nel 1848.","Libro","Sobrio","Adulti");
    book.memory.secrets.chiave="Il passaggio segreto è dietro al camino.";
    book.chapters=[{id:"ch1",number:1,title:"Messaggio",purpose:"Scrivere",scenes:[
      {id:"s1",number:1,title:"Lettera",objective:"Avvisare",status:"canon",
        text:"Mara scrive un telegramma nel 1848."}],
      historicalDossier:appendInstitutionalInspection(base(),inspection)}];
    const chapter=book.chapters[0]!,cycle=createEditorialCycle("ch1");
    const seg=chapterSegments(chapter)[0]!;
    const historic=reviewerPrompt(book,cycle,"historical",seg,1);
    expect(historic.prompt).toContain("Rights and access information");
    for(const role of ["continuity","timeline","readerCasual","readerMystery"] as const)
      expect(reviewerPrompt(book,cycle,role,seg,1).prompt)
        .not.toContain("Rights and access information");
    const report=validateReport(cycle,"historical",seg,1,JSON.stringify({
      verdict:"issues",summary:"Da verificare presso l'istituzione.",
      memoryNote:"Nessuna prova primaria acquisita.",
      findings:[{sceneId:"s1",category:"storia",severity:"minor",
        evidence:"Mara scrive un telegramma",
        reason:"La scheda e i diritti non provano la disponibilità del telegrafo.",
        remediation:"Verificare prima gli originali.",
        historical:{claim:"Il telegrafo era operativo qui.",assessment:"unverified",
          sourceIds:[],sourceEvidence:[]}}],
    }),chapter);
    cycle.reports.push(report);
    const judge=adjudicationPrompt(book,cycle);
    expect(judge.prompt).toContain("Rights and access information");
    expect(judge.prompt).toContain('"rightsStatus":"undetermined"');
    expect(judge.system).toContain("gli avvisi sui diritti");
  });
});
