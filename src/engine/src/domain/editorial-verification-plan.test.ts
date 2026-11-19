import {describe,expect,it} from "vitest";
import {newBook} from "./types";
import {buildEditorialVerificationPlan,MAX_VERIFICATION_PLAN_ITEMS} from "./editorial-verification-plan";
import {
  chapterSegments,createEditorialCycle,validateReport,validateJudgment,
  type EditorialRole,type ChapterEditorialCycle,
} from "./editorial-board";

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
describe("Piano delle verifiche dell'autore derivato dalla redazione",()=>{
  it("nessun piano artificiale senza divergenze; nessuna mutazione",()=>{
    const {book,chapter,cycle}=setup();
    const before=JSON.stringify(book);
    expect(buildEditorialVerificationPlan(book,cycle,chapter)).toMatchObject({
      items:[],totalItemCount:0,omittedItemCount:0,unreviewableFindingCount:0,
    });
    expect(JSON.stringify(book)).toBe(before);
  });
  it("mostra in attesa del giudice senza inventare prove o controlli",()=>{
    const {book,chapter,cycle,a,b}=makeDisagreement();
    const plan=buildEditorialVerificationPlan(book,cycle,chapter);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      status:"awaiting_judge",sceneId:"s1",category:"ritmo",quote,
      findingIds:[b,a],acceptedFindingIds:[],
    });
    expect(plan.items[0]).not.toHaveProperty("missingEvidence");
    expect(plan.items[0]).not.toHaveProperty("nextCheck");
    expect(plan.counts.awaiting_judge).toBe(1);
  });
  it("richieste di prova del giudice restano consultive, non sono repair",()=>{
    const {book,chapter,cycle,a,b}=makeDisagreement();
    decide(cycle,chapter,book,a,b,"needs_evidence");
    const prior=JSON.stringify(book);
    const plan=buildEditorialVerificationPlan(book,cycle,chapter);
    expect(plan.items[0]).toMatchObject({
      status:"needs_evidence",missingEvidence:missing,nextCheck:check,
      explanation,acceptedFindingIds:[],
    });
    expect(plan.counts.needs_evidence).toBe(1);
    expect(JSON.stringify(book)).toBe(prior);
  });
  it("distingue una correzione accolta e nessun intervento",()=>{
    for(const outcome of ["approved_edit","closed_no_edit"] as const){
      const {book,chapter,cycle,a,b}=makeDisagreement();
      decide(cycle,chapter,book,a,b,outcome);
      const plan=buildEditorialVerificationPlan(book,cycle,chapter);
      expect(plan.items[0]?.status).toBe(outcome);
      expect(plan.items[0]?.acceptedFindingIds).toEqual(
        outcome==="approved_edit"?[a]:[]);
      expect(plan.items[0]?.nextCheck).toBe(check);
    }
  });
  it("capitolo modificato: giudizio passato è stale, non è approvazione",()=>{
    const {book,chapter,cycle,a,b}=makeDisagreement();
    decide(cycle,chapter,book,a,b,"approved_edit");
    expect(buildEditorialVerificationPlan(book,cycle,chapter).counts.approved_edit).toBe(1);
    chapter.scenes[0]!.text="Mara accende la lampada. La lettera non compare.";
    const plan=buildEditorialVerificationPlan(book,cycle,chapter);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.status).toBe("requires_recheck");
    expect(plan.items[0]?.acceptedFindingIds).toEqual([]);
    expect(plan.items[0]?.nextCheck).toBe(check);
    expect(plan.counts.approved_edit).toBe(0);
  });
  it("decisione alterata o importata non certifica una correzione",()=>{
    const {book,chapter,cycle,a,b}=makeDisagreement();
    decide(cycle,chapter,book,a,b,"approved_edit");
    cycle.judgment!.decisions[0]!.findingId="falso";
    const plan=buildEditorialVerificationPlan(book,cycle,chapter);
    expect(plan.items[0]?.status).toBe("requires_recheck");
    expect(plan.items[0]?.acceptedFindingIds).toEqual([]);
  });
  it("le tornate precedenti sono soltanto audit, mai nuove autorizzazioni",()=>{
    const {book,chapter,cycle,a,b}=makeDisagreement();
    decide(cycle,chapter,book,a,b,"approved_edit");
    cycle.priorRounds=[{
      round:1,reports:structuredClone(cycle.reports),
      judgment:structuredClone(cycle.judgment!),
    }];
    cycle.round=2;cycle.reports=[];cycle.judgment=undefined;
    const plan=buildEditorialVerificationPlan(book,cycle,chapter);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.status).toBe("archived");
    expect(plan.items[0]?.round).toBe(1);
    expect(plan.items[0]?.acceptedFindingIds).toEqual([]);
    expect(plan.counts.approved_edit).toBe(0);
  });
  it("limiti espliciti senza fingere copertura completa",()=>{
    const {book,chapter,cycle}=setup();
    const a=add(book,cycle,"style","Accorciare la frase narrativa.");
    const b=add(book,cycle,"narrative","Conservare la tensione narrativa.");
    for(const report of cycle.reports){
      const base=report.findings[0]!;
      report.findings=Array.from({length:7},(_,i)=>({
        ...base,id:"1:"+report.role+":0:"+i,
        category:"tema-"+i,
        remediation:report.role==="style"?
          "Tagliare la frase in "+i:"Mantenere l'attesa in "+i,
      }));
    }
    const plan=buildEditorialVerificationPlan(book,cycle,chapter);
    expect(plan.totalItemCount).toBe(6);
    expect(plan.unreviewableFindingCount).toBe(2);
    expect(plan.omittedGroupCount).toBe(1);
    expect(plan.items).toHaveLength(6);
    expect(plan.items.every(x=>x.status==="awaiting_judge")).toBe(true);
    expect(MAX_VERIFICATION_PLAN_ITEMS).toBe(24);
    expect(a).toBeDefined();expect(b).toBeDefined();
  });
  it("capitolo di altro ciclo: non riutilizzare giudizi e segreti",()=>{
    const {book,cycle}=makeDisagreement();
    const alien={...book.chapters[0]!,id:"other"};
    const plan=buildEditorialVerificationPlan(book,cycle,alien);
    expect(plan.totalItemCount).toBe(0);
  });
});
