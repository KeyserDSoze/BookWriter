import "fake-indexeddb/auto";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {newBook} from "../domain/types";
import {
  chapterSegments,createEditorialCycle,validateReport,validateJudgment,
  type EditorialRole,type ChapterEditorialCycle,
} from "../domain/editorial-board";
import {buildEditorialVerificationPlan} from "../domain/editorial-verification-plan";
import {currentEditorialVerificationChoice}
  from "../domain/editorial-verification-choices";
import {getDb,getBook,saveBook,listActivities} from "../infrastructure/db";
import {getOutbox} from "../infrastructure/outbox";
import {recordEditorialVerificationChoice} from "./editorial-verification-choices";

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

const privateNote="PRIVATO_AUTORE_CHOICE: voglio rileggere questa scena con attenzione.";
async function prepared(){
  const {book,cycle,chapter,a,b}=makeDisagreement();
  decide(cycle,chapter,book,a,b,"needs_evidence");
  cycle.stage="blocked";book.status="paused";
  book.remote={owner:"writer",repository:"romanzo",branch:"main",
    autoSync:true,lastSyncedCommit:"a".repeat(40)};
  await saveBook(book);
  // A blocked editorial cycle is deliberately not eligible for automatic
  // checkpoints. Seed a pending outbox item explicitly to test its deletion.
  await (await getDb()).put("outbox",{
    bookId:book.id,operationId:crypto.randomUUID(),
    revision:1,requestedAt:new Date().toISOString(),state:"pending",attempts:0,
  },book.id);
  const stored=(await getBook(book.id))!;
  const item=buildEditorialVerificationPlan(stored,stored.editorialCycle!,
    stored.chapters[0]!).items[0]!;
  return {book:stored,item};
}
describe("Application: scelte autore sulla verifica del giudice",()=>{
  it("presa in carico, rifiuto e reset atomici, no leak activity, no mutazione canon",async()=>{
    let {book,item}=await prepared();
    const before=structuredClone(book);
    expect(await getOutbox(book.id)).toBeDefined();
    for(const status of ["taken_on","dismissed","reset"] as const){
      await recordEditorialVerificationChoice(book.id,book.updatedAt,"c1",item.key,
        status,privateNote);
      book=(await getBook(book.id))!;
      const current=currentEditorialVerificationChoice(book,"c1",item);
      if(status==="reset")expect(current).toBeNull();
      else expect(current?.status).toBe(status);
    }
    expect(book.editorialVerificationChoices?.map(x=>x.status))
      .toEqual(["taken_on","dismissed","reset"]);
    expect(book.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect(book.chapters).toEqual(before.chapters);
    expect(book.memory).toEqual(before.memory);
    expect(book.editorialCycle).toEqual(before.editorialCycle);
    const activities=(await listActivities(book.id)).filter(x=>
      x.title==="Scelta privata sul controllo editoriale aggiornata");
    expect(activities).toHaveLength(3);
    for(const forbidden of ["PRIVATO_AUTORE_CHOICE",quote,missing,check,
      "Mara","Elio","taken_on","dismissed","reset"])
      expect(JSON.stringify(activities)).not.toContain(forbidden);
  });
  it("CAS, autopilot attivo e ciclo non bloccato non scrivono e non svuotano la coda",async()=>{
    const {book,item}=await prepared();
    const call=(stamp:string,key:string)=>
      recordEditorialVerificationChoice(book.id,stamp,"c1",key,"taken_on",privateNote);
    await expect(call("1999-01-01",item.key)).rejects.toThrow(/modificato/);
    await expect(call(book.updatedAt,"non-esiste")).rejects.toThrow(/non più corrente/);
    expect((await getBook(book.id))!.remote?.autoSync).toBe(true);
    expect(await getOutbox(book.id)).toBeDefined();
    const live=(await getBook(book.id))!;
    live.status="running";await saveBook(live,false);
    await expect(call(live.updatedAt,item.key)).rejects.toThrow(/pausa/);
    live.status="paused";live.editorialCycle!.stage="adjudicate";
    await saveBook(live,false);
    await expect(call(live.updatedAt,item.key)).rejects.toThrow(/blocco/);
    expect((await getBook(book.id))!.editorialVerificationChoices).toBeUndefined();
  });
  it("lock writer occupato rifiuta senza scrittura",async()=>{
    const {book,item}=await prepared();
    vi.stubGlobal("navigator",{locks:{request:async(_name:string,_opts:unknown,
      cb:(lock:object|null)=>Promise<unknown>)=>cb(null)}});
    await expect(recordEditorialVerificationChoice(
      book.id,book.updatedAt,"c1",item.key,"taken_on",privateNote))
      .rejects.toThrow(/in uso/);
    expect((await getBook(book.id))!.editorialVerificationChoices).toBeUndefined();
  });
});
