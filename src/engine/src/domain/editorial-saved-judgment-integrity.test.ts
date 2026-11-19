import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import { editorialRecoveryProblem } from "./editorial-recovery";
import {
  EDITORIAL_ROLES, assertSavedEditorialJudgmentIntegrity, chapterSegments,
  createEditorialCycle, repairPrompt, validateJudgment, validateReport,
  type ChapterEditorialCycle,
} from "./editorial-board";

function fixture(): { book: BookProject; cycle: ChapterEditorialCycle; ids: string[] } {
  const book = newBook("Mara attraversa il castello.", "Il portone", "Sobrio", "Adulti");
  book.phase = "chapterReview"; book.status = "paused";
  book.chapters = [{
    id:"c1",number:1,title:"Il portone",purpose:"Entrare",
    scenes:[
      {id:"s1",number:1,title:"Ingresso",objective:"Aprire",
        text:"Mara vede il guardiano vicino al portone del castello.",status:"canon"},
      {id:"s2",number:2,title:"Salone",objective:"Raccontare",
        text:"Mara racconta con calma la sua visita nel grande salone.",status:"canon"},
    ],
  }];
  const ch = book.chapters[0]!, cycle = createEditorialCycle(ch.id);
  const segments = chapterSegments(ch);
  for(const role of EDITORIAL_ROLES)for(const segment of segments) {
    const include = (role === "style" && segment.index === 0) ||
      (role === "narrative" && segment.index === 1);
    const raw = JSON.stringify(include ? {
      verdict:"issues",summary:"La scena necessita di maggiore chiarezza.",
      memoryNote:"",findings:[{
        sceneId:segment.sceneId,category:"stile",severity:"minor",
        evidence:segment.index===0?"Mara vede il guardiano":"Mara racconta con calma",
        reason:"Il ritmo richiede una verifica indipendente.",
        remediation:"Ridurre la ridondanza preservando la voce del personaggio.",
      }],
    } : {verdict:"pass",summary:"Non emergono criticità verificabili.",
      memoryNote:"",findings:[]});
    cycle.reports.push(validateReport(cycle,role,segment,segments.length,raw,ch,book));
  }
  const ids = cycle.reports.flatMap(report=>report.findings.map(f=>f.id));
  cycle.judgment = validateJudgment(cycle,JSON.stringify({
    reasoning:"Le due scene richiedono modifiche minime giustificate dalle prove.",
    decisions:ids.map(findingId=>({
      findingId,action:"accept",
      rationale:"La correzione stilistica rende la frase più leggibile.",
      remediation:"Semplificare la frase mantenendo invariati i dettagli.",
    })),
  }),ch,book);
  cycle.stage="repair"; book.editorialCycle=cycle;
  return {book,cycle,ids};
}
describe("Integrità del giudizio persistito nella remediation",()=>{
  it("accetta una matrice completa e il prossimo step con la prova ancora corrente",()=>{
    const {book,cycle}=fixture();
    expect(()=>assertSavedEditorialJudgmentIntegrity(cycle,book.chapters[0]!,"s1")).not.toThrow();
    expect(repairPrompt(book,cycle,"s1").prompt).toContain("Semplificare la frase");
    expect(editorialRecoveryProblem(book)).toBeUndefined();
  });
  it("blocca decisioni duplicate, mancanti e inventate anche sui rilievi di stile",()=>{
    const {book,cycle}=fixture();
    const original=structuredClone(cycle.judgment!.decisions);
    cycle.judgment!.decisions=[original[0]!,structuredClone(original[0]!)];
    expect(()=>repairPrompt(book,cycle,"s1")).toThrow(/duplicata/);
    expect(editorialRecoveryProblem(book)).toMatch(/duplicata/);
    cycle.judgment!.decisions=original.slice(0,1);
    expect(()=>repairPrompt(book,cycle,"s1")).toThrow(/non ha valutato tutti/);
    cycle.judgment!.decisions=[original[0]!,{...original[1]!,findingId:"inventato"}];
    expect(()=>repairPrompt(book,cycle,"s1")).toThrow(/inesistente/);
    expect(cycle.reports).toHaveLength(24);
  });
  it("blocca remediation vuote, giudizio malformato, timestamp e verdetto incoerenti",()=>{
    const {book,cycle}=fixture();
    cycle.judgment!.decisions[0]!.remediation=" ";
    expect(()=>repairPrompt(book,cycle,"s1")).toThrow(/senza remediation concreta/);
    cycle.judgment!.decisions[0]!.remediation="Semplificare la frase mantenendo invariati i dettagli.";
    cycle.judgment!.decisions[1]!.rationale="breve";
    expect(()=>repairPrompt(book,cycle,"s1")).toThrow(/schema/);
    cycle.judgment!.decisions[1]!.rationale="La correzione stilistica rende la frase più leggibile.";
    cycle.judgment!.createdAt="data falsa";
    expect(()=>repairPrompt(book,cycle,"s1")).toThrow(/giudizio salvato/);
    cycle.judgment!.createdAt="2026-11-09T12:00:00Z";
    cycle.judgment!.verdict="freeze";
    expect(()=>repairPrompt(book,cycle,"s1")).toThrow(/giudizio salvato/);
  });
  it("riprende la seconda scena anche se la riconciliazione salvata contiene l'ancora della prima scena ormai riscritta",()=>{
    const {book,cycle}=fixture(),ch=book.chapters[0]!;
    const passIndex=cycle.reports.findIndex(r=>r.role==="narrative"&&r.segmentIndex===0);
    const segment=chapterSegments(ch)[0]!;
    const extra=validateReport(cycle,"narrative",segment,chapterSegments(ch).length,JSON.stringify({
      verdict:"issues",summary:"La frase può essere resa più diretta senza cambiare fatti o punto di vista.",memoryNote:"",
      findings:[{sceneId:"s1",category:"stile",severity:"minor",evidence:"Mara vede il guardiano",
        reason:"Il dettaglio richiede una formulazione più netta e leggibile.",remediation:"Spostare il guardiano all'inizio della frase."}],
    }),ch,book);
    cycle.reports[passIndex]=extra;
    const s1=cycle.reports.flatMap(r=>r.findings).filter(f=>f.sceneId==="s1");
    const s2=cycle.reports.flatMap(r=>r.findings).filter(f=>f.sceneId==="s2");
    expect(s1).toHaveLength(2); expect(s2).toHaveLength(1);
    const chosen=s1[0]!.id;
    const decisions=[...s1,...s2].map(f=>({findingId:f.id,action:f.id===chosen||f.sceneId==="s2"?"accept":"reject",
      rationale:"La scelta è motivata dalla prova letterale e mantiene invariato il contenuto narrativo.",
      remediation:f.id===chosen||f.sceneId==="s2"?"Semplificare la frase mantenendo invariati i dettagli narrativi.":""}));
    cycle.judgment=validateJudgment(cycle,JSON.stringify({
      reasoning:"Valuto i due rilievi sullo stesso frammento e scelgo una sola correzione concreta.",decisions,
      recommendationReconciliations:[{findingIds:s1.map(f=>f.id),resolution:"choose_one",evidenceAssessment:"adequate_for_selected_edits",
        rationale:"La prima proposta è più coerente con il tono e preserva meglio il dettaglio del guardiano.",
        missingEvidence:"Serve verificare che il guardiano resti descritto senza aggiungere fatti o informazioni nuove.",
        nextCheck:"Rileggere la frase completa nella recensione successiva della scena."}],
    }),ch,book);
    cycle.stage="repair";
    ch.scenes[0]!.text="Mara entra e descrive con precisione il guardiano vicino al portone.";
    ch.scenes[0]!.status="draft";
    cycle.repairCursor=1;
    expect(repairPrompt(book,cycle,"s2").prompt).toContain("Mara racconta con calma");
    expect(editorialRecoveryProblem(book)).toBeUndefined();
    ch.scenes[1]!.text="Il salone è deserto e silenzioso.";
    expect(()=>repairPrompt(book,cycle,"s2")).toThrow(/prova narrativa della prossima scena/);
  });
  it("blocca la prova della scena da riparare, senza modificare il testo",()=>{
    const {book,cycle}=fixture(),ch=book.chapters[0]!;
    ch.scenes[0]!.text="Mara non incontra nessuno all'ingresso.";
    const before=structuredClone(ch.scenes);
    expect(()=>repairPrompt(book,cycle,"s1")).toThrow(/prova narrativa della prossima scena/);
    expect(editorialRecoveryProblem(book)).toMatch(/obsoleto/);
    expect(ch.scenes).toEqual(before);
  });
  it("dopo un repair applicato non richiede che la scena precedente torni al testo originario",()=>{
    const {book,cycle}=fixture(),ch=book.chapters[0]!;
    ch.scenes[0]!.text="Mara descrive con precisione il guardiano del castello.";
    ch.scenes[0]!.status="draft";
    cycle.repairCursor=1;
    expect(repairPrompt(book,cycle,"s2").prompt).toContain("Mara racconta con calma");
    expect(editorialRecoveryProblem(book)).toBeUndefined();
    ch.scenes[1]!.text="Il salone è deserto e silenzioso.";
    expect(()=>repairPrompt(book,cycle,"s2")).toThrow(/prova narrativa della prossima scena/);
    expect(editorialRecoveryProblem(book)).toMatch(/prova narrativa/);
  });
});
