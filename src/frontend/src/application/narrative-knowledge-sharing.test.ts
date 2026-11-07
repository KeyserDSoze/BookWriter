import "fake-indexeddb/auto";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {newBook} from "../domain/types";
import {buildNarrativeEventCandidateIndex} from "../domain/narrative-event-candidates";
import {createNarrativeEventDecision} from "../domain/narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "../domain/narrative-knowledge-decisions";
import {buildKnowledgeSharingRegistry} from "../domain/narrative-knowledge-sharing";
import {getDb,getBook,saveBook,listActivities} from "../infrastructure/db";
import {getOutbox} from "../infrastructure/outbox";
import {recordNarrativeKnowledgeShareDecision} from "./narrative-knowledge-sharing";

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
  vi.stubGlobal("navigator",{locks:{request:async(
    _n:string,_o:unknown,cb:(lock:object)=>Promise<unknown>)=>cb({})}});
});
afterEach(()=>vi.unstubAllGlobals());

async function sample(){
  const book=newBook("Indizio","Consenso","Prosa","Adulti");
  book.status="paused";
  book.remote={owner:"author",repository:"romanzo",branch:"main",
    autoSync:true,lastSyncedCommit:"a".repeat(40)};
  book.memory.secrets.lettera="NON_COPIARE_NEI_LOG_INTERNI";
  book.chapters=[{id:"c1",number:1,title:"Scoperta",purpose:"Notizia",
    frozenAt:"2026-11-07T10:00:00.000Z",scenes:[{id:"s1",number:1,
      title:"Mara",objective:"Notizia",status:"canon" as const,
      text:"Mara scopre che Elio nasconde la lettera."}]}];
  const source=createNarrativeEventDecision(book,
    buildNarrativeEventCandidateIndex(book).events[0]!,
    "affirmed","L'autore conferma la menzione non il fatto.",
    crypto.randomUUID(),"2026-11-07T12:00:00.000Z");
  book.narrativeEventDecisions=[source];
  const knowledge=createNarrativeKnowledgeDecision(book,source.id,"reported_by_other",
    "CLASSIFICAZIONE RISERVATA: il personaggio può essere stato ingannato.",
    crypto.randomUUID(),"2026-11-07T13:00:00.000Z");
  book.narrativeKnowledgeDecisions=[knowledge];
  await saveBook(book);
  return {book:(await getBook(book.id))!,knowledge};
}
const reason="MOTIVAZIONE PRIVATA: consento un invio soltanto a due ruoli selezionati.";

describe("Scrittura sicura dell'autorizzazione AI per conoscenza",()=>{
  it("atomica con CAS, Web Locks e outbox svuotata; nessuna modifica canonica",async()=>{
    const {book,knowledge}=await sample();
    const before=structuredClone(book.memory),chapters=structuredClone(book.chapters);
    expect(await getOutbox(book.id)).toBeDefined();
    await recordNarrativeKnowledgeShareDecision(book.id,book.updatedAt,
      knowledge.id,"allowed",["continuity","judge"],reason);
    const result=(await getBook(book.id))!;
    expect(buildKnowledgeSharingRegistry(result).current).toHaveLength(1);
    expect(result.narrativeKnowledgeShareDecisions?.[0]?.recipients)
      .toEqual(["continuity","judge"]);
    expect(result.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect(result.memory).toEqual(before);
    expect(result.chapters).toEqual(chapters);
    const activity=(await listActivities(book.id)).find(x=>x.title===
      "Consenso autore sulle conoscenze");
    expect(activity).toBeDefined();
    expect(JSON.stringify(activity)).not.toContain("NON_COPIARE");
    expect(JSON.stringify(activity)).not.toContain("MOTIVAZIONE PRIVATA");
    expect(JSON.stringify(activity)).not.toContain("CLASSIFICAZIONE RISERVATA");
  });
  it("una revoca successiva blocca il pacchetto futuro mantenendo storico",async()=>{
    let {book,knowledge}=await sample();
    await recordNarrativeKnowledgeShareDecision(book.id,book.updatedAt,
      knowledge.id,"allowed",["secrets"],reason);
    book=(await getBook(book.id))!;
    await recordNarrativeKnowledgeShareDecision(book.id,book.updatedAt,
      knowledge.id,"revoked",[],
      "L'autore ritira espressamente la condivisione ai provider AI.");
    const result=(await getBook(book.id))!;
    expect(result.narrativeKnowledgeShareDecisions).toHaveLength(2);
    expect(buildKnowledgeSharingRegistry(result).current).toHaveLength(0);
  });
  it("blocca CAS obsoleti, fonti inventate e redazione in esecuzione",async()=>{
    const {book,knowledge}=await sample();
    const act=(stamp:string,id:string)=>
      recordNarrativeKnowledgeShareDecision(book.id,stamp,id,"allowed",
        ["judge"],reason);
    await expect(act("2020-01-01",knowledge.id)).rejects.toThrow(/cambiato/);
    await expect(act(book.updatedAt,"inventato")).rejects.toThrow(/non è più corrente/);
    expect((await getBook(book.id))?.remote?.autoSync).toBe(true);
    expect(await getOutbox(book.id)).toBeDefined();
    book.status="running";await saveBook(book,false);
    await expect(act(book.updatedAt,knowledge.id)).rejects.toThrow(/pausa/);
  });
});
