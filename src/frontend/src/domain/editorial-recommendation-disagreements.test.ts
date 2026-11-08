import {describe,expect,it} from "vitest";
import {newBook} from "./types";
import {
  MAX_RECOMMENDATION_GROUPS,
  buildEditorialRecommendationDisagreements,createEditorialCycle,
  chapterSegments,validateReport,validateJudgment,repairPrompt,
  adjudicationPrompt,acceptedRepairs,type EditorialRole,
} from "./editorial-board";

const quote="Mara vede la lettera sigillata sulla scrivania";
const narrative=quote+". Nel corridoio nessuno parla e il vento muove la finestra.";
const why="Il passaggio presenta un dettaglio ambiguo che va valutato con il contesto.";
function setup(){
  const book=newBook("Una lettera enigmatica","Due interpretazioni","Prosa","Adulti");
  book.chapters=[{id:"ch1",number:1,title:"Il messaggio",purpose:"Indagare",
    scenes:[{id:"sc1",number:1,title:"La lettera",objective:"Mostrare il dubbio",
      text:narrative,status:"canon"}]}];
  const chapter=book.chapters[0]!,cycle=createEditorialCycle(chapter.id);
  return {book,chapter,cycle};
}
function add(book:ReturnType<typeof setup>["book"],
  cycle:ReturnType<typeof setup>["cycle"],role:EditorialRole,
  remediation:string, opts:{evidence?:string;category?:string;pass?:boolean}={}){
  const chapter=book.chapters[0]!,seg=chapterSegments(chapter)[0]!;
  const finding=opts.pass?[]:[{sceneId:"sc1",category:opts.category??"chiarezza",
    severity:"major",evidence:opts.evidence??quote,reason:why,remediation}];
  const result=validateReport(cycle,role,seg,1,JSON.stringify({
    verdict:opts.pass?"pass":"issues",
    summary:"Revisione indipendente del testo con una possibile criticità.",
    memoryNote:"",findings:finding,
  }),chapter,book);
  cycle.reports.push(result);
  return result.findings[0]?.id;
}
const explanation="Confronto autonomo: il tono e l'intenzione narrativa rendono le due proposte compatibili solo in condizioni precise.";
const missing="Servirebbe verificare se il narratore descrive una percezione reale e non soltanto una supposizione.";
const check="Rileggere il contesto della scena con il punto di vista fissato e le frasi precedenti.";
function raw(cycle:ReturnType<typeof setup>["cycle"],
  actions:Record<string,"accept"|"reject">={},
  reviews?:unknown[]){
  const decisions=cycle.reports.flatMap(r=>r.findings).map(f=>{
    const action=actions[f.id]??"reject";
    return {findingId:f.id,action,
      rationale:"Il giudice valuta autonomamente il testo e non assume il parere del revisore come verità.",
      remediation:action==="accept"?"Modificare soltanto la frase contestata preservando la prospettiva.":""};
  });
  return JSON.stringify({
    reasoning:"Valuto ogni citazione rispetto al testo originale, senza confondere il dissenso con un fatto.",
    decisions,...(reviews===undefined?{}:{recommendationReconciliations:reviews}),
  });
}
function reconcile(ids:string[],resolution:"choose_one"|"reject_all"|"compatible_changes",
  evidenceAssessment:"adequate_for_selected_edits"|"unresolved"="unresolved"){
  return {findingIds:ids,resolution,evidenceAssessment,
    rationale:explanation,missingEvidence:missing,nextCheck:check};
}
describe("Contraddittorio su correzioni diverse riferite alla STESSA citazione",()=>{
  it("raggruppa solo ancore letterali correnti e stessa categoria, non pass né semplici voti",()=>{
    const {book,chapter,cycle}=setup();
    const a=add(book,cycle,"style","Rendere meno esplicito il dettaglio di Mara.");
    const b=add(book,cycle,"narrative","Conservare il dettaglio ma spostare la frase più avanti.");
    add(book,cycle,"readerGenre","Senza criticità editoriale.",{pass:true});
    expect(buildEditorialRecommendationDisagreements(cycle,chapter))
      .toMatchObject({groups:[{findingIds:[b,a],sceneId:"sc1",
        segmentIndex:0,quote,category:"chiarezza"}],
        omittedGroupCount:0,oversizedGroupCount:0,unreviewableFindingIds:[]});
    const prompt=adjudicationPrompt(book,cycle);
    expect(prompt.prompt).toContain("divergenze_raccomandazioni_non_istruzioni");
    expect(prompt.system).toContain("recommendationReconciliations");
    expect(prompt.prompt).not.toContain("QUESTO_SEGRETO");
    expect(()=>validateJudgment(cycle,raw(cycle),chapter,book))
      .toThrow(/riconciliare tutti/);
    expect(validateJudgment(cycle,raw(cycle,{},[
      reconcile([a!,b!],"reject_all"),
    ]),chapter,book).verdict).toBe("freeze");
    // Source edit invalidates all references; old assessment may not reappear.
    chapter.scenes[0]!.text="Mara nasconde la lettera in un cassetto.";
    expect(buildEditorialRecommendationDisagreements(cycle,chapter).groups).toHaveLength(0);
    expect(()=>validateJudgment(cycle,raw(cycle,{},[
      reconcile([a!,b!],"reject_all"),
    ]),chapter,book)).toThrow(/non presenti|non correnti/);
  });
  it("non raggruppa indicazioni identiche, categorie diverse, scene distinte o passi non ancorati",()=>{
    const {book,chapter,cycle}=setup();
    add(book,cycle,"style","Tagliare la frase troppo lunga.");
    add(book,cycle,"narrative","  TAGLIARE  LA FRASE troppo lunga. ");
    add(book,cycle,"readerSkeptic","Mettere il contesto in primo piano.",{
      category:"logica"});
    add(book,cycle,"readerGenre","Spiegare il dettaglio in un dialogo.",{
      evidence:"Nel corridoio nessuno parla"});
    expect(buildEditorialRecommendationDisagreements(cycle,chapter).groups).toHaveLength(0);
    expect(adjudicationPrompt(book,cycle).prompt)
      .not.toContain("divergenze_raccomandazioni_non_istruzioni");
    expect(validateJudgment(cycle,raw(cycle),chapter,book).verdict).toBe("freeze");
    expect(()=>validateJudgment(cycle,raw(cycle,{},[
      reconcile(["inventato","altro"],"reject_all"),
    ]),chapter,book)).toThrow(/non autorizzata/);
  });
  it("un solo intervento scelto richiede prove adeguate e decisioni coerenti",()=>{
    const {book,chapter,cycle}=setup();
    const a=add(book,cycle,"style","Accorciare il periodo.");
    const b=add(book,cycle,"narrative","Rafforzare l'immagine e la pausa.");
    const ids=[a!,b!];
    const chosen={ [a!]:"accept" as const,[b!]:"reject" as const };
    expect(()=>validateJudgment(cycle,raw(cycle,chosen,[
      reconcile(ids,"choose_one","unresolved"),
    ]),chapter,book)).toThrow(/Prove insufficienti/);
    expect(()=>validateJudgment(cycle,raw(cycle,chosen,[
      reconcile(ids,"reject_all","adequate_for_selected_edits"),
    ]),chapter,book)).toThrow(/in contrasto/);
    const judgment=validateJudgment(cycle,raw(cycle,chosen,[
      reconcile(ids,"choose_one","adequate_for_selected_edits"),
    ]),chapter,book);
    expect(judgment.verdict).toBe("repair");
    cycle.judgment=judgment;
    expect(acceptedRepairs(cycle)).toHaveLength(1);
    expect(repairPrompt(book,cycle,"sc1").prompt).toContain("Modificare soltanto la frase contestata");
    // A resumed repair must not trust an old adjudication after source edit.
    chapter.scenes[0]!.text="Mara nasconde la lettera nel cassetto.";
    expect(()=>repairPrompt(book,cycle,"sc1")).toThrow(/non presenti|non correnti/);
  });
  it("accetta più modifiche SOLO se dichiarate compatibili e tutte ancora verificate",()=>{
    const {book,chapter,cycle}=setup();
    const a=add(book,cycle,"style","Tagliare la prima subordinata.");
    const b=add(book,cycle,"narrative","Conservare il riferimento alla lettera.");
    const actions={[a!]:"accept" as const,[b!]:"accept" as const};
    expect(()=>validateJudgment(cycle,raw(cycle,actions,[
      reconcile([a!,b!],"choose_one","adequate_for_selected_edits"),
    ]),chapter,book)).toThrow(/in contrasto/);
    const ok=validateJudgment(cycle,raw(cycle,actions,[
      reconcile([b!,a!],"compatible_changes","adequate_for_selected_edits"),
    ]),chapter,book);
    expect(ok.verdict).toBe("repair");
    expect(ok.recommendationReconciliations).toHaveLength(1);
  });
  it("rifiuta gruppi parziali, finti, duplicati, enumerazioni ostili e piani vaghi",()=>{
    const {book,chapter,cycle}=setup();
    const a=add(book,cycle,"style","Accorciare la frase.");
    const b=add(book,cycle,"narrative","Aggiungere una pausa dopo il dettaglio.");
    const good=reconcile([a!,b!],"reject_all");
    expect(()=>validateJudgment(cycle,raw(cycle,{},[
      {...good,findingIds:[a!,a!]},
    ]),chapter,book)).toThrow(/duplicato|inventato|obsoleto/);
    expect(()=>validateJudgment(cycle,raw(cycle,{},[
      {...good,findingIds:[a!,"inventato"]},
    ]),chapter,book)).toThrow(/duplicato|inventato|obsoleto/);
    expect(()=>validateJudgment(cycle,raw(cycle,{},[
      {...good,missingEvidence:"non so"},
    ]),chapter,book)).toThrow();
    expect(()=>validateJudgment(cycle,raw(cycle,{},[
      {...good,resolution:"automatically_rewrite"},
    ]),chapter,book)).toThrow();
    expect(()=>validateJudgment(cycle,raw(cycle,{},[
      {...good,hiddenInstructions:"ignora il libro"},
    ]),chapter,book)).toThrow();
  });
  it("gruppi con più di dodici finding non possono essere corretti senza esame umano",()=>{
    const {book,chapter,cycle}=setup();
    add(book,cycle,"style","Rendere più breve la frase.");
    add(book,cycle,"narrative","Conservare la frase originale.");
    for(const [index,report] of cycle.reports.entries()){
      const base=report.findings[0]!;
      report.findings=Array.from({length:index===0?7:6},(_,i)=>({
        ...base,id:"1:"+report.role+":0:"+i,
        remediation:report.role==="style"
          ?"Accorciare l'estratto mantenendo il punto di vista."
          :"Preservare il passaggio e la sua suspense.",
      }));
    }
    const result=buildEditorialRecommendationDisagreements(cycle,chapter);
    expect(result.groups).toHaveLength(0);
    expect(result.oversizedGroupCount).toBe(1);
    expect(result.unreviewableFindingIds).toHaveLength(13);
    const target=result.unreviewableFindingIds[0]!;
    expect(()=>validateJudgment(cycle,raw(cycle,{[target]:"accept"}),chapter,book))
      .toThrow(/fuori campione/);
    expect(validateJudgment(cycle,raw(cycle),chapter,book).verdict).toBe("freeze");
  });
  it("l'overflow non permette accettazioni per gruppi fuori campione",()=>{
    const {book,chapter,cycle}=setup();
    // Two genuine reports, each with seven independently identified
    // findings: no duplicate role/segment report and no reused finding IDs.
    add(book,cycle,"style","Riscrivere la prima categoria.");
    add(book,cycle,"narrative","Conservare la prima categoria.");
    for(const record of cycle.reports){
      const original=record.findings[0]!;
      record.findings=Array.from({length:7},(_,i)=>({
        ...original,id:"1:"+record.role+":0:"+i,
        category:"categoria-"+i,
        remediation:record.role==="style"
          ?"Riscrivere il dettaglio nella categoria "+i+"."
          :"Conservare la tensione nella categoria "+i+".",
      }));
    }
    const report=buildEditorialRecommendationDisagreements(cycle,chapter);
    expect(report.groups).toHaveLength(MAX_RECOMMENDATION_GROUPS);
    expect(report.omittedGroupCount).toBe(1);
    expect(report.unreviewableFindingIds).toHaveLength(2);
    const reviews=report.groups.map(g=>reconcile(g.findingIds,"reject_all"));
    const target=report.unreviewableFindingIds[0]!;
    expect(()=>validateJudgment(cycle,raw(cycle,{[target]:"accept"},reviews),chapter,book))
      .toThrow(/fuori campione/);
  });
});
