import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import {
  EDITORIAL_ROLES, assertEditorialReviewCoverage,
  assertSavedEditorialFreezeJudgmentIntegrity, chapterSegments,
  createEditorialCycle, validateJudgment, validateReport,
  type ChapterEditorialCycle,
} from "./editorial-board";
import { editorialRecoveryProblem } from "../application/editorial-control";

function fixture(twoScenes = false): {book: BookProject;cycle:ChapterEditorialCycle;id:string} {
  const book = newBook("Mara incontra il guardiano del castello.",
    "Il segreto del portone", "Sobrio", "Adulti");
  book.phase="chapterReview";book.status="paused";
  book.chapters=[{id:"c1",number:1,title:"Il portone",purpose:"Incontrare il guardiano",
    scenes:[{id:"s1",number:1,title:"L'arrivo",objective:"Introdurre il mistero",
      text:"Mara incontra il guardiano davanti al portone del castello.",status:"canon"},
      ...(twoScenes ? [{id:"s2",number:2,title:"La chiave",
        objective:"Svelare un indizio",
        text:"Il guardiano nasconde una chiave sotto il vecchio mantello.",status:"canon" as const}] : []),
    ]}];
  const chapter=book.chapters[0]!;
  const cycle=createEditorialCycle(chapter.id);
  const segments=chapterSegments(chapter);
  for(const role of EDITORIAL_ROLES)for(const segment of segments) {
    const finding=role==="style" && segment.index===0;
    const raw=JSON.stringify(finding ? {
      verdict:"issues",summary:"Lo stile del primo incontro merita un controllo.",
      memoryNote:"",findings:[{
        sceneId:segment.sceneId,category:"stile",severity:"minor",
        evidence:"Mara incontra il guardiano",
        reason:"L'incipit può risultare troppo esplicito nel ritmo.",
        remediation:"Valutare un'apertura più atmosferica senza cambiare il canone.",
      }],
    } : {verdict:"pass",summary:"Nessun problema narrativo dimostrato.",
      memoryNote:"",findings:[]});
    cycle.reports.push(validateReport(cycle,role,segment,segments.length,raw,chapter,book));
  }
  const id="1:style:0:0";
  cycle.judgment=validateJudgment(cycle,JSON.stringify({
    reasoning:"La battuta introduttiva è intenzionale e la critica non richiede intervento.",
    decisions:[{findingId:id,action:"reject",
      rationale:"Il ritmo serve ad aprire il mistero senza introdurre un errore.",
      remediation:""}],
  }),chapter,book);
  cycle.stage="summary";cycle.summaryCursor=0;
  book.editorialCycle=cycle;
  return {book,cycle,id};
}

describe("Guardia sul giudizio freeze salvato prima del summary",()=>{
  it("accetta report 12×N e un giudizio completo che respinge criticamente il finding",()=>{
    const {book,cycle}=fixture();
    const before=structuredClone(cycle);
    expect(assertEditorialReviewCoverage(book,cycle,true).reportCount).toBe(12);
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle)).not.toThrow();
    expect(editorialRecoveryProblem(book)).toBeUndefined();
    expect(cycle).toEqual(before);
  });
  it("blocca decisioni assenti, duplicate e inventate nonostante il verdetto freeze",()=>{
    const {book,cycle,id}=fixture();
    cycle.judgment!.decisions=[];
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle))
      .toThrow(/non ha valutato tutti/);
    expect(editorialRecoveryProblem(book)).toMatch(/tutti/);
    const original=fixture().cycle.judgment!.decisions[0]!;
    cycle.judgment!.decisions=[original,{...original}];
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle))
      .toThrow(/duplicato/);
    cycle.judgment!.decisions=[{...original,findingId:"fake"}];
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle))
      .toThrow(/inesistente/);
    expect(cycle.reports.flatMap(report=>report.findings.map(f=>f.id))).toEqual([id]);
  });
  it("non tratta freeze come autorità se il giudice aveva accettato una riscrittura",()=>{
    const {book,cycle}=fixture();
    cycle.judgment!.decisions[0]!.action="accept";
    cycle.judgment!.decisions[0]!.remediation=
      "Riscrivere l'incipit modificando solo il ritmo del primo incontro.";
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle))
      .toThrow(/verdetto freeze incoerente/);
    expect(editorialRecoveryProblem(book)).toMatch(/verdetto freeze/);
  });
  it("blocca timestamp, schema e verdetto corrotti anche con review complete",()=>{
    const {book,cycle}=fixture();
    cycle.judgment!.createdAt="data impossibile";
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle))
      .toThrow(/giudizio freeze salvato/);
    cycle.judgment!.createdAt="2026-11-10T12:00:00.000Z";
    cycle.judgment!.decisions[0]!.rationale="breve";
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle))
      .toThrow(/schema del giudizio/);
    cycle.judgment!.decisions[0]!.rationale=
      "Il testo è volutamente lineare e non necessita di modifiche.";
    cycle.judgment!.verdict="repair";
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle))
      .toThrow(/giudizio freeze salvato/);
  });
  it("la sintesi parziale sana continua, ma cursor/riassunti finti non saltano segmenti",()=>{
    const {book,cycle}=fixture(true);
    expect(assertEditorialReviewCoverage(book,cycle,true).reportCount).toBe(24);
    cycle.summaryCursor=1;
    cycle.runningChapterSummary=
      "Nel primo incontro Mara vede il guardiano davanti al portone.";
    cycle.runningBookSummary=
      "Il racconto comincia con Mara davanti al castello e un mistero.";
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle)).not.toThrow();
    expect(editorialRecoveryProblem(book)).toBeUndefined();
    cycle.runningChapterSummary=undefined;
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle))
      .toThrow(/sinossi progressive/);
    expect(editorialRecoveryProblem(book)).toMatch(/sinossi progressive/);
    cycle.runningChapterSummary=
      "Nel primo incontro Mara vede il guardiano davanti al portone.";
    cycle.summaryCursor=2;
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle))
      .toThrow(/cursore delle sinossi/);
    cycle.summaryCursor=-1;
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle))
      .toThrow(/cursore delle sinossi/);
    cycle.summaryCursor=Number.NaN;
    expect(()=>assertSavedEditorialFreezeJudgmentIntegrity(book,cycle))
      .toThrow(/cursore delle sinossi/);
  });
});
