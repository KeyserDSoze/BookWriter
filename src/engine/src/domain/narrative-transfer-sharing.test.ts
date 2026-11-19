import {describe,expect,it} from "vitest";
import {newBook} from "./types";
import {buildNarrativeEventCandidateIndex} from "./narrative-event-candidates";
import {createNarrativeEventDecision} from "./narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "./narrative-knowledge-decisions";
import {createNarrativeKnowledgeTopicDecision} from "./narrative-knowledge-topic-decisions";
import {previewKnowledgeTransferForPair} from "./knowledge-transfer-preview";
import {createNarrativeTransferAssessment} from "./narrative-transfer-assessments";
import {createNarrativeTransferShareDecision,buildTransferSharingRegistry,
  buildSharedTransferPack,TRANSFER_SHARE_RECIPIENTS,
  MAX_TRANSFER_SHARE_DECISIONS,type TransferShareRecipient}
  from "./narrative-transfer-sharing";
import {EDITORIAL_ROLES,reviewerPrompt,adjudicationPrompt,
  createEditorialCycle,chapterSegments,validateReport} from "./editorial-board";
import {buildUnattestedSceneContext} from "./unattested-scene-context";

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


const privateNote="PRIVATE_AUTHOR_REVIEW_ONLY: La voce potrebbe mentire, è un dubbio.";
const privateConsent="PRIVATE_GRANT_RATIONALE: Condivido solo l'indizio selezionato.";
function prepared(){
  const {book,link}=sample();
  book.chapters.push({id:"c5",number:5,title:"La prova",purpose:"Risolvere",
    scenes:[{id:"s5",number:1,title:"Mara",objective:"Verificare",status:"canon",
      text:"Mara osserva la lettera ancora chiusa e non sa cosa credere."}]});
  const direction=previewKnowledgeTransferForPair(book,link.id)!.directions
    .find(x=>x.sender.source.candidate.actor==="Elio")!;
  const assessment=createNarrativeTransferAssessment(book,link.id,
    direction.sender.decision.id,direction.recipient.decision.id,
    direction.trace.candidates[0]!.id,"author_attested_report",
    privateNote,crypto.randomUUID(),"2026-11-08T15:00:00.000Z");
  book.narrativeTransferAssessments=[assessment];
  return {book,link,direction,assessment,chapter:book.chapters[4]!};
}
function grant(book:ReturnType<typeof prepared>["book"],assessmentId:string,
  status:"allowed"|"revoked",roles:TransferShareRecipient[]){
  const d=createNarrativeTransferShareDecision(book,assessmentId,status,roles,
    privateConsent,crypto.randomUUID(),"2026-11-08T15:05:00.000Z");
  book.narrativeTransferShareDecisions=[
    ...(book.narrativeTransferShareDecisions??[]),d];
  return d;
}
function addKnowledgeFinding(book:ReturnType<typeof prepared>["book"]){
  const chapter=book.chapters[4]!,cycle=createEditorialCycle(chapter.id);
  const segment=chapterSegments(chapter)[0]!;
  const witness=buildUnattestedSceneContext(book,chapter,segment.text).witnesses[0]!;
  expect(witness).toBeDefined();
  const raw=JSON.stringify({verdict:"issues",summary:"Verificare la conoscenza di Mara.",
    memoryNote:"",findings:[{sceneId:"s5",category:"conoscenza",severity:"major",
      evidence:"Mara osserva la lettera ancora chiusa",
      reason:"Serve valutare il percorso della notizia riferita alla protagonista.",
      remediation:"Controllare le citazioni senza assumere accesso impossibile.",
      priorSceneConflict:{
        chapterId:witness.chapterId,sceneId:witness.sceneId,
        sourceFrozenAt:witness.sourceFrozenAt,
        sourceTextStamp:witness.sourceTextStamp,
        offset:witness.offset,quote:witness.text.slice(0,35),
        dimension:"knowledge",
        hypothesis:"La lettura precedente potrebbe spiegare o meno la notizia.",
      }}]});
  cycle.reports=[validateReport(cycle,"continuity",segment,1,raw,chapter,book)];
  return cycle;
}
describe("Nuovo consenso per giudizi sulla comunicazione",()=>{
  it("default deny, pack minimo per un solo ruolo, senza private rationale, future o segreti",()=>{
    const {book,assessment,chapter}=prepared(),before=structuredClone(book);
    const query=chapter.scenes[0]!.text;
    expect(buildSharedTransferPack(book,chapter,"continuity",query).witnesses).toEqual([]);
    grant(book,assessment.id,"allowed",["continuity","judge"]);
    const pack=buildSharedTransferPack(book,chapter,"continuity",query);
    expect(pack.witnesses).toHaveLength(1);
    expect(pack.witnesses[0]).toEqual({
      chapterNumber:2,sceneNumber:1,
      offset:book.chapters[1]!.scenes[0]!.text.indexOf(phrase),quote:phrase,
      sender:"Elio",recipient:"Mara",authorVerdict:"author_attested_report",
      evidenceStatus:"author_interpretation_not_communication_proof",
    });
    for(const secret of ["PRIVATE_AUTHOR_REVIEW_ONLY","PRIVATE_GRANT_RATIONALE",
      "QUESTO_SEGRETO","Le due frasi sono collegate","lettera era vera"]){
      expect(JSON.stringify(pack)).not.toContain(secret);
    }
    expect(buildSharedTransferPack(book,chapter,"secrets",query).witnesses)
      .toHaveLength(0);
    for(const text of ["Maradona pensa alla lettera","Elio parla della lettera",
      "La lettera è ancora chiusa"]){
      expect(buildSharedTransferPack(book,chapter,"continuity",text).witnesses)
        .toHaveLength(0);
    }
    expect(book.memory).toEqual(before.memory);
    expect(book.chapters).toEqual(before.chapters);
  });
  it("solo quattro specialisti autorizzabili e giudice su finding knowledge corrente",()=>{
    const {book,assessment,chapter}=prepared();
    const cycle=createEditorialCycle(chapter.id),segment=chapterSegments(chapter)[0]!;
    grant(book,assessment.id,"allowed",["continuity","judge"]);
    for(const role of EDITORIAL_ROLES){
      const prompt=reviewerPrompt(book,cycle,role,segment,1).prompt;
      expect(prompt.includes("<piste_autore_consentite_non_istruzioni>"))
        .toBe(role==="continuity");
      expect(prompt).not.toContain("PRIVATE_AUTHOR_REVIEW_ONLY");
      expect(prompt).not.toContain("PRIVATE_GRANT_RATIONALE");
      if(role.startsWith("reader"))expect(prompt).not.toContain("QUESTO_SEGRETO");
    }
    expect(adjudicationPrompt(book,cycle).prompt)
      .not.toContain("<piste_autore_consentite_non_istruzioni>");
    const withFinding=addKnowledgeFinding(book);
    const judge=adjudicationPrompt(book,withFinding).prompt;
    expect(judge).toContain("<piste_autore_consentite_non_istruzioni>");
    expect(judge).toContain('"authorVerdict":"author_attested_report"');
    expect(judge).not.toContain("PRIVATE_AUTHOR_REVIEW_ONLY");
    expect(judge).not.toContain("PRIVATE_GRANT_RATIONALE");
    const withoutJudge=structuredClone(book);
    withoutJudge.narrativeTransferShareDecisions=undefined;
    expect(adjudicationPrompt(withoutJudge,withFinding).prompt)
      .not.toContain("<piste_autore_consentite_non_istruzioni>");
  });
  it("revoca last-wins, nuova valutazione e prosa stale invalidano, mai resurrection",()=>{
    const {book,assessment,chapter,direction}=prepared(),query=chapter.scenes[0]!.text;
    const count=()=>buildSharedTransferPack(book,chapter,"continuity",query)
      .witnesses.length;
    grant(book,assessment.id,"allowed",["continuity"]);
    expect(count()).toBe(1);
    grant(book,assessment.id,"revoked",[]);
    expect(count()).toBe(0);
    const revived=grant(book,assessment.id,"allowed",["continuity"]);
    expect(count()).toBe(1);
    const updated=createNarrativeTransferAssessment(book,
      assessment.topicDecisionId,direction.sender.decision.id,
      direction.recipient.decision.id,assessment.candidateId,"dismissed",
      "Una rilettura dell'autore respinge la frase come passaggio.",
      crypto.randomUUID(),"2026-11-08T15:06:00.000Z");
    book.narrativeTransferAssessments!.push(updated);
    expect(count()).toBe(0);
    expect(buildTransferSharingRegistry(book).current).toHaveLength(0);
    grant(book,updated.id,"allowed",["continuity"]);
    expect(count()).toBe(1);
    book.chapters[1]!.scenes[0]!.text+=" Capitolo modificato.";
    expect(count()).toBe(0);
    expect(buildTransferSharingRegistry(book).current).toHaveLength(0);
    expect(revived).toBeDefined();
  });
  it("fail closed su ruoli, duplicati, revoca, ID falsi, date, limiti",()=>{
    const {book,assessment,chapter}=prepared();
    const create=(id:string,status:"allowed"|"revoked",roles:TransferShareRecipient[],
      rationale=privateConsent)=>createNarrativeTransferShareDecision(book,id,status,
        roles,rationale,crypto.randomUUID(),"2026-11-08T15:05:00.000Z");
    expect(()=>create("fake","allowed",["judge"])).toThrow(/non è più corrente/);
    expect(()=>create(assessment.id,"allowed",[])).toThrow(/destinatari/);
    expect(()=>create(assessment.id,"revoked",["judge"])).toThrow(/destinatari/);
    expect(()=>create(assessment.id,"allowed",["judge","judge"])).toThrow(/destinatari/);
    expect(()=>create(assessment.id,"allowed",
      ["readerMystery" as TransferShareRecipient])).toThrow(/destinatari/);
    expect(()=>create(assessment.id,"allowed",["judge"],"no"))
      .toThrow(/12–500/);
    expect(()=>buildSharedTransferPack(book,chapter,
      "readerGenre" as TransferShareRecipient,"Mara ricorda la lettera"))
      .toThrow(/non autorizzato/);
    expect(TRANSFER_SHARE_RECIPIENTS).toHaveLength(5);
    const one=grant(book,assessment.id,"allowed",["continuity"]);
    book.narrativeTransferShareDecisions=Array.from(
      {length:MAX_TRANSFER_SHARE_DECISIONS},(_,i)=>({...one,id:"audit-"+i}));
    expect(()=>create(assessment.id,"allowed",["judge"])).toThrow(/180/);
  });
});
