import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, newBook, type BookProject } from "../domain/types";
import { getBook, getDb, listActivities, saveBook, saveSettings } from "../infrastructure/db";
const { modelCall, writerGuard } = vi.hoisted(() => ({ modelCall: vi.fn(), writerGuard: vi.fn() }));
vi.mock("../infrastructure/ai", () => ({ callModel: modelCall }));
vi.mock("./writer-guard", () => ({ withWriterGuard: writerGuard }));
import { createEditorialCycle } from "../domain/editorial-board";
import { AutopilotRunner } from "./autopilot";

function book(): BookProject {
  const b=newBook("Mara protegge la chiave di un castello.", "Romanzo", "Sobrio", "Adulti");
  b.phase="prose"; b.status="paused";
  b.memory.secrets.chiave = "La chiave apre un passaggio segreto.";
  b.chapters=[{id:"ch-1",number:1,title:"Il castello",purpose:"Presentazione",
    scenes:[{id:"scene-1",number:1,title:"Ingresso",objective:"Aprire la trama",
      text:"Mara saluta il guardiano e passa la porta.",status:"canon",summary:"Mara entra."}]}];
  return b;
}
const report=(issues=false) => JSON.stringify({
  verdict:issues?"issues":"pass", summary:issues?"Il guardiano parla senza motivazione.":"Verifica completata senza rilievi.",
  memoryNote:"Osservazione personale",
  findings:issues?[{sceneId:"scene-1",category:"dialogo",severity:"major",
    evidence:"Mara saluta il guardiano",
    reason:"Il guardiano non ha una ragione credibile per aprire la porta.",
    remediation:"Inserire una motivazione plausibile nel dialogo della scena."}]:[],
});
const judgment=(accept:boolean, round=1) => JSON.stringify({
  reasoning:"Il direttore ha valutato le dodici letture e la fondatezza di ciascun rilievo della redazione.",
  decisions:accept?[{findingId:String(round)+":continuity:0:0",action:"accept",
    rationale:"La motivazione del guardiano non risulta dal testo e serve un chiarimento.",
    remediation:"Inserire una battuta che spieghi il motivo per cui il guardiano apre."}]:[],
});
beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
  await saveSettings(structuredClone(DEFAULT_SETTINGS));
  modelCall.mockReset();writerGuard.mockReset();
  writerGuard.mockImplementation(async(_bookId,_runId,_ctrl,callback)=>
    callback({assertActive:async()=>{},failure:()=>undefined}));
});
afterEach(()=>vi.unstubAllGlobals());

describe("Ciclo di redazione per capitolo nel runner",()=>{
  it("esegue 12 chat isolate, giudice e sinossi prima di congelare il capitolo",async()=>{
    const source=book();await saveBook(source,false);
    const prompts:Array<{kind:string;system:string;prompt:string}>=[];
    modelCall.mockImplementation(async(kind:string,system:string,prompt:string)=>{
      prompts.push({kind,system,prompt});
      const text=kind==="chapterJudge"?judgment(false):
        kind==="summarize"?JSON.stringify({
          chapterSummary:"Mara entra al castello dopo una breve conversazione con il guardiano.",
          bookSummary:"All'inizio del romanzo Mara entra al castello custodendo la propria chiave.",
        }):report(false);
      return {text,endpointId:"test",modelId:"Astra",inputTokens:120,outputTokens:30};
    });
    const run=new AutopilotRunner();
    await run.run(source.id,async()=>undefined);
    const updated=await getBook(source.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.chapters[0]?.frozenAt).toBeDefined();
    expect(updated?.chapters[0]?.editorialRounds?.[0]?.reports).toHaveLength(12);
    expect(updated?.chapters[0]?.editorialRounds?.[0]?.judgment.verdict).toBe("freeze");
    expect(updated?.bookSummary).toContain("Mara");
    expect(updated?.chapters[0]?.bookSummaryAtFreeze).toBe(updated?.bookSummary);
    expect(prompts.filter(x=>x.kind==="chapterAudit")).toHaveLength(7);
    expect(prompts.filter(x=>x.kind==="chapterReaders")).toHaveLength(5);
    expect(prompts.filter(x=>x.kind==="chapterJudge")).toHaveLength(1);
    expect(prompts.filter(x=>x.kind==="summarize")).toHaveLength(1);
    expect(prompts.filter(x=>x.kind==="chapterReaders").every(x=>
      !x.prompt.includes("passaggio segreto"))).toBe(true);
    expect(prompts.filter(x=>x.kind==="chapterAudit").some(x=>
      x.prompt.includes("passaggio segreto"))).toBe(true);
    expect((await listActivities(source.id)).filter(a=>a.phase==="chapterReview")).toHaveLength(14);
  });
  it("rifiuta sinossi solo-spazi anche con 12 report e freeze valido, senza perdere usage o canon",async()=>{
    const source=book();
    source.bookSummary="Il libro non è ancora stato consolidato.";
    await saveBook(source,false);
    const responses:string[]=[];
    modelCall.mockImplementation(async (kind:string)=>{
      responses.push(kind);
      const text=kind==="chapterJudge"?judgment(false):
        kind==="summarize"?JSON.stringify({
          chapterSummary:" ".repeat(45),
          bookSummary:"  \n\t".repeat(28),
        }):report(false);
      return {text,endpointId:"openai",modelId:"review-model",
        inputTokens:243,outputTokens:72};
    });
    await new AutopilotRunner().run(source.id,async()=>undefined);
    const saved=(await getBook(source.id))!;
    expect(saved.status).toBe("error");
    expect(saved.editorialCycle).toMatchObject({
      stage:"summary",summaryCursor:0,
      judgment:{verdict:"freeze"},
    });
    expect(saved.editorialCycle?.reports).toHaveLength(12);
    expect(saved.chapters[0]!.frozenAt).toBeUndefined();
    expect(saved.chapters[0]!.summary).toBeUndefined();
    expect(saved.chapters[0]!.bookSummaryAtFreeze).toBeUndefined();
    expect(saved.chapters[0]!.scenes).toEqual(source.chapters[0]!.scenes);
    expect(saved.bookSummary).toBe("Il libro non è ancora stato consolidato.");
    expect(responses.filter(x=>x==="summarize")).toHaveLength(1);
    expect(responses).toHaveLength(14);
    const history=(await listActivities(source.id));
    expect(history.filter(x=>x.title.includes("Sinossi"))).toMatchObject([{
      status:"failed",aiRequested:true,
      inputTokens:243,outputTokens:72,
    }]);
    expect(history).toHaveLength(14);
  });
  it("accetta un rilievo motivato, corregge la scena, aggiorna memoria e riesegue i 12 controlli",async()=>{
    const source=book();await saveBook(source,false);
    let round=1;const tasks:string[]=[];
    modelCall.mockImplementation(async(kind:string,system:string,prompt:string)=>{
      tasks.push(kind);
      if(kind==="chapterJudge"){
        const text=judgment(round===1,round);round++;
        return {text,endpointId:"test",modelId:"Judge"};
      }
      if(kind==="chapterRepair")
        return {text:"Mara saluta il guardiano; lui apre per ordine del castellano.",endpointId:"test",modelId:"Writer"};
      if(kind==="consolidate")
        return {text:JSON.stringify(source.memory),endpointId:"test",modelId:"Memory"};
      if(kind==="summarize")
        return {text:JSON.stringify({chapterSummary:"La guardia lascia passare Mara, come ordinato dal castellano.",
          bookSummary:"Nel primo capitolo Mara entra al castello per ordine del castellano."}),endpointId:"test",modelId:"Luna"};
      const first = round===1 && kind==="chapterAudit" && system.includes("Coerenza");
      return {text:report(first),endpointId:"test",modelId:"Reviewer"};
    });
    await new AutopilotRunner().run(source.id,async()=>undefined);
    const updated=await getBook(source.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.chapters[0]?.scenes[0]?.text).toContain("castellano");
    expect(updated?.chapters[0]?.editorialRounds).toHaveLength(2);
    expect(updated?.chapters[0]?.editorialRounds?.[0]?.judgment.verdict).toBe("repair");
    expect(updated?.chapters[0]?.editorialRounds?.[1]?.judgment.verdict).toBe("freeze");
    expect(tasks.filter(x=>x==="chapterAudit")).toHaveLength(14);
    expect(tasks.filter(x=>x==="chapterReaders")).toHaveLength(10);
    expect(tasks.filter(x=>x==="chapterRepair")).toHaveLength(1);
    expect(tasks.filter(x=>x==="consolidate")).toHaveLength(1);
  });
  it("non sovrascrive il canone se la memoria cambia durante reconcile senza bump updatedAt",async()=>{
    const source=book();
    source.phase="chapterReview";
    source.chapters[0]!.scenes[0]!.status="draft";
    source.editorialCycle=createEditorialCycle("ch-1");
    source.editorialCycle.stage="reconcile";
    source.editorialCycle.reconcileCursor=0;
    await saveBook(source,false);
    modelCall.mockImplementation(async(kind:string)=>{
      expect(kind).toBe("consolidate");
      // Simulate a legacy restore that changes the source without incrementing
      // updatedAt. The generic DB revision fence alone cannot detect this.
      const changed=(await getBook(source.id))!;
      const unchangedStamp=changed.updatedAt;
      changed.memory.secrets.chiave="NUOVO SEGRETO PRIVATO DELL'AUTORE";
      changed.memory.currentState="L'autore ha corretto la memoria narrativa.";
      expect(changed.updatedAt).toBe(unchangedStamp);
      await (await getDb()).put("books",changed);
      return {text:JSON.stringify(source.memory),endpointId:"test",modelId:"Memory",
        inputTokens:45,outputTokens:27};
    });
    await new AutopilotRunner().run(source.id,async()=>undefined);
    const actual=(await getBook(source.id))!;
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(actual.status).toBe("error");
    expect(actual.previousError).toMatch(/Riconciliazione obsoleta/);
    expect(actual.previousError).not.toContain("NUOVO SEGRETO PRIVATO");
    expect(actual.memory.secrets.chiave).toBe("NUOVO SEGRETO PRIVATO DELL'AUTORE");
    expect(actual.memory.currentState).toBe("L'autore ha corretto la memoria narrativa.");
    expect(actual.editorialCycle).toMatchObject({stage:"reconcile",reconcileCursor:0});
    expect(actual.chapters[0]!.scenes[0]!.status).toBe("draft");
    expect(actual.chapters[0]!.frozenAt).toBeUndefined();
    const attempted=(await listActivities(source.id)).filter(a=>a.aiRequested);
    expect(attempted).toHaveLength(1);
    expect(attempted[0]).toMatchObject({
      status:"failed",inputTokens:45,outputTokens:27,
    });
  });

  it("non applica il report AI se l'autore modifica il libro durante la chiamata",async()=>{
    const source=book();await saveBook(source,false);
    modelCall.mockImplementation(async()=>{
      const changed=await getBook(source.id);
      if (!changed) throw new Error("Fixture mancante");
      changed.authorConstraints.push("Non svelare il segreto aggiunto dall'autore durante la review.");
      await saveBook(changed,false);
      return {text:report(false),endpointId:"test",modelId:"Reviewer"};
    });
    await new AutopilotRunner().run(source.id,async()=>undefined);
    const updated=await getBook(source.id);
    expect(updated?.authorConstraints).toContain(
      "Non svelare il segreto aggiunto dall'autore durante la review.");
    expect(updated?.editorialCycle?.reports).toHaveLength(0);
    expect(updated?.chapters[0]?.frozenAt).toBeUndefined();
    expect(updated?.status).toBe("paused");
  });
  it("ferma la redazione PRIMA del provider quando manca riserva economica",async()=>{
    const source=book();
    source.aiBudget={enabled:true,enabledAt:new Date(Date.now()-5000).toISOString(),
      limitEur:0.0001,maxOutputTokens:8192};
    const settings=structuredClone(DEFAULT_SETTINGS);
    settings.defaultRoute.modelId="mock-budget-model";
    settings.aiPriceRates=[{endpointId:"openai",modelId:"mock-budget-model",
      inputEurPerMillion:3,outputEurPerMillion:9}];
    await saveSettings(settings);
    await saveBook(source,false);
    modelCall.mockResolvedValue({text:report(false),endpointId:"openai",
      modelId:"mock-budget-model",inputTokens:200,outputTokens:500});
    await new AutopilotRunner().run(source.id,async()=>undefined);
    expect(modelCall).not.toHaveBeenCalled();
    const blocked=await getBook(source.id);
    expect(blocked?.status).toBe("paused");
    expect(blocked?.previousError).toMatch(/Budget stimato raggiunto/);
    expect(blocked?.editorialCycle?.reports).toHaveLength(0);
    const afterLogs=await listActivities(source.id);
    expect(afterLogs.some(a=>a.aiRequested)).toBe(false);
  });
  it("sospende dopo una chiamata realmente tentata se il provider non comunica usage",async()=>{
    const source=book();
    source.aiBudget={enabled:true,enabledAt:new Date(Date.now()-5000).toISOString(),
      limitEur:5,maxOutputTokens:8192};
    const settings=structuredClone(DEFAULT_SETTINGS);
    settings.defaultRoute.modelId="mock-budget-model";
    settings.aiPriceRates=[{endpointId:"openai",modelId:"mock-budget-model",
      inputEurPerMillion:3,outputEurPerMillion:9}];
    await saveSettings(settings);
    await saveBook(source,false);
    modelCall.mockResolvedValue({text:report(false),
      endpointId:"openai",modelId:"mock-budget-model"});
    await new AutopilotRunner().run(source.id,async()=>undefined);
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(modelCall.mock.calls[0]?.[6]).toEqual({maxOutputTokens:8192});
    const blocked=await getBook(source.id);
    expect(blocked?.status).toBe("paused");
    expect(blocked?.editorialCycle?.reports).toHaveLength(1);
    expect(blocked?.previousError).toMatch(/senza usage completo/);
    const attempted=(await listActivities(source.id)).filter(a=>a.aiRequested === true);
    expect(attempted).toHaveLength(1);
    expect(attempted[0]?.status).toBe("succeeded");
  });

  it("ferma l'autopilot dopo tre tornate senza consensus e NON congela il capitolo",async()=>{
    const source=book();await saveBook(source,false);
    let round=1;
    modelCall.mockImplementation(async(kind:string,system:string)=>{
      if(kind==="chapterJudge") return {text:judgment(true,round++),endpointId:"test",modelId:"Judge"};
      if(kind==="chapterRepair") return {text:"Mara saluta il guardiano; resta un problema di motivazione.",endpointId:"test",modelId:"Writer"};
      if(kind==="consolidate") return {text:JSON.stringify(source.memory),endpointId:"test",modelId:"Memory"};
      return {text:report(kind==="chapterAudit" && system.includes("Coerenza")),
        endpointId:"test",modelId:"Reviewer"};
    });
    await new AutopilotRunner().run(source.id,async()=>undefined);
    const updated=await getBook(source.id);
    expect(updated?.status).toBe("paused");
    expect(updated?.chapters[0]?.frozenAt).toBeUndefined();
    expect(updated?.editorialCycle?.stage).toBe("blocked");
    expect(updated?.editorialCycle?.priorRounds).toHaveLength(3);
    expect(updated?.previousError).toMatch(/decisione umana/i);
    expect((await listActivities(source.id)).some(a=>a.title.includes("Sinossi"))).toBe(false);
  });
});
