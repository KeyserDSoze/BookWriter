import {describe,expect,it} from "vitest";
import {newBook,type BookProject} from "./types";
import {buildNarrativeEventCandidateIndex} from "./narrative-event-candidates";
import {createNarrativeEventDecision} from "./narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "./narrative-knowledge-decisions";
import {createNarrativeKnowledgeTimingDecision} from "./narrative-knowledge-timing";
import {createNarrativeKnowledgeShareDecision,buildSharedKnowledgePack}
  from "./narrative-knowledge-sharing";
import {buildNarrativeKnowledgeTopicRegistry,createNarrativeKnowledgeTopicDecision,
  MAX_KNOWLEDGE_TOPIC_DECISIONS} from "./narrative-knowledge-topic-decisions";
import {EDITORIAL_ROLES,createEditorialCycle,chapterSegments,reviewerPrompt,adjudicationPrompt}
  from "./editorial-board";

function bookWithThree():BookProject{
  const book=newBook("Il segreto","Stessa notizia","Prosa","Adulti");
  book.chapters=[
    {id:"c1",number:1,title:"A",purpose:"Storia",
      frozenAt:"2026-11-08T08:00:00.000Z",
      scenes:[{id:"s1",number:1,title:"Mara",objective:"Conoscenza",
        text:"Mara scopre che la lettera era falsa.",status:"canon"}]},
    {id:"c2",number:2,title:"B",purpose:"Storia",
      frozenAt:"2026-11-08T09:00:00.000Z",
      scenes:[{id:"s2",number:1,title:"Elio",objective:"Conoscenza",
        text:"Elio apprende che la lettera era falsa.",status:"canon"}]},
    {id:"c3",number:3,title:"C",purpose:"Storia",
      frozenAt:"2026-11-08T09:30:00.000Z",
      scenes:[{id:"s3",number:1,title:"Nina",objective:"Conoscenza",
        text:"Nina capisce che la lettera era falsa.",status:"canon"}]},
    {id:"c4",number:4,title:"D",purpose:"Testimone",
      scenes:[{id:"s4",number:1,title:"Epilogo",objective:"Osservazione",
        text:"Mara, Elio e Nina osservano la lettera.",status:"canon"}]},
  ];
  book.memory.secrets.lettera="SEGRETO_PRIVATO_UNICO_NON_TRASMETTERE";
  return book;
}
function annotate(book:BookProject,actor:string){
  const c=buildNarrativeEventCandidateIndex(book).events.find(x=>x.actor===actor)!;
  const event=createNarrativeEventDecision(book,c,"affirmed",
    "L'autore attesta soltanto questa menzione congelata.",
    crypto.randomUUID(),"2026-11-08T10:00:00.000Z");
  book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),event];
  const knowledge=createNarrativeKnowledgeDecision(book,event.id,"reported_by_other",
    "MOTIVAZIONE_KNOWLEDGE_SEGRETA: può trattarsi di un racconto inattendibile.",
    crypto.randomUUID(),"2026-11-08T10:01:00.000Z");
  book.narrativeKnowledgeDecisions=[...(book.narrativeKnowledgeDecisions??[]),knowledge];
  return knowledge;
}
function link(book:BookProject,a:string,b:string,
  verdict:"same_information"|"different_information"="same_information"){
  const d=createNarrativeKnowledgeTopicDecision(book,a,b,verdict,
    "MOTIVAZIONE_COPPIA_PRIVATA: l'autore giudica le due notizie correlate.",
    crypto.randomUUID(),"2026-11-08T10:02:00.000Z");
  book.narrativeKnowledgeTopicDecisions=[...(book.narrativeKnowledgeTopicDecisions??[]),d];
  return d;
}

describe("Relazioni a coppie delle conoscenze: conferma esplicita dell'autore",()=>{
  it("default deny: solo due conoscenze affermate e correnti di persone diverse",()=>{
    const book=bookWithThree();
    expect(()=>createNarrativeKnowledgeTopicDecision(book,"falsa","altra",
      "same_information","Motivazione sufficiente per due fonti.",
      crypto.randomUUID(),"2026-11-08T10:02:00.000Z")).toThrow(/non è più corrente/);
    const mara=annotate(book,"Mara"),elio=annotate(book,"Elio");
    const original=structuredClone(book);
    const d=link(book,elio.id,mara.id);
    expect(d.firstKnowledgeDecisionId).toBe([mara.id,elio.id].sort()[0]);
    expect(d.secondKnowledgeDecisionId).toBe([mara.id,elio.id].sort()[1]);
    const current=buildNarrativeKnowledgeTopicRegistry(book);
    expect(current).toMatchObject({pairwiseOnly:true,nonCurrentCount:0});
    expect(current.sameInformation).toHaveLength(1);
    expect(current.sameInformation[0]?.first.source.decision.quote).toContain("lettera");
    expect(current.sameInformation[0]?.second.source.decision.quote).toContain("lettera");
    expect(book.memory).toEqual(original.memory);
    expect(book.chapters).toEqual(original.chapters);
    expect(book.narrativeKnowledgeShareDecisions).toEqual(original.narrativeKnowledgeShareDecisions);
  });
  it("l'ordine dei capitoli NON certifica trasmissione, né due link ne generano un terzo",()=>{
    const book=bookWithThree();
    const a=annotate(book,"Mara"),b=annotate(book,"Elio"),c=annotate(book,"Nina");
    link(book,a.id,b.id);
    link(book,b.id,c.id);
    const registry=buildNarrativeKnowledgeTopicRegistry(book);
    expect(registry.sameInformation).toHaveLength(2);
    expect(registry.current).toHaveLength(2);
    expect(Object.keys(registry)).not.toContain("graph");
    expect(Object.keys(registry)).not.toContain("transmissions");
    expect(registry.sameInformation.some(x=>
      [x.decision.firstKnowledgeDecisionId,x.decision.secondKnowledgeDecisionId]
        .includes(a.id) &&
      [x.decision.firstKnowledgeDecisionId,x.decision.secondKnowledgeDecisionId]
        .includes(c.id))).toBe(false);
    expect(registry.current[0]?.firstTiming).toBeNull();
    expect(registry.current[0]?.secondTiming).toBeNull();
  });
  it("rettifica last-wins con coppia invertita, senza resurrezione dopo fonte stale",()=>{
    const book=bookWithThree(),a=annotate(book,"Mara"),b=annotate(book,"Elio");
    link(book,a.id,b.id);
    const newer=link(book,b.id,a.id,"different_information");
    const r=buildNarrativeKnowledgeTopicRegistry(book);
    expect(r.current).toHaveLength(1);
    expect(r.differentInformation[0]?.decision.id).toBe(newer.id);
    expect(r.sameInformation).toHaveLength(0);
    expect(r.nonCurrentCount).toBe(1);
    book.chapters[1]!.frozenAt=undefined;
    expect(buildNarrativeKnowledgeTopicRegistry(book).current).toHaveLength(0);
    book.chapters[1]!.frozenAt="2026-11-08T09:00:00.000Z";
    book.chapters[1]!.scenes[0]!.text+=" La notte successiva.";
    expect(buildNarrativeKnowledgeTopicRegistry(book).current).toHaveLength(0);
    book.chapters[1]!.scenes[0]!.text="Elio apprende che la lettera era falsa.";
    annotate(book,"Elio");
    expect(buildNarrativeKnowledgeTopicRegistry(book).current).toHaveLength(0);
    expect(book.narrativeKnowledgeTopicDecisions).toHaveLength(2);
  });
  it("stesso attore, stessa fonte, enum ostili e limiti non ammettono relazioni",()=>{
    const book=bookWithThree(),a=annotate(book,"Mara"),b=annotate(book,"Elio");
    expect(()=>link(book,a.id,a.id)).toThrow(/distinte/);
    const second=createNarrativeKnowledgeDecision(book,a.sourceEventDecisionId,
      "learned_directly","Seconda interpretazione motivata dello stesso soggetto.",
      crypto.randomUUID(),"2026-11-08T10:04:00.000Z");
    book.narrativeKnowledgeDecisions!.push(second);
    expect(()=>link(book,a.id,b.id)).toThrow(/non è più corrente/);
    const a2=second;
    const notAllowed=createNarrativeKnowledgeTopicDecision;
    expect(()=>notAllowed(book,a2.id,b.id,
      "sent_by_telepathy" as "same_information",
      "La motivazione è coerente e sufficientemente dettagliata.",
      crypto.randomUUID(),"2026-11-08T10:05:00.000Z")).toThrow(/non valida/);
    expect(()=>notAllowed(book,a2.id,b.id,"same_information","troppo corta",
      crypto.randomUUID(),"2026-11-08T10:05:00.000Z")).toThrow(/20–650/);
    const initial=link(book,a2.id,b.id);
    book.narrativeKnowledgeTopicDecisions=Array.from({length:MAX_KNOWLEDGE_TOPIC_DECISIONS},
      (_,i)=>({...initial,id:"topic-"+i}));
    expect(()=>link(book,a2.id,b.id)).toThrow(/120/);
  });
  it("mostra due tempi privati quando esistono, senza dedurne causalità",()=>{
    const book=bookWithThree(),a=annotate(book,"Mara"),b=annotate(book,"Elio");
    for(const [id,moment,order] of [
      [a.id,"known_before_scene","flashback_or_reordered"],
      [b.id,"acquired_in_scene","chronological"],
    ] as const){
      const t=createNarrativeKnowledgeTimingDecision(book,id,moment,order,
        "TEMPO_PRIVATO_NON_AI: il capitolo può essere non lineare.",
        crypto.randomUUID(),"2026-11-08T10:03:00.000Z");
      book.narrativeKnowledgeTimingDecisions=[
        ...(book.narrativeKnowledgeTimingDecisions??[]),t];
    }
    link(book,a.id,b.id);
    const r=buildNarrativeKnowledgeTopicRegistry(book);
    expect([r.current[0]?.firstTiming?.decision.accessMoment,
      r.current[0]?.secondTiming?.decision.accessMoment].sort())
      .toEqual(["acquired_in_scene","known_before_scene"]);
    expect(Object.keys(r.current[0]!)).not.toContain("transfer");
    expect(Object.keys(r.current[0]!)).not.toContain("chronologicalOrder");
  });
  it("con opt-in AI della conoscenza la relazione e il motivo privati non entrano nei prompt",()=>{
    const book=bookWithThree(),a=annotate(book,"Mara"),b=annotate(book,"Elio");
    link(book,a.id,b.id);
    const grant=createNarrativeKnowledgeShareDecision(book,a.id,"allowed",
      ["continuity","timeline","secrets","characterVoice","judge"],
      "Autorizzo soltanto la citazione breve e la classificazione originaria.",
      crypto.randomUUID(),"2026-11-08T10:03:00.000Z");
    book.narrativeKnowledgeShareDecisions=[grant];
    const chapter=book.chapters[3]!,cycle=createEditorialCycle(chapter.id),
      seg=chapterSegments(chapter)[0]!;
    for(const role of EDITORIAL_ROLES){
      const prompt=reviewerPrompt(book,cycle,role,seg,1);
      expect(prompt.prompt).not.toContain("MOTIVAZIONE_COPPIA_PRIVATA");
      expect(prompt.prompt).not.toContain("narrativeKnowledgeTopicDecisions");
      expect(prompt.prompt).not.toContain("different_information");
      expect(prompt.prompt).not.toContain("same_information");
    }
    const judge=adjudicationPrompt(book,cycle);
    expect(judge.prompt).not.toContain("MOTIVAZIONE_COPPIA_PRIVATA");
    expect(judge.prompt).not.toContain("narrativeKnowledgeTopicDecisions");
    const pack=buildSharedKnowledgePack(book,chapter,"continuity",seg.text);
    expect(pack.witnesses).toHaveLength(1);
    expect(JSON.stringify(pack)).not.toContain("MOTIVAZIONE_COPPIA_PRIVATA");
    expect(JSON.stringify(pack)).not.toContain("SEGRETO_PRIVATO_UNICO");
  });
  it("coppie da ZIP con attore o ID manipolati restano storico non corrente",()=>{
    const book=bookWithThree(),a=annotate(book,"Mara"),b=annotate(book,"Elio");
    const d=link(book,a.id,b.id);
    book.narrativeKnowledgeTopicDecisions=[{
      ...d,firstKnowledgeDecisionId:"inventato",
      secondKnowledgeDecisionId:"z-inventato",
    }];
    expect(buildNarrativeKnowledgeTopicRegistry(book).current).toEqual([]);
  });
});
