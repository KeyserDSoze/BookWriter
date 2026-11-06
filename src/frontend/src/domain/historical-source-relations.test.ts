import { describe, expect, it } from "vitest";
import { newBook } from "./types";
import { adjudicationPrompt, chapterSegments, createEditorialCycle, reviewerPrompt, validateReport } from "./editorial-board";
import {
  appendHistoricalSourceRelation, activeHistoricalSourceRelations,
  dependentHistoricalSourceIds, extendHistoricalDossier, validateHistoricalClaim,
  type HistoricalSource,
} from "./historical-research";

const query="Telegrafo elettrico nel 1848";
const stamp="2026-11-06T14:00:00.000Z";
const note="Ho confrontato entrambe le attribuzioni: provengono dalla medesima cronaca di partenza.";
function source(pageId:number,revisionId:number):HistoricalSource {
  return {
    id:"itwiki:"+pageId+":"+revisionId,provider:"it.wikipedia.org",
    pageId,revisionId,title:"Cronache della linea "+pageId,
    url:"https://it.wikipedia.org/wiki/Telegrafo",query,retrievedAt:stamp,
    excerpt:"La cronaca "+pageId+" descrive la linea telegrafica operativa nell'anno 1848."
  };
}
function example(){
  const a=source(42,210),b=source(43,311),c=source(44,411);
  const dossier=extendHistoricalDossier(undefined,[query],[a,b,c],stamp);
  const claim=(...ids:string[])=>({
    claim:"Il telegrafo cittadino operava nell'anno 1848.",
    assessment:"consistent_with_excerpt" as const,sourceIds:ids,
    sourceEvidence:ids.map(id=>{
      const record=[a,b,c].find(x=>x.id===id)!;
      return {sourceId:id,quote:record.excerpt.slice(0,52)};
    }),
  });
  return {a,b,c,dossier,claim};
}

describe("Origine documentale dichiarata dall'autore",()=>{
  it("blocca la doppia fonte se l'autore segnala originale condiviso o derivazione",()=>{
    const {a,b,dossier,claim}=example();
    const linked=appendHistoricalSourceRelation(dossier,a.id,b.id,"same_original",note,stamp);
    expect(linked.sourceRelations).toHaveLength(1);
    expect(activeHistoricalSourceRelations(linked).map(x=>x.relation))
      .toEqual(["same_original"]);
    expect(dependentHistoricalSourceIds([a.id,b.id],linked)).toBe(true);
    expect(()=>validateHistoricalClaim(claim(a.id,b.id),linked))
      .toThrow(/originale|derivazione/);
    expect(()=>validateHistoricalClaim(claim(a.id),linked)).not.toThrow();
    const other=appendHistoricalSourceRelation(dossier,b.id,a.id,"derived",note,stamp);
    expect(()=>validateHistoricalClaim(claim(a.id,b.id),other))
      .toThrow(/originale|derivazione/);
  });

  it("propaga il legame transitivo e una rettifica unknown non certifica indipendenza",()=>{
    const {a,b,c,dossier,claim}=example();
    const first=appendHistoricalSourceRelation(dossier,a.id,b.id,"derived",note,stamp);
    const second=appendHistoricalSourceRelation(first,b.id,c.id,"same_original",note,stamp);
    expect(dependentHistoricalSourceIds([a.id,c.id],second)).toBe(true);
    expect(()=>validateHistoricalClaim(claim(a.id,c.id),second))
      .toThrow(/non sono riscontri indipendenti/);
    const corrected=appendHistoricalSourceRelation(second,b.id,c.id,"unknown",
      "Non possiamo più confermare il legame prima riportato: servono documenti originali.",stamp);
    expect(activeHistoricalSourceRelations(corrected)).toHaveLength(2);
    expect(dependentHistoricalSourceIds([a.id,c.id],corrected)).toBe(false);
    expect(dependentHistoricalSourceIds([a.id,b.id],corrected)).toBe(true);
    expect(()=>validateHistoricalClaim(claim(a.id,c.id),corrected)).not.toThrow();
    expect(corrected.sourceRelations).toHaveLength(3);
    expect(corrected.sourceRelations![1]?.relation).toBe("same_original");
  });

  it("conserva lo storico, ma una nuova revisione non eredita la vecchia relazione",()=>{
    const {a,b,dossier,claim}=example();
    const linked=appendHistoricalSourceRelation(dossier,a.id,b.id,"derived",note,stamp);
    const replacement=source(42,999);
    const next=extendHistoricalDossier(linked,[query],[replacement,b],
      "2026-11-06T15:00:00.000Z");
    expect(next.sourceRelations).toEqual(linked.sourceRelations);
    expect(activeHistoricalSourceRelations(next)).toEqual([]);
    expect(()=>validateHistoricalClaim(claim(a.id,b.id),next)).toThrow(/inesistente|obsoleta/);
    expect(()=>validateHistoricalClaim({
      ...claim(a.id,b.id),
      sourceIds:[replacement.id,b.id],
      sourceEvidence:[
        {sourceId:replacement.id,quote:replacement.excerpt.slice(0,52)},
        {sourceId:b.id,quote:b.excerpt.slice(0,52)},
      ],
    },next)).not.toThrow();
  });

  it("rifiuta fonti inattive, coppie ripetute, ragioni insufficienti e backup alterati",()=>{
    const {a,b,dossier,claim}=example();
    for(const [idA,idB] of [[a.id,a.id],[a.id,"itwiki:99:1"],["",b.id]])
      expect(()=>appendHistoricalSourceRelation(dossier,idA,idB,
        "derived",note,stamp)).toThrow(/distinte|attive/);
    expect(()=>appendHistoricalSourceRelation(dossier,a.id,b.id,"derived","troppo breve",stamp))
      .toThrow(/24–400/);
    expect(()=>appendHistoricalSourceRelation(dossier,a.id,b.id,"derived",note,"invalid"))
      .toThrow(/24–400/);
    const linked=appendHistoricalSourceRelation(dossier,a.id,b.id,"same_original",note,stamp);
    const corrupted=structuredClone(linked);
    corrupted.sourceRelations![0]!.note="alterato";
    expect(()=>activeHistoricalSourceRelations(corrupted)).toThrow(/manomesso/);
    expect(()=>validateHistoricalClaim(claim(a.id,b.id),corrupted))
      .toThrow(/manomesso/);
    const full=structuredClone(linked);
    full.sourceRelations=Array.from({length:61},()=>linked.sourceRelations![0]!);
    expect(()=>appendHistoricalSourceRelation(full,a.id,b.id,"unknown",note,stamp))
      .toThrow(/pieno/);
  });

  it("solo storico e giudice vedono la dichiarazione, mai i lettori",()=>{
    const {a,b,dossier}=example();
    const linked=appendHistoricalSourceRelation(dossier,a.id,b.id,"derived",note,stamp);
    const book=newBook("Romanzo storico","Il telegrafo","Prosa sobria","Adulti");
    book.chapters=[{id:"c1",number:1,title:"Sospetto",purpose:"Ambientazione",
      scenes:[{id:"s1",number:1,title:"Messaggio",objective:"Inviare",
        text:"Mara usa il telegrafo nel 1848.",status:"canon"}],
      historicalDossier:linked}];
    const cycle=createEditorialCycle("c1");
    const seg=chapterSegments(book.chapters[0]!)[0]!;
    expect(reviewerPrompt(book,cycle,"historical",seg,1).prompt).toContain(note);
    for(const role of ["style","continuity","readerMystery"] as const)
      expect(reviewerPrompt(book,cycle,role,seg,1).prompt).not.toContain(note);
    const report=validateReport(cycle,"historical",seg,1,JSON.stringify({
      verdict:"issues",summary:"L'uso storico richiede una ricerca mirata.",
      findings:[{sceneId:"s1",category:"storia",severity:"minor",
        evidence:"Mara usa il telegrafo",
        reason:"La data e il luogo devono essere controllati.",
        remediation:"Controllare il luogo prima di riscrivere.",
        historical:{claim:"L'uso locale del telegrafo è attestato per il 1848.",
          assessment:"unverified",sourceIds:[]}}],
      memoryNote:"Segnalazione ancora incerta.",
    }),book.chapters[0]!);
    cycle.reports.push(report);
    expect(adjudicationPrompt(book,cycle).prompt).toContain(note);
  });
});
