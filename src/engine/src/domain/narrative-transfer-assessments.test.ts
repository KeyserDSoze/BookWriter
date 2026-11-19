import {describe,expect,it} from "vitest";
import {newBook} from "./types";
import {buildNarrativeEventCandidateIndex} from "./narrative-event-candidates";
import {createNarrativeEventDecision} from "./narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "./narrative-knowledge-decisions";
import {createNarrativeKnowledgeTopicDecision} from "./narrative-knowledge-topic-decisions";
import {previewKnowledgeTransferForPair} from "./knowledge-transfer-preview";
import {createNarrativeTransferAssessment,buildNarrativeTransferAssessmentRegistry,
  MAX_TRANSFER_ASSESSMENTS} from "./narrative-transfer-assessments";

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


const note="MOTIVO_PRIVATO_COMUNICAZIONE: potrebbe essere soltanto una menzogna del narratore.";
function add(book:ReturnType<typeof sample>["book"],topicId:string,
  senderId:string,recipientId:string,candidateId:string,
  verdict:"author_attested_report"|"possible_path"|"dismissed"="possible_path"){
  const decision=createNarrativeTransferAssessment(
    book,topicId,senderId,recipientId,candidateId,verdict,note,
    crypto.randomUUID(),"2026-11-08T12:00:00.000Z");
  book.narrativeTransferAssessments=[
    ...(book.narrativeTransferAssessments??[]),decision];
  return decision;
}

describe("Giudizi privati dell'autore su UNA pista comunicativa",()=>{
  it("richiede un link corrente e l'esatta direzione/citazione verificabile",()=>{
    const {book,link}=sample(),before=structuredClone(book);
    const preview=previewKnowledgeTransferForPair(book,link.id)!;
    const direction=preview.directions.find(d=>d.sender.source.candidate.actor==="Elio")!;
    const candidate=direction.trace.candidates[0]!;
    expect(()=>add(book,link.id,direction.recipient.decision.id,
      direction.sender.decision.id,candidate.id)).toThrow(/non più corrente/);
    expect(()=>add(book,link.id,direction.sender.decision.id,
      direction.recipient.decision.id,"citazione inventata")).toThrow(/non più corrente/);
    const decision=add(book,link.id,direction.sender.decision.id,
      direction.recipient.decision.id,candidate.id,"author_attested_report");
    const current=buildNarrativeTransferAssessmentRegistry(book,link.id);
    expect(current.current).toHaveLength(1);
    expect(current.current[0]?.decision).toEqual(decision);
    expect(current.current[0]?.candidate.quote).toBe(phrase);
    expect(current).toMatchObject({nonCurrentCount:0,authorInterpretationsOnly:true});
    expect(JSON.stringify(current)).not.toContain("QUESTO_SEGRETO");
    expect(book.chapters).toEqual(before.chapters);
    expect(book.memory).toEqual(before.memory);
  });
  it("rettifica last-wins senza perdere audit e non decide sulle coppie mancanti",()=>{
    const {book,link}=sample();
    const d=previewKnowledgeTransferForPair(book,link.id)!.directions
      .find(d=>d.sender.source.candidate.actor==="Elio")!;
    const c=d.trace.candidates[0]!;
    const first=add(book,link.id,d.sender.decision.id,d.recipient.decision.id,c.id);
    const later=add(book,link.id,d.sender.decision.id,d.recipient.decision.id,c.id,"dismissed");
    expect(first.id).not.toBe(later.id);
    const registry=buildNarrativeTransferAssessmentRegistry(book,link.id);
    expect(registry.current.map(x=>x.decision.id)).toEqual([later.id]);
    expect(registry.nonCurrentCount).toBe(1);
    expect(buildNarrativeTransferAssessmentRegistry(book,"non-collegato").current)
      .toHaveLength(0);
  });
  it("fonti modificate, riaperte, draft e topic rettificato invalidano senza risorgere",()=>{
    const {book,link}=sample();
    const d=previewKnowledgeTransferForPair(book,link.id)!.directions
      .find(d=>d.sender.source.candidate.actor==="Elio")!;
    add(book,link.id,d.sender.decision.id,d.recipient.decision.id,d.trace.candidates[0]!.id);
    book.chapters[1]!.scenes[0]!.status="draft";
    expect(buildNarrativeTransferAssessmentRegistry(book,link.id).current).toHaveLength(0);
    book.chapters[1]!.scenes[0]!.status="canon";
    book.chapters[1]!.scenes[0]!.text+=" Nuova frase.";
    expect(buildNarrativeTransferAssessmentRegistry(book,link.id).current).toHaveLength(0);
    const intact=sample();
    const a=intact.book;
    const dir=previewKnowledgeTransferForPair(a,intact.link.id)!.directions
      .find(d=>d.sender.source.candidate.actor==="Elio")!;
    add(a,intact.link.id,dir.sender.decision.id,dir.recipient.decision.id,dir.trace.candidates[0]!.id);
    const newer=createNarrativeKnowledgeTopicDecision(a,
      intact.link.firstKnowledgeDecisionId,intact.link.secondKnowledgeDecisionId,
      "different_information","Le due notizie, secondo l'autore, sono distinte.",
      crypto.randomUUID(),"2026-11-08T12:02:00.000Z");
    a.narrativeKnowledgeTopicDecisions!.push(newer);
    expect(buildNarrativeTransferAssessmentRegistry(a,intact.link.id).current).toHaveLength(0);
    expect(buildNarrativeTransferAssessmentRegistry(a,intact.link.id).nonCurrentCount).toBe(1);
    a.narrativeKnowledgeTopicDecisions!.pop();
    a.chapters[2]!.scenes[0]!.text+=" Altra frase.";
    expect(buildNarrativeTransferAssessmentRegistry(a,intact.link.id).current).toHaveLength(0);
  });
  it("fail closed su enum, note, ID, limiti e data",()=>{
    const {book,link}=sample();
    const d=previewKnowledgeTransferForPair(book,link.id)!.directions
      .find(d=>d.sender.source.candidate.actor==="Elio")!;
    const args=[book,link.id,d.sender.decision.id,d.recipient.decision.id,
      d.trace.candidates[0]!.id] as const;
    expect(()=>createNarrativeTransferAssessment(...args,"telepathy" as "possible_path",
      note,crypto.randomUUID(),"2026-11-08T12:00:00.000Z")).toThrow(/non valida/);
    expect(()=>createNarrativeTransferAssessment(...args,"possible_path",
      "breve",crypto.randomUUID(),"2026-11-08T12:00:00.000Z")).toThrow(/20–650/);
    expect(()=>createNarrativeTransferAssessment(...args,"possible_path",
      note,crypto.randomUUID(),"invalid")).toThrow(/data/);
    const first=add(book,link.id,d.sender.decision.id,d.recipient.decision.id,
      d.trace.candidates[0]!.id);
    book.narrativeTransferAssessments=Array.from({length:MAX_TRANSFER_ASSESSMENTS},
      (_,i)=>({...first,id:"test-"+i}));
    expect(()=>createNarrativeTransferAssessment(...args,"possible_path",
      note,crypto.randomUUID(),"2026-11-08T12:00:00.000Z")).toThrow(/120/);
  });
});
