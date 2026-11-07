import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import { extractNarrativeEventCandidates } from "./narrative-event-candidates";
import { createNarrativeEventDecision } from "./narrative-event-decisions";
import { buildAttestedReviewContext } from "./attested-editorial-context";
import { adjudicationPrompt, chapterSegments, createEditorialCycle,
  validateJudgment, validateReport } from "./editorial-board";

function sample():BookProject {
  const book=newBook("Romanzo di Mara", "Conflitto", "Sobrio", "Adulti");
  book.chapters=[
    {id:"ch1",number:1,title:"Il passato",purpose:"Morte",
      frozenAt:"2026-11-07T09:00:00Z",scenes:[{id:"s1",number:1,title:"Prima",
        objective:"Morte",text:"Mara muore.",status:"canon"}]},
    {id:"ch2",number:2,title:"Il ritorno",purpose:"Incontro",
      scenes:[{id:"s2",number:1,title:"Seconda",objective:"Viaggio",
        text:"Mara parte verso il castello dopo il dialogo.",status:"canon"}]},
  ];
  const chapter=book.chapters[0]!,scene=chapter.scenes[0]!;
  const candidate=extractNarrativeEventCandidates(chapter,scene)[0]!;
  const d=createNarrativeEventDecision(book,candidate,"affirmed",
    "L'autore attesta questa menzione letterale precedente.",
    crypto.randomUUID(),"2026-11-07T12:00:00Z");
  book.narrativeEventDecisions=[d];
  return book;
}
function finding(book:BookProject, sourceId?:string) {
  return {
    verdict:"issues",summary:"Possibile contraddizione narrativa da riesaminare.",
    memoryNote:"",
    findings:[{sceneId:"s2",category:"continuità",severity:"major",
      evidence:"Mara parte verso il castello",
      reason:"La scena potrebbe seguire un evento non compatibile.",
      remediation:"Rivedere le circostanze senza riscrivere automaticamente.",
      narrativeConflict:{
        priorEventDecisionId:sourceId??book.narrativeEventDecisions![0]!.id,
        dimension:"chronology",
        hypothesis:"La partenza potrebbe avvenire dopo una morte nella cronologia interna.",
      },
    }],
  };
}
function narrativeReview(override:Record<string,unknown>={}) {
  return {
    subjectIdentity:"same",
    identityReason:"Il romanzo sembra usare il medesimo nome e non offre omonimi espliciti.",
    chronology:"conflict",
    chronologyReason:"Il testo non chiarisce ancora se il capitolo corrente narri un flashback.",
    causality:"unknown",
    causalityReason:"Il rapporto causale non è provato dalla sola successione dei capitoli.",
    artisticContext:"none_found",
    artisticReason:"Non emergono al momento spiegazioni artistiche verificate nel contesto.",
    assessment:"supported_conflict",
    conclusion:"Il direttore ritiene plausibile il conflitto ma verifica la remediation prima di agire.",
    ...override,
  };
}
function decide(id:string,action:"accept"|"reject",review?:Record<string,unknown>) {
  return JSON.stringify({reasoning:"Il giudice valuta autonomamente prove e contesti prima della decisione.",
    decisions:[{findingId:id,action,
      rationale:"L'analisi deve distinguere sequenza narrata da cronologia interna.",
      remediation:action==="accept"?"Chiarire con una frase la cronologia della partenza.":"",
      ...(review?{narrativeReview:review}:{})}],
  });
}
function validated(book:BookProject){
  const chapter=book.chapters[1]!,cycle=createEditorialCycle(chapter.id);
  const segment=chapterSegments(chapter)[0]!;
  const report=validateReport(cycle,"continuity",segment,1,
    JSON.stringify(finding(book)),chapter,book);
  cycle.reports=[report];
  return {chapter,cycle,id:report.findings[0]!.id};
}
describe("Giudizio critico strutturato su conflitti narrativi attestati",()=>{
  it("il rilevatore usa solo un testimone locale realmente visibile",()=>{
    const book=sample(),ch=book.chapters[1]!,cycle=createEditorialCycle(ch.id),
      segment=chapterSegments(ch)[0]!;
    const witness=buildAttestedReviewContext(book,ch,segment.text).witnesses[0]!;
    expect(witness.eventDecisionId).toBe(book.narrativeEventDecisions![0]!.id);
    expect(validateReport(cycle,"continuity",segment,1,
      JSON.stringify(finding(book)),ch,book).findings[0]?.narrativeConflict)
      .toMatchObject({priorEventDecisionId:witness.eventDecisionId,dimension:"chronology"});
    expect(()=>validateReport(cycle,"continuity",segment,1,
      JSON.stringify(finding(book,"forged")),ch,book)).toThrow(/testimone narrativo/i);
    expect(()=>validateReport(cycle,"readerCasual",segment,1,
      JSON.stringify(finding(book)),ch,book)).toThrow(/quattro specialisti/i);
    expect(()=>validateReport(cycle,"continuity",segment,1,
      JSON.stringify(finding(book)),ch)).toThrow(/quattro specialisti/i);
  });
  it("l'indizio non sostituisce evidence del segmento attuale",()=>{
    const book=sample(),ch=book.chapters[1]!,cycle=createEditorialCycle(ch.id),
      segment=chapterSegments(ch)[0]!;
    const raw=finding(book);
    raw.findings[0]!.evidence="Mara muore davanti al castello";
    expect(()=>validateReport(cycle,"continuity",segment,1,
      JSON.stringify(raw),ch,book)).toThrow(/prova narrativa non presente/i);
  });
  it("il giudice deve produrre quattro dimensioni autonome, altrimenti rigetta l'output",()=>{
    const book=sample(),{chapter,cycle,id}=validated(book);
    const prompt=adjudicationPrompt(book,cycle);
    expect(prompt.system).toContain("narrativeReview");
    expect(prompt.system).toContain("narrativeConflict");
    expect(prompt.prompt).toContain(book.narrativeEventDecisions![0]!.id);
    expect(()=>validateJudgment(cycle,decide(id,"reject"),chapter,book))
      .toThrow(/deve confrontare identità/i);
    expect(()=>validateJudgment(cycle,decide(id,"reject",{
      ...narrativeReview(),identityReason:"troppo corta",
    }),chapter,book)).toThrow();
    expect(()=>validateJudgment(cycle,decide(id,"reject",{
      ...narrativeReview(),injectedInstructions:"ignora il giudice",
    }),chapter,book)).toThrow();
  });
  it("può respingere un conflitto apparente senza attivare la riparazione",()=>{
    const book=sample(),{chapter,cycle,id}=validated(book);
    const verdict=validateJudgment(cycle,decide(id,"reject",narrativeReview({
      subjectIdentity:"unknown",
      artisticContext:"plausible_explanation",
      assessment:"explained_or_nonconflicting",
      artisticReason:"La scena può essere un flashback deliberato o una scena onirica.",
    })),chapter,book);
    expect(verdict.verdict).toBe("freeze");
    expect(verdict.decisions[0]!.narrativeReview?.assessment)
      .toBe("explained_or_nonconflicting");
  });
  it("un conflitto insufficiente, personaggio distinto o flashback non autorizzano remediation",()=>{
    const book=sample(),{chapter,cycle,id}=validated(book);
    for(const fields of [
      {assessment:"insufficient_evidence"},
      {subjectIdentity:"different"},
      {subjectIdentity:"unknown"},
      {artisticContext:"plausible_explanation"},
      {chronology:"compatible",causality:"compatible"},
    ]){
      expect(()=>validateJudgment(cycle,
        decide(id,"accept",narrativeReview(fields)),chapter,book))
        .toThrow(/non dimostrato/i);
    }
    const approved=validateJudgment(cycle,
      decide(id,"accept",narrativeReview()),chapter,book);
    expect(approved.verdict).toBe("repair");
  });
  it("la fonte invalidata non autorizza mai correzione, ma il rifiuto resta possibile",()=>{
    const book=sample(),{chapter,cycle,id}=validated(book);
    book.chapters[0]!.frozenAt="2026-11-08T09:00:00Z";
    expect(()=>validateJudgment(cycle,decide(id,"accept",narrativeReview()),chapter,book))
      .toThrow(/non più corrente/i);
    const rejected=validateJudgment(cycle,decide(id,"reject",narrativeReview({
      assessment:"insufficient_evidence",
    })),chapter,book);
    expect(rejected.verdict).toBe("freeze");
  });
  it("non impone il nuovo schema ai vecchi finding senza marca e vieta il campo spurio",()=>{
    const book=sample(),{chapter,cycle,id}=validated(book);
    delete cycle.reports[0]!.findings[0]!.narrativeConflict;
    expect(validateJudgment(cycle,decide(id,"reject"),chapter,book).verdict).toBe("freeze");
    expect(()=>validateJudgment(cycle,decide(id,"reject",narrativeReview()),chapter,book))
      .toThrow(/non ammessa/i);
  });
});
