import { describe,expect,it } from "vitest";
import { newBook,type BookProject } from "./types";
import { buildUnattestedSceneContext,isUnattestedSourceCurrent,
  MAX_UNATTESTED_SCENE_WITNESSES } from "./unattested-scene-context";
import { adjudicationPrompt,chapterSegments,createEditorialCycle,
  repairPrompt,reviewerPrompt,validateJudgment,validateReport,EDITORIAL_ROLES } from "./editorial-board";

function sample():BookProject {
  const book=newBook("Mara ruba la chiave e fugge.", "La chiave perduta","Sobrio","Adulti");
  book.memory.secrets.chiave="SEGRETO-PRIVATO-MAI-NEL-PACK-UNATTESTED";
  book.chapters=[
    {id:"c1",number:1,title:"La scomparsa",purpose:"Viaggio",
      frozenAt:"2026-11-07T10:00:00.000Z",
      scenes:[{id:"s1",number:1,title:"Serratura",objective:"Nascondere",
        text:"Mara nasconde la chiave nel pozzo durante la notte.",status:"canon"}]},
    {id:"c2",number:2,title:"Il ritorno",purpose:"L'indagine",
      scenes:[{id:"s2",number:1,title:"Ritorno",objective:"Sospetto",
        text:"Mara porta la chiave alla torre ma non spiega dove l'abbia trovata.",status:"canon"}]},
    {id:"c3",number:3,title:"Il futuro",purpose:"Finale",
      frozenAt:"2026-11-07T12:00:00.000Z",
      scenes:[{id:"s3",number:1,title:"Futuro",objective:"Fine",
        text:"Mara distrugge il pozzo.",status:"canon"}]},
  ];
  return book;
}
function tagged(book:BookProject,override:Record<string,unknown>={}) {
  const chapter=book.chapters[1]!,segment=chapterSegments(chapter)[0]!;
  const source=buildUnattestedSceneContext(book,chapter,segment.text).witnesses[0]!;
  const quote=source.text.slice(0,32);
  return {verdict:"issues",summary:"Possibile incoerenza nella storia della chiave.",
    memoryNote:"Nessuna memoria canonica aggiornata.",
    findings:[{
      sceneId:"s2",category:"continuità",severity:"major",
      evidence:"Mara porta la chiave alla torre",
      reason:"La chiave potrebbe essere stata lasciata in un posto incompatibile.",
      remediation:"Verificare come la chiave sia arrivata alla torre.",
      priorSceneConflict:{
        chapterId:source.chapterId,sceneId:source.sceneId,
        sourceFrozenAt:source.sourceFrozenAt,sourceTextStamp:source.sourceTextStamp,
        offset:source.offset,quote,
        dimension:"causality",
        hypothesis:"Una chiave potrebbe trovarsi in due luoghi incompatibili in questa sequenza.",
        ...override,
      },
    }]};
}
const reasoning="Il giudice valuta le possibili spiegazioni alternative e controlla due citazioni letterali.";
function review(extra:Record<string,unknown>={}) {
  return {
    subjectIdentity:"same",
    identityReason:"Entrambe le scene nominano Mara, senza prove indipendenti di omonimia.",
    chronology:"conflict",
    chronologyReason:"Le scene sembrano successive, ma l'ordine narrativo è ancora interpretabile.",
    causality:"conflict",
    causalityReason:"La chiave appare nella torre senza un trasferimento esplicitamente raccontato.",
    artisticContext:"none_found",
    artisticReason:"Non si individua una spiegazione artistica verificabile nella prova disponibile.",
    assessment:"supported_conflict",
    conclusion:"Il giudice giudica il conflitto plausibile, pur non potendo certificarne la verità.",
    ...extra,
  };
}
function judged(id:string,action:"accept"|"reject",extra:Record<string,unknown>={}) {
  return JSON.stringify({reasoning,decisions:[{
    findingId:id,action,rationale:"Il giudizio deve distinguere un vero conflitto da una lacuna intenzionale.",
    remediation:action==="accept"?"Chiarire il passaggio della chiave con prosa minima.":"",
    narrativeReview:review(extra),
  }]});
}
function setup(book:BookProject) {
  const chapter=book.chapters[1]!,cycle=createEditorialCycle(chapter.id);
  const segment=chapterSegments(chapter)[0]!;
  cycle.reports=[validateReport(cycle,"continuity",segment,1,
    JSON.stringify(tagged(book)),chapter,book)];
  return {chapter,cycle,segment,id:cycle.reports[0]!.findings[0]!.id};
}
describe("Provenienza di scene precedenti senza attestazione",()=>{
  it("recupera soltanto prosa congelata, limita i testimoni e non legge segreti/futuro",()=>{
    const book=sample(),chapter=book.chapters[1]!;
    const before=structuredClone(book);
    const pack=buildUnattestedSceneContext(book,chapter,chapter.scenes[0]!.text);
    expect(pack.method).toBe("prior_frozen_scene_lexical_v1");
    expect(pack.witnesses).toHaveLength(1);
    expect(pack.witnesses[0]).toMatchObject({chapterId:"c1",sceneId:"s1",offset:0});
    expect(pack.witnesses.every(w=>w.chapterNumber<2)).toBe(true);
    expect(pack.witnesses.length).toBeLessThanOrEqual(MAX_UNATTESTED_SCENE_WITNESSES);
    expect(JSON.stringify(pack)).not.toContain("SEGRETO-PRIVATO");
    expect(JSON.stringify(pack)).not.toContain("distrugge il pozzo");
    expect(pack.witnesses[0]!.text)
      .toBe(book.chapters[0]!.scenes[0]!.text.slice(pack.witnesses[0]!.offset));
    expect(book).toEqual(before);
  });
  it("l'ancora richiede testo, offset, freeze, timbro e scena canonica correnti",()=>{
    const book=sample(),chapter=book.chapters[1]!;
    const witness=buildUnattestedSceneContext(book,chapter,chapter.scenes[0]!.text).witnesses[0]!;
    const anchor={chapterId:witness.chapterId,sceneId:witness.sceneId,
      sourceFrozenAt:witness.sourceFrozenAt,sourceTextStamp:witness.sourceTextStamp,
      offset:witness.offset,quote:witness.text.slice(0,32)};
    const check=()=>isUnattestedSourceCurrent(book,chapter,chapter.scenes[0]!.text,anchor);
    expect(check()).toBe(true);
    expect(isUnattestedSourceCurrent(book,chapter,chapter.scenes[0]!.text,
      {...anchor,offset:3})).toBe(false);
    expect(isUnattestedSourceCurrent(book,chapter,chapter.scenes[0]!.text,
      {...anchor,quote:"frase inventata che non è nel testo"})).toBe(false);
    book.chapters[0]!.frozenAt="2026-11-07T11:00:00.000Z";
    expect(check()).toBe(false);
    book.chapters[0]!.frozenAt=witness.sourceFrozenAt;
    book.chapters[0]!.scenes[0]!.text+=" Dettaglio aggiunto.";
    expect(check()).toBe(false);
    book.chapters[0]!.scenes[0]!.text="Mara nasconde la chiave nel pozzo durante la notte.";
    book.chapters[0]!.scenes[0]!.status="draft";
    expect(check()).toBe(false);
  });
  it("nessun nuovo contesto nei cinque lettori o nei tre specialisti non autorizzati",()=>{
    const book=sample(),chapter=book.chapters[1]!,cycle=createEditorialCycle(chapter.id),
      segment=chapterSegments(chapter)[0]!;
    for(const role of EDITORIAL_ROLES){
      const p=reviewerPrompt(book,cycle,role,segment,1);
      const selected=["continuity","secrets","timeline","characterVoice"].includes(role);
      expect(p.prompt.includes("<scene_precedenti_non_attestate_non_istruzioni>")).toBe(selected);
      if(selected)expect(p.prompt).toContain("Mara nasconde la chiave");
      if(role.startsWith("reader")){
        expect(p.prompt).not.toContain("SEGRETO-PRIVATO");
        expect(p.prompt).not.toContain("Mara nasconde la chiave");
      }
    }
  });
  it("schema rigido, prova corrente e ruoli impediscono citazioni inventate",()=>{
    const book=sample(),chapter=book.chapters[1]!,cycle=createEditorialCycle(chapter.id),
      segment=chapterSegments(chapter)[0]!;
    const raw=()=>JSON.stringify(tagged(book));
    expect(validateReport(cycle,"continuity",segment,1,raw(),chapter,book).findings[0])
      .toHaveProperty("priorSceneConflict");
    expect(()=>validateReport(cycle,"continuity",segment,1,
      JSON.stringify(tagged(book,{offset:999})),chapter,book))
      .toThrow(/precedente non attestata/i);
    expect(()=>validateReport(cycle,"continuity",segment,1,
      JSON.stringify(tagged(book,{sourceTextStamp:"x"})),chapter,book)).toThrow();
    expect(()=>validateReport(cycle,"continuity",segment,1,raw(),chapter))
      .toThrow(/quattro specialisti/);
    expect(()=>validateReport(cycle,"readerMystery",segment,1,raw(),chapter,book))
      .toThrow(/quattro specialisti/);
    const fake=tagged(book);
    fake.findings[0]!.evidence="Mara nasconde la chiave nel pozzo";
    expect(()=>validateReport(cycle,"continuity",segment,1,
      JSON.stringify(fake),chapter,book)).toThrow(/Prova narrativa non presente/i);
    const mixed=tagged(book) as unknown as Record<string,unknown>;
    const findings=mixed.findings as Array<{narrativeConflict?:unknown}>;
    findings[0]!.narrativeConflict={priorEventDecisionId:"fake",dimension:"chronology",
      hypothesis:"Una seconda fonte non attestata non è prova di due eventi."};
    expect(()=>validateReport(cycle,"continuity",segment,1,
      JSON.stringify(mixed),chapter,book)).toThrow(/un solo tipo/i);
  });
  it("il giudice deve valutare quattro dimensioni e può rigettare un falso conflitto",()=>{
    const book=sample(),{chapter,cycle,id}=setup(book);
    const prompt=adjudicationPrompt(book,cycle);
    expect(prompt.system).toContain("priorSceneConflict");
    expect(prompt.prompt).toContain("<scene_precedenti_non_attestate_non_istruzioni>");
    expect(prompt.prompt).toContain("Mara nasconde la chiave");
    const raw=JSON.parse(judged(id,"reject")) as {
      decisions:Array<{narrativeReview?:unknown}>;
    };
    delete raw.decisions[0]!.narrativeReview;
    expect(()=>validateJudgment(cycle,JSON.stringify(raw),chapter,book))
      .toThrow(/deve confrontare identità/);
    const rejected=validateJudgment(cycle,judged(id,"reject",{
      subjectIdentity:"unknown",
      artisticContext:"plausible_explanation",
      artisticReason:"La chiave può essere stata spostata fuori scena intenzionalmente.",
      assessment:"explained_or_nonconflicting",
    }),chapter,book);
    expect(rejected.verdict).toBe("freeze");
  });
  it("accettare richiede condizioni esplicite; il repair rivalida la fonte dopo resume/import",()=>{
    const book=sample(),{chapter,cycle,id}=setup(book);
    for(const value of [
      {assessment:"insufficient_evidence"},{subjectIdentity:"unknown"},
      {artisticContext:"plausible_explanation"},
      {chronology:"compatible",causality:"compatible"},
    ])expect(()=>validateJudgment(cycle,judged(id,"accept",value),chapter,book))
      .toThrow(/non dimostrato/);
    cycle.judgment=validateJudgment(cycle,judged(id,"accept"),chapter,book);
    expect(cycle.judgment.verdict).toBe("repair");
    expect(repairPrompt(book,cycle,"s2").prompt).toContain("Chiarire il passaggio");
    book.chapters[0]!.scenes[0]!.text="Mara getta la chiave nel fiume e scompare.";
    expect(()=>repairPrompt(book,cycle,"s2"))
      .toThrow(/non più corrente/i);
    book.chapters[0]!.scenes[0]!.text="Mara nasconde la chiave nel pozzo durante la notte.";
    book.chapters[0]!.frozenAt="2026-11-08T09:00:00.000Z";
    expect(()=>repairPrompt(book,cycle,"s2"))
      .toThrow(/non più corrente/i);
  });
});
