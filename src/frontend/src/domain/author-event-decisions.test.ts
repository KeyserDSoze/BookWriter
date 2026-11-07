import {describe,expect,it} from "vitest";
import {newBook} from "./types";
import {extractNarrativeEventCandidates} from "./narrative-event-candidates";
import {appendAuthorEventDecision,authorEventDecisionHistory,authorEventStatus,
  confirmedAuthorNarrativeEvents,sceneTextFingerprint} from "./author-event-decisions";
import {buildContinuityEvidence,markDownstreamContinuity} from "./cross-chapter-continuity";
import {adjudicationPrompt,chapterSegments,createEditorialCycle,reviewerPrompt} from "./editorial-board";

const date="2026-11-07T11:10:00.000Z";
const motivation="Questa consegna avviene realmente davanti a più testimoni nella scena.";
function sample(){
  const book=newBook("Un segreto","Libro","Stile sobrio","Adulti");
  book.memory.secrets.chiave="PRIVATO: la chiave è falsa e nessuno lo sa";
  book.chapters=[1,2].map(n=>({
    id:"ch-"+n,number:n,title:"Capitolo "+n,purpose:"Un passaggio",
    frozenAt:date,summary:"Sintesi",
    scenes:[{id:"s-"+n,number:1,title:"Scena",objective:"Trama",status:"canon" as const,
      text:n===1?"Mara consegna la chiave a Elio. Poi torna al castello."
        :"Elio cerca la chiave e incontra il guardiano.",
      characters:["Elio","Mara"],items:["chiave"]}],
  }));
  const chapter=book.chapters[0]!,scene=chapter.scenes[0]!;
  const candidate=extractNarrativeEventCandidates(chapter,scene)[0]!;
  return {book,chapter,scene,candidate};
}

describe("Attestazioni esplicite dell'autore su menzioni narrative",()=>{
  it("registra la conferma con quote originale, motivazione e versione dell'intera scena",()=>{
    const {chapter,scene,candidate}=sample();
    expect(authorEventStatus(chapter,candidate)).toBe("pending");
    const confirmed=appendAuthorEventDecision(chapter,candidate,"confirmed",motivation,date);
    expect(confirmed).toMatchObject({
      chapterId:"ch-1",sceneId:"s-1",quote:"Mara consegna la chiave a Elio",
      offset:0,verdict:"confirmed",sourceFrozenAt:date,
    });
    expect(confirmed.sourceSceneFingerprint).toBe(sceneTextFingerprint(scene.text));
    expect(authorEventStatus(chapter,candidate)).toBe("confirmed");
    expect(confirmedAuthorNarrativeEvents(chapter,scene)).toEqual([expect.objectContaining({
      kind:"item_transfer_mention",evidenceStatus:"author_confirmed_interpretation",
      sceneId:"s-1",quote:candidate.quote,
    })]);
    expect(JSON.stringify(confirmedAuthorNarrativeEvents(chapter,scene))).not.toContain(motivation);
  });

  it("rende obsolete le decisioni se cambia QUALSIASI parte della scena o il freeze",()=>{
    const {chapter,scene,candidate}=sample();
    appendAuthorEventDecision(chapter,candidate,"confirmed",motivation,date);
    scene.text+=" Un personaggio diverso entra dalla finestra.";
    expect(authorEventStatus(chapter,candidate)).toBe("stale");
    expect(confirmedAuthorNarrativeEvents(chapter,scene)).toHaveLength(0);
    scene.text=scene.text.replace(" Un personaggio diverso entra dalla finestra.","");
    chapter.frozenAt=undefined;
    expect(authorEventStatus(chapter,candidate)).toBe("stale");
    expect(confirmedAuthorNarrativeEvents(chapter,scene)).toHaveLength(0);
    chapter.frozenAt="2026-11-07T11:12:00.000Z";
    expect(authorEventStatus(chapter,candidate)).toBe("stale");
  });

  it("respinge e ritira conservando lo storico append-only; mai riattiva una vecchia conferma",()=>{
    const {chapter,scene,candidate}=sample();
    appendAuthorEventDecision(chapter,candidate,"confirmed",motivation,date);
    appendAuthorEventDecision(chapter,candidate,"rejected",
      "Il narratore descrive una menzogna del guardiano, non una consegna.", "2026-11-07T11:11:00.000Z");
    expect(authorEventStatus(chapter,candidate)).toBe("rejected");
    expect(confirmedAuthorNarrativeEvents(chapter,scene)).toHaveLength(0);
    appendAuthorEventDecision(chapter,candidate,"withdrawn",
      "Ritiro esplicitamente il giudizio precedente per mancanza di prove.","2026-11-07T11:12:00.000Z");
    expect(authorEventStatus(chapter,candidate)).toBe("withdrawn");
    expect(chapter.authorEventDecisions?.map(d=>d.verdict)).toEqual(["confirmed","rejected","withdrawn"]);
    expect(()=>appendAuthorEventDecision(chapter,candidate,"withdrawn",motivation,
      "2026-11-07T11:13:00.000Z")).toThrow(/già attiva/);
  });

  it("blocca consenso inventato e documenti ostili, fallendo prima di promuovere",()=>{
    const {chapter,candidate}=sample();
    expect(()=>appendAuthorEventDecision(chapter,{...candidate,quote:"Chiave inventata"},
      "confirmed",motivation,date)).toThrow(/obsoleta/);
    expect(()=>appendAuthorEventDecision(chapter,candidate,"confirmed","sì",date))
      .toThrow(/Motivazione/);
    appendAuthorEventDecision(chapter,candidate,"confirmed",motivation,date);
    chapter.authorEventDecisions![0]!.sourceSceneFingerprint="garbage";
    expect(()=>authorEventDecisionHistory(chapter)).toThrow(/alterato/);
    expect(()=>confirmedAuthorNarrativeEvents(chapter,chapter.scenes[0]!)).toThrow(/alterato/);
  });

  it("backup importato non produce canone confermato fino a nuova attestazione locale",()=>{
    const {chapter,scene,candidate}=sample();
    appendAuthorEventDecision(chapter,candidate,"confirmed",motivation,date);
    chapter.authorEventDecisions![0]!.importedUnverified=true;
    expect(authorEventStatus(chapter,candidate)).toBe("imported_unverified");
    expect(confirmedAuthorNarrativeEvents(chapter,scene)).toEqual([]);
    appendAuthorEventDecision(chapter,candidate,"confirmed",
      "Ho consultato personalmente la scena dopo l'importazione e confermo.", 
      "2026-11-07T11:15:00.000Z");
    expect(authorEventStatus(chapter,candidate)).toBe("confirmed");
  });

  it("gli eventi dichiarati entrano nei soli campioni specialistici/giudice, mai ai lettori ciechi",()=>{
    const {book,chapter,scene,candidate}=sample();
    appendAuthorEventDecision(chapter,candidate,"confirmed",motivation,date);
    markDownstreamContinuity(book,chapter,"author_event_attestation",[scene.id]);
    const next=book.chapters[1]!;
    const pack=buildContinuityEvidence(book,next,next.scenes[0])!;
    expect(pack.scenes[0]?.authorConfirmedEvents?.[0]).toMatchObject({
      evidenceStatus:"author_confirmed_interpretation",quote:candidate.quote,
    });
    expect(JSON.stringify(pack)).not.toContain(motivation);
    expect(JSON.stringify(pack)).not.toContain("PRIVATO:");
    const cycle=createEditorialCycle(next.id),segment=chapterSegments(next)[0]!;
    const specialist=reviewerPrompt(book,cycle,"continuity",segment,1);
    const judge=adjudicationPrompt(book,cycle);
    const blind=reviewerPrompt(book,cycle,"readerCasual",segment,1);
    expect(specialist.prompt).toContain("author_confirmed_interpretation");
    expect(judge.prompt).toContain("author_confirmed_interpretation");
    expect(blind.prompt).not.toContain("author_confirmed_interpretation");
    expect(blind.prompt).not.toContain(candidate.quote);
    expect(specialist.prompt).not.toContain(motivation);
  });
});
