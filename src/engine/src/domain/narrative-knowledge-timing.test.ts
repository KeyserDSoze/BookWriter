import {describe,expect,it} from "vitest";
import {newBook,type BookProject} from "./types";
import {buildNarrativeEventCandidateIndex} from "./narrative-event-candidates";
import {createNarrativeEventDecision} from "./narrative-event-decisions";
import {createNarrativeKnowledgeDecision}
  from "./narrative-knowledge-decisions";
import {buildNarrativeKnowledgeTimingRegistry,createNarrativeKnowledgeTimingDecision,
  MAX_KNOWLEDGE_TIMING_DECISIONS} from "./narrative-knowledge-timing";
import {buildSharedKnowledgePack,createNarrativeKnowledgeShareDecision}
  from "./narrative-knowledge-sharing";
import {createEditorialCycle,chapterSegments,EDITORIAL_ROLES,reviewerPrompt,
  adjudicationPrompt} from "./editorial-board";

function sample():BookProject{
  const book=newBook("Segreto","Mara e Elio","Romanzo","Adulti");
  book.chapters=[
    {id:"ch1",number:1,title:"Prima lettera",purpose:"Rivelazione",
      frozenAt:"2026-11-08T07:00:00.000Z",
      scenes:[{id:"s1",number:1,title:"La lettera",objective:"Segreto",
        text:"Mara scopre che Elio ha nascosto la lettera.",status:"canon"}]},
    {id:"ch2",number:2,title:"Seconda lettera",purpose:"Rivelazione",
      frozenAt:"2026-11-08T07:30:00.000Z",
      scenes:[{id:"s2",number:1,title:"Sogno di Elio",objective:"Futuro",
        text:"Elio scopre che Mara ha trovato la lettera.",status:"canon"}]},
    {id:"ch3",number:3,title:"Ricordo",purpose:"Flashback",
      scenes:[{id:"s3",number:1,title:"Ricordo",objective:"Timeline",
        text:"Mara racconta di avere sentito parlare della lettera.",status:"canon"}]},
  ];
  book.memory.secrets.lettera="SPOILER_MEMORIA_NON_LEGGERE";
  return book;
}
function confirm(book:BookProject,actor:"Mara"|"Elio"){
  const candidate=buildNarrativeEventCandidateIndex(book).events.find(x=>x.actor===actor)!;
  const d=createNarrativeEventDecision(book,candidate,"affirmed",
    "L'autore attesta questa menzione testuale, non la verità.",
    crypto.randomUUID(),"2026-11-08T08:00:00.000Z");
  book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),d];
  return d;
}
function classify(book:BookProject,actor:"Mara"|"Elio",
  verdict:"learned_directly"|"reported_by_other"|"still_secret"="learned_directly"){
  const source=confirm(book,actor);
  const d=createNarrativeKnowledgeDecision(book,source.id,verdict,
    "Interpretazione riservata del testo da parte dell'autore.",
    crypto.randomUUID(),"2026-11-08T08:10:00.000Z");
  book.narrativeKnowledgeDecisions=[...(book.narrativeKnowledgeDecisions??[]),d];
  return d;
}
function timing(book:BookProject,knowledgeId:string,
  accessMoment:"acquired_in_scene"|"known_before_scene"|"not_yet_known"|"uncertain",
  narrativeOrder:"chronological"|"flashback_or_reordered"|"undetermined"="undetermined"){
  const d=createNarrativeKnowledgeTimingDecision(book,knowledgeId,
    accessMoment,narrativeOrder,
    "PRIVATO_TEMPO_NON_INVIARE_AI: l'autore ricostruisce la successione.",
    crypto.randomUUID(),"2026-11-08T09:00:00.000Z");
  book.narrativeKnowledgeTimingDecisions=[
    ...(book.narrativeKnowledgeTimingDecisions??[]),d];
  return d;
}

describe("Tempo delle conoscenze interpretato dall'autore",()=>{
  it("ancora il tempo alle sole interpretazioni knowledge correnti, senza cambiare il canone",()=>{
    const book=sample();
    expect(()=>timing(book,"inventato","uncertain")).toThrow(/non è corrente/);
    const k=classify(book,"Mara"),before=structuredClone(book);
    const t=timing(book,k.id,"acquired_in_scene","chronological");
    expect(t).toMatchObject({
      knowledgeDecisionId:k.id,accessMoment:"acquired_in_scene",
      narrativeOrder:"chronological",
    });
    const ledger=buildNarrativeKnowledgeTimingRegistry(book);
    expect(ledger.current).toHaveLength(1);
    expect(ledger.manuscriptOrderOnly).toBe(true);
    expect(ledger.byCharacter[0]?.actorName).toBe("Mara");
    expect(book.memory).toEqual(before.memory);
    expect(book.chapters).toEqual(before.chapters);
    expect(book.narrativeKnowledgeShareDecisions).toEqual(before.narrativeKnowledgeShareDecisions);
  });
  it("separa la posizione di Mara da quella di Elio, senza dedurre una trasmissione",()=>{
    const book=sample();
    const elio=classify(book,"Elio","reported_by_other");
    const mara=classify(book,"Mara","learned_directly");
    timing(book,elio.id,"known_before_scene","flashback_or_reordered");
    timing(book,mara.id,"acquired_in_scene","chronological");
    const timeline=buildNarrativeKnowledgeTimingRegistry(book);
    expect(timeline.current.map(x=>x.knowledge.source.candidate.actor)).toEqual(["Mara","Elio"]);
    expect(timeline.byCharacter.map(x=>x.actorName)).toEqual(["Elio","Mara"]);
    expect(timeline.current[1]?.decision.narrativeOrder).toBe("flashback_or_reordered");
    expect(Object.keys(timeline)).not.toContain("conflicts");
    expect(Object.keys(timeline)).not.toContain("knowledgeTransfers");
  });
  it("classificazione still_secret ammette solo non ancora noto o tempo incerto",()=>{
    const book=sample(),k=classify(book,"Mara","still_secret");
    expect(()=>timing(book,k.id,"acquired_in_scene")).toThrow(/contraddice/);
    expect(()=>timing(book,k.id,"known_before_scene")).toThrow(/contraddice/);
    const t=timing(book,k.id,"not_yet_known","flashback_or_reordered");
    expect(buildNarrativeKnowledgeTimingRegistry(book).current[0]?.decision.id).toBe(t.id);
    const latest=createNarrativeKnowledgeDecision(book,k.sourceEventDecisionId,
      "learned_directly","L'autore corregge la propria classificazione sul sapere.",
      crypto.randomUUID(),"2026-11-08T09:10:00.000Z");
    book.narrativeKnowledgeDecisions!.push(latest);
    expect(buildNarrativeKnowledgeTimingRegistry(book).current).toHaveLength(0);
    expect(()=>timing(book,latest.id,"not_yet_known")).toThrow(/contraddice/);
  });
  it("rettifiche append-only: ultima per ID esatto prevale e vecchia non risorge",()=>{
    const book=sample(),k=classify(book,"Mara");
    timing(book,k.id,"known_before_scene","undetermined");
    const update=timing(book,k.id,"acquired_in_scene","chronological");
    const timeline=buildNarrativeKnowledgeTimingRegistry(book);
    expect(timeline.current).toHaveLength(1);
    expect(timeline.current[0]?.decision.id).toBe(update.id);
    expect(timeline.nonCurrentCount).toBe(1);
    book.chapters[0]!.frozenAt=undefined;
    expect(buildNarrativeKnowledgeTimingRegistry(book).current).toHaveLength(0);
    book.chapters[0]!.frozenAt="2026-11-08T07:00:00.000Z";
    book.chapters[0]!.scenes[0]!.text+=" Narrazione mutata.";
    expect(buildNarrativeKnowledgeTimingRegistry(book).current).toHaveLength(0);
    book.chapters[0]!.scenes[0]!.text="Mara scopre che Elio ha nascosto la lettera.";
    confirm(book,"Mara"); // New attestation invalidates OLD source and its timing.
    expect(buildNarrativeKnowledgeTimingRegistry(book).current).toHaveLength(0);
  });
  it("opzioni ostili, input invalidi e limite non producono deduzioni canoniche",()=>{
    const book=sample(),k=classify(book,"Mara");
    const args=["acquired_in_scene","chronological"] as const;
    const make=(moment:string,order:string,reason:string)=>
      createNarrativeKnowledgeTimingDecision(book,k.id,
        moment as "acquired_in_scene",order as "chronological",reason,
        crypto.randomUUID(),"2026-11-08T09:00:00.000Z");
    expect(()=>make("time_travel","chronological",
      "Ragione sufficientemente dettagliata e utile per la scelta.")).toThrow(/non valida/);
    expect(()=>make("acquired_in_scene","eternal",
      "Ragione sufficientemente dettagliata e utile per la scelta.")).toThrow(/non valida/);
    expect(()=>make(...args,"breve")).toThrow(/20–650/);
    const valid=timing(book,k.id,"uncertain");
    book.narrativeKnowledgeTimingDecisions=Array.from({length:MAX_KNOWLEDGE_TIMING_DECISIONS},
      (_,i)=>({...valid,id:"time-"+i}));
    expect(()=>timing(book,k.id,"uncertain")).toThrow(/200/);
    expect(book.memory.secrets.lettera).toBe("SPOILER_MEMORIA_NON_LEGGERE");
  });
  it("anche con consenso knowledge esplicito, il tempo privato non entra nei 12 prompt né nel giudice",()=>{
    const book=sample(),k=classify(book,"Mara");
    timing(book,k.id,"known_before_scene","flashback_or_reordered");
    const grant=createNarrativeKnowledgeShareDecision(book,k.id,"allowed",
      ["continuity","timeline","secrets","characterVoice","judge"],
      "La classificazione base è condivisibile, il tempo narrativo no.",
      crypto.randomUUID(),"2026-11-08T09:20:00.000Z");
    book.narrativeKnowledgeShareDecisions=[grant];
    const chapter=book.chapters[2]!,cycle=createEditorialCycle(chapter.id);
    const seg=chapterSegments(chapter)[0]!;
    for(const role of EDITORIAL_ROLES){
      const p=reviewerPrompt(book,cycle,role,seg,1);
      expect(p.prompt).not.toContain("PRIVATO_TEMPO_NON_INVIARE_AI");
      expect(p.prompt).not.toContain("narrativeKnowledgeTimingDecisions");
      expect(p.prompt).not.toContain("flashback_or_reordered");
      expect(p.system).not.toContain("PRIVATO_TEMPO_NON_INVIARE_AI");
    }
    const judge=adjudicationPrompt(book,cycle);
    expect(judge.prompt).not.toContain("PRIVATO_TEMPO_NON_INVIARE_AI");
    const shared=buildSharedKnowledgePack(book,chapter,"continuity",seg.text);
    expect(shared.witnesses).toHaveLength(1);
    expect(JSON.stringify(shared)).not.toContain("PRIVATO_TEMPO_NON_INVIARE_AI");
    expect(JSON.stringify(shared)).not.toContain("known_before_scene");
  });
  it("un campo importato coerente strutturalmente ma con fonte falsa rimane storico",()=>{
    const book=sample(),k=classify(book,"Mara");
    const t=timing(book,k.id,"known_before_scene");
    book.narrativeKnowledgeTimingDecisions=[{...t,knowledgeDecisionId:"ID-FALSO"}];
    expect(buildNarrativeKnowledgeTimingRegistry(book).current).toHaveLength(0);
    expect(buildNarrativeKnowledgeTimingRegistry(book).nonCurrentCount).toBe(1);
  });
});
