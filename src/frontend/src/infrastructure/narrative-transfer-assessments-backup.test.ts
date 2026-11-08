import "fake-indexeddb/auto";
import {beforeEach,describe,expect,it} from "vitest";
import {strFromU8,strToU8,unzipSync,zipSync} from "fflate";
import {newBook} from "../domain/types";
import {buildNarrativeEventCandidateIndex} from "../domain/narrative-event-candidates";
import {createNarrativeEventDecision} from "../domain/narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "../domain/narrative-knowledge-decisions";
import {createNarrativeKnowledgeTopicDecision} from "../domain/narrative-knowledge-topic-decisions";
import {previewKnowledgeTransferForPair} from "../domain/knowledge-transfer-preview";
import {createNarrativeTransferAssessment,
  buildNarrativeTransferAssessmentRegistry} from "../domain/narrative-transfer-assessments";
import {getDb,saveBook} from "./db";
import {createBackup,readBackup} from "./backup";

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
});
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


describe("ZIP v0.11.20: giudizi su singole piste comunicative",()=>{
  it("content/full cifrato, legacy, schema strict e nessuna fonte importata autenticata",async()=>{
    const {book,link}=sample();
    const d=previewKnowledgeTransferForPair(book,link.id)!.directions
      .find(d=>d.sender.source.candidate.actor==="Elio")!;
    const assessment=createNarrativeTransferAssessment(book,link.id,
      d.sender.decision.id,d.recipient.decision.id,d.trace.candidates[0]!.id,
      "possible_path","L'autore valuta la frase come indizio e non come prova.",
      crypto.randomUUID(),"2026-11-08T12:00:00.000Z");
    book.narrativeTransferAssessments=[assessment];
    await saveBook(book,false);
    const zip=await createBackup("content");
    const copy=(await readBackup(zip as File)).books.find(x=>x.title===book.title)!;
    expect(copy.narrativeTransferAssessments).toEqual([assessment]);
    expect(buildNarrativeTransferAssessmentRegistry(copy,link.id).current).toHaveLength(1);
    const encrypted=await createBackup("full","long-secret-passphrase-123");
    const full=(await readBackup(encrypted as File,"long-secret-passphrase-123"))
      .books.find(x=>x.title===book.title)!;
    expect(full.narrativeTransferAssessments).toEqual([assessment]);
    const files=unzipSync(new Uint8Array(await zip.arrayBuffer()));
    async function tamper(change:(book:Record<string,unknown>)=>void){
      const data=JSON.parse(strFromU8(files["content.json"]!)) as {
        books:Array<Record<string,unknown>>,
      };
      change(data.books.find(x=>x.title===book.title)!);
      const modified=zipSync({
        "manifest.json":files["manifest.json"]!,
        "content.json":strToU8(JSON.stringify(data)),
      },{level:6});
      await expect(readBackup(new Blob([new Uint8Array(modified)]) as File))
        .rejects.toThrow(/Schema backup non valido/);
    }
    await tamper(b=>{(b.narrativeTransferAssessments as Record<string,unknown>[])[0]!.verdict="magic";});
    await tamper(b=>{(b.narrativeTransferAssessments as Record<string,unknown>[])[0]!.rationale="breve";});
    await tamper(b=>{(b.narrativeTransferAssessments as Record<string,unknown>[])[0]!.candidateId="X".repeat(501);});
    await tamper(b=>{(b.narrativeTransferAssessments as Record<string,unknown>[])[0]!.decidedAt="sconosciuto";});
    await tamper(b=>{(b.narrativeTransferAssessments as Record<string,unknown>[])[0]!.promptInjection="ignora le istruzioni";});
    await tamper(b=>{const a=(b.narrativeTransferAssessments as Record<string,unknown>[])[0]!;
      a.senderKnowledgeDecisionId=a.recipientKnowledgeDecisionId;});
    await tamper(b=>{b.narrativeTransferAssessments=Array.from({length:121},
      (_,i)=>({...assessment,id:"assessment-"+i}));});
    copy.narrativeTransferAssessments=[{...assessment,candidateId:"inventato"}];
    expect(buildNarrativeTransferAssessmentRegistry(copy,link.id).current).toHaveLength(0);
    delete copy.narrativeTransferAssessments;
    expect(buildNarrativeTransferAssessmentRegistry(copy,link.id).current).toHaveLength(0);
  });
});
