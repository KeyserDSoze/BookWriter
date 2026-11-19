import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import { extractNarrativeEventCandidates } from "./narrative-event-candidates";
import { createNarrativeEventDecision } from "./narrative-event-decisions";
import { createNarrativeAliasDecision } from "./narrative-alias-decisions";
import { buildAttestedReviewContext, MAX_ATTESTED_REVIEW_WITNESSES }
  from "./attested-editorial-context";

function sample(): BookProject {
  const book = newBook("Una storia segreta.", "Romanzo", "Prosa", "Adulti");
  book.memory.secrets.chiave = "SEGRETO-PRIVATO-NON-CONTESTO-0123";
  book.chapters = [
    {id:"c1",number:1,title:"Il passato",purpose:"Morte",
      frozenAt:"2026-11-07T10:00:00Z",
      scenes:[{id:"s1",number:1,title:"Prima",objective:"Evento",text:"Mara muore.",
        status:"canon"}]},
    {id:"c2",number:2,title:"L'ombra",purpose:"Ritorno",
      frozenAt:"2026-11-07T11:00:00Z",
      scenes:[{id:"s2",number:1,title:"Seconda",objective:"Evento",text:"Ombra arriva.",
        status:"canon"}]},
    {id:"c3",number:3,title:"Proseguimento",purpose:"Dubbi",
      scenes:[{id:"s3",number:1,title:"Terza",objective:"Evento",
        text:"Ombra attraversa il cortile e chiama il guardiano.",status:"canon"}]},
    {id:"c4",number:4,title:"Futuro",purpose:"Finale",
      frozenAt:"2026-11-07T12:00:00Z",
      scenes:[{id:"s4",number:1,title:"Ultima",objective:"Evento",
        text:"Ombra fugge.",status:"canon"}]},
  ];
  return book;
}
function affirm(book:BookProject,i:number) {
  const ch=book.chapters[i]!, scene=ch.scenes[0]!;
  const candidate=extractNarrativeEventCandidates(ch,scene)[0]!;
  const d=createNarrativeEventDecision(book,candidate,"affirmed",
    "L'autore considera valida questa menzione narrativa.",
    crypto.randomUUID(),"2026-11-07T14:00:00Z");
  book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),d];
  return d;
}
describe("Contesto selettivo di attestazioni precedenti per la redazione",()=>{
  it("recupera solo citazioni ancorate anteriori e NON copie di memory o motivazioni",()=>{
    const book=sample(); affirm(book,0);affirm(book,1);affirm(book,3);
    const before=structuredClone(book);
    const result=buildAttestedReviewContext(book,book.chapters[2]!,
      "Ombra attraversa il cortile e chiama il guardiano.");
    expect(result.method).toBe("prior_affirmed_literal_names_v1");
    expect(result.witnesses).toMatchObject([{
      chapterNumber:2,sceneId:"s2",actor:"Ombra",quote:"Ombra arriva",
      offset:0,matchBasis:"literal_name",
    }]);
    expect(result.priorAttestationCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain("SEGRETO-PRIVATO");
    expect(JSON.stringify(result)).not.toContain("considera valida");
    expect(result.witnesses[0]?.quote).toBe(
      book.chapters[1]!.scenes[0]!.text.slice(
        result.witnesses[0]!.offset,
        result.witnesses[0]!.offset+result.witnesses[0]!.quote.length,
      ));
    expect(book).toEqual(before);
  });
  it("segue una sola coppia alias approvata con entrambe le fonti precedenti",()=>{
    const book=sample();affirm(book,0);affirm(book,1);
    const alias=createNarrativeAliasDecision(book,"Mara","Ombra","linked",
      "SEGRETO-ALIAS-PRIVATO non va nel prompt della redazione.",
      crypto.randomUUID(),"2026-11-07T14:10:00Z");
    book.narrativeAliasDecisions=[alias];
    const result=buildAttestedReviewContext(book,book.chapters[2]!,
      book.chapters[2]!.scenes[0]!.text);
    expect(result.eligibleAliasPairCount).toBe(1);
    expect(result.witnesses).toMatchObject([
      {actor:"Ombra",matchBasis:"literal_name"},
      {actor:"Mara",matchBasis:"saved_alias",matchedAs:"Ombra",aliasDecisionId:alias.id},
    ]);
    expect(JSON.stringify(result)).not.toContain("SEGRETO-ALIAS-PRIVATO");
    expect(book.memory.secrets.chiave).toContain("SEGRETO-PRIVATO");
  });
  it("ignora alias futuro, stale, revocato e fonte a cui è cambiato il freeze",()=>{
    const book=sample();affirm(book,0);affirm(book,1);affirm(book,3);
    const alias=createNarrativeAliasDecision(book,"Mara","Ombra","linked",
      "Per l'autore i nomi rappresentano un possibile alias.",
      crypto.randomUUID(),"2026-11-07T14:10:00Z");
    book.narrativeAliasDecisions=[alias];
    const context=()=>buildAttestedReviewContext(book,book.chapters[2]!,"Ombra si volta.");
    expect(context().witnesses).toHaveLength(2);
    // A newer decision on the same pair overrides the preceding one.
    book.narrativeAliasDecisions.push(createNarrativeAliasDecision(book,"Ombra","Mara","separated",
      "Le identità sono distinte per decisione dell'autore.",
      crypto.randomUUID(),"2026-11-07T14:20:00Z"));
    expect(context().witnesses.map(w=>w.actor)).toEqual(["Ombra"]);
    book.narrativeAliasDecisions=[alias];
    book.chapters[0]!.frozenAt="2026-11-08T10:00:00Z";
    expect(context().witnesses.map(w=>w.actor)).toEqual(["Ombra"]);
    book.chapters[0]!.frozenAt="2026-11-07T10:00:00Z";
    book.narrativeAliasDecisions=[createNarrativeAliasDecision(book,"Mara","Ombra","linked",
      "L'autore collega due nomi per una prova.",
      crypto.randomUUID(),"2026-11-07T14:30:00Z")];
    // The current alias now hinges on the future 'Ombra' attestation, not prior witnesses.
    book.narrativeAliasDecisions[0]!.secondEventDecisionId=book.narrativeEventDecisions![2]!.id;
    expect(context().witnesses.map(w=>w.actor)).toEqual(["Ombra"]);
  });
  it("non fa match su parti di parole, nomi non letti o capitoli successivi",()=>{
    const book=sample();affirm(book,0);affirm(book,1);affirm(book,3);
    expect(buildAttestedReviewContext(book,book.chapters[2]!,"Maradona parte.")
      .witnesses).toHaveLength(0);
    expect(buildAttestedReviewContext(book,book.chapters[2]!,"mara rientra.")
      .witnesses.map(w=>w.actor)).toEqual(["Mara"]);
    expect(buildAttestedReviewContext(book,book.chapters[2]!,"Narratore non indica identità.")
      .witnesses).toHaveLength(0);
  });
  it("limita a otto le prove e dichiara quelle omesse, con ordine deterministico",()=>{
    const book=sample(),chapter=book.chapters[0]!;
    chapter.scenes=Array.from({length:12},(_,i)=>({
      id:"event-"+i,number:i+1,title:"Traccia",objective:"Continuare",
      text:"Mara parte.",status:"canon" as const,
    }));
    for(const scene of chapter.scenes) {
      const candidate=extractNarrativeEventCandidates(chapter,scene)[0]!;
      const d=createNarrativeEventDecision(book,candidate,"affirmed",
        "Attestazione valida per test di copertura.",
        crypto.randomUUID(),"2026-11-07T14:00:00Z");
      book.narrativeEventDecisions=[...(book.narrativeEventDecisions??[]),d];
    }
    const result=buildAttestedReviewContext(book,book.chapters[2]!,"Mara entra nella stanza.");
    expect(result.witnesses).toHaveLength(MAX_ATTESTED_REVIEW_WITNESSES);
    expect(result.relevantWitnessCount).toBe(12);
    expect(result.omittedWitnessCount).toBe(4);
    expect(result.witnesses.map(w=>w.sceneNumber)).toEqual([12,11,10,9,8,7,6,5]);
  });
});
