import { describe, expect, it } from "vitest";
import { extendHistoricalDossier, validateHistoricalClaim } from "./historical-research";
import { extendChapterBibliography } from "./bibliography";
import { extendArchiveCatalog } from "./archival-catalog";
import { appendManualEvidence } from "./manual-evidence";
import { newBook } from "./types";
import { adjudicationPrompt, chapterSegments, createEditorialCycle, reviewerPrompt,
  validateReport } from "./editorial-board";
import {
  activeWikisourceExcerpts, allWikisourceExcerpts, extendWikisourceDossier,
  normalizeWikisourceQueries, validateWikisourceExcerpt, wikisourcePageUrl,
  wikisourceRevisionUrl, type WikisourceExcerpt,
} from "./wikisource-excerpts";

const at="2026-11-06T02:45:00.000Z";
const query="Telegrafo e lettere nel 1848";
const source:WikisourceExcerpt={
  id:"itws:42:321",provider:"it.wikisource.org",pageId:42,revisionId:321,
  title:"Lettere del 1848",url:"https://it.wikisource.org/wiki/Lettere_del_1848",
  excerpt:"La stazione telegrafica inviava dispacci per tutto l'inverno dell'anno 1848.",
  query,retrievedAt:at,revisionAt:"2025-06-18T09:30:00.000Z",
  evidenceStatus:"community_transcription_unverified",
  rightsStatus:"work_rights_not_verified",
};
const dossier=()=>extendWikisourceDossier(undefined,[query],[source],at);
describe("Estratti revisionati Wikisource: identità, evidenza e provenienza",()=>{
  it("normalizza solo query pubbliche, ricostruisce URL esatte e rifiuta host obliqui",()=>{
    expect(normalizeWikisourceQueries([query," "+query+" "])).toEqual([query]);
    expect(()=>normalizeWikisourceQueries(["https://private.example"])).toThrow();
    expect(()=>normalizeWikisourceQueries(["sk-"+ "secretabc123456789"])).toThrow();
    expect(wikisourcePageUrl("Lettere del 1848")).toBe(source.url);
    expect(wikisourceRevisionUrl(321)).toBe("https://it.wikisource.org/w/index.php?oldid=321");
    expect(()=>wikisourcePageUrl("../evil")).toThrow();
    expect(()=>wikisourcePageUrl("https://attacker.tld")).toThrow();
    expect(validateWikisourceExcerpt(source)).toBe(true);
    expect(validateWikisourceExcerpt({...source,url:"https://it.wikisource.org.evil.example/wiki/Lettere_del_1848"})).toBe(false);
    expect(validateWikisourceExcerpt({...source,id:"itws:42:999"})).toBe(false);
    expect(validateWikisourceExcerpt({...source,rightsStatus:"public_domain" as never})).toBe(false);
    expect(validateWikisourceExcerpt({...source,revisionId:0})).toBe(false);
  });
  it("archivia snapshot immutabili; un refresh non è conferma dell'originale",()=>{
    const first=dossier();
    const changed={...source,id:"itws:42:322",revisionId:322,
      excerpt:source.excerpt+" Nel mese successivo la linea venne riparata."};
    const later=extendWikisourceDossier(first,[query],[changed],"2026-11-06T02:46:00.000Z");
    expect(allWikisourceExcerpts(later)).toHaveLength(2);
    expect(activeWikisourceExcerpts(later).map(x=>x.id)).toEqual(["itws:42:322"]);
    expect(activeWikisourceExcerpts(first).map(x=>x.id)).toEqual(["itws:42:321"]);
    expect(()=>extendWikisourceDossier(first,[query],
      [{...source,excerpt:"Dati alterati sotto la stessa revisione nota"}],at))
      .toThrow(/testo differente/);
    const corrupted={...later,wikisource:{...later.wikisource!,excerpts:"malformed" as never}};
    expect(activeWikisourceExcerpts(corrupted)).toEqual([]);
  });
  it("usa solo la citazione associata alla revisione attiva; vecchia revisione e sourceQuote sono respinte",()=>{
    const d=dossier();
    const quote="La stazione telegrafica inviava dispacci";
    expect(()=>validateHistoricalClaim({
      claim:"La stazione telegrafica era in uso durante l'inverno del 1848.",
      assessment:"consistent_with_excerpt",sourceIds:[source.id],
      sourceEvidence:[{sourceId:source.id,quote}],
    },d)).not.toThrow();
    expect(()=>validateHistoricalClaim({
      claim:"La stazione era attiva.",assessment:"consistent_with_excerpt",
      sourceIds:[source.id],sourceQuote:quote,
    },d)).toThrow(/sourceEvidence/);
    expect(()=>validateHistoricalClaim({
      claim:"La stazione era attiva.",assessment:"consistent_with_excerpt",
      sourceIds:[source.id],sourceEvidence:[{sourceId:source.id,quote:"Scritto non presente in questa trascrizione"}],
    },d)).toThrow(/fonte associata/);
    const second={...source,revisionId:322,id:"itws:42:322"};
    const two=extendWikisourceDossier(d,[query],[source,second],at);
    expect(()=>validateHistoricalClaim({
      claim:"La stazione era attiva.",assessment:"consistent_with_excerpt",
      sourceIds:[source.id,second.id],
      sourceEvidence:[{sourceId:source.id,quote},{sourceId:second.id,quote}],
    },two)).toThrow(/non sono fonti indipendenti/);
    const refreshed=extendWikisourceDossier(d,[query],[second],at);
    expect(()=>validateHistoricalClaim({
      claim:"La stazione era attiva.",assessment:"consistent_with_excerpt",
      sourceIds:[source.id],sourceEvidence:[{sourceId:source.id,quote}],
    },refreshed)).toThrow(/obsoleta/);
    expect(()=>validateHistoricalClaim({
      claim:"Il telegrafo non era disponibile.",assessment:"unverified",
      sourceIds:[source.id],
    },d)).toThrow(/non verificata/);
  });
  it("Wikipedia, Crossref, LoC e trascrizione manuale preservano Wikisource",()=>{
    let d=dossier();
    d=extendHistoricalDossier(d,["Telegrafo elettrico nel 1848"],[],at);
    expect(activeWikisourceExcerpts(d)).toHaveLength(1);
    d=extendChapterBibliography(d,["10.1000/xyz123"],[],at);
    expect(activeWikisourceExcerpts(d)).toHaveLength(1);
    const loc={id:"loc:2020123456:"+Date.parse(at),provider:"loc.gov" as const,
      itemId:"2020123456",title:"Telegraph correspondence 1848",
      url:"https://www.loc.gov/item/2020123456/",query:"telegraph correspondence 1848",retrievedAt:at};
    d=extendArchiveCatalog(d,[loc.query],[loc],at);
    d=appendManualEvidence(d,{
      catalogItemId:loc.id,locator:"Pagina 13",
      text:"The telegraph station was used throughout the first months of the year.",
      rightsBasis:"public_domain",rightsNote:"Verified through the institutional rights and access statement.",
      rightsAttested:true,
    },at);
    expect(activeWikisourceExcerpts(d)).toHaveLength(1);
    expect(d.manualEvidence?.activeExcerptIds).toHaveLength(1);
    expect(d.archiveCatalog?.activeItemIds).toHaveLength(1);
  });
  it("il solo storico e il giudice leggono la trascrizione esterna, senza fingere autenticità",()=>{
    const book=newBook("Mara usa un telegrafo nel 1848","Libro test","Sobrio","Adulti");
    book.memory.secrets.mistero="La chiave segreta apre il passaggio.";
    book.chapters=[{id:"ch",number:1,title:"Il messaggio",purpose:"Il telegrafo",
      scenes:[{id:"s1",number:1,title:"Notizie",objective:"Informare",status:"canon",
        text:"Mara usa il telegrafo durante l'inverno del 1848."}],
      historicalDossier:dossier()}];
    const cycle=createEditorialCycle("ch");
    const seg=chapterSegments(book.chapters[0]!)[0]!;
    const specialist=reviewerPrompt(book,cycle,"historical",seg,1);
    expect(specialist.prompt).toContain(source.id);
    expect(specialist.prompt).toContain(source.excerpt);
    expect(specialist.system).toContain("Wikisource");
    for(const role of ["readerCasual","readerMystery","continuity","style"] as const)
      expect(reviewerPrompt(book,cycle,role,seg,1).prompt).not.toContain(source.excerpt);
    const payload=JSON.stringify({
      verdict:"issues",summary:"La specifica ubicazione del telegrafo richiede verifica.",
      memoryNote:"Il testo è una trascrizione, non una fonte autenticata.",
      findings:[{
        sceneId:"s1",category:"tecnologia",severity:"minor",
        evidence:"Mara usa il telegrafo",
        reason:"La trascrizione non identifica la stazione usata dal personaggio.",
        remediation:"Consultare l'originale prima di attribuire un luogo specifico.",
        historical:{claim:"Il telegrafo era disponibile nel 1848.",
          assessment:"consistent_with_excerpt",sourceIds:[source.id],
          sourceEvidence:[{sourceId:source.id,quote:"La stazione telegrafica inviava dispacci"}]},
      }],
    });
    const report=validateReport(cycle,"historical",seg,1,payload,book.chapters[0]!);
    cycle.reports.push(report);
    const judge=adjudicationPrompt(book,cycle);
    expect(judge.prompt).toContain('"evidenceStatus":"community_transcription_unverified"');
    expect(judge.prompt).toContain('"quoteMatches":true');
    expect(judge.prompt).toContain('"rightsStatus":"work_rights_not_verified"');
    expect(judge.system).toContain("NON autenticità");
  });
});
