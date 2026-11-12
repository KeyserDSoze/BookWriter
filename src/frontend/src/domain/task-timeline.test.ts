import { describe,expect,it } from "vitest";
import { type Activity } from "./types";
import {
  completedTaskDurationSeconds,estimatedTaskCostEur,filterTaskTimeline,
  formatTaskDuration,groupTaskTimelineByRun,summarizeTaskTimeline,
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
  it("raggruppa run non contigui e isola task senza sessione",()=>{
    const entries=[
      t("a",{runId:"run-1",createdAt:"2026-11-12T07:00:00Z"}),
      t("b",{runId:"run-2",createdAt:"2026-11-12T08:00:00Z",
        status:"failed",outputTokens:undefined}),
      t("c",{runId:"run-1",createdAt:"2026-11-12T09:00:00Z"}),
      t("d",{runId:"",createdAt:"2026-11-12T10:00:00Z"}),
      t("e",{runId:"",createdAt:"2026-11-12T11:00:00Z"}),
    ];
    const sorted=filterTaskTimeline(entries,{
      query:"",status:"all",phase:"",order:"newest",
    });
    const groups=groupTaskTimelineByRun(sorted);
    expect(groups.map(group=>group.activities.map(a=>a.id)))
      .toEqual([["e"],["d"],["c","a"],["b"]]);
    expect(groups.map(group=>group.runId)).toEqual([null,null,"run-1","run-2"]);
    expect(groups[2].summary).toMatchObject({
      total:2,pricedReports:2,uncertainAttempts:0,
    });
    expect(groups[2].summary.knownEstimatedEur).toBeCloseTo(0.0008);
    expect(groups[3].summary).toMatchObject({
      total:1,pricedReports:0,uncertainAttempts:1,
    });
    expect(entries.map(a=>a.id)).toEqual(["a","b","c","d","e"]);
    expect(groupTaskTimelineByRun(filterTaskTimeline(entries,{
      query:"",status:"failed",phase:"",order:"oldest",
    })).map(group=>group.activities[0].id)).toEqual(["b"]);
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
