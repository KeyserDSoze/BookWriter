import "fake-indexeddb/auto";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {newBook} from "../domain/types";
import {chapterSegments,createEditorialCycle,validateReport,validateJudgment,
  type EditorialRole,type ChapterEditorialCycle} from "../domain/editorial-board";
import {buildFrozenEditorialVerificationPlan}
  from "../domain/editorial-verification-plan";
import {currentArchivedEditorialVerificationChoice}
  from "../domain/editorial-verification-choices";
import {getBook,getDb,saveBook,listActivities} from "../infrastructure/db";
import {getOutbox} from "../infrastructure/outbox";
import {recordArchivedEditorialVerificationChoice}
  from "./editorial-verification-choices";

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
  vi.stubGlobal("navigator",{locks:{request:async(_name:string,_opts:unknown,
    cb:(lock:object)=>Promise<unknown>)=>cb({})}});
});
afterEach(()=>vi.unstubAllGlobals());

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
const privateNote="MOTIVO_STORICO_PRIVATO: voglio approfondire senza riaprire il romanzo.";
async function prepared(){
  const {book,chapter,cycle,a,b}=makeDisagreement();
  decide(cycle,chapter,book,a,b,"needs_evidence");
  chapter.frozenAt="2026-11-08T16:00:00.000Z";
  chapter.editorialRounds=[{round:1,reports:structuredClone(cycle.reports),
    judgment:structuredClone(cycle.judgment!)}];
  book.editorialCycle=undefined;
  book.status="paused";
  book.remote={owner:"writer",repository:"romanzo",branch:"main",
    autoSync:true,lastSyncedCommit:"a".repeat(40)};
  await saveBook(book,false);
  await (await getDb()).put("outbox",{
    bookId:book.id,operationId:crypto.randomUUID(),
    revision:1,requestedAt:new Date().toISOString(),state:"pending",attempts:0,
  },book.id);
  const stored=(await getBook(book.id))!;
  const item=buildFrozenEditorialVerificationPlan(stored,stored.chapters[0]!)
    .items[0]!;
  expect(item.historicalCheckEligible).toBe(true);
  return {book:stored,item};
}
describe("Application: note private su controlli di capitolo congelato",()=>{
  it("presa in carico, rifiuto e reset persistono senza riaprire, autosync OFF",async()=>{
    let {book,item}=await prepared();
    const before=structuredClone({chapters:book.chapters,memory:book.memory,
      phase:book.phase,status:book.status,editorialCycle:book.editorialCycle});
    expect(await getOutbox(book.id)).toBeDefined();
    for(const status of ["taken_on","dismissed","reset"] as const){
      await recordArchivedEditorialVerificationChoice(book.id,book.updatedAt,
        "c1",item.key,status,privateNote);
      book=(await getBook(book.id))!;
      const choice=currentArchivedEditorialVerificationChoice(book,"c1",item);
      expect(choice?.status??null).toBe(status==="reset"?null:status);
    }
    expect(book.editorialVerificationChoices?.map(x=>x.status))
      .toEqual(["taken_on","dismissed","reset"]);
    expect({chapters:book.chapters,memory:book.memory,phase:book.phase,
      status:book.status,editorialCycle:book.editorialCycle}).toEqual(before);
    expect(book.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    const activities=(await listActivities(book.id)).filter(x=>
      x.title==="Scelta privata sul controllo editoriale aggiornata");
    expect(activities).toHaveLength(3);
    for(const sensitive of ["MOTIVO_STORICO_PRIVATO",quote,missing,check,
      "Mara","Elio","taken_on","dismissed","reset"])
      expect(JSON.stringify(activities)).not.toContain(sensitive);
  });
  it("rifiuta CAS vecchio, ciclo editoriale in esecuzione e nessun freeze",async()=>{
    const {book,item}=await prepared();
    const call=(updatedAt:string,key:string)=>recordArchivedEditorialVerificationChoice(
      book.id,updatedAt,"c1",key,"taken_on",privateNote);
    await expect(call("1990-01-01",item.key)).rejects.toThrow(/modificato/);
    await expect(call(book.updatedAt,"fake")).rejects.toThrow(/non trovato/);
    expect(await getOutbox(book.id)).toBeDefined();
    const running=(await getBook(book.id))!;
    running.status="running";await saveBook(running,false);
    await expect(call(running.updatedAt,item.key)).rejects.toThrow(/pausa/);
    const cycle=createEditorialCycle("c1");
    running.status="paused";running.editorialCycle=cycle;
    await saveBook(running,false);
    await expect(call(running.updatedAt,item.key)).rejects.toThrow(/redazione è attiva/);
    running.editorialCycle=undefined;
    running.chapters[0]!.frozenAt=undefined;
    await saveBook(running,false);
    await expect(call(running.updatedAt,item.key)).rejects.toThrow(/non trovato/);
    expect((await getBook(book.id))!.editorialVerificationChoices).toBeUndefined();
  });
  it("Web Locks non disponibili/occupati non scrivono né cancellano outbox",async()=>{
    const {book,item}=await prepared();
    vi.stubGlobal("navigator",{locks:{request:async(_name:string,_opts:unknown,
      cb:(lock:object|null)=>Promise<unknown>)=>cb(null)}});
    await expect(recordArchivedEditorialVerificationChoice(
      book.id,book.updatedAt,"c1",item.key,"taken_on",privateNote))
      .rejects.toThrow(/in uso/);
    vi.stubGlobal("navigator",{});
    await expect(recordArchivedEditorialVerificationChoice(
      book.id,book.updatedAt,"c1",item.key,"taken_on",privateNote))
      .rejects.toThrow(/Web Locks/);
    expect((await getBook(book.id))!.editorialVerificationChoices).toBeUndefined();
    expect(await getOutbox(book.id)).toBeDefined();
  });
});
