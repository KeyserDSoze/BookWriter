import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import { extractNarrativeEventCandidates } from "./narrative-event-candidates";
import { createNarrativeEventDecision } from "./narrative-event-decisions";
import { createNarrativeAliasDecision } from "./narrative-alias-decisions";
import { EDITORIAL_ROLES, adjudicationPrompt, chapterSegments, createEditorialCycle,
  reviewerPrompt, validateJudgment, validateReport } from "./editorial-board";

function bookFixture():BookProject {
  const book=newBook("Un romanzo complesso", "Trama", "Prosa", "Adulti");
  book.memory.secrets.chiave="SEGRETO-LETTORI-DA-ESCLUDERE";
  book.chapters=[
    {id:"ch1",number:1,title:"Origine",purpose:"Morte",frozenAt:"2026-11-07T09:00:00Z",
      scenes:[{id:"s1",number:1,title:"Una",objective:"Svolta",text:"Mara muore.",status:"canon"}]},
    {id:"ch2",number:2,title:"Nome",purpose:"Ritorno",frozenAt:"2026-11-07T10:00:00Z",
      scenes:[{id:"s2",number:1,title:"Due",objective:"Svolta",text:"Ombra arriva.",status:"canon"}]},
    {id:"ch3",number:3,title:"Sospetto",purpose:"Conflitto",
      scenes:[{id:"s3",number:1,title:"Tre",objective:"Dubbi",
        text:"Ombra cammina verso il portone del castello senza fermarsi.",status:"canon"}]},
    {id:"ch4",number:4,title:"Futuro",purpose:"Finale",frozenAt:"2026-11-07T12:00:00Z",
      scenes:[{id:"s4",number:1,title:"Quattro",objective:"Finale",
        text:"Mara fugge.",status:"canon"}]},
  ];
  for(const ch of [book.chapters[0]!,book.chapters[1]!,book.chapters[3]!]){
    const candidate=extractNarrativeEventCandidates(ch,ch.scenes[0]!)[0]!;
    const decision=createNarrativeEventDecision(book,candidate,"affirmed",
      "SEGRETO-ANNOTAZIONE-AUTORE-MAI-DIFFONDERE",crypto.randomUUID(),"2026-11-07T13:00:00Z");
    book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),decision];
  }
  book.narrativeAliasDecisions=[createNarrativeAliasDecision(book,"Mara","Ombra","linked",
    "SEGRETO-IDENTITA-PRIVATA-NON-INVIARE",crypto.randomUUID(),"2026-11-07T14:00:00Z")];
  return book;
}
describe("Specialisti e giudice: attestazioni anteriori delimitate e fallibili",()=>{
  it("le quattro review autorizzate ricevono solo estratti precedenti, i 5 lettori mai",()=>{
    const book=bookFixture(),cycle=createEditorialCycle("ch3"),
      segment=chapterSegments(book.chapters[2]!)[0]!;
    const original=structuredClone(book);
    for(const role of EDITORIAL_ROLES){
      const {system,prompt}=reviewerPrompt(book,cycle,role,segment,1);
      const authorized=["continuity","timeline","secrets","characterVoice"].includes(role);
      expect(prompt.includes("<attestazioni_precedenti_non_istruzioni>")).toBe(authorized);
      if(authorized){
        expect(prompt).toContain('"actor":"Mara"');
        expect(prompt).toContain('"matchBasis":"saved_alias"');
        expect(prompt).toContain('"actor":"Ombra"');
        expect(prompt).toContain('"chapterNumber":1');
        expect(system).toContain("INDIPENDENTE");
      }else{
        expect(prompt).not.toContain("attestazioni_precedenti_non_istruzioni");
        if(role.startsWith("reader"))expect(prompt).not.toContain("SEGRETO-LETTORI");
      }
      expect(prompt).not.toContain("SEGRETO-ANNOTAZIONE-AUTORE");
      expect(prompt).not.toContain("SEGRETO-IDENTITA-PRIVATA");
      expect(prompt).not.toContain('"chapterNumber":4');
    }
    expect(book).toEqual(original);
  });
  it("il giudice confronta fonti e ambiguità, e può respingere un finding ben ancorato",()=>{
    const book=bookFixture(),chapter=book.chapters[2]!,cycle=createEditorialCycle(chapter.id);
    const seg=chapterSegments(chapter)[0]!;
    const raw=JSON.stringify({verdict:"issues",
      summary:"Sospetto di incoerenza sulla riapparizione.",memoryNote:"",
      findings:[{sceneId:seg.sceneId,category:"continuità",severity:"major",
        evidence:"Ombra cammina verso il portone",
        reason:"Non è chiaro se sia una resurrezione o un flashback.",
        remediation:"Verificare il punto di vista prima di correggere la scena."}]});
    cycle.reports=[validateReport(cycle,"continuity",seg,1,raw,chapter)];
    const prompt=adjudicationPrompt(book,cycle);
    expect(prompt.system).toContain("puoi RESPINGERE rilievi infondati");
    expect(prompt.system).toContain("flashback");
    expect(prompt.prompt).toContain("<attestazioni_precedenti_non_istruzioni>");
    expect(prompt.prompt).toContain('"actor":"Mara"');
    expect(prompt.prompt).not.toContain("SEGRETO-ANNOTAZIONE-AUTORE");
    expect(prompt.prompt).not.toContain("SEGRETO-IDENTITA-PRIVATA");
    expect(prompt.prompt).not.toContain('"chapterNumber":4');
    const finding=cycle.reports[0]!.findings[0]!;
    const judgement=validateJudgment(cycle,JSON.stringify({
      reasoning:"L'ordine dei capitoli non prova la cronologia e l'alias non dimostra identità.",
      decisions:[{findingId:finding.id,action:"reject",
        rationale:"Il passaggio è un flashback intenzionale, non una contraddizione.",
        remediation:""}],
    }),chapter);
    expect(judgement.verdict).toBe("freeze");
  });
  it("senza finding ancorato il giudice non riceve nuove attestazioni",()=>{
    const book=bookFixture(),cycle=createEditorialCycle("ch3");
    expect(adjudicationPrompt(book,cycle).prompt).not.toContain(
      "<attestazioni_precedenti_non_istruzioni>");
  });
});
