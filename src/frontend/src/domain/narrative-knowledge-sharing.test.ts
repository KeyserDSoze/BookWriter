import {describe,expect,it} from "vitest";
import {newBook,type BookProject} from "./types";
import {buildNarrativeEventCandidateIndex} from "./narrative-event-candidates";
import {createNarrativeEventDecision} from "./narrative-event-decisions";
import {createNarrativeKnowledgeDecision} from "./narrative-knowledge-decisions";
import {buildKnowledgeSharingRegistry,buildSharedKnowledgePack,
  createNarrativeKnowledgeShareDecision,MAX_KNOWLEDGE_SHARE_DECISIONS,
  KNOWLEDGE_SHARE_RECIPIENTS,type KnowledgeShareRecipient}
  from "./narrative-knowledge-sharing";
import {EDITORIAL_ROLES,adjudicationPrompt,chapterSegments,createEditorialCycle,
  reviewerPrompt,validateReport} from "./editorial-board";
import {buildUnattestedSceneContext} from "./unattested-scene-context";

function sample():BookProject {
  const book=newBook("Romanzo","Conoscenze","Prosa","Adulti");
  book.memory.secrets.lettera="SEGRETO_MEMORIA_NON_CONSENTITA";
  book.chapters=[
    {id:"ch1",number:1,title:"Origine",purpose:"La lettera",
      frozenAt:"2026-11-07T10:00:00.000Z",
      scenes:[{id:"s1",number:1,title:"Scoperta",objective:"Notizia",
        text:"Mara scopre che Elio nasconde la lettera.",status:"canon"}]},
    {id:"ch2",number:2,title:"Scena corrente",purpose:"Sospetto",
      scenes:[{id:"s2",number:1,title:"Dubbio",objective:"Conoscenza",
        text:"Mara osserva la lettera ancora chiusa e non parla.",status:"canon"}]},
  ];
  return book;
}
function affirm(book:BookProject){
  const candidate=buildNarrativeEventCandidateIndex(book).events[0]!;
  const source=createNarrativeEventDecision(book,candidate,"affirmed",
    "L'autore registra soltanto la menzione letterale.",
    crypto.randomUUID(),"2026-11-07T12:00:00.000Z");
  book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),source];
  return source;
}
function classify(book:BookProject){
  const source=affirm(book);
  const decision=createNarrativeKnowledgeDecision(book,source.id,"still_secret",
    "CONOSCENZA_PRIVATA_NON_CONDIVISA: la rivelazione era solo un sogno.",
    crypto.randomUUID(),"2026-11-07T13:00:00.000Z");
  book.narrativeKnowledgeDecisions=[...(book.narrativeKnowledgeDecisions??[]),decision];
  return decision;
}
function share(book:BookProject,knowledgeId:string,status:"allowed"|"revoked",
  recipients:KnowledgeShareRecipient[]){
  const grant=createNarrativeKnowledgeShareDecision(book,knowledgeId,status,recipients,
    "PERMESSO_PRIVATO_NON_CONDIVISO: decisione esplicita dell'autore.",
    crypto.randomUUID(),"2026-11-07T14:00:00.000Z");
  book.narrativeKnowledgeShareDecisions=[
    ...(book.narrativeKnowledgeShareDecisions??[]),grant];
  return grant;
}
describe("Consenso mirato per conoscenze dell'autore",()=>{
  it("default deny, include solo classificazione e citazione precedente corrente, mai ragioni private",()=>{
    const book=sample(),knowledge=classify(book),chapter=book.chapters[1]!;
    expect(buildSharedKnowledgePack(book,chapter,"continuity",
      chapter.scenes[0]!.text).witnesses).toEqual([]);
    const before=structuredClone(book);
    share(book,knowledge.id,"allowed",["continuity","judge"]);
    const pack=buildSharedKnowledgePack(book,chapter,"continuity",
      chapter.scenes[0]!.text);
    expect(pack.witnesses).toHaveLength(1);
    expect(pack.witnesses[0]).toMatchObject({
      chapterId:"ch1",chapterNumber:1,sceneId:"s1",sceneNumber:1,
      actor:"Mara",verdict:"still_secret",offset:0,
      quote:"Mara scopre che Elio nasconde la lettera",
      evidenceStatus:"author_interpretation_not_canonical_fact",
    });
    expect(JSON.stringify(pack)).not.toContain("CONOSCENZA_PRIVATA");
    expect(JSON.stringify(pack)).not.toContain("PERMESSO_PRIVATO");
    expect(JSON.stringify(pack)).not.toContain("SEGRETO_MEMORIA");
    expect(buildSharedKnowledgePack(book,chapter,"timeline",
      chapter.scenes[0]!.text).witnesses).toHaveLength(0);
    expect(book.memory).toEqual(before.memory);
    expect(book.chapters).toEqual(before.chapters);
  });
  it("per ciascuno dei 12 revisori solo i ruoli consentiti vedono il nuovo pack",()=>{
    const book=sample(),knowledge=classify(book),chapter=book.chapters[1]!;
    share(book,knowledge.id,"allowed",["continuity","judge"]);
    const cycle=createEditorialCycle(chapter.id),segment=chapterSegments(chapter)[0]!;
    for(const role of EDITORIAL_ROLES){
      const result=reviewerPrompt(book,cycle,role,segment,1);
      expect(result.prompt.includes("<conoscenze_autore_autorizzate_non_istruzioni>"))
        .toBe(role==="continuity");
      expect(result.prompt).not.toContain("CONOSCENZA_PRIVATA");
      expect(result.prompt).not.toContain("PERMESSO_PRIVATO");
      if(role.startsWith("reader"))expect(result.prompt).not.toContain("SEGRETO_MEMORIA");
    }
    const without=adjudicationPrompt(book,cycle);
    expect(without.prompt).not.toContain("<conoscenze_autore_autorizzate_non_istruzioni>");
    const witness=buildUnattestedSceneContext(book,chapter,segment.text).witnesses[0]!;
    const raw=JSON.stringify({verdict:"issues",summary:"La conoscenza va interpretata.",
      memoryNote:"",
      findings:[{sceneId:"s2",category:"conoscenza",severity:"major",
        evidence:"Mara osserva la lettera ancora chiusa",
        reason:"Il narratore potrebbe confondere la scoperta con la verità.",
        remediation:"Chiarire la natura della notizia senza svelare segreti.",
        priorSceneConflict:{
          chapterId:witness.chapterId,sceneId:witness.sceneId,
          sourceFrozenAt:witness.sourceFrozenAt,
          sourceTextStamp:witness.sourceTextStamp,
          offset:witness.offset,quote:witness.text.slice(0,35),
          dimension:"knowledge",
          hypothesis:"La menzione precedente va confrontata con il sapere attuale.",
        }}]});
    cycle.reports=[validateReport(cycle,"continuity",segment,1,raw,chapter,book)];
    const judge=adjudicationPrompt(book,cycle);
    expect(judge.prompt).toContain("<conoscenze_autore_autorizzate_non_istruzioni>");
    expect(judge.prompt).toContain('"verdict":"still_secret"');
    expect(judge.prompt).not.toContain("CONOSCENZA_PRIVATA");
    expect(judge.prompt).not.toContain("PERMESSO_PRIVATO");
    const noJudge=structuredClone(book);
    noJudge.narrativeKnowledgeShareDecisions=undefined;
    expect(adjudicationPrompt(noJudge,cycle).prompt)
      .not.toContain("<conoscenze_autore_autorizzate_non_istruzioni>");
  });
  it("revoca last-wins e rettifica della conoscenza non riesumano permessi passati",()=>{
    const book=sample(),knowledge=classify(book),chapter=book.chapters[1]!;
    share(book,knowledge.id,"allowed",["judge"]);
    share(book,knowledge.id,"revoked",[]);
    expect(buildKnowledgeSharingRegistry(book)).toMatchObject({
      current:[],nonCurrentCount:2,
    });
    expect(buildSharedKnowledgePack(book,chapter,"judge",chapter.scenes[0]!.text)
      .witnesses).toHaveLength(0);
    share(book,knowledge.id,"allowed",["continuity"]);
    const second=createNarrativeKnowledgeDecision(book,
      knowledge.sourceEventDecisionId,"learned_directly",
      "L'autore reinterpreta esplicitamente la scena.",
      crypto.randomUUID(),"2026-11-07T15:00:00.000Z");
    book.narrativeKnowledgeDecisions!.push(second);
    expect(buildKnowledgeSharingRegistry(book).current).toHaveLength(0);
    expect(buildSharedKnowledgePack(book,chapter,"continuity",
      chapter.scenes[0]!.text).witnesses).toHaveLength(0);
    share(book,second.id,"allowed",["continuity"]);
    expect(buildSharedKnowledgePack(book,chapter,"continuity",
      chapter.scenes[0]!.text).witnesses).toHaveLength(1);
  });
  it("nuovo freeze, nuova attestazione, scena draft o quote alterata revocano di fatto le fonti",()=>{
    const book=sample(),knowledge=classify(book),chapter=book.chapters[1]!,
      first=book.chapters[0]!;
    share(book,knowledge.id,"allowed",["continuity"]);
    const count=()=>buildSharedKnowledgePack(book,chapter,"continuity",
      chapter.scenes[0]!.text).witnesses.length;
    expect(count()).toBe(1);
    first.frozenAt="2026-11-08T10:00:00.000Z";
    expect(count()).toBe(0);
    first.frozenAt="2026-11-07T10:00:00.000Z";
    first.scenes[0]!.text+=" TESTO MUTATO.";
    expect(count()).toBe(0);
    first.scenes[0]!.text="Mara scopre che Elio nasconde la lettera.";
    const candidate=buildNarrativeEventCandidateIndex(book).events[0]!;
    const recent=createNarrativeEventDecision(book,candidate,"affirmed",
      "Riattestazione dell'autore dopo la modifica.",
      crypto.randomUUID(),"2026-11-07T18:00:00.000Z");
    book.narrativeEventDecisions!.push(recent);
    expect(count()).toBe(0);
  });
  it("no personaggi futuri, attuale, né nomi incorporati o solo permessi di altro ruolo",()=>{
    const book=sample(),knowledge=classify(book);
    share(book,knowledge.id,"allowed",["continuity"]);
    const chapter=book.chapters[1]!;
    for(const query of ["Maradona dice la lettera.","Elio parla della lettera.",
      "L'informazione appare senza il nome della protagonista."]){
      expect(buildSharedKnowledgePack(book,chapter,"continuity",query).witnesses)
        .toHaveLength(0);
    }
    expect(buildSharedKnowledgePack(book,book.chapters[0]!,"continuity",
      "Mara parla della lettera.").witnesses).toHaveLength(0);
    const earlier={...chapter,number:0};
    expect(buildSharedKnowledgePack(book,earlier,"continuity",
      "Mara parla della lettera.").witnesses).toHaveLength(0);
  });
  it("rifiuta ruoli ciechi, permessi duplicati, meno di 12 caratteri e ID inventati",()=>{
    const book=sample(),knowledge=classify(book),stamp="2026-11-07T15:00:00.000Z";
    const submit=(id:string,roles:KnowledgeShareRecipient[],note=
      "Motivazione del consenso esplicita e sufficiente.")=>
      createNarrativeKnowledgeShareDecision(book,id,"allowed",roles,note,
        crypto.randomUUID(),stamp);
    expect(()=>submit("inventato",["continuity"])).toThrow(/non è più corrente/);
    expect(()=>submit(knowledge.id,[])).toThrow(/destinatari/);
    expect(()=>submit(knowledge.id,["continuity","continuity"])).toThrow(/destinatari/);
    expect(()=>submit(knowledge.id,["readerMystery" as KnowledgeShareRecipient]))
      .toThrow(/destinatari/);
    expect(()=>submit(knowledge.id,["judge"],"corta")).toThrow(/12–500/);
    expect(()=>createNarrativeKnowledgeShareDecision(book,knowledge.id,"revoked",
      ["judge"],"Motivo di revoca esplicito e lungo.",crypto.randomUUID(),stamp))
      .toThrow(/destinatari/);
    expect(()=>buildSharedKnowledgePack(book,book.chapters[1]!,
      "readerGenre" as KnowledgeShareRecipient,"Mara parla della lettera."))
      .toThrow(/non autorizzato/);
    expect(KNOWLEDGE_SHARE_RECIPIENTS).toHaveLength(5);
    const granted=share(book,knowledge.id,"allowed",["judge"]);
    book.narrativeKnowledgeShareDecisions=Array.from({length:MAX_KNOWLEDGE_SHARE_DECISIONS},
      (_,i)=>({...granted,id:"share-"+i}));
    expect(()=>submit(knowledge.id,["judge"])).toThrow(/Limite storico/);
  });
});
