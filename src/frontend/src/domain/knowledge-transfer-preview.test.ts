import {describe,expect,it} from "vitest";
import {newBook,type BookProject} from "./types";
import {buildNarrativeEventCandidateIndex} from "./narrative-event-candidates";
import {createNarrativeEventDecision} from "./narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "./narrative-knowledge-decisions";
import {createNarrativeKnowledgeTopicDecision} from "./narrative-knowledge-topic-decisions";
import {previewKnowledgeTransferForPair} from "./knowledge-transfer-preview";
import {buildInformationTransferTrace} from "./information-transfer-traces";

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

describe("Anteprima on-demand di possibili comunicazioni fra conoscenze",()=>{
  it("solo link diretto e corrente, due direzioni e mittente/destinatario esatti",()=>{
    const {book,link}=sample(),before=structuredClone(book);
    const preview=previewKnowledgeTransferForPair(book,link.id)!;
    expect(preview.method).toBe("author_topic_pair_bounded_transfer_mentions_v1");
    expect(preview.manuscriptOrderOnly).toBe(true);
    const forward=preview.directions.find(x=>
      x.sender.source.candidate.actor==="Elio")!;
    const backward=preview.directions.find(x=>
      x.sender.source.candidate.actor==="Mara")!;
    expect(forward.recipient.source.candidate.actor).toBe("Mara");
    expect(forward.trace.candidates).toHaveLength(1);
    expect(forward.trace.candidates[0]).toMatchObject({
      chapterId:"c2",sceneId:"s2",sender:"Elio",recipient:"Mara",
      evidenceStatus:"unverified_literal_report",
    });
    expect(forward.trace.candidates[0]!.quote).toBe(phrase);
    expect(forward.trace.candidates[0]!.matchedTopicTerms).toContain("lettera");
    expect(backward.trace.candidates).toHaveLength(0);
    expect(JSON.stringify(preview)).not.toContain("QUESTO_SEGRETO");
    expect(JSON.stringify(preview)).not.toContain("lettera era vera");
    expect(book).toEqual(before);
  });
  it("il filtro diretto non altera il vecchio scanner dei revisori",()=>{
    const {book}=sample();
    const chapter=book.chapters[2]!,query="Mara apprende che la lettera è falsa.";
    const all=buildInformationTransferTrace(book,chapter,query);
    const exact=buildInformationTransferTrace(book,chapter,query,
      {sender:"Elio",recipient:"Mara"});
    expect(all.candidates.length).toBeGreaterThan(exact.candidates.length);
    expect(exact.candidates).toHaveLength(1);
    expect(exact.matchedCandidateCount).toBe(1);
    expect(all.candidates.some(x=>x.sender==="Nina")).toBe(true);
  });
  it("due knowledge senza link same, rettifica e fonte stale non producono anteprima",()=>{
    const {book,link}=sample();
    expect(previewKnowledgeTransferForPair(book,"falso")).toBeNull();
    const newer=createNarrativeKnowledgeTopicDecision(book,
      link.firstKnowledgeDecisionId,link.secondKnowledgeDecisionId,
      "different_information","Le due notizie descrivono fatti diversi.",
      crypto.randomUUID(),"2026-11-08T11:05:00.000Z");
    book.narrativeKnowledgeTopicDecisions!.push(newer);
    expect(previewKnowledgeTransferForPair(book,link.id)).toBeNull();
    book.narrativeKnowledgeTopicDecisions=[link];
    book.chapters[2]!.scenes[0]!.text+=" Una riga cambiata.";
    expect(previewKnowledgeTransferForPair(book,link.id)).toBeNull();
  });
  it("se il dialogo è riaperto o draft scompare il candidato, senza mutare il link",()=>{
    const {book,link}=sample();
    const source=book.chapters[1]!;
    source.frozenAt=undefined;
    const result=previewKnowledgeTransferForPair(book,link.id)!;
    expect(result.directions.flatMap(x=>x.trace.candidates)).toEqual([]);
    source.frozenAt="2026-11-08T08:30:00.000Z";
    source.scenes[0]!.status="draft";
    expect(previewKnowledgeTransferForPair(book,link.id)!.directions
      .flatMap(x=>x.trace.candidates)).toEqual([]);
  });
});
