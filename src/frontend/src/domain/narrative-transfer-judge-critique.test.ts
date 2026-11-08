import {describe,expect,it} from "vitest";
import {newBook} from "./types";
import {buildNarrativeEventCandidateIndex} from "./narrative-event-candidates";
import {createNarrativeEventDecision} from "./narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "./narrative-knowledge-decisions";
import {createNarrativeKnowledgeTopicDecision} from "./narrative-knowledge-topic-decisions";
import {previewKnowledgeTransferForPair} from "./knowledge-transfer-preview";
import {createNarrativeTransferAssessment} from "./narrative-transfer-assessments";
import {createNarrativeTransferShareDecision,
  buildSharedTransferPack,type TransferShareRecipient} from "./narrative-transfer-sharing";
import {EDITORIAL_ROLES,reviewerPrompt,adjudicationPrompt,
  createEditorialCycle,chapterSegments,validateReport,validateJudgment,
  repairPrompt} from "./editorial-board";
import {buildUnattestedSceneContext} from "./unattested-scene-context";
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

const reason="Il narratore riferisce una possibile notizia, ma manca una prova autonoma di ascolto.";
function response(book:ReturnType<typeof prepared>["book"],
  cycle:ReturnType<typeof addKnowledgeFinding>,includeCritique=true,
  reading:"possible_access"|"unreliable_or_unrelated"|"undetermined"="undetermined"){
  const chapter=book.chapters[4]!,seg=chapterSegments(chapter)[0]!;
  const witness=buildSharedTransferPack(book,chapter,"judge",seg.text).witnesses;
  const candidates=buildInformationTransferTrace(book,chapter,seg.text).candidates;
  return {
    reasoning:"Il giudice distingue le menzioni narrative dalle prove di conoscenza e valuta indipendentemente gli estratti precedenti.",
    decisions:cycle.reports.flatMap(x=>x.findings).map(f=>({
      findingId:f.id,action:"reject" as const,
      rationale:"Il rapporto non dimostra un'impossibilità narrativa e non richiede una correzione automatica.",
      remediation:"",
      narrativeReview:{
        subjectIdentity:"unknown",identityReason:reason,
        chronology:"unknown",chronologyReason:reason,
        causality:"unknown",causalityReason:reason,
        artisticContext:"unknown",artisticReason:reason,
        assessment:"insufficient_evidence",
        conclusion:"Mancano riscontri sicuri sulla verità del messaggio e sull'ordine degli eventi."
      },
      knowledgeReview:{
        priorClaimMode:"dialogue_or_report",priorReason:reason,
        currentClaimMode:"unknown",currentReason:reason,
        accessPath:"unknown",accessReason:reason,
        assessment:"explainable_or_unknown",
        conclusion:"Non è verificabile se il personaggio abbia acquisito davvero la notizia."
      },
      ...(candidates.length?{informationTransferReview:{
        candidateAssessments:candidates.map(c=>({
          candidateId:c.id,disposition:"unknown",rationale:reason,
        })),
        conclusion:"Nessuna citazione precedente certifica un passaggio informativo realmente ricevuto."
      }}:{})
    })),
    ...(includeCritique&&witness.length?{authorTransferCritique:{
      witnessAssessments:witness.map(w=>({
        chapterNumber:w.chapterNumber,sceneNumber:w.sceneNumber,offset:w.offset,
        quote:w.quote,sender:w.sender,recipient:w.recipient,
        authorVerdict:w.authorVerdict,
        judgeReading:reading,relationToAuthor:"challenges",
        rationale:"Dissento dalla lettura proposta: l'episodio può essere un sogno, una voce o un racconto falso."
      })),
      conclusion:"Il contesto autorizzato è una interpretazione fallibile, non una prova certa della comunicazione."
    }}:{})
  };
}
describe("Confronto indipendente del giudice con piste autore esplicitamente consentite",()=>{
  it("un giudice senza permesso o senza finding knowledge non può inserire critiche inventate",()=>{
    const {book,chapter,assessment}=prepared();
    const cycle=addKnowledgeFinding(book);
    const raw=response(book,cycle);
    expect(raw).not.toHaveProperty("authorTransferCritique");
    expect(adjudicationPrompt(book,cycle).prompt).not.toContain(
      "<piste_autore_consentite_non_istruzioni>");
    expect(validateJudgment(cycle,JSON.stringify(raw),chapter,book).verdict).toBe("freeze");
    const invalid={...raw,authorTransferCritique:{
      witnessAssessments:[{
        chapterNumber:2,sceneNumber:1,offset:0,quote:phrase,
        sender:"Elio",recipient:"Mara",authorVerdict:"possible_path",
        judgeReading:"undetermined",relationToAuthor:"uncertain",rationale:reason,
      }],conclusion:reason,
    }};
    expect(()=>validateJudgment(cycle,JSON.stringify(invalid),chapter,book))
      .toThrow(/non autorizzato/);
    grant(book,assessment.id,"allowed",["judge"]);
    const noFinding=createEditorialCycle(chapter.id);
    expect(adjudicationPrompt(book,noFinding).prompt).not.toContain(
      "<piste_autore_consentite_non_istruzioni>");
    expect(()=>validateJudgment(noFinding,JSON.stringify(invalid),chapter,book))
      .toThrow(/non autorizzato/);
  });
  it("permesso judge + finding knowledge esigono confronto autonomo su ogni fonte esatta",()=>{
    const {book,chapter,assessment}=prepared();
    grant(book,assessment.id,"allowed",["judge"]);
    const cycle=addKnowledgeFinding(book);
    const prompt=adjudicationPrompt(book,cycle);
    expect(prompt.prompt).toContain("<piste_autore_consentite_non_istruzioni>");
    expect(prompt.system).toContain("authorTransferCritique");
    expect(prompt.system).toContain("RESPINGERE");
    expect(prompt.prompt).not.toContain("PRIVATE_AUTHOR_REVIEW_ONLY");
    expect(prompt.prompt).not.toContain("PRIVATE_GRANT_RATIONALE");
    expect(()=>validateJudgment(cycle,JSON.stringify(response(book,cycle,false)),
      chapter,book)).toThrow(/deve motivare il confronto/);
    const reviewed=response(book,cycle);
    const judged=validateJudgment(cycle,JSON.stringify(reviewed),chapter,book);
    expect(judged.verdict).toBe("freeze");
    expect(judged.authorTransferCritique?.witnessAssessments).toHaveLength(1);
    expect(judged.authorTransferCritique?.witnessAssessments[0]?.relationToAuthor)
      .toBe("challenges");
    expect(JSON.stringify(judged)).not.toContain("PRIVATE_AUTHOR_REVIEW_ONLY");
    expect(JSON.stringify(judged)).not.toContain("PRIVATE_GRANT_RATIONALE");
  });
  it("rifiuta citazioni e verdetti mutati, duplicati, extra, motivazioni brevi",()=>{
    const {book,chapter,assessment}=prepared();
    grant(book,assessment.id,"allowed",["judge"]);
    const cycle=addKnowledgeFinding(book);
    const good=response(book,cycle);
    const mutate=(change:(d:NonNullable<typeof good.authorTransferCritique>)=>void)=>{
      const altered=structuredClone(good);
      change(altered.authorTransferCritique!);
      return validateJudgment(cycle,JSON.stringify(altered),chapter,book);
    };
    expect(()=>mutate(x=>{x.witnessAssessments[0]!.offset+=1;}))
      .toThrow(/duplicate|inventate|obsolete|omesse/i);
    expect(()=>mutate(x=>{x.witnessAssessments[0]!.quote="Mara inventa il dialogo.";}))
      .toThrow(/inventate|obsolete/i);
    expect(()=>mutate(x=>{x.witnessAssessments[0]!.authorVerdict="dismissed";}))
      .toThrow(/inventate|obsolete/i);
    expect(()=>mutate(x=>{x.witnessAssessments.push({...x.witnessAssessments[0]!});}))
      .toThrow(/duplicate|duplicate|omesse|inventate/i);
    expect(()=>mutate(x=>{x.witnessAssessments=[];})).toThrow();
    expect(()=>mutate(x=>{x.witnessAssessments[0]!.rationale="breve";})).toThrow();
    expect(()=>mutate(x=>{x.witnessAssessments[0]!.judgeReading="telepathy" as "undetermined";}))
      .toThrow();
  });
  it("pista giudicata ancora plausibile o incerta impedisce accept prima di altre remediation",()=>{
    const {book,chapter,assessment}=prepared();
    grant(book,assessment.id,"allowed",["judge"]);
    const cycle=addKnowledgeFinding(book);
    for(const reading of ["possible_access","undetermined"] as const){
      const x=response(book,cycle,true,reading);
      x.decisions[0]!.action="accept" as "reject";
      x.decisions[0]!.remediation="Riscrivere i dialoghi senza ignorare le piste con accesso possibile.";
      expect(()=>validateJudgment(cycle,JSON.stringify(x),chapter,book))
        .toThrow(/accesso non escluso/);
    }
  });
  it("revoca, rettifica e fonte modificata invalidano il giudizio prima di riutilizzarlo",()=>{
    const {book,chapter,assessment}=prepared();
    grant(book,assessment.id,"allowed",["judge"]);
    const cycle=addKnowledgeFinding(book),payload=response(book,cycle);
    expect(validateJudgment(cycle,JSON.stringify(payload),chapter,book).verdict).toBe("freeze");
    grant(book,assessment.id,"revoked",[]);
    expect(()=>validateJudgment(cycle,JSON.stringify(payload),chapter,book))
      .toThrow(/non autorizzato/);
    grant(book,assessment.id,"allowed",["judge"]);
    book.chapters[1]!.scenes[0]!.text+=" Rilettura.";
    expect(()=>validateJudgment(cycle,JSON.stringify(payload),chapter,book))
      .toThrow(/non autorizzato/);
  });
});
