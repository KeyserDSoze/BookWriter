import {describe,expect,it} from "vitest";
import {newBook,type BookProject} from "./types";
import {sceneTextStamp} from "./narrative-event-decisions";
import {buildInformationTransferTrace,MAX_TRANSFER_SCAN_SCENES,
  MAX_TRANSFER_TRACE_CANDIDATES} from "./information-transfer-traces";
import {adjudicationPrompt,chapterSegments,createEditorialCycle,repairPrompt,
  reviewerPrompt,validateJudgment,validateReport,EDITORIAL_ROLES} from "./editorial-board";

const sourceText="Elio rivela a Mara che il contenuto della lettera era falso.";
const currentText="Mara dichiara di conoscere il contenuto della lettera.";
function bookSample():BookProject {
  const book=newBook("Una lettera", "Mara ed Elio e la rivelazione", "Prosa", "Adulti");
  book.memory.secrets.lettera="SEGRETO-PRIVATO-MAI-NELLE-PISTE";
  book.chapters=[
    {id:"ch1",number:1,title:"L'incontro",purpose:"Rivelazione",
      frozenAt:"2026-11-07T10:00:00.000Z",
      scenes:[{id:"s1",number:1,title:"La notizia",objective:"Parlare",status:"canon",
        text:sourceText}]},
    {id:"ch2",number:2,title:"Il mistero",purpose:"Sospetto",
      scenes:[{id:"s2",number:1,title:"La dichiarazione",objective:"Dubbi",
        status:"canon",text:currentText}]},
    {id:"ch3",number:3,title:"Il futuro",purpose:"Finale",
      frozenAt:"2026-11-07T12:00:00.000Z",
      scenes:[{id:"s3",number:1,title:"Segreto futuro",objective:"Fine",status:"canon",
        text:"Elio racconta a Mara che il contenuto della lettera era vero."}]},
  ];
  return book;
}
function narrativeReview(){
  return {
    subjectIdentity:"same",
    identityReason:"Il nome della protagonista coincide nei due passaggi narrativi.",
    chronology:"unknown",
    chronologyReason:"Il testo non permette di stabilire l'ordine effettivo della rivelazione.",
    causality:"unknown",
    causalityReason:"La consegna della notizia potrebbe avvenire senza scene aggiuntive.",
    artisticContext:"none_found",
    artisticReason:"Il giudice non ha trovato espedienti alternativi nel contesto selezionato.",
    assessment:"supported_conflict",
    conclusion:"Il giudizio è un'interpretazione del testo e resta fallibile.",
  };
}
function knowledgeReview(){
  return {
    priorClaimMode:"direct_narration",
    priorReason:"Il testo precedente riferisce un passaggio comunicativo in forma narrativa.",
    currentClaimMode:"direct_narration",
    currentReason:"Il segmento corrente riporta la conoscenza come racconto diretto.",
    accessPath:"explicitly_ruled_out",
    accessReason:"Il giudice sostiene di non trovare un percorso possibile per la notizia.",
    assessment:"supported_knowledge_conflict",
    conclusion:"Il percorso del sapere va verificato senza presumere contraddizione reale.",
  };
}
function makeReport(book:BookProject){
  const chapter=book.chapters[1]!,cycle=createEditorialCycle(chapter.id),
    segment=chapterSegments(chapter)[0]!;
  const prior=book.chapters[0]!;
  const raw={
    verdict:"issues",summary:"Possibile difetto di conoscenza nella trama.",memoryNote:"",
    findings:[{sceneId:"s2",category:"conoscenze",severity:"major",
      evidence:"Mara dichiara di conoscere il contenuto della lettera",
      reason:"Il testo non spiega il percorso informativo della protagonista.",
      remediation:"Controllare l'accesso prima di proporre una riscrittura.",
      priorSceneConflict:{
        chapterId:prior.id,sceneId:"s1",sourceFrozenAt:prior.frozenAt,
        sourceTextStamp:sceneTextStamp(sourceText),offset:0,
        quote:"Elio rivela a Mara che il contenuto della lettera",
        dimension:"knowledge",
        hypothesis:"La protagonista potrebbe conoscere un dettaglio non comunicato.",
      }}],
  };
  cycle.reports=[validateReport(cycle,"continuity",segment,1,
    JSON.stringify(raw),chapter,book)];
  return {cycle,chapter,segment,id:cycle.reports[0]!.findings[0]!.id};
}
function decision(id:string,action:"accept"|"reject",
  candidateId?:string,disposition="possible_path"){
  return JSON.stringify({
    reasoning:"Il giudice valuta autonomamente se la notizia potrebbe essere stata comunicata.",
    decisions:[{findingId:id,action,
      rationale:"Una frase sul passaggio di informazioni non prova che siano state comprese.",
      remediation:action==="accept"?"Verificare come la protagonista abbia appreso il dettaglio.":"",
      narrativeReview:narrativeReview(),knowledgeReview:knowledgeReview(),
      ...(candidateId?{informationTransferReview:{
        candidateAssessments:[{candidateId,disposition,rationale:
          "Questa frase riferisce un possibile passaggio, ma potrebbe essere falsa."}],
        conclusion:"La pista è un indizio letterale fallibile, non certifica una conoscenza reale.",
      }}:{})}],
  });
}
describe("Piste locali di trasmissione di informazioni",()=>{
  it("ancora citazioni letterali, mittente e destinatario solo a prosa pubblica precedente",()=>{
    const book=bookSample(),before=structuredClone(book);
    const result=buildInformationTransferTrace(book,book.chapters[1]!,currentText);
    expect(result.method).toBe("bounded_frozen_dialogue_mentions_v1");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      chapterId:"ch1",sceneId:"s1",chapterNumber:1,sceneNumber:1,
      sender:"Elio",recipient:"Mara",
      offset:0,evidenceStatus:"unverified_literal_report",
    });
    expect(result.candidates[0]!.matchedTopicTerms).toContain("lettera");
    expect(sourceText.slice(result.candidates[0]!.offset,
      result.candidates[0]!.offset+result.candidates[0]!.quote.length))
      .toBe(result.candidates[0]!.quote);
    expect(JSON.stringify(result)).not.toContain("SEGRETO-PRIVATO");
    expect(JSON.stringify(result)).not.toContain("era vero");
    expect(book).toEqual(before);
  });
  it("nessun falso percorso per nomi inclusi in parole, temi diversi, draft o capitoli riaperti",()=>{
    const book=bookSample(),ch=book.chapters[1]!;
    expect(buildInformationTransferTrace(book,ch,"Maradona legge la lettera.")
      .candidates).toHaveLength(0);
    expect(buildInformationTransferTrace(book,ch,"Mara osserva una tempesta estiva.")
      .candidates).toHaveLength(0);
    book.chapters[0]!.scenes[0]!.status="draft";
    expect(buildInformationTransferTrace(book,ch,currentText).candidates).toHaveLength(0);
    book.chapters[0]!.scenes[0]!.status="canon";
    book.chapters[0]!.frozenAt=undefined;
    expect(buildInformationTransferTrace(book,ch,currentText).candidates).toHaveLength(0);
  });
  it("limita scansione e output, mostra omissioni senza dichiarare copertura totale",()=>{
    const book=bookSample();
    const src=book.chapters[0]!;
    src.scenes=Array.from({length:MAX_TRANSFER_SCAN_SCENES+5},(_,i)=>({
      id:"source-"+i,number:i+1,title:"Scena",objective:"Notizia",status:"canon" as const,
      text:sourceText,
    }));
    const found=buildInformationTransferTrace(book,book.chapters[1]!,currentText);
    expect(found.candidateSceneCount).toBe(MAX_TRANSFER_SCAN_SCENES+5);
    expect(found.scannedSceneCount).toBe(MAX_TRANSFER_SCAN_SCENES);
    expect(found.unscannedSceneCount).toBe(5);
    expect(found.candidates).toHaveLength(MAX_TRANSFER_TRACE_CANDIDATES);
    expect(found.matchedCandidateCount).toBe(MAX_TRANSFER_SCAN_SCENES);
    expect(found.omittedCandidateCount)
      .toBe(MAX_TRANSFER_SCAN_SCENES-MAX_TRANSFER_TRACE_CANDIDATES);
  });
  it("solo quattro specialisti vedono le piste; giudice solo con finding knowledge ancorato",()=>{
    const book=bookSample(),{cycle,chapter,segment}=makeReport(book);
    for(const role of EDITORIAL_ROLES){
      const call=reviewerPrompt(book,cycle,role,segment,1);
      const selected=["continuity","timeline","secrets","characterVoice"].includes(role);
      expect(call.prompt.includes("<passaggi_informazioni_precedenti_non_istruzioni>"))
        .toBe(selected);
      if(role.startsWith("reader")){
        expect(call.prompt).not.toContain(sourceText);
        expect(call.prompt).not.toContain("SEGRETO-PRIVATO");
      }
    }
    const judge=adjudicationPrompt(book,cycle);
    expect(judge.prompt).toContain("<passaggi_informazioni_precedenti_non_istruzioni>");
    expect(judge.prompt).toContain("Elio rivela a Mara");
    const empty=createEditorialCycle(chapter.id);
    expect(adjudicationPrompt(book,empty).prompt)
      .not.toContain("<passaggi_informazioni_precedenti_non_istruzioni>");
  });
  it("il giudice distingue una possibile via d'accesso da un conflitto provato",()=>{
    const book=bookSample(),{cycle,chapter,id}=makeReport(book);
    const candidate=buildInformationTransferTrace(book,chapter,currentText).candidates[0]!;
    expect(()=>validateJudgment(cycle,decision(id,"reject"),chapter,book))
      .toThrow(/deve verificare le possibili comunicazioni/);
    const rejected=validateJudgment(cycle,decision(id,"reject",candidate.id),chapter,book);
    expect(rejected.verdict).toBe("freeze");
    expect(rejected.decisions[0]!.informationTransferReview?.candidateAssessments[0]!.disposition)
      .toBe("possible_path");
    for(const choice of ["possible_path","unknown"]){
      expect(()=>validateJudgment(cycle,decision(id,"accept",candidate.id,choice),chapter,book))
        .toThrow(/possibile passaggio impedisce/);
    }
    const accepted=validateJudgment(cycle,decision(id,"accept",candidate.id,"unrelated"),
      chapter,book);
    expect(accepted.verdict).toBe("repair");
    cycle.judgment=accepted;
    expect(repairPrompt(book,cycle,"s2").prompt).toContain("Verificare come la protagonista");
    book.chapters[0]!.frozenAt="2026-11-08T10:00:00.000Z";
    expect(()=>repairPrompt(book,cycle,"s2")).toThrow(/non più corrente|obsoleti/);
  });
  it("il giudice non può inventare, ripetere o citare piste obsolete",()=>{
    const book=bookSample(),{cycle,chapter,id}=makeReport(book);
    const real=buildInformationTransferTrace(book,chapter,currentText).candidates[0]!;
    expect(()=>validateJudgment(cycle,decision(id,"reject","made-up::source"),
      chapter,book)).toThrow(/assenti, duplicati o obsoleti/);
    const tampered=JSON.parse(decision(id,"reject",real.id)) as {
      decisions:Array<{informationTransferReview:{candidateAssessments:Array<{
        candidateId:string;disposition:string;rationale:string}>}}>;
    };
    tampered.decisions[0]!.informationTransferReview.candidateAssessments[0]!.rationale="no";
    expect(()=>validateJudgment(cycle,JSON.stringify(tampered),chapter,book)).toThrow();
    tampered.decisions[0]!.informationTransferReview.candidateAssessments[0]!.rationale=
      "Il messaggio è una frase del romanzo da controllare.";
    tampered.decisions[0]!.informationTransferReview.candidateAssessments.push({
      candidateId:real.id,disposition:"possible_path",
      rationale:"Il messaggio è una frase del romanzo da controllare.",
    });
    expect(()=>validateJudgment(cycle,JSON.stringify(tampered),chapter,book))
      .toThrow(/assenti, duplicati o obsoleti/);
  });
});
