import "fake-indexeddb/auto";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {newBook} from "../domain/types";
import {buildNarrativeEventCandidateIndex} from "../domain/narrative-event-candidates";
import {createNarrativeEventDecision} from "../domain/narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "../domain/narrative-knowledge-decisions";
import {buildNarrativeKnowledgeTopicRegistry} from "../domain/narrative-knowledge-topic-decisions";
import {getBook,getDb,saveBook,listActivities} from "../infrastructure/db";
import {getOutbox} from "../infrastructure/outbox";
import {recordNarrativeKnowledgeTopicDecision} from "./narrative-knowledge-topic-decisions";

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
  vi.stubGlobal("navigator",{locks:{request:async(
    _name:string,_opts:unknown,callback:(lock:object)=>Promise<unknown>)=>callback({})}});
});
afterEach(()=>vi.unstubAllGlobals());
async function sample(){
  const book=newBook("Il segreto","Confronto","Prosa","Adulti");
  book.status="paused";
  book.memory.secrets.lettera="NON_METTERE_QUESTO_SEGRETO_NEI_LOG";
  book.remote={owner:"author",repository:"romanzo",branch:"main",
    autoSync:true,lastSyncedCommit:"a".repeat(40)};
  book.chapters=[
    {id:"c1",number:1,title:"Mara",purpose:"Conoscenza",
      frozenAt:"2026-11-08T08:00:00.000Z",
      scenes:[{id:"s1",number:1,title:"Mara",objective:"Apprende",
        text:"Mara scopre che la lettera è falsa.",status:"canon" as const}]},
    {id:"c2",number:2,title:"Elio",purpose:"Conoscenza",
      frozenAt:"2026-11-08T08:30:00.000Z",
      scenes:[{id:"s2",number:1,title:"Elio",objective:"Apprende",
        text:"Elio apprende che la lettera è falsa.",status:"canon" as const}]},
  ];
  const ids:string[]=[];
  for(const candidate of buildNarrativeEventCandidateIndex(book).events){
    const source=createNarrativeEventDecision(book,candidate,"affirmed",
      "L'autore attesta questa menzione senza inferire verità.",
      crypto.randomUUID(),"2026-11-08T09:00:00.000Z");
    book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),source];
    const knowledge=createNarrativeKnowledgeDecision(book,source.id,"reported_by_other",
      "NOTA_PRIVATA_CONOSCENZA: la rivelazione potrebbe non essere vera.",
      crypto.randomUUID(),"2026-11-08T09:10:00.000Z");
    book.narrativeKnowledgeDecisions=[
      ...(book.narrativeKnowledgeDecisions??[]),knowledge];
    ids.push(knowledge.id);
  }
  await saveBook(book);
  return {book:(await getBook(book.id))!,ids};
}
const rationale="MOTIVO_PRIVATO_COPPIA: entrambe le scene alludono al testo della stessa lettera.";
describe("Registrazione manuale dei legami fra conoscenze",()=>{
  it("transazione atomica, lock/CAS, nessuna modifica al canone o log di spoiler",async()=>{
    const {book,ids}=await sample(),before=structuredClone(book);
    expect(await getOutbox(book.id)).toBeDefined();
    await recordNarrativeKnowledgeTopicDecision(book.id,book.updatedAt,
      ids[0]!,ids[1]!,"same_information",rationale);
    const result=(await getBook(book.id))!;
    expect(result.narrativeKnowledgeTopicDecisions).toHaveLength(1);
    expect(buildNarrativeKnowledgeTopicRegistry(result).sameInformation).toHaveLength(1);
    expect(result.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect(result.memory).toEqual(before.memory);
    expect(result.chapters).toEqual(before.chapters);
    expect(result.narrativeKnowledgeShareDecisions).toEqual(before.narrativeKnowledgeShareDecisions);
    const activity=(await listActivities(book.id))
      .find(x=>x.title==="Relazione tra conoscenze annotata dall'autore");
    expect(activity).toBeDefined();
    expect(JSON.stringify(activity)).not.toContain("MOTIVO_PRIVATO_COPPIA");
    expect(JSON.stringify(activity)).not.toContain("NOTA_PRIVATA_CONOSCENZA");
    expect(JSON.stringify(activity)).not.toContain("NON_METTERE");
    expect(JSON.stringify(activity)).not.toContain("Mara scopre");
  });
  it("rettifica append-only senza cancellare il precedente collegamento",async()=>{
    let {book,ids}=await sample();
    await recordNarrativeKnowledgeTopicDecision(book.id,book.updatedAt,
      ids[0]!,ids[1]!,"same_information",rationale);
    book=(await getBook(book.id))!;
    await recordNarrativeKnowledgeTopicDecision(book.id,book.updatedAt,
      ids[1]!,ids[0]!,"different_information",
      "L'autore ha riconosciuto due messaggi apparentemente simili ma distinti.");
    const latest=(await getBook(book.id))!;
    expect(latest.narrativeKnowledgeTopicDecisions).toHaveLength(2);
    expect(buildNarrativeKnowledgeTopicRegistry(latest).differentInformation).toHaveLength(1);
    expect(buildNarrativeKnowledgeTopicRegistry(latest).sameInformation).toHaveLength(0);
  });
  it("nessuna scrittura con CAS obsoleto, ID inventati o autopilot attivo",async()=>{
    const {book,ids}=await sample();
    const action=(stamp:string,id:string)=>
      recordNarrativeKnowledgeTopicDecision(book.id,stamp,id,ids[1]!,
        "same_information",rationale);
    await expect(action("2001-01-01",ids[0]!)).rejects.toThrow(/cambiato/);
    await expect(action(book.updatedAt,"falso")).rejects.toThrow(/non è più corrente/);
    expect((await getBook(book.id))?.remote?.autoSync).toBe(true);
    expect(await getOutbox(book.id)).toBeDefined();
    const running=(await getBook(book.id))!;
    running.status="running";await saveBook(running,false);
    await expect(action(running.updatedAt,ids[0]!)).rejects.toThrow(/pausa/);
  });
});
