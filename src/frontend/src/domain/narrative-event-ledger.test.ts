import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import { buildNarrativeEventCandidateIndex, extractNarrativeEventCandidates } from "./narrative-event-candidates";
import { createNarrativeEventDecision } from "./narrative-event-decisions";
import { buildNarrativeEventLedger } from "./narrative-event-ledger";

function sample() {
  const book = newBook("Tracce", "Tracce", "Prosa", "Adulti");
  book.chapters = [
    {id:"c1",number:1,title:"Uno",purpose:"Inizio",frozenAt:"2026-11-07T10:00:00Z",
      scenes:[{id:"s1",number:1,title:"Soglia",objective:"Ingresso",
        text:"Mara consegna la chiave a Elio.",status:"canon"}]},
    {id:"c2",number:2,title:"Due",purpose:"Svolta",frozenAt:"2026-11-07T11:00:00Z",
      scenes:[{id:"s2",number:1,title:"Passaggio",objective:"Evoluzione",
        text:"Mara scompare. Elio ritorna.",status:"canon"}]},
  ];
  return book;
}

function decide(book: BookProject, chapterIndex: number, sceneIndex: number, index: number,
  verdict: "affirmed"|"dismissed" = "affirmed") {
  const ch=book.chapters[chapterIndex]!,sc=ch.scenes[sceneIndex]!;
  const candidate=extractNarrativeEventCandidates(ch,sc)[index]!;
  const decision=createNarrativeEventDecision(book,candidate,verdict,
    "Interpretazione dichiarata esplicitamente dall'autore.",
    crypto.randomUUID(),"2026-11-07T12:00:00Z");
  book.narrativeEventDecisions = [...(book.narrativeEventDecisions??[]),decision];
  return decision;
}

describe("Registro consultivo delle attestazioni correnti",()=>{
  it("raggruppa attestazioni valide per nome esatto su capitoli diversi",()=>{
    const book=sample();
    decide(book,0,0,0);
    decide(book,1,0,0);
    decide(book,1,0,1,"dismissed");
    const originalMemory=structuredClone(book.memory);
    const ledger=buildNarrativeEventLedger(book);
    expect(ledger.currentAffirmed.map(e=>e.candidate.chapterNumber)).toEqual([1,2]);
    expect(ledger.currentDismissed).toHaveLength(1);
    expect(ledger.crossChapterActors.map(g=>g.actor)).toEqual(["Mara"]);
    expect(ledger.crossChapterActors[0]!.entries).toHaveLength(2);
    expect(book.memory).toEqual(originalMemory);
  });
  it("dopo una rettifica non conta due volte la medesima menzione",()=>{
    const book=sample();
    decide(book,0,0,0);
    decide(book,0,0,0,"dismissed");
    const ledger=buildNarrativeEventLedger(book);
    expect(ledger.currentAffirmed).toHaveLength(0);
    expect(ledger.currentDismissed).toHaveLength(1);
    expect(ledger.nonCurrentCount).toBe(1);
  });
  it("scarta freeze cambiati, scena alterata, scene non canoniche",()=>{
    const book=sample();
    decide(book,0,0,0);
    decide(book,1,0,0);
    book.chapters[0]!.frozenAt="2026-11-08T10:00:00Z";
    book.chapters[1]!.scenes[0]!.text += " Un nuovo particolare.";
    expect(buildNarrativeEventLedger(book)).toMatchObject({
      currentAffirmed:[],nonCurrentCount:2,crossChapterActors:[],
    });
    book.chapters[0]!.frozenAt=undefined;
    book.chapters[1]!.scenes[0]!.status="draft";
    expect(buildNarrativeEventLedger(book).currentAffirmed).toHaveLength(0);
  });
  it("non considera valida una citazione importata inventata",()=>{
    const book=sample();
    const real=decide(book,0,0,0);
    book.narrativeEventDecisions=[{...real,id:"importato",quote:"Mara vince la guerra."}];
    expect(buildNarrativeEventLedger(book)).toMatchObject({
      currentAffirmed:[],currentDismissed:[],nonCurrentCount:1,crossChapterActors:[],
    });
  });
  it("recupera attestazioni oltre il cap di 80 menzioni dell'indice",()=>{
    const book=sample(), ch=book.chapters[0]!;
    ch.scenes=Array.from({length:85},(_,i)=>({
      id:"scene-"+i,number:i+1,title:"Scena "+i,objective:"Traccia",
      text:"Mara scompare.",status:"canon" as const,
    }));
    const last=ch.scenes[84]!;
    const candidate=extractNarrativeEventCandidates(ch,last)[0]!;
    const decision=createNarrativeEventDecision(book,candidate,"affirmed",
      "Attestazione valida oltre il limite di indice.",crypto.randomUUID(),"2026-11-07T12:00:00Z");
    book.narrativeEventDecisions=[decision];
    expect(buildNarrativeEventCandidateIndex(book).events).toHaveLength(80);
    expect(buildNarrativeEventLedger(book).currentAffirmed[0]?.candidate.sceneId).toBe(last.id);
  });
});
