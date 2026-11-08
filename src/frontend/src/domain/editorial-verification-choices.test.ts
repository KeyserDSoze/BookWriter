import {describe,expect,it} from "vitest";
import {newBook} from "./types";
import {
  chapterSegments,createEditorialCycle,validateReport,validateJudgment,
  adjudicationPrompt,reviewerPrompt,EDITORIAL_ROLES,
  type EditorialRole,type ChapterEditorialCycle,
} from "./editorial-board";
import {buildEditorialVerificationPlan} from "./editorial-verification-plan";
import {
  MAX_EDITORIAL_VERIFICATION_CHOICES,createEditorialVerificationChoice,
  currentEditorialVerificationChoice,verificationSourceMatches,
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
const authorNote="AUTORE_PRIVATO_CONTROLLO: devo prima discutere il punto di vista.";
function prepared(){
  const {book,cycle,chapter,a,b}=makeDisagreement();
  decide(cycle,chapter,book,a,b,"needs_evidence");
  cycle.stage="blocked";book.status="paused";
  const item=buildEditorialVerificationPlan(book,cycle,chapter).items[0]!;
  expect(item.status).toBe("needs_evidence");
  return {book,cycle,chapter,item};
}
function addChoice(book:ReturnType<typeof prepared>["book"],key:string,status:
  "taken_on"|"dismissed"|"reset"){
  const d=createEditorialVerificationChoice(book,"c1",key,status,
    authorNote,crypto.randomUUID(),"2026-11-08T18:00:00.000Z");
  book.editorialVerificationChoices=[...(book.editorialVerificationChoices??[]),d];
  return d;
}
describe("Decisioni autore su singoli controlli suggeriti",()=>{
  it("default deny, presa in carico non cambia giudice/canon/prompts",()=>{
    const {book,cycle,chapter,item}=prepared();
    const before=structuredClone({chapters:book.chapters,memory:book.memory,
      editorialCycle:cycle});
    expect(currentEditorialVerificationChoice(book,"c1",item)).toBeNull();
    const choice=addChoice(book,item.key,"taken_on");
    expect(currentEditorialVerificationChoice(book,"c1",item)).toEqual(choice);
    expect(verificationSourceMatches(choice,"c1",item)).toBe(true);
    expect({chapters:book.chapters,memory:book.memory,editorialCycle:cycle})
      .toEqual(before);
    const segment=chapterSegments(chapter)[0]!;
    for(const role of EDITORIAL_ROLES){
      const prompt=reviewerPrompt(book,cycle,role,segment,1).prompt;
      expect(prompt).not.toContain("AUTORE_PRIVATO_CONTROLLO");
      expect(prompt).not.toContain("taken_on");
    }
    expect(adjudicationPrompt(book,cycle).prompt).not.toContain("AUTORE_PRIVATO_CONTROLLO");
  });
  it("respinta e reset hanno priorità last-wins, audit conservato",()=>{
    const {book,item}=prepared();
    const a=addChoice(book,item.key,"taken_on");
    const b=addChoice(book,item.key,"dismissed");
    expect(currentEditorialVerificationChoice(book,"c1",item)).toEqual(b);
    const c=addChoice(book,item.key,"reset");
    expect(currentEditorialVerificationChoice(book,"c1",item)).toBeNull();
    expect(book.editorialVerificationChoices?.map(x=>x.status))
      .toEqual(["taken_on","dismissed","reset"]);
    expect(a.rationale).toBe(authorNote);
    expect(c.id).not.toBe(b.id);
    expect(()=>addChoice(book,item.key,"reset")).toThrow(/Nessuna scelta corrente/);
  });
  it("nuovo check, rettifica motivazione del giudice e fonti stale non riusano il consenso",()=>{
    const {book,cycle,chapter,item}=prepared();
    addChoice(book,item.key,"taken_on");
    cycle.judgment!.recommendationReconciliations![0]!.nextCheck=
      "Richiedere all'autore un chiarimento testuale sulla situazione del personaggio.";
    const altered=buildEditorialVerificationPlan(book,cycle,chapter).items[0]!;
    expect(altered.status).toBe("needs_evidence");
    expect(currentEditorialVerificationChoice(book,"c1",altered)).toBeNull();
    expect(()=>addChoice(book,"fake","dismissed")).toThrow(/non più corrente/);
    chapter.scenes[0]!.text="Mara chiude la finestra e tace.";
    const stale=buildEditorialVerificationPlan(book,cycle,chapter).items[0]!;
    expect(stale.status).toBe("requires_recheck");
    expect(currentEditorialVerificationChoice(book,"c1",stale)).toBeNull();
    expect(()=>addChoice(book,item.key,"taken_on")).toThrow(/non più corrente/);
  });
  it("mai sulle proposte già approvate, chiuse o soltanto storiche",()=>{
    for(const result of ["approved_edit","closed_no_edit"] as const){
      const {book,chapter,cycle,a,b}=makeDisagreement();
      decide(cycle,chapter,book,a,b,result);cycle.stage="blocked";
      const item=buildEditorialVerificationPlan(book,cycle,chapter).items[0]!;
      expect(()=>addChoice(book,item.key,"taken_on")).toThrow(/non più corrente/);
    }
    const {book,cycle,chapter,item}=prepared();
    cycle.priorRounds=[{round:cycle.round,reports:structuredClone(cycle.reports),
      judgment:structuredClone(cycle.judgment!)}];
    cycle.round=2;cycle.reports=[];cycle.judgment=undefined;
    expect(buildEditorialVerificationPlan(book,cycle,chapter).items[0]?.status)
      .toBe("archived");
    expect(()=>addChoice(book,item.key,"taken_on")).toThrow(/non più corrente/);
  });
  it("limiti, note e stati non validi sono fail-closed",()=>{
    const {book,item}=prepared();
    expect(()=>createEditorialVerificationChoice(book,"c1",item.key,"taken_on",
      "breve",crypto.randomUUID(),"2026-11-08T18:00:00.000Z")).toThrow(/20–500/);
    expect(()=>createEditorialVerificationChoice(book,"c1",item.key,
      "automatic_repair" as "taken_on",authorNote,crypto.randomUUID(),
      "2026-11-08T18:00:00.000Z")).toThrow(/non valida/);
    expect(()=>createEditorialVerificationChoice(book,"c1",item.key,"taken_on",
      authorNote,"","invalid")).toThrow(/Identificativo/);
    const first=addChoice(book,item.key,"taken_on");
    book.editorialVerificationChoices=Array.from(
      {length:MAX_EDITORIAL_VERIFICATION_CHOICES},(_,i)=>({...first,id:"audit-"+i}));
    expect(()=>addChoice(book,item.key,"dismissed")).toThrow(/160/);
  });
});
