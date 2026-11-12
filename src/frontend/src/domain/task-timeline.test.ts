import { describe,expect,it } from "vitest";
import { type Activity } from "./types";
import {
  completedTaskDurationSeconds,estimatedTaskCostEur,filterTaskTimeline,
  formatTaskDuration,summarizeTaskTimeline,
} from "./task-timeline";
const t=(id:string,override:Partial<Activity>={}):Activity=>({
  id,bookId:"book",runId:"run-1",phase:"brainstorm",title:"Brainstorming "+id,
  reason:"Cerca una trama",nextStep:"Valida",status:"succeeded",
  createdAt:"2026-11-12T09:00:00.000Z",endedAt:"2026-11-12T09:01:01.200Z",
  endpointId:"local",modelId:"muse",aiRequested:true,
  inputTokens:100,outputTokens:50,priceRateSnapshot:{
    endpointId:"local",modelId:"muse",inputEurPerMillion:2,outputEurPerMillion:4,
  },...override,
});
describe("Timeline task: filtri, durata e stime verificabili",()=>{
  it("filtra metadati, stato e fase senza cercare testo privato/output",()=>{
    const entries=[
      t("a",{createdAt:"2026-11-12T08:00:00.000Z",output:"SEGRETO_NON_RICERCABILE"}),
      t("b",{phase:"prose",title:"Capitolo finale",status:"failed",
        createdAt:"2026-11-12T10:00:00.000Z"}),
      t("c",{phase:"prose",title:"Scena due",status:"cancelled",
        createdAt:"2026-11-12T11:00:00.000Z"}),
    ];
    const filters={query:"",status:"all",phase:"",order:"newest"} as const;
    expect(filterTaskTimeline(entries,filters).map(x=>x.id)).toEqual(["c","b","a"]);
    expect(filterTaskTimeline(entries,{...filters,order:"oldest"}).map(x=>x.id))
      .toEqual(["a","b","c"]);
    expect(filterTaskTimeline(entries,{...filters,status:"failed",phase:"prose"})
      .map(x=>x.id)).toEqual(["b"]);
    expect(filterTaskTimeline(entries,{...filters,query:"CaPiToLo"}).map(x=>x.id))
      .toEqual(["b"]);
    expect(filterTaskTimeline(entries,{...filters,query:"SEGRETO_NON_RICERCABILE"}))
      .toEqual([]);
    expect(filterTaskTimeline(entries,{...filters,query:"run-1"})).toHaveLength(3);
    expect(entries.map(x=>x.id)).toEqual(["a","b","c"]); // sort never mutates source
  });
  it("distingue durata reale e tempi mancanti o corrotti",()=>{
    expect(completedTaskDurationSeconds(t("a"))).toBe(61);
    expect(completedTaskDurationSeconds(t("a",{endedAt:undefined}))).toBeUndefined();
    expect(completedTaskDurationSeconds(t("a",{endedAt:"ieri"}))).toBeUndefined();
    expect(completedTaskDurationSeconds(t("a",{endedAt:"2026-11-12T08:00:00Z"})))
      .toBeUndefined();
    expect(formatTaskDuration(61)).toBe("1 min 1 s");
    expect(formatTaskDuration(3660)).toBe("1 h 1 min");
    expect(formatTaskDuration(0)).toBe("0 s");
  });
  it("non inventa fatture, prezzi o token dopo stop/errore",()=>{
    expect(estimatedTaskCostEur(t("a"))).toBeCloseTo(0.0004);
    expect(estimatedTaskCostEur(t("a",{status:"failed"}))).toBeCloseTo(0.0004);
    for(const a of [
      t("a",{inputTokens:undefined}),t("a",{outputTokens:undefined}),
      t("a",{aiRequested:false}),t("a",{status:"running"}),
      t("a",{priceRateSnapshot:undefined}),t("a",{priceRateSnapshot:{
        endpointId:"wrong",modelId:"muse",inputEurPerMillion:2,outputEurPerMillion:3,
      }}),t("a",{outputTokens:-1}),
    ])expect(estimatedTaskCostEur(a)).toBeUndefined();
    const summary=summarizeTaskTimeline([
      t("known"),t("failed",{status:"failed",outputTokens:undefined}),
      t("cancel",{status:"cancelled",inputTokens:undefined}),
      t("running",{status:"running"}),t("preflight",{status:"failed",aiRequested:false}),
    ]);
    expect(summary).toMatchObject({
      total:5,completed:1,running:1,failed:2,cancelled:1,
      pricedReports:1,uncertainAttempts:3,
    });
    expect(summary.knownEstimatedEur).toBeCloseTo(0.0004);
  });
});
