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


describe("Anteprima esplicita e temporanea di una coppia alias",()=>{
  it("aggiunge solo confronti fra i due nomi selezionati, senza scrivere il libro",()=>{
    const book=fixture(["Mara muore.","Ombra parte."]);
    affirm(book,0);affirm(book,1);
    const before=structuredClone(book);
    const base=buildNarrativeContinuityHints(book);
    expect(base.hints).toHaveLength(0);
    expect(base.aliasPreviewActive).toBe(false);
    const preview=buildNarrativeContinuityHints(book,{first:"Mara",second:"Ombra"});
    expect(preview.aliasPreviewActive).toBe(true);
    expect(preview.hints).toMatchObject([{
      kind:"post_death_activity", identityBasis:"alias_preview",
      earlier:{candidate:{actor:"Mara",quote:"Mara muore"}},
      later:{candidate:{actor:"Ombra",quote:"Ombra parte"}},
    }]);
    expect(book).toEqual(before);
  });
  it("non sopprime mai segnali di nome letterale già presenti",()=>{
    const book=fixture(["Mara muore.","Mara parte.","Ombra fugge."]);
    affirm(book,0); affirm(book,1); affirm(book,2);
    const base=buildNarrativeContinuityHints(book).hints;
    const preview=buildNarrativeContinuityHints(book,{first:"Ombra",second:"Mara"}).hints;
    expect(base).toHaveLength(1);
    expect(base[0]!.identityBasis).toBe("literal_name");
    expect(preview.filter(h=>h.identityBasis==="literal_name")).toEqual(base);
    expect(preview.some(h=>h.identityBasis==="alias_preview" &&
      h.later.candidate.actor==="Ombra")).toBe(true);
  });
  it("rifiuta nomi identici, sconosciuti o privi di decisioni correnti",()=>{
    const book=fixture(["Mara muore.","Ombra parte."]);
    affirm(book,0); affirm(book,1);
    for(const pair of [
      {first:"Mara",second:"mara"}, {first:"Mara",second:"Inventato"},
      {first:"",second:"Ombra"},
    ]) {
      const idx=buildNarrativeContinuityHints(book,pair);
      expect(idx.aliasPreviewActive).toBe(false);
      expect(idx.hints).toHaveLength(0);
    }
    book.chapters[1]!.frozenAt=undefined;
    expect(buildNarrativeContinuityHints(book,{first:"Mara",second:"Ombra"})
      .aliasPreviewActive).toBe(false);
  });
  it("le rettifiche e le decisioni respinte escludono il nome dal confronto",()=>{
    const book=fixture(["Mara muore.","Ombra parte."]);
    affirm(book,0);affirm(book,1);
    affirm(book,1,0,"dismissed");
    const preview=buildNarrativeContinuityHints(book,{first:"Mara",second:"Ombra"});
    expect(preview.aliasPreviewActive).toBe(false);
    expect(preview.hints).toHaveLength(0);
  });
  it("una risurrezione attestata fra gli alias impedisce la pista post-mortem",()=>{
    const book=fixture(["Mara muore.","Ombra risorge.","Ombra parte."]);
    affirm(book,0); affirm(book,1); affirm(book,2);
    const preview=buildNarrativeContinuityHints(book,{first:"Mara",second:"Ombra"});
    expect(preview.aliasPreviewActive).toBe(true);
    expect(preview.hints).toHaveLength(0);
  });
  it("confronta date ISO per nomi diversi solo dopo la scelta esplicita",()=>{
    const book=fixture(["Mara parte.","Ombra arriva."],["2030-06-10","2030-05-01"]);
    affirm(book,0); affirm(book,1);
    expect(buildNarrativeContinuityHints(book).hints).toHaveLength(0);
    const preview=buildNarrativeContinuityHints(book,{first:"Mara",second:"Ombra"});
    expect(preview.hints.map(h=>[h.kind,h.identityBasis]))
      .toEqual([["declared_date_backtrack","alias_preview"]]);
  });
});
