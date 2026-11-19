import {describe,expect,it} from "vitest";
import {newBook} from "./types";
import {
  chapterSegments,createEditorialCycle,validateReport,validateJudgment,
  reviewerPrompt,adjudicationPrompt,EDITORIAL_ROLES,
  type EditorialRole,type ChapterEditorialCycle,
} from "./editorial-board";
import {
  buildEditorialDiffLedger,MAX_EDITORIAL_LEDGER_CANDIDATES,
  MAX_EDITORIAL_LEDGER_THREADS,MAX_EDITORIAL_LEDGER_OBSERVATIONS,
} from "./editorial-diff-ledger";

const quote="Mara trova una lettera dietro la porta";
const text=quote+". Elio osserva in silenzio e non spiega il contenuto.";
const reason="Il ritmo narrativo potrebbe essere migliorato, ma la scena resta ambigua.";
const explanation="Le due proposte riguardano lo stesso testo, ma il giudice deve ragionare senza votazioni automatiche.";
const missing="Manca un'indicazione dell'autore sul ritmo e sul punto di vista desiderati.";
const check="Chiedere all'autore se mantenere il mistero o chiarire il dettaglio nel dialogo.";
function setup(){
  const book=newBook("Una lettera","Mistero di Mara","Prosa","Adulti");
  book.chapters=[{id:"c1",number:1,title:"Un segreto",purpose:"Mistero",
    scenes:[{id:"s1",number:1,title:"La porta",objective:"Sorpresa",
      text,status:"canon"}]}];
  const chapter=book.chapters[0]!,cycle=createEditorialCycle(chapter.id);
  book.editorialCycle=cycle;
  return {book,chapter,cycle};
}
function add(book:ReturnType<typeof setup>["book"],cycle:ChapterEditorialCycle,
  role:EditorialRole,remediation:string,category="ritmo"){
  const chapter=book.chapters[0]!,segment=chapterSegments(chapter)[0]!;
  const report=validateReport(cycle,role,segment,1,JSON.stringify({
    verdict:"issues",summary:"Il controllo trova un punto narrativo da valutare.",
    memoryNote:"",findings:[{
      sceneId:"s1",category,severity:"major",evidence:quote,reason,remediation,
    }],
  }),chapter,book);
  cycle.reports.push(report);
  return report.findings[0]!.id;
}
function makeDisagreement(){
  const {book,chapter,cycle}=setup();
  const a=add(book,cycle,"style","Accorciare la frase mantenendo il riferimento.");
  const b=add(book,cycle,"narrative","Allungare la pausa per amplificare il mistero.");
  return {book,chapter,cycle,a,b};
}
function decide(cycle:ChapterEditorialCycle,chapter:ReturnType<typeof setup>["chapter"],
  book:ReturnType<typeof setup>["book"],a:string,b:string,
  outcome:"needs_evidence"|"approved_edit"|"closed_no_edit"){
  const accept=outcome==="approved_edit";
  const judgment=validateJudgment(cycle,JSON.stringify({
    reasoning:"Il direttore deve valutare i suggerimenti distinti senza dedurre nulla dalla sola citazione.",
    decisions:[a,b].map(id=>({
      findingId:id,action:accept&&id===a?"accept":"reject",
      rationale:"La scena richiede una scelta consapevole sul ritmo senza presupporre errori di fatto.",
      remediation:accept&&id===a?"Rendere il periodo più conciso senza cancellare l'ambiguità.":"",
    })),
    recommendationReconciliations:[{
      findingIds:[b,a],
      resolution:accept?"choose_one":"reject_all",
      evidenceAssessment:outcome==="needs_evidence"
        ?"unresolved":"adequate_for_selected_edits",
      rationale:explanation,missingEvidence:missing,nextCheck:check,
    }],
  }),chapter,book);
  cycle.judgment=judgment;
}

function withArchive(){
  const {book,chapter,cycle,a,b}=makeDisagreement();
  decide(cycle,chapter,book,a,b,"needs_evidence");
  chapter.editorialRounds=[{
    round:cycle.round,reports:structuredClone(cycle.reports),
    judgment:structuredClone(cycle.judgment!),
  }];
  cycle.priorRounds=[];
  cycle.reports=[];
  cycle.judgment=undefined;
  return {book,chapter,cycle};
}
function addCurrent(book:ReturnType<typeof withArchive>["book"],
  cycle:ChapterEditorialCycle){
  const a=add(book,cycle,"style","Rendere più breve la frase narrativa.");
  const b=add(book,cycle,"narrative","Conservare il ritmo lento per aumentare il mistero.");
  return {a,b};
}
function addHistoricalRound(chapter:ReturnType<typeof withArchive>["chapter"],
  times=1){
  const original=structuredClone(chapter.editorialRounds![0]!);
  chapter.editorialRounds=Array.from({length:times},
    ()=>structuredClone(original));
}
describe("Registro locale delle differenze editoriali fra più tornate",()=>{
  it("vuoto senza dati: non inventa dubbi, attività o permessi",()=>{
    const {book,chapter}=setup();
    const before=JSON.stringify(book);
    expect(buildEditorialDiffLedger(book,chapter)).toMatchObject({
      method:"local_editorial_diff_ledger_v1",
      totalHistoricalUnresolved:0,threads:[],currentGroupsCompared:0,
      omittedThreads:0,omittedCandidateObservations:0,
    });
    expect(JSON.stringify(book)).toBe(before);
  });
  it("ordina archivi e revisione corrente; nessun trasferimento delle note",()=>{
    const {book,chapter,cycle}=withArchive();
    addHistoricalRound(chapter,2);
    book.editorialVerificationChoices=[{
      id:"private",chapterId:"c1",planKey:"frozen:fake",
      round:1,quote,missingEvidence:missing,nextCheck:check,
      judgeExplanation:explanation,status:"taken_on",
      rationale:"SEGRETO_AUTORE_PRIVATO: prendere in carico con cautela.",
      decidedAt:"2026-11-08T18:00:00.000Z",
    }];
    const {a,b}=addCurrent(book,cycle);
    decide(cycle,chapter,book,a,b,"needs_evidence");
    const before=JSON.stringify(book);
    const ledger=buildEditorialDiffLedger(book,chapter);
    expect(ledger).toMatchObject({
      totalHistoricalUnresolved:2,currentGroupsCompared:1,
      totalThreads:1,omittedCandidateObservations:0,
      currentReportCount:2,hasCurrentReview:true,
    });
    expect(ledger.threads[0]).toMatchObject({
      literalOnly:true,ambiguousOccurrences:false,
      observedInCurrentSample:true,totalObservations:3,
    });
    expect(ledger.threads[0]!.observations.map(x=>x.source))
      .toEqual(["archive","archive","current"]);
    expect(ledger.threads[0]!.observations.map(x=>x.textChange))
      .toEqual([
        "first_literal_witness","same_literal_position","same_literal_position",
      ]);
    expect(ledger.threads[0]!.observations.map(x=>x.checkChange))
      .toEqual(["first_suggestion","same_suggestion_words","same_suggestion_words"]);
    expect(ledger.threads[0]!.observations[2]).toMatchObject({
      provenance:"current_validated",currentStatus:"needs_evidence",
      missingEvidence:missing,nextCheck:check,
    });
    expect(JSON.stringify(ledger)).not.toContain("SEGRETO_AUTORE_PRIVATO");
    expect(JSON.stringify(book)).toBe(before);
    const segment=chapterSegments(chapter)[0]!;
    for(const role of EDITORIAL_ROLES)
      expect(reviewerPrompt(book,cycle,role,segment,1).prompt)
        .not.toContain("SEGRETO_AUTORE_PRIVATO");
    expect(adjudicationPrompt(book,cycle).prompt)
      .not.toContain("SEGRETO_AUTORE_PRIVATO");
  });
  it("tornate precedenti del ciclo, anche con numero ripetuto, rimangono storiche",()=>{
    const {book,chapter,cycle}=withArchive();
    cycle.priorRounds=[structuredClone(chapter.editorialRounds![0]!)];
    addCurrent(book,cycle);
    const ledger=buildEditorialDiffLedger(book,chapter);
    expect(ledger.threads[0]!.observations.map(x=>x.source))
      .toEqual(["archive","prior_round","current"]);
    expect(ledger.threads[0]!.observations[2]).toMatchObject({
      provenance:"current_awaiting_judge",
    });
    expect(ledger.threads[0]!.observations[2]!.currentStatus).toBeUndefined();
    expect(ledger.threads[0]!.observations[2]!.nextCheck).toBeUndefined();
  });
  it("nuovo suggerimento riformulato, solo parole e non esito del dubbio",()=>{
    const {book,chapter,cycle}=withArchive();
    const {a,b}=addCurrent(book,cycle);
    decide(cycle,chapter,book,a,b,"needs_evidence");
    cycle.judgment!.recommendationReconciliations![0]!.nextCheck=
      "Rileggere il dialogo considerando la relazione tra due personaggi.";
    const ledger=buildEditorialDiffLedger(book,chapter);
    expect(ledger.threads[0]!.observations[1]).toMatchObject({
      checkChange:"different_suggestion_words",
      textChange:"same_literal_position",provenance:"current_validated",
    });
    expect(ledger.threads[0]!.observations[1]!.nextCheck)
      .not.toBe(check);
  });
  it("fonte spostata nella scena: citazione candidata, nessuna identità semantica",()=>{
    const {book,chapter,cycle}=withArchive();
    chapter.scenes[0]!.text="Un rumore improvviso. "+text;
    addCurrent(book,cycle);
    const ledger=buildEditorialDiffLedger(book,chapter);
    expect(ledger.totalThreads).toBe(1);
    expect(ledger.threads[0]!.observations[1]).toMatchObject({
      provenance:"current_awaiting_judge",
      textChange:"moved_literal_position",
      checkChange:"new_judge_not_available",
    });
  });
  it("se nessun nuovo gruppo cita la frase NON inferisce risoluzione",()=>{
    const {book,chapter}=withArchive();
    const ledger=buildEditorialDiffLedger(book,chapter);
    expect(ledger.threads[0]).toMatchObject({
      observedInCurrentSample:false,totalObservations:1,
    });
    expect(ledger.hasCurrentReview).toBe(true);
    expect(ledger.currentGroupsCompared).toBe(0);
  });
  it("il gruppo nuovo richiede judgment interamente valido",()=>{
    const {book,chapter,cycle}=withArchive();
    const {a,b}=addCurrent(book,cycle);
    decide(cycle,chapter,book,a,b,"approved_edit");
    const first=buildEditorialDiffLedger(book,chapter)
      .threads[0]!.observations[1]!;
    expect(first).toMatchObject({
      currentStatus:"approved_edit",provenance:"current_validated",
    });
    cycle.judgment!.decisions[0]!.findingId="decisione-senza-prova";
    const second=buildEditorialDiffLedger(book,chapter)
      .threads[0]!.observations[1]!;
    expect(second).toMatchObject({provenance:"current_unvalidated",
      checkChange:"not_comparable"});
    expect(second.currentStatus).toBeUndefined();
    expect(second.nextCheck).toBeUndefined();
  });
  it("due prove sullo stesso testo in una tornata: ambiguità esplicita",()=>{
    const {book,chapter}=withArchive();
    const copy=structuredClone(chapter.editorialRounds![0]!);
    copy.judgment.recommendationReconciliations!.push(
      {...structuredClone(copy.judgment.recommendationReconciliations![0]!),
        rationale:"Secondo controllo parallelo, non identico per intento."});
    chapter.editorialRounds=[copy];
    const ledger=buildEditorialDiffLedger(book,chapter);
    expect(ledger.threads[0]!.ambiguousOccurrences).toBe(true);
    expect(ledger.threads[0]!.observations.map(x=>x.textChange))
      .toEqual(["ambiguous_literal_witness","ambiguous_literal_witness"]);
    expect(ledger.threads[0]!.observations.every(x=>
      x.checkChange==="not_comparable")).toBe(true);
  });
  it("vecchio report senza anchor resta separato, senza finta identità",()=>{
    const {book,chapter,cycle}=withArchive();
    chapter.editorialRounds![0]!.reports[0]!.findings[0]!.evidenceAnchor=undefined;
    addCurrent(book,cycle);
    const ledger=buildEditorialDiffLedger(book,chapter);
    expect(ledger.totalThreads).toBe(2);
    expect(ledger.threads.flatMap(x=>x.observations)
      .some(x=>x.provenance==="archived_unverifiable")).toBe(true);
    expect(ledger.threads.flatMap(x=>x.observations).some(x=>
      x.provenance==="archived_unverifiable"&&x.nextCheck!==undefined))
      .toBe(false);
  });
  it("frozen: archivio leggibile ma nessun nuovo stato o confronto attivo",()=>{
    const {book,chapter,cycle}=withArchive();
    addCurrent(book,cycle);
    chapter.frozenAt="2026-11-08T20:00:00.000Z";
    const ledger=buildEditorialDiffLedger(book,chapter);
    expect(ledger.hasCurrentReview).toBe(false);
    expect(ledger.currentGroupsCompared).toBe(0);
    expect(ledger.threads[0]!.observedInCurrentSample).toBe(false);
  });
  it("bounded su 240 candidati, 12 serie, 8 osservazioni e conteggi espliciti",()=>{
    const {book,chapter}=withArchive();
    addHistoricalRound(chapter,MAX_EDITORIAL_LEDGER_CANDIDATES+1);
    const ledger=buildEditorialDiffLedger(book,chapter);
    expect(ledger.totalHistoricalUnresolved).toBe(241);
    expect(ledger.omittedCandidateObservations).toBe(1);
    expect(ledger.threads[0]!.totalObservations).toBe(240);
    expect(ledger.threads[0]!.observations).toHaveLength(
      MAX_EDITORIAL_LEDGER_OBSERVATIONS);
    expect(ledger.threads[0]!.omittedObservations).toBe(232);
    const original=structuredClone(chapter.editorialRounds![0]!);
    chapter.editorialRounds=Array.from({length:MAX_EDITORIAL_LEDGER_THREADS+2},
      (_,i)=>{
        const round=structuredClone(original);
        for(const report of round.reports)
          for(const finding of report.findings)
            finding.category="tema-"+i;
        return round;
      });
    const many=buildEditorialDiffLedger(book,chapter);
    expect(many.totalThreads).toBe(14);
    expect(many.threads).toHaveLength(MAX_EDITORIAL_LEDGER_THREADS);
    expect(many.omittedThreads).toBe(2);
  });
  it("filtra i controlli riformulati senza attribuire stati o permessi",()=>{
    const {book,chapter,cycle}=withArchive();
    const {a,b}=addCurrent(book,cycle);
    decide(cycle,chapter,book,a,b,"needs_evidence");
    cycle.judgment!.recommendationReconciliations![0]!.nextCheck=
      "Rileggere il dialogo con un controllo redazionale diverso.";
    const before=JSON.stringify(book);
    const filtered=buildEditorialDiffLedger(book,chapter,"reworded");
    expect(filtered).toMatchObject({
      focus:"reworded",totalThreads:1,matchingThreads:1,
      filteredOutThreads:0,omittedThreads:0,
    });
    expect(filtered.threads[0]!.observations[1]!.checkChange)
      .toBe("different_suggestion_words");
    expect(buildEditorialDiffLedger(book,chapter,"ambiguous")).toMatchObject({
      totalThreads:1,matchingThreads:0,filteredOutThreads:1,threads:[],
    });
    expect(JSON.stringify(book)).toBe(before);
  });
  it("distingue citazione spostata, non osservata e prova inattendibile",()=>{
    const {book,chapter,cycle}=withArchive();
    chapter.scenes[0]!.text="Un rumore improvviso. "+text;
    addCurrent(book,cycle);
    expect(buildEditorialDiffLedger(book,chapter,"moved").matchingThreads)
      .toBe(1);
    expect(buildEditorialDiffLedger(book,chapter,"unobserved").threads)
      .toHaveLength(0);
    cycle.reports=[];
    expect(buildEditorialDiffLedger(book,chapter,"unobserved")).toMatchObject({
      matchingThreads:1,totalThreads:1,
    });
    chapter.frozenAt="2026-11-08T20:00:00.000Z";
    expect(buildEditorialDiffLedger(book,chapter,"unobserved").threads)
      .toHaveLength(0);
    chapter.editorialRounds![0]!.reports[0]!.findings[0]!
      .evidenceAnchor=undefined;
    const unverified=buildEditorialDiffLedger(book,chapter,"unverifiable");
    expect(unverified.matchingThreads).toBe(1);
    expect(unverified.threads[0]!.observations[0]!.nextCheck)
      .toBeUndefined();
  });
  it("filtra prima delle 12 serie mostrate, mai prima del cap di 240",()=>{
    const {book,chapter}=withArchive();
    const first=structuredClone(chapter.editorialRounds![0]!);
    chapter.editorialRounds=Array.from({length:MAX_EDITORIAL_LEDGER_THREADS+2},
      (_,i)=>{
        const round=structuredClone(first);
        for(const report of round.reports)
          for(const finding of report.findings)finding.category="tema-"+i;
        if(i===0)round.judgment.recommendationReconciliations!.push({
          ...structuredClone(round.judgment.recommendationReconciliations![0]!),
          rationale:"Secondo rilievo sull'identica frase nella prima tornata.",
        });
        return round;
      });
    const all=buildEditorialDiffLedger(book,chapter);
    expect(all.totalThreads).toBe(14);
    expect(all.threads.some(x=>x.category==="tema-0")).toBe(false);
    const ambiguous=buildEditorialDiffLedger(book,chapter,"ambiguous");
    expect(ambiguous).toMatchObject({
      totalThreads:14,matchingThreads:1,filteredOutThreads:13,
      omittedThreads:0,omittedCandidateObservations:0,
    });
    expect(ambiguous.threads.map(x=>x.category)).toEqual(["tema-0"]);
  });
  it("altro capitolo non può ricevere evidenze da questo libro",()=>{
    const {book,chapter}=withArchive();
    const fake={...chapter,id:"c2"};
    expect(buildEditorialDiffLedger(book,fake).threads).toEqual([]);
  });
});
