import {describe,expect,it} from "vitest";
import {newBook} from "./types";
import {
  chapterSegments,createEditorialCycle,validateReport,validateJudgment,
  reviewerPrompt,adjudicationPrompt,EDITORIAL_ROLES,
  type EditorialRole,type ChapterEditorialCycle,
} from "./editorial-board";
import {buildFrozenEditorialVerificationPlan}
  from "./editorial-verification-plan";
import {createArchivedEditorialVerificationChoice,
  currentEditorialVerificationChoice} from "./editorial-verification-choices";
import {compareEditorialArchiveToCurrentRevision,
  MAX_EDITORIAL_ARCHIVE_COMPARISONS} from "./editorial-archive-comparison";

const quote="Mara trova una lettera dietro la porta";
const text=quote+". Elio osserva in silenzio e non spiega il contenuto.";
const reason="Il ritmo narrativo potrebbe essere migliorato, ma la scena resta ambigua.";
const explanation="Le due proposte riguardano lo stesso testo, ma il giudice deve ragionare senza votazioni automatiche.";
const missing="Manca un'indicazione dell'autore sul ritmo e sul punto di vista desiderati.";
const check="Chiedere all'autore se mantenere il mistero o chiarire il dettaglio nel dialogo.";
function setup(){
  const book=newBook("Una lettera","Mistero di Mara","Prosa","Adulti");
  book.chapters=[{id:"c1",number:1,title:"Un segreto",purpose:"Mistero",
    scenes:[{id:"s1",number:1,title:"La porta",objective:"Sorpresa",
      text,status:"canon"}]}];
  const chapter=book.chapters[0]!,cycle=createEditorialCycle(chapter.id);
  book.editorialCycle=cycle;
  return {book,chapter,cycle};
}
function add(book:ReturnType<typeof setup>["book"],cycle:ChapterEditorialCycle,
  role:EditorialRole,remediation:string,category="ritmo"){
  const chapter=book.chapters[0]!,segment=chapterSegments(chapter)[0]!;
  const report=validateReport(cycle,role,segment,1,JSON.stringify({
    verdict:"issues",summary:"Il controllo trova un punto narrativo da valutare.",
    memoryNote:"",findings:[{
      sceneId:"s1",category,severity:"major",evidence:quote,reason,remediation,
    }],
  }),chapter,book);
  cycle.reports.push(report);
  return report.findings[0]!.id;
}
function makeDisagreement(){
  const {book,chapter,cycle}=setup();
  const a=add(book,cycle,"style","Accorciare la frase mantenendo il riferimento.");
  const b=add(book,cycle,"narrative","Allungare la pausa per amplificare il mistero.");
  return {book,chapter,cycle,a,b};
}
function decide(cycle:ChapterEditorialCycle,chapter:ReturnType<typeof setup>["chapter"],
  book:ReturnType<typeof setup>["book"],a:string,b:string,
  outcome:"needs_evidence"|"approved_edit"|"closed_no_edit"){
  const accept=outcome==="approved_edit";
  const judgment=validateJudgment(cycle,JSON.stringify({
    reasoning:"Il direttore deve valutare i suggerimenti distinti senza dedurre nulla dalla sola citazione.",
    decisions:[a,b].map(id=>({
      findingId:id,action:accept&&id===a?"accept":"reject",
      rationale:"La scena richiede una scelta consapevole sul ritmo senza presupporre errori di fatto.",
      remediation:accept&&id===a?"Rendere il periodo più conciso senza cancellare l'ambiguità.":"",
    })),
    recommendationReconciliations:[{
      findingIds:[b,a],
      resolution:accept?"choose_one":"reject_all",
      evidenceAssessment:outcome==="needs_evidence"
        ?"unresolved":"adequate_for_selected_edits",
      rationale:explanation,missingEvidence:missing,nextCheck:check,
    }],
  }),chapter,book);
  cycle.judgment=judgment;
}
const note="ANNOTAZIONE_SOLO_STORICA: rivedrò io questo suggerimento.";
function reopened(){
  const {book,chapter,cycle,a,b}=makeDisagreement();
  decide(cycle,chapter,book,a,b,"needs_evidence");
  chapter.frozenAt="2026-11-08T16:00:00.000Z";
  chapter.editorialRounds=[{
    round:cycle.round,reports:structuredClone(cycle.reports),
    judgment:structuredClone(cycle.judgment!),
  }];
  book.editorialCycle=undefined;book.status="paused";
  const historical=buildFrozenEditorialVerificationPlan(book,chapter).items[0]!;
  expect(historical.historicalCheckEligible).toBe(true);
  const choice=createArchivedEditorialVerificationChoice(book,chapter.id,
    historical.key,"taken_on",note,crypto.randomUUID(),"2026-11-08T19:00:00.000Z");
  book.editorialVerificationChoices=[choice];
  chapter.frozenAt=undefined;
  const current=createEditorialCycle(chapter.id);
  book.editorialCycle=current;
  const nowA=add(book,current,"style","Accorciare il passaggio con un taglio diverso.");
  const nowB=add(book,current,"narrative","Conservare la pausa per il mistero.");
  decide(current,chapter,book,nowA,nowB,"needs_evidence");
  current.stage="blocked";
  return {book,chapter,current,choice};
}
describe("Confronto locale tra controlli storici e nuova redazione",()=>{
  it("stessa citazione/posizione: collega solo i testi, non trasferisce le scelte",()=>{
    const {book,chapter,current,choice}=reopened();
    const snapshot=JSON.stringify(book);
    const plan=compareEditorialArchiveToCurrentRevision(book,chapter,current);
    expect(plan).toMatchObject({
      method:"local_literal_archive_comparison_v1",
      chapterId:"c1",totalArchiveChecks:1,omittedArchiveChecks:0,
      currentGroupsCompared:1,currentReportCount:2,
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      relation:"same_literal_anchor",suggestedCheckRelation:"same_words",
      authorNoteState:"taken_on",authorNoteRationale:note,
      oldMissingEvidence:missing,oldNextCheck:check,
      current:{round:1,status:"needs_evidence",nextCheck:check},
    });
    expect(plan.items[0]!.key).not.toBe(choice.planKey);
    expect(currentEditorialVerificationChoice(book,"c1",{
      ...plan.items[0]!.current!,key:"current:1:"+JSON.stringify([
        "1:narrative:0:0","1:style:0:0",
      ]),findingIds:[],segmentIndex:0,category:"ritmo",acceptedFindingIds:[],
    })).toBeNull();
    expect(JSON.stringify(book)).toBe(snapshot);
    const segment=chapterSegments(chapter)[0]!;
    for(const role of EDITORIAL_ROLES)
      expect(reviewerPrompt(book,current,role,segment,1).prompt)
        .not.toContain("ANNOTAZIONE_SOLO_STORICA");
    expect(adjudicationPrompt(book,current).prompt)
      .not.toContain("ANNOTAZIONE_SOLO_STORICA");
  });
  it("nuovo giudice formula controllo differente: nessuna vecchia adesione trasferita",()=>{
    const {book,chapter,current}=reopened();
    current.judgment!.recommendationReconciliations![0]!.nextCheck=
      "Chiedere all'autore se preferisce un punto di vista più vicino a Mara.";
    const plan=compareEditorialArchiveToCurrentRevision(book,chapter,current);
    expect(plan.items[0]).toMatchObject({
      relation:"same_literal_anchor",suggestedCheckRelation:"changed_words",
      authorNoteState:"taken_on",
      current:{status:"needs_evidence"},
    });
    expect(plan.items[0]!.current?.nextCheck).not.toBe(check);
  });
  it("citazione spostata nella stessa scena: pista letterale, non prova semantica",()=>{
    const {book,chapter,current}=reopened();
    chapter.scenes[0]!.text="Una pausa significativa. "+text;
    current.reports=[];current.judgment=undefined;
    add(book,current,"style","Accorciare la scena mantenendo il contesto.");
    add(book,current,"narrative","Conservare il mistero con un altro ritmo.");
    const plan=compareEditorialArchiveToCurrentRevision(book,chapter,current);
    expect(plan.items[0]).toMatchObject({
      relation:"relocated_literal_quote",suggestedCheckRelation:"awaiting_judge",
      authorNoteState:"taken_on",
      current:{status:"awaiting_judge"},
    });
  });
  it("assenza di match o nuovi report non dimostra soluzione",()=>{
    const {book,chapter,current}=reopened();
    current.reports=[];current.judgment=undefined;
    const plan=compareEditorialArchiveToCurrentRevision(book,chapter,current);
    expect(plan.items[0]).toMatchObject({
      relation:"not_observed_in_current_sample",
      suggestedCheckRelation:"not_comparable",
    });
    expect(plan.currentGroupsCompared).toBe(0);
    expect(plan.currentReportCount).toBe(0);
  });
  it("fonti storiche alterate restano visibili ma non confrontabili",()=>{
    const {book,chapter,current}=reopened();
    chapter.editorialRounds![0]!.reports[0]!.findings[0]!.evidenceAnchor=undefined;
    const plan=compareEditorialArchiveToCurrentRevision(book,chapter,current);
    expect(plan.items[0]).toMatchObject({
      relation:"archive_source_unverifiable",
      suggestedCheckRelation:"not_comparable",
      authorNoteState:"ambiguous_or_stale",
    });
    expect(plan.items[0]!.current).toBeUndefined();
    expect(plan.items[0]!.authorNoteRationale).toBeUndefined();
  });
  it("note importate azzerate, doppie congelazioni e snapshot alterati non resuscitano",()=>{
    const {book,chapter,current,choice}=reopened();
    book.editorialVerificationChoices!.push({...choice,
      id:"reset-history",status:"reset",decidedAt:"2026-11-08T19:10:00.000Z"});
    expect(compareEditorialArchiveToCurrentRevision(book,chapter,current)
      .items[0]!.authorNoteState).toBe("reset");
    book.editorialVerificationChoices!.push({...choice,
      id:"second-freeze",planKey:choice.planKey.replace(
        "2026-11-08T16:00:00.000Z","2026-11-08T17:00:00.000Z"),
      decidedAt:"2026-11-08T19:20:00.000Z"});
    const ambiguous=compareEditorialArchiveToCurrentRevision(book,chapter,current);
    expect(ambiguous.items[0]!.authorNoteState).toBe("ambiguous_or_stale");
    expect(ambiguous.items[0]!.authorNoteRationale).toBeUndefined();
    book.editorialVerificationChoices=[{...choice,
      quote:"Citazione falsificata"}];
    expect(compareEditorialArchiveToCurrentRevision(book,chapter,current)
      .items[0]!.authorNoteState).toBe("ambiguous_or_stale");
  });
  it("capitolo ancora congelato o altro ciclo: piano vuoto",()=>{
    const {book,chapter,current}=reopened();
    chapter.frozenAt="2026-11-08T16:00:00.000Z";
    expect(compareEditorialArchiveToCurrentRevision(book,chapter,current)
      .totalArchiveChecks).toBe(0);
    chapter.frozenAt=undefined;
    expect(compareEditorialArchiveToCurrentRevision(book,chapter,
      {...current,chapterId:"other"}).items).toEqual([]);
  });
  it("conteggio copertura, 24 voci massime, scelte senza completamento automatico",()=>{
    const {book,chapter,current}=reopened();
    const round=structuredClone(chapter.editorialRounds![0]!);
    chapter.editorialRounds=Array.from(
      {length:MAX_EDITORIAL_ARCHIVE_COMPARISONS+1},()=>structuredClone(round));
    const plan=compareEditorialArchiveToCurrentRevision(book,chapter,current);
    expect(plan.totalArchiveChecks).toBe(25);
    expect(plan.items).toHaveLength(24);
    expect(plan.omittedArchiveChecks).toBe(1);
    expect(plan.items.every(x=>x.relation==="same_literal_anchor")).toBe(true);
  });
  it("correzioni storiche approvate non vengono trattate come dubbi irrisolti",()=>{
    const {book,chapter,current}=reopened();
    chapter.editorialRounds![0]!.judgment.recommendationReconciliations![0]!
      .evidenceAssessment="adequate_for_selected_edits";
    expect(compareEditorialArchiveToCurrentRevision(book,chapter,current)
      .totalArchiveChecks).toBe(0);
  });
});
