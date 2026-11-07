import {describe,expect,it} from "vitest";
import {newBook,type BookProject} from "./types";
import {buildNarrativeEventCandidateIndex} from "./narrative-event-candidates";
import {createEditorialCycle,reviewerPrompt,adjudicationPrompt,chapterSegments,EDITORIAL_ROLES}
  from "./editorial-board";
import {createNarrativeEventDecision} from "./narrative-event-decisions";
import {buildNarrativeKnowledgeRegistry,createNarrativeKnowledgeDecision,
  MAX_KNOWLEDGE_DECISIONS} from "./narrative-knowledge-decisions";

function sample():BookProject {
  const book=newBook("Romanzo","La lettera","Prosa","Adulti");
  book.chapters=[{id:"chapter-one",number:1,title:"Il segreto",
    purpose:"Rivelazione",frozenAt:"2026-11-07T10:00:00.000Z",
    scenes:[{id:"scene-one",number:1,title:"La scoperta",objective:"Conoscenza",
      text:"Mara scopre che Elio nasconde la lettera.",status:"canon"}]}];
  return book;
}
function affirm(book:BookProject){
  const candidate=buildNarrativeEventCandidateIndex(book).events[0]!;
  const d=createNarrativeEventDecision(book,candidate,"affirmed",
    "L'autore attesta la menzione, senza confermare la conoscenza.",
    crypto.randomUUID(),"2026-11-07T12:00:00.000Z");
  book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),d];
  return d;
}
function knowledge(book:BookProject,sourceId:string,
  verdict:"learned_directly"|"reported_by_other"|"still_secret"="learned_directly"){
  const d=createNarrativeKnowledgeDecision(book,sourceId,verdict,
    "L'autore distingue le informazioni note dalle rivelazioni.",
    crypto.randomUUID(),"2026-11-07T13:00:00.000Z");
  book.narrativeKnowledgeDecisions=[...(book.narrativeKnowledgeDecisions??[]),d];
  return d;
}
describe("Registro privato delle conoscenze interpretate dall'autore",()=>{
  it("accetta solo attestazioni correnti di conoscenza, non altre menzioni",()=>{
    const book=sample();
    expect(()=>createNarrativeKnowledgeDecision(book,"inventata","still_secret",
      "Una motivazione valida e sufficientemente lunga.",
      crypto.randomUUID(),"2026-11-07T13:00:00.000Z")).toThrow(/non è più attestata/);
    const source=affirm(book),before=structuredClone(book);
    const d=knowledge(book,source.id);
    expect(d).toMatchObject({
      sourceEventDecisionId:source.id,actorName:"Mara",verdict:"learned_directly",
    });
    expect(buildNarrativeKnowledgeRegistry(book).learnedDirectly[0]?.source.decision.id)
      .toBe(source.id);
    expect(book.memory).toEqual(before.memory);
    expect(book.chapters).toEqual(before.chapters);
    expect(book.editorialCycle).toEqual(before.editorialCycle);
  });
  it("l'ultima decisione prevale: non torna valida una classificazione antecedente",()=>{
    const book=sample(),source=affirm(book);
    knowledge(book,source.id,"learned_directly");
    const update=knowledge(book,source.id,"reported_by_other");
    const end=knowledge(book,source.id,"still_secret");
    const registry=buildNarrativeKnowledgeRegistry(book);
    expect(registry.current).toHaveLength(1);
    expect(registry.learnedDirectly).toHaveLength(0);
    expect(registry.reportedByOther).toHaveLength(0);
    expect(registry.stillSecret.map(x=>x.decision.id)).toEqual([end.id]);
    expect(registry.nonCurrentCount).toBe(2);
    expect(update).not.toEqual(end);
  });
  it("riapertura, testo cambiato, attestazione respinta o rinnovata invalidano senza cancellare",()=>{
    const book=sample(),source=affirm(book);
    knowledge(book,source.id,"still_secret");
    book.chapters[0]!.frozenAt=undefined;
    expect(buildNarrativeKnowledgeRegistry(book).current).toHaveLength(0);
    book.chapters[0]!.frozenAt="2026-11-07T10:00:00.000Z";
    book.chapters[0]!.scenes[0]!.text+=" Un'altra frase.";
    expect(buildNarrativeKnowledgeRegistry(book).current).toHaveLength(0);
    book.chapters[0]!.scenes[0]!.text="Mara scopre che Elio nasconde la lettera.";
    affirm(book); // the older interpretation is NEVER revived if the author reattests.
    expect(buildNarrativeKnowledgeRegistry(book).current).toHaveLength(0);
    expect(book.narrativeKnowledgeDecisions).toHaveLength(1);
    expect(book.narrativeKnowledgeDecisions![0]!.sourceEventDecisionId).toBe(source.id);
  });
  it("nessun evento di stato o trasferimento oggetto può essere una fonte di sapere",()=>{
    const book=sample();
    book.chapters[0]!.scenes[0]!.text="Mara parte.";
    const source=affirm(book);
    expect(()=>knowledge(book,source.id)).toThrow(/non è più attestata/);
    expect(book.narrativeKnowledgeDecisions).toBeUndefined();
  });
  it("l'import strutturalmente valido ma con ID o personaggio forgiati resta non corrente",()=>{
    const book=sample(),source=affirm(book),d=knowledge(book,source.id);
    book.narrativeKnowledgeDecisions=[{...d,sourceEventDecisionId:"falso"}];
    expect(buildNarrativeKnowledgeRegistry(book).current).toHaveLength(0);
    book.narrativeKnowledgeDecisions=[{...d,actorName:"Elio"}];
    expect(buildNarrativeKnowledgeRegistry(book).current).toHaveLength(0);
    book.narrativeKnowledgeDecisions=[{...d,verdict:"unknown" as typeof d.verdict}];
    expect(buildNarrativeKnowledgeRegistry(book).current).toHaveLength(0);
  });
  it("nessun giudizio privato viene aggiunto ai prompt di revisori o direttore",()=>{
    const book=sample(),source=affirm(book);
    const decision=createNarrativeKnowledgeDecision(book,source.id,"still_secret",
      "NOTA_PRIVATA_UNICA_MAI_AL_MODELLO: la scena era un sogno.",
      crypto.randomUUID(),"2026-11-07T13:00:00.000Z");
    book.narrativeKnowledgeDecisions=[decision];
    book.chapters.push({id:"ch2",number:2,title:"Ritorno",purpose:"Verifica",
      scenes:[{id:"sc2",number:1,title:"Attesa",objective:"Aspettare",
        text:"Mara dichiara di conoscere la lettera.",status:"canon"}]});
    const chapter=book.chapters[1]!,cycle=createEditorialCycle(chapter.id);
    const segment=chapterSegments(chapter)[0]!;
    for(const role of EDITORIAL_ROLES){
      const prompt=reviewerPrompt(book,cycle,role,segment,1);
      expect(prompt.prompt).not.toContain("NOTA_PRIVATA_UNICA_MAI_AL_MODELLO");
      expect(prompt.prompt).not.toContain("narrativeKnowledgeDecisions");
    }
    const judge=adjudicationPrompt(book,cycle);
    expect(judge.prompt).not.toContain("NOTA_PRIVATA_UNICA_MAI_AL_MODELLO");
    expect(judge.prompt).not.toContain("narrativeKnowledgeDecisions");
  });
  it("validazioni e cap massimo non attivano side effect",()=>{
    const book=sample(),source=affirm(book);
    expect(()=>createNarrativeKnowledgeDecision(book,source.id,"learned_directly",
      "breve",crypto.randomUUID(),"2026-11-07T13:00:00.000Z"))
      .toThrow(/12–500/);
    expect(()=>createNarrativeKnowledgeDecision(book,source.id,
      "verify_by_AI" as "still_secret",
      "Motivazione valida per questa conoscenza.",
      crypto.randomUUID(),"2026-11-07T13:00:00.000Z")).toThrow(/Stato/);
    const single=knowledge(book,source.id);
    book.narrativeKnowledgeDecisions=Array.from({length:MAX_KNOWLEDGE_DECISIONS},
      (_,i)=>({...single,id:"note-"+i}));
    expect(()=>knowledge(book,source.id)).toThrow(/160/);
    expect(book.memory.secrets).toEqual({});
  });
});
