import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { newBook, type Activity, type BookProject } from "../domain/types";
import {
  estimatedTaskBookBytes, TASK_BOOK_TOTAL_LIMIT_BYTES,
  TaskBookStorageLimitExceeded, summarizeTaskBookCheckpoint,
} from "../domain/task-book-checkpoint";
import {
  getBook, getDb, saveBook, saveBookAndActivity,
} from "./db";
import { createBackup } from "./backup";
import {
  inspectNarrativeTaskHistoryImpact, inspectTaskBookCheckpoint,
  prepareHistoricalRewindReviewPlan,
  loadTaskBookConsent, loadTaskBookInventory,
  setTaskBookConsent, taskBookConsentKey, taskBookKey, taskBookUsageKey,
} from "./task-book-checkpoint";
import { setTaskProseConsent, taskProseKey } from "./task-prose-checkpoint";

async function fixture(){
  const book=newBook("BRIEF_AUTORE_PRIVATO","Trama integra","Narrativo","Adulti");
  book.status="paused";
  book.memory.secrets["rivelazione"]="SEGRETO_NARRATIVO_NON_DIVULGATO";
  book.chapters=[{
    id:"chapter-book",number:1,title:"Capitolo privato",
    purpose:"Trama",frozenAt:"2026-11-11T10:00:00.000Z",
    scenes:[
      {id:"canon",number:1,title:"Scena canon",objective:"Narrativa",
        text:"PROSA_PRE_COPIA_PRIVATA",status:"canon"},
      {id:"draft",number:2,title:"Bozza",objective:"Revisione",
        text:"BOZZA_PRIVATA_MAI_CANON",status:"draft"},
    ],
  }];
  book.remote={owner:"autore",repository:"libro-privato",branch:"main",autoSync:true};
  await saveBook(book,false);
  return (await getBook(book.id))!;
}
function activity(book:BookProject,id:string,status:Activity["status"]="succeeded"):Activity{
  return {id,bookId:book.id,runId:"run",phase:"prose",title:"Task",
    reason:"Scrittura",nextStep:"Rilettura",status,
    createdAt:"2026-11-12T12:00:00.000Z",output:"SEGRETO_OUTPUT_AI"};
}
async function commit(book:BookProject,id:string,status:Activity["status"]="succeeded"){
  const next=structuredClone(book);
  next.chapters[0]!.scenes[0]!.text="PROSA_POST_COPIA_PRIVATA";
  next.chapters[0]!.scenes[1]!.text="BOZZA_POST_OPERAZIONE";
  next.chapters[0]!.frozenAt=undefined;
  next.memory.secrets["rivelazione"]="SEGRETO_MEMORIA_POST";
  await saveBookAndActivity(next,activity(book,id,status),book.updatedAt);
  return (await getBook(book.id))!;
}
describe("Checkpoint narrativi integrali locali, consenso separato #172",()=>{
  it("default OFF, non retroattivo; cronologia strutturale ancora indipendente",async()=>{
    const book=await fixture();
    const id=crypto.randomUUID();
    expect(await loadTaskBookConsent(book.id)).toBe(false);
    await commit(book,id);
    const db=await getDb();
    expect(await db.get("meta",taskBookKey(book.id,id))).toBeUndefined();
    expect(await db.get("meta","task-structure:v1:"+id)).toBeDefined();
    expect(await inspectTaskBookCheckpoint(book.id,id)).toBeNull();
    await setTaskBookConsent(book.id,true);
    expect(await inspectTaskBookCheckpoint(book.id,id)).toBeNull();
    expect((await loadTaskBookInventory(book.id))?.records).toBe(0);
  });

  it("cattura il contenuto narrativo integrale con draft, freeze, memoria e metadata-only UI",async()=>{
    const book=await fixture();
    await setTaskBookConsent(book.id,true);
    const id=crypto.randomUUID();
    const after=await commit(book,id);
    const raw=await (await getDb()).get("meta",taskBookKey(book.id,id));
    expect(raw).toMatchObject({
      schemaVersion:1,bookId:book.id,activityId:id,
      before:{id:book.id,updatedAt:book.updatedAt,status:"paused"},
      after:{id:book.id,updatedAt:after.updatedAt},
    });
    expect(raw.before.chapters).toEqual(book.chapters);
    expect(raw.after.chapters).toEqual(after.chapters);
    expect(raw.before.memory).toEqual(book.memory);
    expect(raw.after.memory).toEqual(after.memory);
    expect(raw.before.brief).toBe("BRIEF_AUTORE_PRIVATO");
    expect(raw.before.remote).toBeUndefined();
    expect(raw.after.remote).toBeUndefined();
    expect(raw).not.toHaveProperty("output");
    expect(raw.before.chapters[0].scenes[1].text).toBe("BOZZA_PRIVATA_MAI_CANON");
    const metadata=await inspectTaskBookCheckpoint(book.id,id);
    expect(metadata).toMatchObject({
      bookId:book.id,activityId:id,revisionBefore:book.updatedAt,
      revisionAfter:after.updatedAt,chaptersBefore:1,chaptersAfter:1,
      scenesBefore:2,scenesAfter:2,frozenBefore:1,frozenAfter:0,
    });
    expect(JSON.stringify(metadata)).not.toContain("SEGRETO");
    expect(JSON.stringify(metadata)).not.toContain("BOZZA");
    const inventory=(await loadTaskBookInventory(book.id))!;
    expect(inventory.records).toBe(1);
    expect(inventory.estimatedBytes).toBe(estimatedTaskBookBytes(raw));
    expect(await (await getDb()).get("meta",taskBookUsageKey(book.id)))
      .toMatchObject({records:1,estimatedBytes:inventory.estimatedBytes});
  });

  it("quota cumulativa rifiuta atomicamente il task senza modificare libro, audit o altri checkpoint",async()=>{
    const book=await fixture();
    await setTaskBookConsent(book.id,true);
    const db=await getDb();
    await db.put("meta",{
      schemaVersion:1,bookId:book.id,records:9,
      estimatedBytes:TASK_BOOK_TOTAL_LIMIT_BYTES-1,
    },taskBookUsageKey(book.id));
    const id=crypto.randomUUID();
    await expect(commit(book,id)).rejects.toBeInstanceOf(TaskBookStorageLimitExceeded);
    const saved=(await getBook(book.id))!;
    expect(saved).toEqual(book);
    expect(await db.get("activities",id)).toBeUndefined();
    expect(await db.get("meta",taskBookKey(book.id,id))).toBeUndefined();
    expect(await db.get("meta","task-structure:v1:"+id)).toBeUndefined();
    expect(await db.get("meta",taskProseKey(book.id,id))).toBeUndefined();
    expect((await db.get("meta",taskBookUsageKey(book.id))).records).toBe(9);
  });

  it("collisione ID salvato da task precedente: abort canone, audit, checkpoint e ledger",async()=>{
    const book=await fixture();
    await setTaskBookConsent(book.id,true);
    const db=await getDb();
    const id=crypto.randomUUID();
    await db.add("meta",{collision:true},taskBookKey(book.id,id));
    await expect(commit(book,id)).rejects.toThrow();
    expect(await getBook(book.id)).toEqual(book);
    expect(await db.get("activities",id)).toBeUndefined();
    expect(await db.get("meta","task-structure:v1:"+id)).toBeUndefined();
    expect((await db.get("meta",taskBookUsageKey(book.id))).records).toBe(0);
  });

  it("consenso indipendente per libro e dalla prosa; revoca selettiva senza perdita del canone",async()=>{
    const a=await fixture();
    const b=await fixture();
    await setTaskBookConsent(a.id,true);
    await setTaskBookConsent(b.id,true);
    await setTaskProseConsent(a.id,true);
    const aid=crypto.randomUUID(),bid=crypto.randomUUID();
    await commit(a,aid);await commit(b,bid);
    const db=await getDb();
    expect(await db.get("meta",taskProseKey(a.id,aid))).toBeDefined();
    await setTaskBookConsent(a.id,false);
    expect(await loadTaskBookConsent(a.id)).toBe(false);
    expect(await inspectTaskBookCheckpoint(a.id,aid)).toBeNull();
    expect(await db.get("meta",taskBookKey(a.id,aid))).toBeUndefined();
    expect(await db.get("meta",taskBookUsageKey(a.id))).toBeUndefined();
    expect(await db.get("meta",taskProseKey(a.id,aid))).toBeDefined();
    expect(await db.get("meta","task-structure:v1:"+aid)).toBeDefined();
    expect(await inspectTaskBookCheckpoint(b.id,bid)).toBeTruthy();
    expect((await getBook(a.id))!.chapters[0]!.scenes[0]!.text)
      .toBe("PROSA_POST_COPIA_PRIVATA");
    expect((await loadTaskBookInventory(a.id))!.records).toBe(0);
  });

  it("consenso corrotto o ledger mancante rifiutano nuovi task (fail closed)",async()=>{
    const book=await fixture();
    await setTaskBookConsent(book.id,true);
    const db=await getDb();
    await db.delete("meta",taskBookUsageKey(book.id));
    const id=crypto.randomUUID();
    await expect(commit(book,id)).rejects.toThrow(/Contatore/);
    expect(await getBook(book.id)).toEqual(book);
    expect(await db.get("activities",id)).toBeUndefined();
    await setTaskBookConsent(book.id,true);
    expect((await loadTaskBookInventory(book.id))!.records).toBe(0);
    await db.put("meta",{bad:true},taskBookUsageKey(book.id));
    await expect(setTaskBookConsent(book.id,true)).rejects.toThrow(/corrotto/);
  });

  it("status failed e task cross-book non producono coppie, ZIP e fork non ereditano meta",async()=>{
    const book=await fixture();
    const other=await fixture();
    await setTaskBookConsent(book.id,true);
    const failed=crypto.randomUUID();
    await commit(book,failed,"failed");
    expect(await (await getDb()).get("meta",taskBookKey(book.id,failed)))
      .toBeUndefined();
    const wrong=crypto.randomUUID();
    const updated=structuredClone((await getBook(book.id))!);
    await saveBookAndActivity(updated,{
      ...activity(other,wrong),bookId:other.id,
    },updated.updatedAt);
    expect(await (await getDb()).get("meta",taskBookKey(book.id,wrong)))
      .toBeUndefined();
    const id=crypto.randomUUID();
    await commit((await getBook(book.id))!,id);
    const zip=await createBackup("content");
    const raw=JSON.parse(strFromU8(unzipSync(new Uint8Array(
      await zip.arrayBuffer()))["content.json"]!));
    const serialized=JSON.stringify(raw);
    expect(serialized).not.toContain(taskBookConsentKey(book.id));
    expect(serialized).not.toContain(taskBookKey(book.id,id));
    expect(serialized).not.toContain(taskBookUsageKey(book.id));
    expect(JSON.stringify(await inspectTaskBookCheckpoint(book.id,id)))
      .not.toContain("PROSA_POST");
  });

  it("analisi storica è solo metadata e usa la revisione del libro corrente",async()=>{
    const book=await fixture();
    await setTaskBookConsent(book.id,true);
    const id=crypto.randomUUID();
    const after=await commit(book,id);
    const result=await inspectNarrativeTaskHistoryImpact(book.id,id);
    expect(result).toMatchObject({
      bookId:book.id,activityId:id,revisionBefore:book.updatedAt,
      revisionAfter:after.updatedAt,currentRevision:after.updatedAt,
      currentRevisionEqualsRecordedAfter:true,
      chaptersChanged:1,scenesChanged:2,
      frozenRemoved:1,globalNarrativeChange:true,memoryChanged:true,
      candidateChapterCount:1,candidateChapterNumbers:[1],
    });
    for(const secret of ["PROSA_PRE","PROSA_POST","BOZZA_PRIVATA",
      "SEGRETO_MEMORIA","BRIEF_AUTORE","account-privato"])
      expect(JSON.stringify(result)).not.toContain(secret);
    const latest=structuredClone(after);
    latest.brief="NUOVA_ISTRUZIONE_PRIVATA";
    await saveBook(latest,false,after.updatedAt);
    const changed=await inspectNarrativeTaskHistoryImpact(book.id,id);
    expect(changed?.currentRevisionEqualsRecordedAfter).toBe(false);
    expect(changed?.revisionAfter).toBe(after.updatedAt);
  });

  it("no dati se task cross-book, consenso revocato o checkpoint corrotto",async()=>{
    const a=await fixture(),b=await fixture();
    await setTaskBookConsent(a.id,true);
    const id=crypto.randomUUID();
    await commit(a,id);
    expect(await inspectNarrativeTaskHistoryImpact(b.id,id)).toBeNull();
    expect(await inspectNarrativeTaskHistoryImpact(a.id,id)).toBeTruthy();
    await setTaskBookConsent(a.id,false);
    expect(await inspectNarrativeTaskHistoryImpact(a.id,id)).toBeNull();
    await setTaskBookConsent(a.id,true);
    await (await getDb()).put("meta",{schemaVersion:1,bookId:a.id,activityId:id,
      before:{id:a.id,chapters:[]},after:{id:a.id,chapters:[]}},
      taskBookKey(a.id,id));
    expect(await inspectNarrativeTaskHistoryImpact(a.id,id)).toBeNull();
  });

  it("piano prima/dopo con digest reali: lettura consentita, zero scritture",async()=>{
    const book=await fixture();
    await setTaskBookConsent(book.id,true);
    const id=crypto.randomUUID();
    const after=await commit(book,id);
    const db=await getDb();
    const raw=await db.get("meta",taskBookKey(book.id,id));
    const encoded=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
    const hex=async(value:unknown)=>Array.from(new Uint8Array(
      await crypto.subtle.digest("SHA-256",encoded(value))),
      x=>x.toString(16).padStart(2,"0")).join("");
    const expectedBefore=await hex(raw.before);
    const expectedAfter=await hex(raw.after);
    expect(expectedBefore).not.toBe(expectedAfter);
    const pre=await prepareHistoricalRewindReviewPlan(book.id,id,"before");
    const post=await prepareHistoricalRewindReviewPlan(book.id,id,"after");
    expect(pre).toMatchObject({
      bookId:book.id,activityId:id,target:"before",
      targetRevision:book.updatedAt,currentRevision:after.updatedAt,
      targetSha256:expectedBefore,currentSha256:expectedAfter,
      candidateChapterCount:1,runningActivityCount:0,
      remoteConfigured:true,targetFrozenCount:1,currentFrozenCount:0,
    });
    expect(post).toMatchObject({
      target:"after",targetSha256:expectedAfter,
      currentSha256:expectedAfter,currentEqualsTargetRevision:true,
    });
    for(const secret of ["BRIEF_AUTORE_PRIVATO","PROSA_PRE",
      "SEGRETO_MEMORIA","libro-privato","SEGRETO_OUTPUT_AI"])
      expect(JSON.stringify(pre)).not.toContain(secret);
    expect(await db.get("meta",taskBookKey(book.id,id))).toEqual(raw);
    expect(await getBook(book.id)).toEqual(after);
    expect(await db.get("activities",id)).toBeDefined();
  });

  it("piano segnala task ancora running e baseline mutata senza autorizzare restore",async()=>{
    const book=await fixture();
    await setTaskBookConsent(book.id,true);
    const id=crypto.randomUUID();
    const after=await commit(book,id);
    const db=await getDb();
    const original=await prepareHistoricalRewindReviewPlan(book.id,id,"before");
    expect(original).toBeTruthy();
    const updated=structuredClone(after);
    updated.brief="ALTRO_BRIEF_PRIVATO";
    updated.status="running";
    await saveBook(updated,false,after.updatedAt);
    const current=(await getBook(book.id))!;
    await db.put("activities",{
      ...activity(book,crypto.randomUUID()),status:"running",
    },crypto.randomUUID());
    const plan=await prepareHistoricalRewindReviewPlan(book.id,id,"before");
    expect(plan?.currentRevision).toBe(current.updatedAt);
    expect(plan?.currentSha256).not.toBe(original?.currentSha256);
    expect(plan?.blockers).toContain("book_running");
    expect(plan?.blockers).toContain("running_activity");
    expect(plan?.blockers).toContain("remote_lease_unverified");
    expect(plan?.blockers).toContain("external_backup_unverified");
    expect(plan?.blockers).toContain("historical_fork_unavailable");
    expect(plan?.blockers).toContain("editorial_approval_unavailable");
    expect(plan).not.toHaveProperty("readyToRestore");
  });

  it("piano fail-closed con book/task cross-book, revoca e snapshot corrotta",async()=>{
    const a=await fixture(),b=await fixture();
    await setTaskBookConsent(a.id,true);
    const id=crypto.randomUUID();
    await commit(a,id);
    expect(await prepareHistoricalRewindReviewPlan(a.id,id,"after")).toBeTruthy();
    expect(await prepareHistoricalRewindReviewPlan(b.id,id,"after")).toBeNull();
    expect(await prepareHistoricalRewindReviewPlan(a.id,"missing","before")).toBeNull();
    expect(await prepareHistoricalRewindReviewPlan(a.id,id,"strano" as "before"))
      .toBeNull();
    await setTaskBookConsent(a.id,false);
    expect(await prepareHistoricalRewindReviewPlan(a.id,id,"before")).toBeNull();
    await setTaskBookConsent(a.id,true);
    const db=await getDb();
    await db.put("meta",{schemaVersion:1,bookId:a.id,activityId:id,
      before:{id:a.id,chapters:[]},after:{id:a.id,chapters:[]}},
      taskBookKey(a.id,id));
    expect(await prepareHistoricalRewindReviewPlan(a.id,id,"before")).toBeNull();
    expect(await getBook(a.id)).toBeDefined();
  });

  it("checkpoint corrotto o senza bookId esatto non rivela metadati",async()=>{
    const book=await fixture();
    await setTaskBookConsent(book.id,true);
    const db=await getDb();
    const id=crypto.randomUUID();
    await db.put("meta",{schemaVersion:1,bookId:book.id,
      activityId:id,before:{id:"altro"},after:{id:book.id}},
      taskBookKey(book.id,id));
    expect(await inspectTaskBookCheckpoint(book.id,id)).toBeNull();
    expect(summarizeTaskBookCheckpoint(null,book.id,id)).toBeNull();
  });
});
