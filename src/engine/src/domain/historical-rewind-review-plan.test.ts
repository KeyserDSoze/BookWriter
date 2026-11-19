import { describe, expect, it } from "vitest";
import { newBook, type Activity, type BookProject } from "./types";
import { createTaskBookCheckpoint } from "./task-book-checkpoint";
import {
  buildHistoricalRewindReviewPlan,
} from "./historical-rewind-review-plan";

const digestA="a".repeat(64),digestB="b".repeat(64);
function fixture(){
  const before=newBook("BRIEF_PRIVATO_🔐","TITOLO_PRIVATO","Romanzo","Adulti");
  before.updatedAt="2026-11-12T09:00:00.000Z";
  before.status="paused";
  before.memory.secrets["s"]="SEGRETO_STORICO";
  before.chapters=[{id:"chapter-one",number:1,title:"CAPITOLO_PRIVATO",purpose:"Test",
    frozenAt:"2026-11-12T08:30:00.000Z",
    scenes:[{id:"scene",number:1,title:"SCENA_PRIVATA",objective:"Test",
      text:"PROSA_STORICA_PRIMA",status:"draft"}]}];
  const after=structuredClone(before);
  after.updatedAt="2026-11-12T10:00:00.000Z";
  after.chapters[0]!.scenes[0]!.text="PROSA_STORICA_DOPO";
  after.chapters[0]!.frozenAt=undefined;
  const task:Activity={id:"task1",bookId:before.id,runId:"run",phase:"prose",
    status:"succeeded",title:"Scrittura",reason:"Test",nextStep:"Rivedi",
    createdAt:"2026-11-12T10:00:00.000Z"};
  return {before,after,task,raw:createTaskBookCheckpoint(before,after,task)};
}
describe("Piano storico non eseguibile #174",()=>{
  it("seleziona prima/dopo senza esporre testo/identità remote e non autorizza restore",()=>{
    const {before,after,task,raw}=fixture();
    const current=structuredClone(after);
    current.remote={owner:"ACCOUNT_PRIVATO",repository:"SEGRETO_GITHUB",
      branch:"main",autoSync:true};
    const pre=buildHistoricalRewindReviewPlan(raw,before.id,task.id,current,task,
      "before",0,digestA,digestB);
    const post=buildHistoricalRewindReviewPlan(raw,before.id,task.id,current,task,
      "after",0,digestB,digestB);
    expect(pre).toMatchObject({
      target:"before",targetRevision:before.updatedAt,
      currentRevision:after.updatedAt,currentEqualsTargetRevision:false,
      targetChapterCount:1,targetSceneCount:1,targetFrozenCount:1,
      currentFrozenCount:0,candidateChapterCount:1,
      candidateChapterNumbers:[1],candidateNumbersOmitted:0,
      remoteConfigured:true,runningActivityCount:0,
      targetSha256:digestA,currentSha256:digestB,
    });
    expect(post).toMatchObject({
      target:"after",targetRevision:after.updatedAt,
      currentEqualsTargetRevision:true,targetFrozenCount:0,
      targetSha256:digestB,
    });
    for(const blocker of [
      "remote_lease_unverified","external_backup_unverified",
      "historical_fork_unavailable","editorial_approval_unavailable",
    ])expect(pre?.blockers).toContain(blocker);
    expect(pre?.blockers).not.toContain("book_running");
    expect(JSON.stringify(pre)).not.toContain("SEGRETO");
    expect(JSON.stringify(pre)).not.toContain("PROSA");
    expect(JSON.stringify(post)).not.toContain("TITOLO_PRIVATO");
    expect(JSON.stringify(raw)).not.toContain("SEGRETO_GITHUB");
    expect(pre).not.toHaveProperty("readyToRestore");
    expect(pre).not.toHaveProperty("book");
  });
  it("conta writer e task running come blocchi, senza cambiare il canone",()=>{
    const {before,after,task,raw}=fixture();
    const current=structuredClone(after);
    current.status="running";
    const original=JSON.stringify(current);
    const result=buildHistoricalRewindReviewPlan(raw,before.id,task.id,current,task,
      "before",2,digestA,digestB);
    expect(result?.blockers).toContain("book_running");
    expect(result?.blockers).toContain("running_activity");
    expect(result?.runningActivityCount).toBe(2);
    expect(JSON.stringify(current)).toBe(original);
  });
  it("rifiuta task, snapshot, selezione, hash e contatore non affidabili",()=>{
    const {before,after,task,raw}=fixture();
    const plan=(t:Activity,target:"before"|"after",n:number,hash:string)=> 
      buildHistoricalRewindReviewPlan(raw,before.id,task.id,after,t,target,n,hash,digestB);
    expect(plan({...task,status:"failed"},"before",0,digestA)).toBeNull();
    expect(plan({...task,bookId:"other-book"},"before",0,digestA)).toBeNull();
    expect(plan(task,"before",-1,digestA)).toBeNull();
    expect(plan(task,"after",Number.NaN,digestA)).toBeNull();
    expect(plan(task,"before",0,"SEGRETO_IN_HASH")).toBeNull();
    expect(buildHistoricalRewindReviewPlan(raw,before.id,"other-task",
      after,task,"before",0,digestA,digestB)).toBeNull();
    expect(buildHistoricalRewindReviewPlan(raw,"other-book",task.id,
      after,task,"after",0,digestA,digestB)).toBeNull();
    const invalid=structuredClone(raw);
    invalid.before.chapters[0]!.scenes.push(
      structuredClone(invalid.before.chapters[0]!.scenes[0]!));
    expect(buildHistoricalRewindReviewPlan(invalid,before.id,task.id,
      after,task,"before",0,digestA,digestB)).toBeNull();
  });
});
