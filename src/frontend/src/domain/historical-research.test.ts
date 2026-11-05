import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import { adjudicationPrompt, chapterSegments, createEditorialCycle, reviewerPrompt, validateReport } from "./editorial-board";
import {
  activeHistoricalSources, extendHistoricalDossier, isTrustedHistoricalUrl,
  normalizeResearchQueries, validateHistoricalClaim, type HistoricalSource,
} from "./historical-research";

function source(revisionId=210): HistoricalSource {
  return {
    id:"itwiki:42:"+revisionId, pageId:42, revisionId,
    provider:"it.wikipedia.org", title:"Telegrafo",
    url:"https://it.wikipedia.org/wiki/Telegrafo",
    query:"Telegrafo elettrico nel 1848",
    excerpt:"Il telegrafo elettrico cominciò a diffondersi in Europa durante il XIX secolo.",
    retrievedAt:"2026-11-05T20:00:00.000Z",
  };
}
function sample():BookProject{
  const book=newBook("Romanzo storico","Il telegrafo","Prosa","Adulti");
  book.memory.secrets.chiave="La chiave apre un nascondiglio reale che nessuno conosce.";
  book.chapters=[{id:"c1",number:1,title:"Sospetto",purpose:"Scoprire il pericolo",scenes:[
    {id:"s1",number:1,title:"Il messaggio",objective:"Informare",status:"canon",
      text:"Nel 1848 Mara usa il telegrafo per mandare un messaggio."},
  ]}];
  return book;
}
function finding(meta:unknown){
  return JSON.stringify({verdict:"issues",
    summary:"Il messaggio nel 1848 richiede una verifica storico-documentale.",
    memoryNote:"Verificare il riferimento tecnico",
    findings:[{sceneId:"s1",category:"storia",severity:"major",
      evidence:"Mara usa il telegrafo",
      reason:"Il funzionamento storico dello strumento richiede riscontro.",
      remediation:"Descrivere un impiego verosimile dello strumento nel luogo corretto.",
      ...(meta ? {historical:meta} : {}),
    }]});
}
const confirmed=(ids=["itwiki:42:210"],quote="Il telegrafo elettrico cominciò a diffondersi")=>({
  claim:"L'uso del telegrafo elettrico in Europa ha precedenti ottocenteschi.",
  assessment:"consistent_with_excerpt",sourceIds:ids,sourceQuote:quote,
});
describe("Dossier storico verificabile nel processo editoriale",()=>{
  it("accetta solo query pubbliche sane, un massimo di 5 e link Wikipedia HTTPS esatti",()=>{
    expect(normalizeResearchQueries(["   Telegrafo nel 1848  ","Telegrafo nel 1848"]))
      .toEqual(["Telegrafo nel 1848"]);
    for(const query of ["sk-verysecret00000000000","https://example.com/private",
      " x ","<script>alert(1)</script>","".padEnd(111,"A")])
      expect(()=>normalizeResearchQueries([query])).toThrow();
    expect(()=>normalizeResearchQueries(Array(6).fill("Telegrafo nel 1848"))).toThrow();
    expect(isTrustedHistoricalUrl("https://it.wikipedia.org/wiki/Telegrafo")).toBe(true);
    for(const link of ["http://it.wikipedia.org/wiki/Telegrafo",
      "https://it.wikipedia.org.evil.org/wiki/Telegrafo",
      "https://it.wikipedia.org/w/api.php", "https://user:pass@it.wikipedia.org/wiki/Telegrafo",
      "https://it.wikipedia.org/wiki/Telegrafo?token=secret"])
      expect(isTrustedHistoricalUrl(link)).toBe(false);
  });
  it("conserva vecchie revisioni citate anche dopo aggiornamento con nuova revisione",()=>{
    const old=extendHistoricalDossier(undefined,["Telegrafo elettrico nel 1848"],[source()],new Date().toISOString());
    const updated=extendHistoricalDossier(old,["Telegrafo elettrico nel 1848"],[source(211)],new Date().toISOString());
    expect(updated.sources.map(s=>s.id)).toEqual(["itwiki:42:210","itwiki:42:211"]);
    expect(activeHistoricalSources(updated).map(s=>s.id)).toEqual(["itwiki:42:211"]);
    expect(updated.unansweredQueries).toHaveLength(0);
  });
  it("il revisore storico riceve solo le fonti attive, gli undici agenti no",()=>{
    const b=sample(),cycle=createEditorialCycle("c1"),seg=chapterSegments(b.chapters[0]!)[0]!;
    b.chapters[0]!.historicalDossier=extendHistoricalDossier(undefined,
      ["Telegrafo elettrico nel 1848"],[source()],new Date().toISOString());
    const history=reviewerPrompt(b,cycle,"historical",seg,1);
    const continuity=reviewerPrompt(b,cycle,"continuity",seg,1);
    const reader=reviewerPrompt(b,cycle,"readerSkeptic",seg,1);
    expect(history.prompt).toContain("https://it.wikipedia.org/wiki/Telegrafo");
    expect(history.prompt).toContain("Il telegrafo elettrico");
    expect(history.system).toContain("TERZIARIA");
    expect(continuity.prompt).not.toContain("https://it.wikipedia.org/wiki/");
    expect(reader.prompt).not.toContain("https://it.wikipedia.org/wiki/");
    expect(reader.prompt).not.toContain("chiave apre un nascondiglio");
  });
  it("valida citazioni letterali e non si fida di sourceId inventati o storici",()=>{
    const b=sample(),cycle=createEditorialCycle("c1"),seg=chapterSegments(b.chapters[0]!)[0]!;
    b.chapters[0]!.historicalDossier=extendHistoricalDossier(undefined,
      ["Telegrafo elettrico nel 1848"],[source()],new Date().toISOString());
    expect(()=>validateReport(cycle,"historical",seg,1,finding(confirmed(["inventata"])),b.chapters[0]!))
      .toThrow(/inesistente/);
    expect(()=>validateReport(cycle,"historical",seg,1,finding(confirmed(undefined,"Una frase inventata dal modello")),b.chapters[0]!))
      .toThrow(/non compare/);
    expect(()=>validateReport(cycle,"historical",seg,1,finding(undefined),b.chapters[0]!))
      .toThrow(/distinguere/);
    const ok=validateReport(cycle,"historical",seg,1,finding(confirmed()),b.chapters[0]!);
    expect(ok.findings[0]?.historical?.sourceIds).toEqual(["itwiki:42:210"]);
    cycle.reports.push(ok);
    const judge=adjudicationPrompt(b,cycle);
    expect(judge.prompt).toContain("https://it.wikipedia.org/wiki/Telegrafo");
    expect(judge.prompt).toContain("Il telegrafo elettrico");
    expect(judge.system).toContain("fonte TERZIARIA");
    expect(()=>validateReport(cycle,"style",seg,1,finding(confirmed()),b.chapters[0]!))
      .toThrow(/Solo il revisore storico/);
  });
  it("un dubbio senza riscontri resta unverified e non può fingere citazioni",()=>{
    const b=sample(),cycle=createEditorialCycle("c1"),seg=chapterSegments(b.chapters[0]!)[0]!;
    const undecided={
      claim:"Un personaggio usa un mezzo non documentato nell'anno della storia.",
      assessment:"unverified" as const,sourceIds:[],
    };
    expect(validateReport(cycle,"historical",seg,1,finding(undecided),b.chapters[0]!).findings).toHaveLength(1);
    expect(()=>validateHistoricalClaim({...undecided,sourceIds:["itwiki:42:210"]},
      b.chapters[0]!.historicalDossier)).toThrow(/non verificata/);
  });
});
