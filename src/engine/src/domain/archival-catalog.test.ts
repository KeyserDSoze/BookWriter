import { describe, expect, it } from "vitest";
import { newBook } from "./types";
import { extendChapterBibliography } from "./bibliography";
import { extendHistoricalDossier } from "./historical-research";
import { activeArchivalItems, extendArchiveCatalog, locItemUrl,
  normalizeArchiveQueries, type ArchivalCatalogItem } from "./archival-catalog";
import { chapterSegments, createEditorialCycle, adjudicationPrompt,
  reviewerPrompt, validateReport } from "./editorial-board";

const at="2026-11-06T10:00:00.000Z";
const item:ArchivalCatalogItem={
  id:"loc:2020123456:"+Date.parse(at),provider:"loc.gov",itemId:"2020123456",
  title:"Telegraph correspondence collection",
  url:"https://www.loc.gov/item/2020123456/",
  date:"1848",description:"Historical correspondence about telegraph communications.",
  query:"telegraph communications 1848",retrievedAt:at,
};
describe("Catalogo archivistico istituzionale LoC",()=>{
  it("accetta soltanto ricerche pubbliche controllate e URL ricostruite",()=>{
    expect(normalizeArchiveQueries([" telegraph communications 1848 ","TELEGRAPH COMMUNICATIONS 1848"]))
      .toEqual(["telegraph communications 1848"]);
    expect(locItemUrl("2020123456")).toBe(item.url);
    for(const q of ["a","https://attacker.example/private","github_pat_abc","sk-abcdefghij",
      "<script>","a".repeat(111)])
      expect(()=>normalizeArchiveQueries([q])).toThrow();
    expect(()=>normalizeArchiveQueries(Array(4).fill("telegraph communications 1848"))).toThrow();
    expect(()=>locItemUrl("../bad")).toThrow();
  });
  it("preserva catalogo Wikipedia e bibliografia DOI nei successivi aggiornamenti",()=>{
    let dossier=extendArchiveCatalog(undefined,[item.query],[item],at);
    expect(activeArchivalItems(dossier)).toEqual([item]);
    dossier=extendHistoricalDossier(dossier,["Telegrafo nel 1848"],[],at);
    expect(activeArchivalItems(dossier)).toEqual([item]);
    dossier=extendChapterBibliography(dossier,["10.1000/xyz123"],[],at);
    expect(activeArchivalItems(dossier)).toEqual([item]);
    const refreshed=extendArchiveCatalog(dossier,[item.query],[
      {...item,id:"loc:2020123456:"+(Date.parse(at)+1000),
        retrievedAt:new Date(Date.parse(at)+1000).toISOString()},
    ],at);
    expect(refreshed.archiveCatalog?.items).toHaveLength(2);
    expect(activeArchivalItems(refreshed)).toHaveLength(1);
    expect(refreshed.bibliography).toBeDefined();
  });
  it("non consente schede ostili, snapshot diversi con stesso ID o URL falsificati",()=>{
    expect(()=>extendArchiveCatalog(undefined,[item.query],[
      {...item,url:"https://www.loc.gov.attacker.org/item/2020123456/"},
    ],at)).toThrow(/non validi/);
    expect(()=>extendArchiveCatalog(undefined,[item.query],[
      {...item,query:"private message about Mara"},
    ],at)).toThrow(/non validi/);
    const dossier=extendArchiveCatalog(undefined,[item.query],[item],at);
    expect(()=>extendArchiveCatalog(dossier,[item.query],[
      {...item,title:"Changed without a new timestamp"},
    ],at)).toThrow(/cambiato contenuto/);
  });
  it("solo storico e giudice ricevono le schede; i metadati NON sono citazioni",()=>{
    const book=newBook("Mara usa un telegrafo nel 1848.","Romanzo storico","Sobrio","Adulti");
    book.memory.secrets.chiave="Mara nasconde una chiave.";
    book.chapters=[{id:"ch1",number:1,title:"Il telegrafo",purpose:"Viaggio",scenes:[
      {id:"s1",number:1,title:"La lettera",objective:"Avvisare",status:"canon",
        text:"Mara usa un telegrafo nel 1848."},
    ]}];
    const chapter=book.chapters[0]!;
    chapter.historicalDossier=extendArchiveCatalog(undefined,[item.query],[item],at);
    const cycle=createEditorialCycle("ch1");
    const seg=chapterSegments(chapter)[0]!;
    expect(reviewerPrompt(book,cycle,"historical",seg,1).prompt).toContain(item.url);
    expect(reviewerPrompt(book,cycle,"timeline",seg,1).prompt).not.toContain(item.url);
    expect(reviewerPrompt(book,cycle,"readerSkeptic",seg,1).prompt).not.toContain(item.url);
    const raw=JSON.stringify({verdict:"issues",
      summary:"Va verificato se questo telegrafo fosse in uso nel luogo.",
      memoryNote:"Consultare il documento originale prima di decidere.",
      findings:[{sceneId:"s1",category:"storia",severity:"minor",
        evidence:"Mara usa un telegrafo",
        reason:"La presenza della tecnologia richiede verifiche locali.",
        remediation:"Verificare i documenti originali prima di modificare la scena.",
        historical:{claim:"Il telegrafo era usato in questa città nel 1848.",
          assessment:"consistent_with_excerpt",sourceIds:[item.id],
          sourceEvidence:[{sourceId:item.id,quote:"Historical correspondence about telegraph"}]},
      }],
    });
    expect(()=>validateReport(cycle,"historical",seg,1,raw,chapter)).toThrow(/inesistente/);
    const valid=JSON.parse(raw) as {findings:Array<{historical:{
      assessment:string;sourceIds:string[];sourceEvidence:unknown[]}}>} & Record<string,unknown>;
    valid.findings[0]!.historical={...valid.findings[0]!.historical,
      assessment:"unverified",sourceIds:[],sourceEvidence:[]};
    const report=validateReport(cycle,"historical",seg,1,JSON.stringify(valid),chapter);
    cycle.reports.push(report);
    const judge=adjudicationPrompt(book,cycle);
    expect(judge.prompt).toContain(item.url);
    expect(judge.prompt).toContain("SOLI METADATI");
    expect(judge.system).toContain("NON sono citazioni");
  });
});
