import { describe, expect, it } from "vitest";
import { newBook } from "./types";
import { extendArchiveCatalog } from "./archival-catalog";
import { extendChapterBibliography } from "./bibliography";
import { extendHistoricalDossier } from "./historical-research";
import { activeManualEvidence, appendManualEvidence, type ManualExcerptInput } from "./manual-evidence";
import { adjudicationPrompt, chapterSegments, createEditorialCycle,
  reviewerPrompt, validateReport } from "./editorial-board";

const now="2026-11-06T01:35:00.000Z";
const query="telegraph communications 1848";
const archive={
  id:"loc:2020123456:"+Date.parse(now), provider:"loc.gov" as const,
  itemId:"2020123456",title:"Telegraph letters, 1848",
  url:"https://www.loc.gov/item/2020123456/",query,retrievedAt:now,
};
const input:ManualExcerptInput={
  catalogItemId:archive.id,locator:"Pagina 12, foglio 3v",
  text:"The telegraph apparatus was operated at the station during the winter of 1848.",
  documentDate:"1848, originale",rightsBasis:"public_domain",
  rightsNote:"La voce dei diritti del documento dichiara pubblico dominio.",
  rightsAttested:true,
};
const dossier=()=>extendArchiveCatalog(undefined,[query],[archive],now);

describe("Trascrizioni d'archivio dell'autore: provenienza e diritti",()=>{
  it("accetta solo estratti trascritti e attestati da una scheda attiva, con versioni immutabili",()=>{
    const saved=appendManualEvidence(dossier(),input,now);
    expect(activeManualEvidence(saved)).toHaveLength(1);
    expect(activeManualEvidence(saved)[0]?.provider).toBe("author-transcribed-loc");
    expect(activeManualEvidence(saved)[0]?.url).toBe(archive.url);
    expect(saved.sources).toEqual([]);
    expect(saved.archiveCatalog?.items).toHaveLength(1);
    expect(()=>appendManualEvidence(saved,input,now)).toThrow(/Conflitto/);
    const later=appendManualEvidence(saved,{...input,text:input.text+" Second edition."},
      new Date(Date.parse(now)+1000).toISOString());
    expect(later.manualEvidence?.excerpts).toHaveLength(2);
    expect(activeManualEvidence(later)).toHaveLength(1);
    expect(activeManualEvidence(later)[0]?.text).toContain("Second edition");
    expect(saved.manualEvidence?.excerpts[0]?.text).toBe(input.text);
  });
  it("rifiuta schede inesistenti, consenso assente, diritti ambigui e trascrizioni fuori limite",()=>{
    for (const bad of [
      {...input,catalogItemId:"loc:other:1"},
      {...input,rightsAttested:false},
      {...input,rightsNote:"non so"},
      {...input,rightsBasis:"unknown"},
      {...input,locator:"?"},{...input,text:"troppo breve"},
      {...input,text:"A".repeat(1201)},
    ]) expect(()=>appendManualEvidence(dossier(),
      bad as ManualExcerptInput,now)).toThrow();
    expect(()=>appendManualEvidence(undefined,input,now)).toThrow(/scheda d'archivio/);
  });
  it("preserva trascrizioni nei refresh di Wikipedia, DOI e catalogo senza falsi richiami",()=>{
    let d=appendManualEvidence(dossier(),input,now);
    d=extendHistoricalDossier(d,["Telegrafo elettrico nel 1848"],[],now);
    d=extendChapterBibliography(d,["10.1000/xyz123"],[],now);
    expect(activeManualEvidence(d)).toHaveLength(1);
    const later=new Date(Date.parse(now)+3000).toISOString();
    d=extendArchiveCatalog(d,[query],[{...archive,id:"loc:2020123456:"+Date.parse(later),
      retrievedAt:later}],later);
    expect(d.manualEvidence?.excerpts).toHaveLength(1);
    expect(activeManualEvidence(d)).toHaveLength(0);
  });
  it("il revisore e il giudice vedono la trascrizione, gli altri undici no",()=>{
    const book=newBook("Romanzo 1848","Mara","Sobrio","Adulti");
    book.memory.secrets.chiave="Mara conosce un segreto inedito.";
    book.chapters=[{id:"ch",number:1,title:"Il telegrafo",purpose:"La prima lettera",scenes:[
      {id:"s1",number:1,title:"La spedizione",objective:"Spedire",status:"canon",
        text:"Mara usa il telegrafo durante l'inverno del 1848."},
    ],historicalDossier:appendManualEvidence(dossier(),input,now)}];
    const chapter=book.chapters[0]!,cycle=createEditorialCycle("ch");
    const seg=chapterSegments(chapter)[0]!;
    const excerpt=activeManualEvidence(chapter.historicalDossier)[0]!;
    const history=reviewerPrompt(book,cycle,"historical",seg,1);
    expect(history.prompt).toContain(excerpt.id);
    expect(history.prompt).toContain("NON autenticati");
    for(const role of ["continuity","timeline","readerCasual","readerMystery"] as const)
      expect(reviewerPrompt(book,cycle,role,seg,1).prompt).not.toContain(excerpt.text);
    const raw=JSON.stringify({verdict:"issues",summary:"Serve contestualizzare l'uso del telegrafo.",
      memoryNote:"Considerare un'altra fonte per la località.",
      findings:[{sceneId:"s1",category:"documenti",severity:"minor",
        evidence:"Mara usa il telegrafo",
        reason:"La fonte attestata parla della stazione ma non del castello.",
        remediation:"Verificare l'ubicazione precisa prima di riscrivere la scena.",
        historical:{claim:"Il telegrafo era usato nel 1848.",
          assessment:"consistent_with_excerpt",sourceIds:[excerpt.id],
          sourceEvidence:[{sourceId:excerpt.id,
            quote:"The telegraph apparatus was operated at the station"}]},
      }],
    });
    const report=validateReport(cycle,"historical",seg,1,raw,chapter);
    cycle.reports.push(report);
    const judge=adjudicationPrompt(book,cycle);
    expect(judge.prompt).toContain('"evidenceStatus":"author_transcribed_unverified"');
    expect(judge.prompt).toContain('"quoteMatches":true');
    expect(judge.prompt).toContain("Pagina 12, foglio 3v");
    expect(judge.system).toContain("NON autenticità");
    const fake=JSON.parse(raw) as {findings:Array<{historical:{sourceIds:string[];sourceEvidence:Array<{sourceId:string;quote:string}>}}>} & Record<string,unknown>;
    fake.findings[0]!.historical.sourceIds=[archive.id];
    fake.findings[0]!.historical.sourceEvidence[0]!.sourceId=archive.id;
    expect(()=>validateReport(cycle,"historical",seg,1,JSON.stringify(fake),chapter))
      .toThrow(/inesistente/);
  });
});
