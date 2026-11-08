import "fake-indexeddb/auto";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {newBook} from "../domain/types";
import {buildNarrativeEventCandidateIndex} from "../domain/narrative-event-candidates";
import {createNarrativeEventDecision} from "../domain/narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "../domain/narrative-knowledge-decisions";
import {createNarrativeKnowledgeTopicDecision} from "../domain/narrative-knowledge-topic-decisions";
import {previewKnowledgeTransferForPair} from "../domain/knowledge-transfer-preview";
import {createNarrativeTransferAssessment} from "../domain/narrative-transfer-assessments";
import {buildSharedTransferPack} from "../domain/narrative-transfer-sharing";
import {getDb,getBook,saveBook,listActivities} from "../infrastructure/db";
import {getOutbox} from "../infrastructure/outbox";
import {recordNarrativeTransferShareDecision} from "./narrative-transfer-sharing";

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
  vi.stubGlobal("navigator",{locks:{request:async(
    _name:string,_opts:unknown,callback:(lock:object)=>Promise<unknown>)=>callback({})}});
});
afterEach(()=>vi.unstubAllGlobals());

const phrase="Elio rivela a Mara che la lettera è falsa";
function sample(){
  const book=newBook("Notizie", "Due punti di vista", "Prosa", "Adulti");
  book.memory.secrets.private="QUESTO_SEGRETO_NON_VA_NELL_ANTEPRIMA";
  book.chapters=[
    {id:"c1",number:1,title:"Elio",purpose:"Conoscenza",
      frozenAt:"2026-11-08T08:00:00.000Z",
      scenes:[{id:"s1",number:1,title:"Elio",objective:"Apprende",status:"canon",
        text:"Elio scopre che la lettera è falsa."}]},
    {id:"c2",number:2,title:"La notizia",purpose:"Comunicazioni",
      frozenAt:"2026-11-08T08:30:00.000Z",
      scenes:[{id:"s2",number:1,title:"Messaggi",objective:"Raccontare",status:"canon",
        text:"Nina rivela a Mara che la lettera è falsa. "+
          phrase+". Elio rivela a Nina che la lettera è falsa. "+
          "Elio confida a Mara che il giardino è verde."}]},
    {id:"c3",number:3,title:"Mara",purpose:"Conoscenza",
      frozenAt:"2026-11-08T09:00:00.000Z",
      scenes:[{id:"s3",number:1,title:"Mara",objective:"Apprende",status:"canon",
        text:"Mara apprende che la lettera è falsa."}]},
    {id:"c4",number:4,title:"Futuro",purpose:"Non leggere",
      frozenAt:"2026-11-08T10:00:00.000Z",
      scenes:[{id:"s4",number:1,title:"Dialogo",objective:"Non leggere",status:"canon",
        text:"Elio rivela a Mara che la lettera era vera."}]},
  ];
  const ids:string[]=[];
  for(const actor of ["Elio","Mara"]){
    const event=buildNarrativeEventCandidateIndex(book).events
      .find(x=>x.actor===actor && x.kind==="knowledge_mention")!;
    const attested=createNarrativeEventDecision(book,event,"affirmed",
      "Questa menzione è presente nel testo congelato.",
      crypto.randomUUID(),"2026-11-08T11:00:00.000Z");
    book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),attested];
    const knowledge=createNarrativeKnowledgeDecision(book,attested.id,"reported_by_other",
      "L'autore interpreta la notizia senza certificarne la verità.",
      crypto.randomUUID(),"2026-11-08T11:01:00.000Z");
    book.narrativeKnowledgeDecisions=[...(book.narrativeKnowledgeDecisions??[]),knowledge];
    ids.push(knowledge.id);
  }
  const link=createNarrativeKnowledgeTopicDecision(book,ids[0]!,ids[1]!,
    "same_information","Le due frasi sono collegate secondo l'autore.",
    crypto.randomUUID(),"2026-11-08T11:02:00.000Z");
  book.narrativeKnowledgeTopicDecisions=[link];
  return {book,link};
}

async function prepared(){
  const {book,link}=sample();
  book.status="paused";
  book.remote={owner:"author",repository:"romanzo",branch:"main",
    autoSync:true,lastSyncedCommit:"a".repeat(40)};
  const dir=previewKnowledgeTransferForPair(book,link.id)!.directions
    .find(x=>x.sender.source.candidate.actor==="Elio")!;
  const assessment=createNarrativeTransferAssessment(book,link.id,
    dir.sender.decision.id,dir.recipient.decision.id,dir.trace.candidates[0]!.id,
    "possible_path","NOTA_PRIVATA_VALUTAZIONE: Solo una pista ipotetica nel romanzo.",
    crypto.randomUUID(),"2026-11-08T15:00:00.000Z");
  book.narrativeTransferAssessments=[assessment];
  book.chapters.push({id:"c5",number:5,title:"Esito",purpose:"Capire",
    scenes:[{id:"s5",number:1,title:"Ritorno",objective:"Capire",
      text:"Mara cerca la lettera ancora chiusa.",status:"canon"}]});
  await saveBook(book);
  return {book:(await getBook(book.id))!,assessment};
}
const note="MOTIVO_PRIVATO_CONSENSO: autorizzo soltanto un contesto fallibile.";
describe("Consensi transfer: transazioni locali e privacy",()=>{
  it("grant e revoca con CAS, lock, outbox svuotata, nessun leak activity",async()=>{
    let {book,assessment}=await prepared();
    const before=structuredClone(book);
    expect(await getOutbox(book.id)).toBeDefined();
    await recordNarrativeTransferShareDecision(book.id,book.updatedAt,
      assessment.id,"allowed",["continuity","judge"],note);
    book=(await getBook(book.id))!;
    expect(book.narrativeTransferShareDecisions).toHaveLength(1);
    expect(book.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect(book.chapters).toEqual(before.chapters);
    expect(book.memory).toEqual(before.memory);
    expect(book.narrativeTransferAssessments).toEqual(before.narrativeTransferAssessments);
    const chapter=book.chapters[4]!;
    expect(buildSharedTransferPack(book,chapter,"continuity",
      chapter.scenes[0]!.text).witnesses).toHaveLength(1);
    const logs=(await listActivities(book.id)).filter(x=>x.title.includes(
      "Consenso sulle piste comunicative"));
    expect(logs).toHaveLength(1);
    for(const word of ["MOTIVO_PRIVATO_CONSENSO","NOTA_PRIVATA_VALUTAZIONE",
      "Elio","Mara","lettera è falsa","continuity","judge"])
      expect(JSON.stringify(logs)).not.toContain(word);
    await recordNarrativeTransferShareDecision(book.id,book.updatedAt,
      assessment.id,"revoked",[],note);
    book=(await getBook(book.id))!;
    expect(book.narrativeTransferShareDecisions?.map(x=>x.status))
      .toEqual(["allowed","revoked"]);
    expect(buildSharedTransferPack(book,chapter,"continuity",
      chapter.scenes[0]!.text).witnesses).toHaveLength(0);
  });
  it("CAS stale, fonte contraffatta e autopilot attivo non scrivono né svuotano outbox",async()=>{
    const {book,assessment}=await prepared();
    const call=(stamp:string,id:string)=>
      recordNarrativeTransferShareDecision(book.id,stamp,id,"allowed",["judge"],note);
    await expect(call("2000-01-01",assessment.id)).rejects.toThrow(/cambiato/);
    await expect(call(book.updatedAt,"fake")).rejects.toThrow(/non è più corrente/);
    expect((await getBook(book.id))!.remote?.autoSync).toBe(true);
    expect(await getOutbox(book.id)).toBeDefined();
    const running=(await getBook(book.id))!;
    running.status="running";await saveBook(running,false);
    await expect(call(running.updatedAt,assessment.id)).rejects.toThrow(/pausa/);
  });
});
