import type { Activity, BookProject } from "./types";
import {
  narrativeBookCopy, type TaskBookCheckpoint,
} from "./task-book-checkpoint";
import { compareNarrativeTaskHistory } from "./narrative-task-history-impact";

export type HistoricalTarget = "before" | "after";
export type HistoricalPlanBlocker =
  | "book_running" | "running_activity" | "remote_lease_unverified"
  | "external_backup_unverified" | "historical_fork_unavailable"
  | "editorial_approval_unavailable";

export interface HistoricalRewindReviewPlan {
  bookId: string;
  activityId: string;
  target: HistoricalTarget;
  targetRevision: string;
  currentRevision: string;
  targetSha256: string;
  currentSha256: string;
  currentEqualsTargetRevision: boolean;
  targetChapterCount: number;
  targetSceneCount: number;
  targetFrozenCount: number;
  currentFrozenCount: number;
  candidateChapterCount: number;
  candidateChapterNumbers: number[];
  candidateNumbersOmitted: number;
  runningActivityCount: number;
  remoteConfigured: boolean;
  blockers: HistoricalPlanBlocker[];
}

function chaptersStats(book:BookProject):{chapters:number;scenes:number;frozen:number}{
  return {
    chapters:book.chapters.length,
    scenes:book.chapters.reduce((n,chapter)=>n+chapter.scenes.length,0),
    frozen:book.chapters.filter(chapter=>!!chapter.frozenAt).length,
  };
}

/** All output is fixed metadata and SHA-256 digests, never raw private prose.
 * Blockers are informational, NOT an actionable permission/restore token. */
export function buildHistoricalRewindReviewPlan(
  raw:unknown, bookId:string, activityId:string,
  current:BookProject, task:Activity,
  target:HistoricalTarget, runningActivityCount:number,
  targetSha256:string, currentSha256:string,
):HistoricalRewindReviewPlan|null{
  if(target!=="before"&&target!=="after")return null;
  if(task.id!==activityId||task.bookId!==bookId||
     task.status!=="succeeded"||current.id!==bookId||
     !Number.isSafeInteger(runningActivityCount)||runningActivityCount<0||
     !/^[a-f0-9]{64}$/.test(targetSha256)||
     !/^[a-f0-9]{64}$/.test(currentSha256))return null;
  const impact=compareNarrativeTaskHistory(raw,bookId,activityId,current);
  if(!impact)return null;
  const checkpoint=raw as TaskBookCheckpoint;
  const selected=checkpoint[target];
  const targetStats=chaptersStats(selected);
  const currentStats=chaptersStats(current);
  const blockers:HistoricalPlanBlocker[]=[];
  if(current.status==="running")blockers.push("book_running");
  if(runningActivityCount>0)blockers.push("running_activity");
  if(!!current.remote)blockers.push("remote_lease_unverified");
  // There is no persisted proof of backup, distributed writer lease or an
  // executable historical fork with a downstream approval protocol.
  blockers.push("external_backup_unverified",
    "historical_fork_unavailable","editorial_approval_unavailable");
  return {
    bookId,activityId,target,
    targetRevision:selected.updatedAt,currentRevision:current.updatedAt,
    targetSha256,currentSha256,
    currentEqualsTargetRevision:selected.updatedAt===current.updatedAt,
    targetChapterCount:targetStats.chapters,
    targetSceneCount:targetStats.scenes,
    targetFrozenCount:targetStats.frozen,
    currentFrozenCount:currentStats.frozen,
    candidateChapterCount:impact.candidateChapterCount,
    candidateChapterNumbers:[...impact.candidateChapterNumbers],
    candidateNumbersOmitted:impact.candidateChapterNumbersOmitted,
    runningActivityCount,remoteConfigured:!!current.remote,blockers,
  };
}

/** Separate from the plan: only used inside storage, never returned to UI. */
export function snapshotForHistoricalTarget(
  raw:TaskBookCheckpoint,target:HistoricalTarget,
):BookProject{
  return narrativeBookCopy(raw[target]);
}
