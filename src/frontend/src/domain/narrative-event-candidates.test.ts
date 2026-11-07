import { describe, expect, it } from "vitest";
import { newBook, type Chapter, type Scene } from "./types";
import { buildNarrativeEventCandidateIndex, extractNarrativeEventCandidates }
  from "./narrative-event-candidates";
import { buildContinuityEvidence, markDownstreamContinuity }
  from "./cross-chapter-continuity";
import { adjudicationPrompt, chapterSegments, createEditorialCycle, reviewerPrompt }
  from "./editorial-board";

const frozenAt="2026-11-07T11:00:00.000Z";
const makeScene=(id:string,text:string):Scene=>({
  id,number:1,title:"Una lettera",objective:"Trasmettere un indizio",
  status:"canon",date:"1848",text,characters:["Mara","Elio"],items:["chiave"],
});
const makeChapter=(n:number,scenes:Scene[]):Chapter=>({
  id:"ch-"+n,number:n,title:"Capitolo "+n,purpose:"Continuare la trama",frozenAt,scenes,
});

describe("Indice locale di eventi candidati ancorati",()=>{
  it("classifica tre menzioni esplicite con citazioni e offset REALI",()=>{
    const scene=makeScene("scene-1",
      "Mara scopre che Elio nasconde la lettera. " +
      "Mara consegna la chiave a Elio. Elio scompare nella nebbia.");
    const chapter=makeChapter(1,[scene]);
    const events=extractNarrativeEventCandidates(chapter,scene);
    expect(events.map(e=>e.kind)).toEqual([
      "knowledge_mention","item_transfer_mention","state_change_mention",
    ]);
    expect(events[0]).toMatchObject({
      actor:"Mara",detail:"Elio nasconde la lettera",
      sceneId:"scene-1",sceneDate:"1848",evidenceStatus:"unverified_literal_pattern",
    });
    expect(events[1]).toMatchObject({actor:"Mara",detail:"chiave",recipient:"Elio"});
    expect(events[2]).toMatchObject({actor:"Elio",detail:"scompare"});
    for(const e of events)expect(scene.text.slice(e.offset,e.offset+e.quote.length)).toBe(e.quote);
  });

  it("non registra come evento verificato un dialogo o una menzogna: rimane solo candidato",()=>{
    const scene=makeScene("s",
      '«Mara consegna la chiave a Elio», mente il guardiano. ' +
      "Elio non scopre che il portone è aperto. Elio scompare.");
    const events=extractNarrativeEventCandidates(makeChapter(1,[scene]),scene);
    expect(events.every(e=>e.evidenceStatus==="unverified_literal_pattern")).toBe(true);
    expect(events.some(e=>e.kind==="item_transfer_mention")).toBe(true);
    expect(events.some(e=>e.kind==="knowledge_mention")).toBe(false);
  });

  it("esclude scene non canoniche e capitoli riaperti, senza leggere memoria privata o futuro",()=>{
    const book=newBook("Una vicenda","Libro","Romanzo","Adulti");
    book.memory.secrets.lettera="PRIVATO: Mara mente a Elio";
    book.chapters=[
      makeChapter(1,[makeScene("first","Mara consegna la chiave a Elio.")]),
      makeChapter(2,[makeScene("second","Elio scopre che Mara nasconde il testamento.")]),
      makeChapter(3,[makeScene("future","Mara scompare.")]),
    ];
    book.chapters[1]!.scenes.push({...makeScene("draft","Elio fugge."),status:"draft"});
    const earlier=buildNarrativeEventCandidateIndex(book,3);
    expect(earlier.events.map(e=>e.chapterNumber)).toEqual([1,2]);
    expect(JSON.stringify(earlier)).not.toContain("PRIVATO:");
    expect(JSON.stringify(earlier)).not.toContain("Mara scompare");
    expect(JSON.stringify(earlier)).not.toContain("Elio fugge");
    book.chapters[0]!.frozenAt=undefined;
    expect(buildNarrativeEventCandidateIndex(book,3).events.map(e=>e.chapterNumber)).toEqual([2]);
  });

  it("mantiene un massimo per scena e un limite complessivo con disclosure senza scansione remota",()=>{
    const book=newBook("Una vicenda","Libro","Romanzo","Adulti");
    const repeated="Elio scompare. ".repeat(30);
    book.chapters=Array.from({length:25},(_,i)=>makeChapter(i+1,
      [makeScene("s-"+i,repeated)]));
    const result=buildNarrativeEventCandidateIndex(book);
    expect(result.events).toHaveLength(80);
    expect(result.eventLimitReached).toBe(true);
    expect(result.scannedSceneCount).toBe(21);
    expect(result.unscannedSceneCount).toBe(4);
    expect(extractNarrativeEventCandidates(book.chapters[0]!,book.chapters[0]!.scenes[0]!))
      .toHaveLength(4);
  });

  it("i campioni cross-chapter aggiungono candidati solo a specialisti e giudice, non ai lettori ciechi",()=>{
    const book=newBook("Una vicenda","Libro","Romanzo","Adulti");
    book.memory.secrets.lettera="PRIVATO: l'erede è Elio";
    book.chapters=[
      makeChapter(1,[makeScene("a","Mara consegna la chiave a Elio.")]),
      makeChapter(2,[makeScene("b","Elio cerca la chiave nelle stanze del castello.")]),
    ];
    markDownstreamContinuity(book,book.chapters[0]!,"retroactive_revision",["a"]);
    const current=book.chapters[1]!,cy=createEditorialCycle(current.id);
    const pack=buildContinuityEvidence(book,current,current.scenes[0])!;
    expect(pack.scenes[0]!.eventCandidates?.[0]).toMatchObject({
      kind:"item_transfer_mention",sceneId:"a",
      evidenceStatus:"unverified_literal_pattern",
    });
    for(const e of pack.scenes[0]!.eventCandidates??[])
      expect(book.chapters[0]!.scenes[0]!.text.slice(e.offset,e.offset+e.quote.length))
        .toBe(e.quote);
    const seg=chapterSegments(current)[0]!;
    const specialist=reviewerPrompt(book,cy,"continuity",seg,1);
    const judge=adjudicationPrompt(book,cy);
    const blind=reviewerPrompt(book,cy,"readerCasual",seg,1);
    expect(specialist.prompt).toContain("item_transfer_mention");
    expect(judge.prompt).toContain("item_transfer_mention");
    expect(judge.prompt).toContain("eventCandidates sono solo ipotesi TESTUALI");
    expect(blind.prompt).not.toContain("item_transfer_mention");
    expect(blind.prompt).not.toContain("Mara consegna la chiave");
    expect(JSON.stringify(pack)).not.toContain("PRIVATO:");
  });
});
