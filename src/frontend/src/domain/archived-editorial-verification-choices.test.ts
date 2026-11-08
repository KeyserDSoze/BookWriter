import {describe,expect,it} from "vitest";
import {newBook} from "./types";
import {
  chapterSegments,createEditorialCycle,validateReport,validateJudgment,
  reviewerPrompt,adjudicationPrompt,EDITORIAL_ROLES,
  type EditorialRole,type ChapterEditorialCycle,
} from "./editorial-board";
import {
  buildFrozenEditorialVerificationPlan,findFrozenEditorialVerificationCheck,
  MAX_VERIFICATION_PLAN_ITEMS,
} from "./editorial-verification-plan";
import {
  createArchivedEditorialVerificationChoice,
  currentArchivedEditorialVerificationChoice,
  MAX_EDITORIAL_VERIFICATION_CHOICES,
} from "./editorial-verification-choices";

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
const note="ANNOTAZIONE_STORICA_PRIVATA: rileggere solo come riferimento del capitolo.";
function frozen(){
  const {book,chapter,cycle,a,b}=makeDisagreement();
  decide(cycle,chapter,book,a,b,"needs_evidence");
  chapter.frozenAt="2026-11-08T16:00:00.000Z";
  chapter.editorialRounds=[{
    round:cycle.round,reports:structuredClone(cycle.reports),
    judgment:structuredClone(cycle.judgment!),
  }];
  book.editorialCycle=undefined;book.status="paused";
  const plan=buildFrozenEditorialVerificationPlan(book,chapter);
  const item=plan.items[0]!;
  expect(item.status).toBe("archived");
  expect(item.historicalCheckEligible).toBe(true);
  return {book,chapter,item,plan};
}
function add(book:ReturnType<typeof frozen>["book"],key:string,
  status:"taken_on"|"dismissed"|"reset"){
  const c=createArchivedEditorialVerificationChoice(book,"c1",key,status,
    note,crypto.randomUUID(),"2026-11-08T19:00:00.000Z");
  book.editorialVerificationChoices=[...(book.editorialVerificationChoices??[]),c];
  return c;
}
describe("Controlli storici congelati: annotazione autore NON esecutiva",()=>{
  it("non ci sono permessi correnti: note precise, last-wins, reset senza mutare canon",()=>{
    const {book,chapter,item,plan}=frozen();
    const before=structuredClone({chapters:book.chapters,memory:book.memory});
    expect(plan.counts.archived).toBe(1);
    expect(plan.counts.needs_evidence).toBe(0);
    expect(findFrozenEditorialVerificationCheck(book,"c1",item.key)).toEqual(item);
    expect(currentArchivedEditorialVerificationChoice(book,"c1",item)).toBeNull();
    const taken=add(book,item.key,"taken_on");
    expect(currentArchivedEditorialVerificationChoice(book,"c1",item)).toEqual(taken);
    const rejected=add(book,item.key,"dismissed");
    expect(currentArchivedEditorialVerificationChoice(book,"c1",item)).toEqual(rejected);
    add(book,item.key,"reset");
    expect(currentArchivedEditorialVerificationChoice(book,"c1",item)).toBeNull();
    expect(()=>add(book,item.key,"reset")).toThrow(/Nessuna scelta storica corrente/);
    expect({chapters:book.chapters,memory:book.memory}).toEqual(before);
    expect(book.editorialCycle).toBeUndefined();
    const independent=createEditorialCycle("c1");
    const segment=chapterSegments(chapter)[0]!;
    for(const role of EDITORIAL_ROLES)
      expect(reviewerPrompt(book,independent,role,segment,1).prompt)
        .not.toContain("ANNOTAZIONE_STORICA_PRIVATA");
    // The judge may require a prior frozen chapter; regardless no private note.
    expect(JSON.stringify(book.editorialVerificationChoices)).toContain(note);
  });
  it("ritoccando un controllo, data freeze o source report nessuna scelta risorge",()=>{
    const {book,chapter,item}=frozen();
    add(book,item.key,"taken_on");
    chapter.editorialRounds![0]!.judgment.recommendationReconciliations![0]!
      .nextCheck="Rileggere i dialoghi del capitolo, includendo la loro prospettiva narrativa.";
    const edited=buildFrozenEditorialVerificationPlan(book,chapter).items[0]!;
    expect(edited.historicalCheckEligible).toBe(true);
    expect(edited.key).toBe(item.key);
    expect(currentArchivedEditorialVerificationChoice(book,"c1",edited)).toBeNull();
    chapter.editorialRounds![0]!.judgment.recommendationReconciliations![0]!
      .nextCheck=check;
    chapter.frozenAt="2026-11-08T18:00:00.000Z";
    const refrozen=buildFrozenEditorialVerificationPlan(book,chapter).items[0]!;
    expect(refrozen.key).not.toBe(item.key);
    expect(currentArchivedEditorialVerificationChoice(book,"c1",refrozen)).toBeNull();
    expect(()=>add(book,item.key,"taken_on")).toThrow(/non trovato/);
    chapter.frozenAt=undefined;
    expect(buildFrozenEditorialVerificationPlan(book,chapter).items).toEqual([]);
    expect(()=>add(book,refrozen.key,"taken_on")).toThrow(/non trovato/);
  });
  it("round ripetuti dopo riapertura non riutilizzano la stessa scelta storica",()=>{
    const {book,chapter,item}=frozen();
    add(book,item.key,"taken_on");
    chapter.editorialRounds!.push(structuredClone(chapter.editorialRounds![0]!));
    const plan=buildFrozenEditorialVerificationPlan(book,chapter);
    expect(plan.items).toHaveLength(2);
    expect(new Set(plan.items.map(x=>x.key)).size).toBe(2);
    const newArchive=plan.items[0]!;
    expect(newArchive.key).not.toBe(item.key);
    expect(newArchive.status).toBe("archived");
    expect(currentArchivedEditorialVerificationChoice(book,"c1",newArchive)).toBeNull();
    expect(currentArchivedEditorialVerificationChoice(book,"c1",plan.items[1]!))
      .not.toBeNull();
  });
  it("non annota passaggi approvati, falsi o con fonti non verificabili",()=>{
    const {book,chapter,item}=frozen();
    const first=chapter.editorialRounds![0]!;
    const review=first.judgment.recommendationReconciliations![0]!;
    for(const change of [
      ()=>{review.evidenceAssessment="adequate_for_selected_edits";},
      ()=>{review.resolution="choose_one";},
      ()=>{review.findingIds=["fake","made-up"];},
      ()=>{first.reports[0]!.findings[0]!.evidenceAnchor=undefined;},
    ]){
      const original=structuredClone(first);
      change();
      expect(buildFrozenEditorialVerificationPlan(book,chapter).items[0]!
        .historicalCheckEligible).toBe(false);
      expect(()=>add(book,item.key,"taken_on")).toThrow(/non coerente/);
      chapter.editorialRounds![0]=original;
    }
  });
  it("solo le prime 24 voci del frozen archive; dati omessi mai autorizzati",()=>{
    const {book,chapter,item}=frozen();
    const duplicate=structuredClone(chapter.editorialRounds![0]!);
    chapter.editorialRounds=Array.from({length:MAX_VERIFICATION_PLAN_ITEMS+1},
      ()=>structuredClone(duplicate));
    const plan=buildFrozenEditorialVerificationPlan(book,chapter);
    expect(plan.totalItemCount).toBe(25);
    expect(plan.omittedItemCount).toBe(1);
    expect(plan.items).toHaveLength(24);
    expect(()=>add(book,item.key,"taken_on")).toThrow(/fuori campione|non trovato/);
    const allowed=add(book,plan.items[0]!.key,"taken_on");
    expect(allowed.planKey).toBe(plan.items[0]!.key);
    book.editorialVerificationChoices=Array.from(
      {length:MAX_EDITORIAL_VERIFICATION_CHOICES},(_,i)=>({...allowed,id:"old-"+i}));
    expect(()=>add(book,plan.items[0]!.key,"dismissed")).toThrow(/160/);
  });
  it("l'archivio di un altro capitolo e l'assenza di freeze non sono annotabili",()=>{
    const {book,item,chapter}=frozen();
    expect(findFrozenEditorialVerificationCheck(book,"other",item.key))
      .toBeUndefined();
    const other={...chapter,id:"other",frozenAt:undefined};
    book.chapters.push(other);
    expect(()=>createArchivedEditorialVerificationChoice(book,"other",item.key,
      "taken_on",note,crypto.randomUUID(),"2026-11-08T19:00:00.000Z"))
      .toThrow(/non trovato/);
  });
});
