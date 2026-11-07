import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import { extractNarrativeEventCandidates } from "./narrative-event-candidates";
import { createNarrativeEventDecision } from "./narrative-event-decisions";
import { buildNarrativeContinuityHints, MAX_NARRATIVE_CONTINUITY_HINTS }
  from "./narrative-continuity-hints";

function fixture(texts: string[], dates: Array<string|undefined> = []) {
  const book = newBook("Trama", "Prove", "Prosa", "Adulti");
  book.chapters = texts.map((text,i)=>({
    id:"c"+i,number:i+1,title:"Capitolo",purpose:"Prova",
    frozenAt:"2026-11-07T10:00:00Z",
    scenes:[{id:"s"+i,number:1,title:"Scena",objective:"Evento",text,
      date:dates[i],status:"canon" as const}],
  }));
  return book;
}
function affirm(book: BookProject, chapter: number, index = 0, verdict: "affirmed"|"dismissed" = "affirmed") {
  const ch=book.chapters[chapter]!, sc=ch.scenes[0]!;
  const candidate=extractNarrativeEventCandidates(ch,sc)[index]!;
  const decision=createNarrativeEventDecision(book,candidate,verdict,
    "Confermato nel contesto dell'opera.",crypto.randomUUID(),"2026-11-07T11:00:00Z");
  book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),decision];
  return decision;
}
describe("Segnali consultivi fra attestazioni ancora valide",()=>{
  it("segnala un'attività dopo una morte senza toccare memoria o freeze",()=>{
    const book=fixture(["Mara muore.","Mara parte."]);
    affirm(book,0);affirm(book,1);
    const before=structuredClone(book);
    const index=buildNarrativeContinuityHints(book);
    expect(index.hints).toHaveLength(1);
    expect(index.hints[0]).toMatchObject({
      kind:"post_death_activity",actor:"Mara",
      earlier:{candidate:{chapterId:"c0",quote:"Mara muore"}},
      later:{candidate:{chapterId:"c1",quote:"Mara parte"}},
    });
    expect(book).toEqual(before);
  });
  it("segnala una seconda morte attestata se non è attestata una risurrezione",()=>{
    const book=fixture(["Elio muore.","Elio muore."]);
    affirm(book,0);affirm(book,1);
    expect(buildNarrativeContinuityHints(book).hints.map(h=>h.kind)).toEqual(["repeated_death"]);
  });
  it("la risurrezione intermedia interrompe il confronto con la morte precedente",()=>{
    const book=fixture(["Mara muore.","Mara risorge.","Mara arriva."]);
    affirm(book,0);affirm(book,1);affirm(book,2);
    expect(buildNarrativeContinuityHints(book).hints).toHaveLength(0);
  });
  it("esclude decisioni respinte, rettificate, stale e capitoli non congelati",()=>{
    const book=fixture(["Mara muore.","Mara parte."]);
    affirm(book,0);affirm(book,1);
    affirm(book,0,0,"dismissed");
    expect(buildNarrativeContinuityHints(book).hints).toHaveLength(0);
    affirm(book,0);
    book.chapters[0]!.scenes[0]!.text+=" Mutato.";
    expect(buildNarrativeContinuityHints(book).hints).toHaveLength(0);
    book.chapters[0]!.frozenAt=undefined;
    expect(buildNarrativeContinuityHints(book).hints).toHaveLength(0);
  });
  it("le date sono segnalate solo se ISO reali e in capitoli distinti",()=>{
    const book=fixture(["Lia arriva.","Lia parte.","Lia ritorna."],
      ["2030-03-04","2030-02-28","febbraio 2030"]);
    affirm(book,0);affirm(book,1);affirm(book,2);
    expect(buildNarrativeContinuityHints(book).hints.map(h=>h.kind)).toEqual(["declared_date_backtrack"]);
    book.chapters[1]!.scenes[0]!.date="2030-02-30";
    expect(buildNarrativeContinuityHints(book).hints).toHaveLength(0);
  });
  it("non accorpa omonimi distinti come se fossero un'identità provata",()=>{
    const book=fixture(["Mara muore.","Maria arriva.","Elio parte."]);
    affirm(book,0);affirm(book,1);affirm(book,2);
    expect(buildNarrativeContinuityHints(book).hints).toHaveLength(0);
  });
  it("tronca i segnali visibili a 40 dichiarando le omissioni",()=>{
    const texts=["Mara muore.",...Array.from({length:50},()=>"Mara parte.")];
    const book=fixture(texts);
    for(let i=0;i<texts.length;i++)affirm(book,i);
    const index=buildNarrativeContinuityHints(book);
    expect(index.inspectedAttestationCount).toBe(51);
    expect(index.hints).toHaveLength(MAX_NARRATIVE_CONTINUITY_HINTS);
    expect(index.omittedHintCount).toBe(10);
  });
});
