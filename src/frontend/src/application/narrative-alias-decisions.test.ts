import "fake-indexeddb/auto";
import { beforeEach,afterEach,describe,expect,it,vi } from "vitest";
import { newBook } from "../domain/types";
import { extractNarrativeEventCandidates } from "../domain/narrative-event-candidates";
import { createNarrativeEventDecision } from "../domain/narrative-event-decisions";
import { getBook,getDb,saveBook,listActivities } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import { buildNarrativeAliasRegistry } from "../domain/narrative-alias-decisions";
import { recordNarrativeAliasDecision } from "./narrative-alias-decisions";

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
  vi.stubGlobal("navigator",{locks:{request:async(
    _n:string,_o:unknown,cb:(lock:object)=>Promise<unknown>)=>cb({})}});
});
afterEach(()=>vi.unstubAllGlobals());

async function sample(){
  const book=newBook("Prove","Soprannome","Prosa","Adulti");
  book.status="paused";
  book.remote={owner:"writer",repository:"novel",branch:"main",autoSync:true,
    lastSyncedCommit:"a".repeat(40)};
  book.chapters=[
    {id:"c1",number:1,title:"Uno",purpose:"Svolta",frozenAt:"2026-11-07T10:00:00Z",
      scenes:[{id:"s1",number:1,title:"S",objective:"Evento",
        text:"Mara muore.",status:"canon" as const}]},
    {id:"c2",number:2,title:"Due",purpose:"Svolta",frozenAt:"2026-11-07T11:00:00Z",
      scenes:[{id:"s2",number:1,title:"S",objective:"Evento",
        text:"Ombra parte.",status:"canon" as const}]},
  ];
  for(const ch of book.chapters){
    const d=createNarrativeEventDecision(book,extractNarrativeEventCandidates(ch,ch.scenes[0]!)[0]!,
      "affirmed","L'autore conferma la menzione nell'opera.",
      crypto.randomUUID(),"2026-11-07T12:00:00Z");
    book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),d];
  }
  await saveBook(book);
  return (await getBook(book.id))!;
}
describe("Salvataggio sicuro di una coppia alias",()=>{
  it("salva storico e attività in una transazione, disabilita autosync e svuota outbox",async()=>{
    const book=await sample();
    expect(await getOutbox(book.id)).toBeDefined();
    await recordNarrativeAliasDecision(book.id,book.updatedAt,"Mara","Ombra","linked",
      "L'autore collega questi due nomi nello stesso arco.");
    const result=(await getBook(book.id))!;
    expect(result.narrativeAliasDecisions).toHaveLength(1);
    expect(buildNarrativeAliasRegistry(result).linked).toHaveLength(1);
    expect(result.remote?.autoSync).toBe(false);
    expect(result.memory).toEqual(book.memory);
    expect(result.chapters).toEqual(book.chapters);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect((await listActivities(book.id)).some(a=>
      a.title==="Decisione autore su possibile alias")).toBe(true);
  });
  it("registra rettifica append-only che blocca ogni legame attivo",async()=>{
    let book=await sample();
    await recordNarrativeAliasDecision(book.id,book.updatedAt,"Mara","Ombra","linked",
      "L'autore pensa che Ombra sia Mara.");
    book=(await getBook(book.id))!;
    await recordNarrativeAliasDecision(book.id,book.updatedAt,"Ombra","Mara","separated",
      "L'autore decide che sono due personaggi distinti.");
    const current=(await getBook(book.id))!;
    expect(current.narrativeAliasDecisions).toHaveLength(2);
    expect(buildNarrativeAliasRegistry(current)).toMatchObject({
      linked:[],nonCurrentCount:1,
    });
    expect(buildNarrativeAliasRegistry(current).separated).toHaveLength(1);
  });
  it("revisioni concorrenti, nomi falsi e autopilot attivo vengono rifiutati",async()=>{
    const book=await sample();
    const action=(date:string,first:string,second:string)=>
      recordNarrativeAliasDecision(book.id,date,first,second,"linked",
        "Questa decisione contiene una motivazione valida.");
    await expect(action("2020-01-01","Mara","Ombra")).rejects.toThrow(/cambiato/);
    await expect(action(book.updatedAt,"Mara","Inventato")).rejects.toThrow(/attestazioni/);
    expect((await getBook(book.id))?.remote?.autoSync).toBe(true);
    expect(await getOutbox(book.id)).toBeDefined();
    book.status="running";await saveBook(book,false);
    await expect(action(book.updatedAt,"Mara","Ombra")).rejects.toThrow(/pausa/);
  });
});
