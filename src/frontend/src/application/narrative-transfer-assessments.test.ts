import "fake-indexeddb/auto";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {newBook} from "../domain/types";
import {buildNarrativeEventCandidateIndex} from "../domain/narrative-event-candidates";
import {createNarrativeEventDecision} from "../domain/narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "../domain/narrative-knowledge-decisions";
import {createNarrativeKnowledgeTopicDecision} from "../domain/narrative-knowledge-topic-decisions";
import {previewKnowledgeTransferForPair} from "../domain/knowledge-transfer-preview";
import {buildNarrativeTransferAssessmentRegistry}
  from "../domain/narrative-transfer-assessments";
import {getDb,getBook,saveBook,listActivities} from "../infrastructure/db";
import {getOutbox} from "../infrastructure/outbox";
import {recordNarrativeTransferAssessment} from "./narrative-transfer-assessments";

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

const privateNote="NOTA_PRIVATA_PISTA_MAI_NEI_LOG: l'autore immagina una voce inattendibile.";
async function persisted(){
  const {book,link}=sample();
  book.status="paused";
  book.remote={owner:"author",repository:"romanzo",branch:"main",
    autoSync:true,lastSyncedCommit:"a".repeat(40)};
  await saveBook(book);
  const fresh=(await getBook(book.id))!;
  const d=previewKnowledgeTransferForPair(fresh,link.id)!.directions
    .find(d=>d.sender.source.candidate.actor==="Elio")!;
  return {book:fresh,link,d,candidate:d.trace.candidates[0]!};
}
describe("Salvataggio privato delle piste con Web Locks e CAS",()=>{
  it("registra una sola lettura, svuota outbox e non pubblica nomi o rationale nel log",async()=>{
    const {book,link,d,candidate}=await persisted(),original=structuredClone(book);
    expect(await getOutbox(book.id)).toBeDefined();
    await recordNarrativeTransferAssessment(book.id,book.updatedAt,link.id,
      d.sender.decision.id,d.recipient.decision.id,candidate.id,
      "author_attested_report",privateNote);
    const changed=(await getBook(book.id))!;
    expect(buildNarrativeTransferAssessmentRegistry(changed,link.id).current)
      .toHaveLength(1);
    expect(changed.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect(changed.chapters).toEqual(original.chapters);
    expect(changed.memory).toEqual(original.memory);
    expect(changed.narrativeKnowledgeShareDecisions)
      .toEqual(original.narrativeKnowledgeShareDecisions);
    const activity=(await listActivities(book.id))
      .find(x=>x.title==="Pista comunicativa valutata dall'autore");
    expect(activity).toBeDefined();
    for(const secret of ["NOTA_PRIVATA_PISTA","QUESTO_SEGRETO","Elio rivela",
      "author_attested_report"])expect(JSON.stringify(activity)).not.toContain(secret);
  });
  it("rettifica append-only e non scrive su CAS vecchio, fonte falsa o autopilot",async()=>{
    let {book,link,d,candidate}=await persisted();
    const save=(stamp:string,id:string,verdict:"possible_path"|"dismissed")=>
      recordNarrativeTransferAssessment(book.id,stamp,link.id,
        d.sender.decision.id,d.recipient.decision.id,id,verdict,privateNote);
    await expect(save("2001-01-01",candidate.id,"possible_path")).rejects.toThrow(/cambiato/);
    await expect(save(book.updatedAt,"falso","possible_path")).rejects.toThrow(/non più corrente/);
    expect((await getBook(book.id))!.remote?.autoSync).toBe(true);
    await save(book.updatedAt,candidate.id,"possible_path");
    book=(await getBook(book.id))!;
    await save(book.updatedAt,candidate.id,"dismissed");
    book=(await getBook(book.id))!;
    expect(book.narrativeTransferAssessments).toHaveLength(2);
    expect(buildNarrativeTransferAssessmentRegistry(book,link.id).current[0]
      ?.decision.verdict).toBe("dismissed");
    book.status="running";await saveBook(book,false);
    const after=(await getBook(book.id))!;
    await expect(save(after.updatedAt,candidate.id,"dismissed")).rejects.toThrow(/pausa/);
  });
});
