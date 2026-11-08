import "fake-indexeddb/auto";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {newBook} from "../domain/types";
import {buildNarrativeEventCandidateIndex} from "../domain/narrative-event-candidates";
import {createNarrativeEventDecision} from "../domain/narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "../domain/narrative-knowledge-decisions";
import {buildNarrativeKnowledgeTimingRegistry} from "../domain/narrative-knowledge-timing";
import {getBook,getDb,saveBook,listActivities} from "../infrastructure/db";
import {getOutbox} from "../infrastructure/outbox";
import {recordNarrativeKnowledgeTimingDecision} from "./narrative-knowledge-timing";

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
  book.remote={owner:"author",repository:"romanzo",branch:"main",
    autoSync:true,lastSyncedCommit:"a".repeat(40)};
  book.memory.secrets.lettera="NON_INVIARE_AI_QUESTO_SEGRETO";
  book.chapters=[{id:"ch1",number:1,title:"Sogno",purpose:"Indizio",
    frozenAt:"2026-11-08T08:00:00.000Z",
    scenes:[{id:"sc1",number:1,title:"Rivelazione",objective:"Apprendere",
      text:"Mara scopre che Elio nasconde la lettera.",status:"canon" as const}]}];
  const source=createNarrativeEventDecision(book,
    buildNarrativeEventCandidateIndex(book).events[0]!,
    "affirmed","L'autore attesta la menzione nella scena corrente.",
    crypto.randomUUID(),"2026-11-08T09:00:00.000Z");
  book.narrativeEventDecisions=[source];
  const knowledge=createNarrativeKnowledgeDecision(book,source.id,
    "learned_directly","L'autore interpreta il passaggio come apprendimento diretto.",
    crypto.randomUUID(),"2026-11-08T09:10:00.000Z");
  book.narrativeKnowledgeDecisions=[knowledge];
  await saveBook(book);
  return {book:(await getBook(book.id))!,knowledge};
}
const note="CRONOLOGIA_PRIVATA: scena inserita come flashback non cronologico.";
describe("Annotazione locale dei tempi della conoscenza",()=>{
  it("scrive in transazione atomica, disabilita autosync senza loggare la motivazione",async()=>{
    const {book,knowledge}=await sample();
    const memory=structuredClone(book.memory),chapters=structuredClone(book.chapters);
    expect(await getOutbox(book.id)).toBeDefined();
    await recordNarrativeKnowledgeTimingDecision(book.id,book.updatedAt,
      knowledge.id,"known_before_scene","flashback_or_reordered",note);
    const after=(await getBook(book.id))!;
    expect(buildNarrativeKnowledgeTimingRegistry(after).current).toHaveLength(1);
    expect(after.narrativeKnowledgeTimingDecisions?.[0]?.narrativeOrder)
      .toBe("flashback_or_reordered");
    expect(after.memory).toEqual(memory);
    expect(after.chapters).toEqual(chapters);
    expect(after.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    const activity=(await listActivities(book.id))
      .find(x=>x.title==="Tempo della conoscenza annotato dall'autore");
    expect(activity).toBeDefined();
    expect(JSON.stringify(activity)).not.toContain("CRONOLOGIA_PRIVATA");
    expect(JSON.stringify(activity)).not.toContain("NON_INVIARE_AI");
    expect(JSON.stringify(activity)).not.toContain("Mara scopre");
  });
  it("append-only e revisione delle interpretazioni",async()=>{
    let {book,knowledge}=await sample();
    await recordNarrativeKnowledgeTimingDecision(book.id,book.updatedAt,
      knowledge.id,"uncertain","undetermined",note);
    book=(await getBook(book.id))!;
    await recordNarrativeKnowledgeTimingDecision(book.id,book.updatedAt,
      knowledge.id,"acquired_in_scene","chronological",note);
    const latest=(await getBook(book.id))!;
    expect(latest.narrativeKnowledgeTimingDecisions).toHaveLength(2);
    expect(buildNarrativeKnowledgeTimingRegistry(latest).current[0]?.decision.accessMoment)
      .toBe("acquired_in_scene");
    expect(buildNarrativeKnowledgeTimingRegistry(latest).nonCurrentCount).toBe(1);
  });
  it("rifiuta libro stale, fonte inventata, autopilot o redazione attiva senza svuotare outbox",async()=>{
    const {book,knowledge}=await sample();
    const doSave=(stamp:string,id:string)=>
      recordNarrativeKnowledgeTimingDecision(book.id,stamp,id,"uncertain",
        "undetermined",note);
    await expect(doSave("2001-01-01",knowledge.id)).rejects.toThrow(/cambiato/);
    await expect(doSave(book.updatedAt,"non-esiste")).rejects.toThrow(/non è corrente/);
    expect((await getBook(book.id))?.remote?.autoSync).toBe(true);
    expect(await getOutbox(book.id)).toBeDefined();
    const running=(await getBook(book.id))!;
    running.status="running";
    await saveBook(running,false);
    await expect(doSave(running.updatedAt,knowledge.id)).rejects.toThrow(/pausa/);
  });
});
