import "fake-indexeddb/auto";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {newBook} from "../domain/types";
import {buildNarrativeEventCandidateIndex} from "../domain/narrative-event-candidates";
import {createNarrativeEventDecision} from "../domain/narrative-event-decisions";
import {buildNarrativeKnowledgeRegistry} from "../domain/narrative-knowledge-decisions";
import {getBook,getDb,saveBook,listActivities} from "../infrastructure/db";
import {getOutbox} from "../infrastructure/outbox";
import {recordNarrativeKnowledgeDecision} from "./narrative-knowledge-decisions";

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
  vi.stubGlobal("navigator",{locks:{request:async(
    _name:string,_opts:unknown,callback:(lock:object)=>Promise<unknown>)=>callback({})}});
});
afterEach(()=>vi.unstubAllGlobals());

async function sample(){
  const book=newBook("Lettera","Mara","Prosa","Adulti");
  book.status="paused";
  book.memory.secrets.lettera="SPOILER SEGRETO NON NEL LOG";
  book.remote={owner:"author",repository:"novel",branch:"main",
    autoSync:true,lastSyncedCommit:"a".repeat(40)};
  book.chapters=[{id:"c1",number:1,title:"Lettera",purpose:"Indizio",
    frozenAt:"2026-11-07T10:00:00.000Z",
    scenes:[{id:"s1",number:1,title:"Scoperta",objective:"Rivelazione",
      text:"Mara scopre che Elio nasconde la lettera.",status:"canon" as const}]}];
  const source=createNarrativeEventDecision(book,
    buildNarrativeEventCandidateIndex(book).events[0]!,
    "affirmed","L'autore conferma la menzione congelata.",
    crypto.randomUUID(),"2026-11-07T12:00:00.000Z");
  book.narrativeEventDecisions=[source];
  await saveBook(book);
  return {book:(await getBook(book.id))!,source};
}
describe("Salvataggio privato delle decisioni di conoscenza",()=>{
  it("transazione su libro, attività e coda; disabilita autosync senza AI",async()=>{
    const {book,source}=await sample();
    const memory=structuredClone(book.memory),chapters=structuredClone(book.chapters);
    expect(await getOutbox(book.id)).toBeDefined();
    await recordNarrativeKnowledgeDecision(book.id,book.updatedAt,source.id,
      "reported_by_other","L'autore ha deciso che Mara ha saputo la notizia da Elio.");
    const after=(await getBook(book.id))!;
    expect(after.narrativeKnowledgeDecisions).toHaveLength(1);
    expect(buildNarrativeKnowledgeRegistry(after).reportedByOther).toHaveLength(1);
    expect(after.remote?.autoSync).toBe(false);
    expect(after.memory).toEqual(memory);
    expect(after.chapters).toEqual(chapters);
    expect(await getOutbox(book.id)).toBeUndefined();
    const activity=(await listActivities(book.id)).find(x=>
      x.title==="Interpretazione autore su conoscenza");
    expect(activity).toBeDefined();
    expect(JSON.stringify(activity)).not.toContain("SPOILER SEGRETO");
    expect(JSON.stringify(activity)).not.toContain("Mara ha saputo");
  });
  it("rettifica append-only e origine attestata ancora valida",async()=>{
    let {book,source}=await sample();
    await recordNarrativeKnowledgeDecision(book.id,book.updatedAt,source.id,
      "learned_directly","Mara apprende personalmente questo segreto.");
    book=(await getBook(book.id))!;
    await recordNarrativeKnowledgeDecision(book.id,book.updatedAt,source.id,
      "still_secret","La scena è un sogno: Mara non sa ancora il contenuto.");
    const latest=(await getBook(book.id))!;
    expect(latest.narrativeKnowledgeDecisions).toHaveLength(2);
    expect(buildNarrativeKnowledgeRegistry(latest).stillSecret).toHaveLength(1);
    expect(buildNarrativeKnowledgeRegistry(latest).learnedDirectly).toHaveLength(0);
  });
  it("no revisioni stale, nessun ID falso o autosync cancellato se la verifica fallisce",async()=>{
    const {book,source}=await sample();
    const action=(stamp:string,id:string)=>
      recordNarrativeKnowledgeDecision(book.id,stamp,id,"still_secret",
        "L'autore conferma che la notizia rimane sconosciuta.");
    await expect(action("2001-01-01",source.id)).rejects.toThrow(/cambiato/);
    await expect(action(book.updatedAt,"id-inventato")).rejects.toThrow(/attestata/);
    expect((await getBook(book.id))?.remote?.autoSync).toBe(true);
    expect(await getOutbox(book.id)).toBeDefined();
    const other=await getBook(book.id);
    other!.status="running";
    await saveBook(other!,false);
    await expect(action(other!.updatedAt,source.id)).rejects.toThrow(/pausa/);
  });
  it("blocca i salvataggi durante un ciclo editoriale non concluso",async()=>{
    const {book,source}=await sample();
    book.editorialCycle={chapterId:"c1",round:1,stage:"review",
      reports:[],repairCursor:0,priorRounds:[]};
    await saveBook(book,false);
    await expect(recordNarrativeKnowledgeDecision(book.id,book.updatedAt,
      source.id,"learned_directly","La menzione è coerente e motivata."))
      .rejects.toThrow(/redazione/);
  });
});
