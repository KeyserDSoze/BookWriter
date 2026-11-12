import type { Activity } from "./types";
import { validTokenCount } from "./ai-usage";
import { isPriceRate } from "./ai-budget";

export type TimelineStatus = "all" | Activity["status"];
export type TimelineOrder = "newest" | "oldest";
export interface TimelineFilters {
  query: string;
  status: TimelineStatus;
  phase: string;
  order: TimelineOrder;
}

/** Only public activity metadata is searched: never prompts or private outputs. */
export function filterTaskTimeline(
  rows: readonly Activity[], filters: TimelineFilters,
): Activity[] {
  const term=filters.query.trim().toLocaleLowerCase("it-IT").slice(0,160);
  return rows.filter(item =>
    (filters.status==="all" || item.status===filters.status) &&
    (!filters.phase || item.phase===filters.phase) &&
    (!term || [item.title,item.phase,item.reason,item.nextStep,
      item.modelId,item.endpointId,item.runId]
      .some(value=>value?.toLocaleLowerCase("it-IT").includes(term)))
  ).sort((a,b)=>{
    const order=a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    return filters.order==="oldest"?order:-order;
  });
}

export function completedTaskDurationSeconds(
  activity: Pick<Activity,"createdAt"|"endedAt">,
): number | undefined {
  if(!activity.endedAt)return undefined;
  const start=Date.parse(activity.createdAt);
  const end=Date.parse(activity.endedAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return undefined;
  return Math.floor((end-start)/1000);
}

/** Snapshot rate + full provider token report are required; never infer usage. */
export function estimatedTaskCostEur(activity:Activity):number|undefined{
  if(activity.status==="running" || activity.aiRequested===false)return undefined;
  const quote=activity.priceRateSnapshot;
  const input=validTokenCount(activity.inputTokens);
  const output=validTokenCount(activity.outputTokens);
  if(!isPriceRate(quote)||input===undefined||output===undefined ||
    quote.endpointId!==activity.endpointId || quote.modelId!==activity.modelId)
    return undefined;
  const estimate=(input*quote.inputEurPerMillion+
    output*quote.outputEurPerMillion)/1_000_000;
  return Number.isFinite(estimate)&&estimate>=0?estimate:undefined;
}

export interface TaskTimelineSummary {
  total: number;
  completed: number;
  running: number;
  failed: number;
  cancelled: number;
  knownEstimatedEur: number;
  pricedReports: number;
  uncertainAttempts: number;
}
export function summarizeTaskTimeline(activities:readonly Activity[]):TaskTimelineSummary{
  const summary:TaskTimelineSummary={total:activities.length,completed:0,running:0,
    failed:0,cancelled:0,knownEstimatedEur:0,pricedReports:0,uncertainAttempts:0};
  for(const activity of activities){
    if(activity.status==="succeeded")summary.completed++;
    if(activity.status==="running")summary.running++;
    if(activity.status==="failed")summary.failed++;
    if(activity.status==="cancelled")summary.cancelled++;
    // A preflight rejected before the provider is not an uncertain billed call.
    const attempt=activity.aiRequested===true ||
      (activity.aiRequested===undefined && !!activity.modelId && !!activity.endpointId);
    if(!attempt)continue;
    const estimate=estimatedTaskCostEur(activity);
    if(estimate===undefined)summary.uncertainAttempts++;
    else{summary.pricedReports++;summary.knownEstimatedEur+=estimate;}
  }
  return summary;
}

/** Display-only grouping: no prompts, output or local traces. */
export interface TaskRunGroup {
  key:string;
  runId:string|null;
  activities:Activity[];
  summary:TaskTimelineSummary;
}

/** Preserves filtered order, isolating legacy activities without run IDs. */
export function groupTaskTimelineByRun(rows:readonly Activity[]):TaskRunGroup[]{
  const groups=new Map<string,{runId:string|null;activities:Activity[]}>();
  rows.forEach((activity,index)=>{
    const runId=typeof activity.runId==="string"&&activity.runId.trim()
      ?activity.runId:null;
    const key=runId===null?`unassigned:${index}`:`run:${runId}`;
    const previous=groups.get(key);
    if(previous)previous.activities.push(activity);
    else groups.set(key,{runId,activities:[activity]});
  });
  return [...groups.entries()].map(([key,group])=>({
    key,runId:group.runId,activities:group.activities,
    summary:summarizeTaskTimeline(group.activities),
  }));
}

/** Cursor over already-filtered, already-ordered task metadata, never private content. */
export interface TaskFocusNavigation {
  id:string;
  index:number;
  total:number;
  previousId?:string;
  nextId?:string;
}
export function resolveTaskFocus(
  rows:readonly Activity[],selectedId:string,
):TaskFocusNavigation|undefined {
  if(!selectedId)return undefined;
  const index=rows.findIndex(activity=>activity.id===selectedId);
  if(index<0)return undefined;
  return {
    id:selectedId,index,total:rows.length,
    previousId:rows[index-1]?.id,nextId:rows[index+1]?.id,
  };
}

export function formatTaskDuration(seconds:number):string {
  if(!Number.isSafeInteger(seconds)||seconds<0)throw new Error("Durata task non valida.");
  if(seconds<60)return seconds+" s";
  const hours=Math.floor(seconds/3600);
  const minutes=Math.floor((seconds%3600)/60);
  const remaining=seconds%60;
  return ((hours?hours+" h ":"")+(minutes||hours?minutes+" min ":"")+
    (remaining?remaining+" s":"")).trim();
}
