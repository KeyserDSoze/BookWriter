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
  it("impedisce che una sola citazione venga attribuita a due fonti",()=>{
    const primary=source();
    const secondary:HistoricalSource={
      ...source(),id:"itwiki:43:311",pageId:43,revisionId:311,
      title:"Ferrovie",url:"https://it.wikipedia.org/wiki/Ferrovia",
      excerpt:"La rete ferroviaria europea aveva già collegamenti importanti prima del 1850.",
    };
    const dossier=extendHistoricalDossier(undefined,["Telegrafo elettrico nel 1848"],
      [primary,secondary],new Date().toISOString());
    const claimed={
      claim:"Nel XIX secolo erano disponibili collegamenti tecnologici in Europa.",
      assessment:"consistent_with_excerpt" as const,
      sourceIds:[primary.id,secondary.id],
    };
    // Old single-quote reports are still readable, but can no longer claim
    // that two sources are corroborating the same statement.
    expect(()=>validateHistoricalClaim({...claimed,
      sourceQuote:"Il telegrafo elettrico cominciò a diffondersi"},dossier))
      .toThrow(/ogni fonte/i);
    expect(()=>validateHistoricalClaim({...claimed,sourceEvidence:[
      {sourceId:primary.id,quote:"Il telegrafo elettrico cominciò a diffondersi"},
    ]},dossier)).toThrow(/ogni fonte/i);
    expect(()=>validateHistoricalClaim({...claimed,sourceEvidence:[
      {sourceId:primary.id,quote:"La rete ferroviaria europea aveva già collegamenti"},
      {sourceId:secondary.id,quote:"Il telegrafo elettrico cominciò a diffondersi"},
    ]},dossier)).toThrow(/fonte associata/i);
    const perSource=[
      {sourceId:primary.id,quote:"Il telegrafo elettrico cominciò a diffondersi"},
      {sourceId:secondary.id,quote:"La rete ferroviaria europea aveva già collegamenti"},
    ];
    expect(()=>validateHistoricalClaim({...claimed,sourceEvidence:perSource},dossier)).not.toThrow();
    const book=sample(),cycle=createEditorialCycle("c1");
    book.chapters[0]!.historicalDossier=dossier;
    const seg=chapterSegments(book.chapters[0]!)[0]!;
    const report=validateReport(cycle,"historical",seg,1,
      finding({...claimed,sourceEvidence:perSource}),book.chapters[0]!);
    cycle.reports.push(report);
    const judge=adjudicationPrompt(book,cycle);
    expect(judge.prompt).toContain('"citedQuote":"La rete ferroviaria europea aveva già collegamenti"');
    expect(judge.prompt).toContain('"quoteMatches":true');
    expect(reviewerPrompt(book,cycle,"historical",seg,1).system).toContain("CIASCUN sourceId");
    expect(reviewerPrompt(book,cycle,"readerCasual",seg,1).prompt)
      .not.toContain("La rete ferroviaria europea");
  });
  it("traccia possibili divergenze fra due documenti distinti senza inventare una verifica semantica",()=>{
    const a:HistoricalSource={...source(),
      excerpt:"La linea telegrafica cittadina iniziò a operare nel 1848 secondo questa cronaca."};
    const b:HistoricalSource={...source(),id:"itwiki:44:311",pageId:44,revisionId:311,
      title:"Rete telegrafica",url:"https://it.wikipedia.org/wiki/Telegrafo_elettrico",
      excerpt:"Un altro resoconto colloca l'apertura della stessa linea soltanto nel 1853."};
    const dossier=extendHistoricalDossier(undefined,["Telegrafo elettrico nel 1848"],
      [a,b],"2026-11-06T12:00:00.000Z");
    const positions=[
      {sourceId:a.id,position:"supports" as const,
        rationale:"La cronaca descrive una linea operativa già nel 1848."},
      {sourceId:b.id,position:"disputes" as const,
        rationale:"Il resoconto colloca il medesimo avvio solo nel 1853."},
    ];
    const claim={
      claim:"La linea cittadina era già operativa nel 1848.",
      assessment:"conflicting_excerpts" as const,sourceIds:[a.id,b.id],
      sourceEvidence:[
        {sourceId:a.id,quote:"La linea telegrafica cittadina iniziò a operare nel 1848"},
        {sourceId:b.id,quote:"Un altro resoconto colloca l'apertura della stessa linea soltanto nel 1853"},
      ],
      sourcePositions:positions,
    };
    expect(()=>validateHistoricalClaim(claim,dossier)).not.toThrow();
    expect(()=>validateHistoricalClaim({...claim,sourcePositions:positions.slice(0,1)},
      dossier)).toThrow(/Divergenza/);
    expect(()=>validateHistoricalClaim({...claim,sourcePositions:[
      positions[0]!,{...positions[1]!,position:"supports" as const},
    ]},dossier)).toThrow(/Divergenza/);
    expect(()=>validateHistoricalClaim({...claim,sourceEvidence:claim.sourceEvidence.slice(0,1)},
      dossier)).toThrow(/citazione letterale/);
    expect(()=>validateHistoricalClaim({...claim,sourceEvidence:[
      claim.sourceEvidence[0]!,{sourceId:b.id,quote:"Questo testo è inventato e non risulta nella fonte."},
    ]},dossier)).toThrow(/non compare/);
    expect(()=>validateHistoricalClaim({...claim,assessment:"consistent_with_excerpt" as const},
      dossier)).toThrow(/posizioni delle fonti/);
    const samePage=extendHistoricalDossier(undefined,["Telegrafo elettrico nel 1848"],
      [a,{...a,id:"itwiki:42:211",revisionId:211}],
      "2026-11-06T12:00:00.000Z");
    expect(()=>validateHistoricalClaim({...claim,
      sourceIds:[a.id,"itwiki:42:211"],
      sourceEvidence:[claim.sourceEvidence[0]!,
        {sourceId:"itwiki:42:211",quote:claim.sourceEvidence[0]!.quote}],
      sourcePositions:[positions[0]!,
        {...positions[1]!,sourceId:"itwiki:42:211"}],
    },samePage)).toThrow(/non sono fonti indipendenti/);
    const book=sample(),cycle=createEditorialCycle("c1"),
      segment=chapterSegments(book.chapters[0]!)[0]!;
    book.chapters[0]!.historicalDossier=dossier;
    const valid=validateReport(cycle,"historical",segment,1,finding(claim),
      book.chapters[0]!);
    cycle.reports.push(valid);
    const judge=adjudicationPrompt(book,cycle);
    expect(judge.prompt).toContain('"sourcePositions"');
    expect(judge.prompt).toContain("Il resoconto colloca");
    expect(judge.system).toContain("falso conflitto");
    expect(reviewerPrompt(book,cycle,"historical",segment,1).system)
      .toContain("conflicting_excerpts");
    expect(reviewerPrompt(book,cycle,"readerCasual",segment,1).prompt)
      .not.toContain("Un altro resoconto");
  });
  it("non spaccia due revisioni della stessa voce per fonti indipendenti",()=>{
    const versions=[source(),source(211)];
    const dossier=extendHistoricalDossier(undefined,["Telegrafo elettrico nel 1848"],
      versions,new Date().toISOString());
    expect(()=>validateHistoricalClaim({
      claim:"I telegrafi elettrici si diffusero nell'Ottocento.",
      assessment:"consistent_with_excerpt",sourceIds:versions.map(s=>s.id),
      sourceEvidence:versions.map(s=>({
        sourceId:s.id,quote:"Il telegrafo elettrico cominciò a diffondersi",
      })),
    },dossier)).toThrow(/non sono fonti indipendenti/);
    expect(()=>validateHistoricalClaim({
      claim:"I telegrafi elettrici si diffusero nell'Ottocento.",
      assessment:"unverified",sourceIds:[],
      sourceEvidence:[{sourceId:versions[0]!.id,quote:"Il telegrafo elettrico cominciò a diffondersi"}],
    },dossier)).toThrow(/non verificata/);
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
