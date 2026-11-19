import { describe,expect,it } from "vitest";
import { newBook, type BookProject } from "./types";
import { extractNarrativeEventCandidates } from "./narrative-event-candidates";
import { createNarrativeEventDecision } from "./narrative-event-decisions";
import { buildNarrativeAliasRegistry, createNarrativeAliasDecision } from "./narrative-alias-decisions";

function sample(): BookProject {
  const book=newBook("Coppia", "Nomi", "Prosa", "Adulti");
  book.chapters=[
    {id:"c1",number:1,title:"Primo",purpose:"Prova",frozenAt:"2026-11-07T10:00:00Z",
      scenes:[{id:"s1",number:1,title:"Prima",objective:"Morte",text:"Mara muore.",status:"canon"}]},
    {id:"c2",number:2,title:"Secondo",purpose:"Prova",frozenAt:"2026-11-07T11:00:00Z",
      scenes:[{id:"s2",number:1,title:"Seconda",objective:"Viaggio",text:"Ombra parte.",status:"canon"}]},
  ];
  return book;
}
function affirm(book: BookProject, chapter:number) {
  const ch=book.chapters[chapter]!, sc=ch.scenes[0]!;
  const candidate=extractNarrativeEventCandidates(ch,sc)[0]!;
  const decision=createNarrativeEventDecision(book,candidate,"affirmed",
    "L'evento viene confermato dall'autore.",crypto.randomUUID(),"2026-11-07T12:00:00Z");
  book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),decision];
  return decision;
}
function alias(book:BookProject,verdict:"linked"|"separated"="linked"){
  const d=createNarrativeAliasDecision(book,"Mara","Ombra",verdict,
    "Secondo l'autore sono due nomi riferiti alla stessa figura.",crypto.randomUUID(),
    "2026-11-07T12:30:00Z");
  book.narrativeAliasDecisions=[...(book.narrativeAliasDecisions??[]),d];
  return d;
}
describe("Audit motivato degli alias",()=>{
  it("conserva entrambe le attestazioni sorgente senza cambiare il canone",()=>{
    const book=sample();const one=affirm(book,0),two=affirm(book,1);
    const before=structuredClone(book),d=alias(book);
    expect(d.firstEventDecisionId).toBe(one.id);
    expect(d.secondEventDecisionId).toBe(two.id);
    expect(buildNarrativeAliasRegistry(book).linked.map(x=>x.decision.id)).toEqual([d.id]);
    expect(book.memory).toEqual(before.memory);
    expect(book.chapters).toEqual(before.chapters);
  });
  it("l'ultima rettifica prevale; la revoca non può riattivare approvazioni passate",()=>{
    const book=sample();affirm(book,0);affirm(book,1);
    alias(book);alias(book,"separated");
    let register=buildNarrativeAliasRegistry(book);
    expect(register.linked).toHaveLength(0);
    expect(register.separated).toHaveLength(1);
    expect(register.nonCurrentCount).toBe(1);
    // Invalidating the latest record never falls back to the old link.
    book.chapters[1]!.frozenAt=undefined;
    register=buildNarrativeAliasRegistry(book);
    expect(register.linked).toHaveLength(0);
    expect(register.separated).toHaveLength(0);
    expect(register.nonCurrentCount).toBe(2);
  });
  it("la rettifica della menzione fonte rende stale il collegamento anche se il nome resta",()=>{
    const book=sample();affirm(book,0);affirm(book,1);alias(book);
    affirm(book,0);
    expect(buildNarrativeAliasRegistry(book)).toMatchObject({
      linked:[],separated:[],nonCurrentCount:1,
    });
  });
  it("modifiche, draft e nuovo freeze non riattivano decisioni vecchie",()=>{
    const book=sample();affirm(book,0);affirm(book,1);alias(book);
    book.chapters[0]!.scenes[0]!.text+=" Dettaglio.";
    expect(buildNarrativeAliasRegistry(book).linked).toHaveLength(0);
    book.chapters[0]!.scenes[0]!.text="Mara muore.";
    book.chapters[0]!.frozenAt="2026-11-08T11:00:00Z";
    expect(buildNarrativeAliasRegistry(book).linked).toHaveLength(0);
    book.chapters[0]!.scenes[0]!.status="draft";
    expect(buildNarrativeAliasRegistry(book).linked).toHaveLength(0);
  });
  it("non accetta nomi non attestati, equivalenti o motivazioni corte",()=>{
    const book=sample();affirm(book,0);affirm(book,1);
    for(const [a,b] of [["Mara","mara"],["Mara","Ipotetico"],["","Ombra"]]){
      expect(()=>createNarrativeAliasDecision(book,a!,b!,"linked",
        "Motivo sufficientemente lungo.",crypto.randomUUID(),"2026-11-07T12:00:00Z"))
        .toThrow();
    }
    expect(()=>createNarrativeAliasDecision(book,"Mara","Ombra","linked",
      "corta",crypto.randomUUID(),"2026-11-07T12:00:00Z")).toThrow(/Motiva/);
    expect(book.narrativeAliasDecisions).toBeUndefined();
  });
  it("rifiuta archivio pieno e non considera autorevole il testo importato",()=>{
    const book=sample();affirm(book,0);affirm(book,1);const d=alias(book);
    book.narrativeAliasDecisions=[{...d,firstEventDecisionId:"ID-contraffatto"}];
    expect(buildNarrativeAliasRegistry(book).linked).toHaveLength(0);
    book.narrativeAliasDecisions=Array.from({length:120},(_,i)=>({...d,id:"a"+i}));
    expect(()=>alias(book)).toThrow(/120/);
  });
});
