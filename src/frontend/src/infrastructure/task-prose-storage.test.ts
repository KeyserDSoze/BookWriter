import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { newBook, type Activity, type BookProject } from "../domain/types";
import {
  estimateNextProsePairBytes, estimateProsePayloadBytes,
  PROSE_MIB, TaskProseQuotaExceeded,
} from "../domain/task-prose-storage";
import { getBook, getDb, saveBook, saveBookAndActivity } from "./db";
import { createBackup } from "./backup";
import {
  deleteSelectedTaskProse, loadTaskProseInventory, setTaskProseLimit,
  taskProseLimitKey, taskProseRemovalKey, wasTaskProseManuallyRemoved,
} from "./task-prose-storage";
import {
  loadTaskProseCheckpoint, setTaskProseConsent, taskProseKey, taskProseUsageKey,
} from "./task-prose-checkpoint";

async function bookFixture(size=100) {
  const book=newBook("BRIEF_SECRET","Libro grande","Narrativo","Adulti");
  book.chapters=[{id:"ch",number:1,title:"Titolo",purpose:"Scena",scenes:[{
    id:"scene",number:1,title:"Scena",objective:"Narrativa",
    text:"A".repeat(size),status:"canon",
  }]}];
  await saveBook(book,false);
  return (await getBook(book.id))!;
}
async function commit(book:BookProject,id:string,text:string){
  const updated=structuredClone(book);
  updated.chapters[0]!.scenes[0]!.text=text;
  const activity:Activity={
    id,bookId:book.id,runId:"run",phase:"prose",
    title:"Generazione",reason:"Scrittura",nextStep:"Rilettura",
    status:"succeeded",createdAt:new Date().toISOString(),
    output:"OUTPUT_PRIVATO",
  };
  await saveBookAndActivity(updated,activity,book.updatedAt);
  return (await getBook(book.id))!;
}
describe("Storage locale opt-in e retention selettiva #168",()=>{
  it("inventario per libro con stima UTF-8, senza testi o statistiche browser inventate",async()=>{
    const book=await bookFixture();
    const empty=await loadTaskProseInventory(book.id);
    expect(empty).toMatchObject({bookId:book.id,records:0,estimatedBytes:0,limitMiB:null});
    expect(empty!.nextPairEstimateBytes).toBe(estimateNextProsePairBytes(book));
    await setTaskProseConsent(book.id,true);
    await setTaskProseLimit(book.id,2);
    const taskId=crypto.randomUUID();
    const next=await commit(book,taskId,"🙂".repeat(500));
    const inventory=(await loadTaskProseInventory(book.id))!;
    const snapshot=(await loadTaskProseCheckpoint(book.id,taskId))!;
    expect(inventory).toMatchObject({
      bookId:book.id,records:1,limitMiB:2,
      entries:[{activityId:taskId,estimatedBytes:estimateProsePayloadBytes(snapshot)}],
    });
    expect(inventory.estimatedBytes).toBe(estimateProsePayloadBytes(snapshot));
    expect(inventory.entries[0]).not.toHaveProperty("text");
    expect(inventory.estimatedBytes).toBeGreaterThan(1500);
    expect(await loadTaskProseInventory("unknown")).toBeNull();
    expect(next.chapters[0]!.scenes[0]!.text).toHaveLength(1000);
    // JSON payload and actual browser disk usage are never conflated.
    expect(inventory.estimatedBytes).toBeLessThan(2*PROSE_MIB);
  });

  it("limite all'interno del commit: task rifiutato senza canone, attività o checkpoint parziali",async()=>{
    const before=await bookFixture(650_000);
    await setTaskProseConsent(before.id,true);
    await setTaskProseLimit(before.id,1);
    const failedId=crypto.randomUUID();
    const next=structuredClone(before);
    next.chapters[0]!.scenes[0]!.text="B".repeat(650_000);
    const activity:Activity={
      id:failedId,bookId:before.id,runId:"run",phase:"prose",
      title:"Quota",reason:"Scrivere",nextStep:"Fermarsi",
      createdAt:new Date().toISOString(),status:"succeeded",
    };
    await expect(saveBookAndActivity(next,activity,before.updatedAt))
      .rejects.toBeInstanceOf(TaskProseQuotaExceeded);
    const stored=(await getBook(before.id))!;
    expect(stored.updatedAt).toBe(before.updatedAt);
    expect(stored.chapters[0]!.scenes[0]!.text).toBe("A".repeat(650_000));
    const db=await getDb();
    expect(await db.get("activities",failedId)).toBeUndefined();
    expect(await db.get("meta","task-structure:v1:"+failedId)).toBeUndefined();
    expect(await db.get("meta",taskProseKey(before.id,failedId))).toBeUndefined();
    expect((await loadTaskProseInventory(before.id))!.records).toBe(0);
  });

  it("quota cumulativa si libera solo con cancellazione autorizzata e traccia tombstone",async()=>{
    let book=await bookFixture(225_000);
    await setTaskProseConsent(book.id,true);
    await setTaskProseLimit(book.id,1);
    const first=crypto.randomUUID(),second=crypto.randomUUID(),third=crypto.randomUUID();
    book=await commit(book,first,"B".repeat(225_000));
    book=await commit(book,second,"C".repeat(225_000));
    const beforeRejected=book.updatedAt;
    await expect(commit(book,third,"D".repeat(225_000)))
      .rejects.toBeInstanceOf(TaskProseQuotaExceeded);
    expect((await getBook(book.id))!.updatedAt).toBe(beforeRejected);
    expect((await loadTaskProseInventory(book.id))!.records).toBe(2);
    expect(await deleteSelectedTaskProse(book.id,[first])).toBe(1);
    expect(await deleteSelectedTaskProse(book.id,[first])).toBe(0);
    expect(await wasTaskProseManuallyRemoved(book.id,first)).toBe(true);
    expect(await loadTaskProseCheckpoint(book.id,first)).toBeNull();
    await expect((await getDb()).get("meta",taskProseRemovalKey(book.id,first)))
      .resolves.toMatchObject({reason:"author_selected",activityId:first});
    book=await commit(book,third,"D".repeat(225_000));
    const inventory=(await loadTaskProseInventory(book.id))!;
    expect(inventory.records).toBe(2);
    expect(await (await getDb()).get("meta",taskProseUsageKey(book.id)))
      .toMatchObject({schemaVersion:1,records:2,estimatedBytes:inventory.estimatedBytes});
    expect(inventory.entries.map(x=>x.activityId)).toEqual(expect.arrayContaining([second,third]));
    expect(await (await getDb()).get("meta","task-structure:v1:"+first)).toBeDefined();
    const archive=await createBackup("content");
    const data=JSON.parse(strFromU8(unzipSync(new Uint8Array(
      await archive.arrayBuffer()))["content.json"]!));
    expect(JSON.stringify(data)).not.toContain(taskProseRemovalKey(book.id,first));
    expect(JSON.stringify(data)).not.toContain(taskProseLimitKey(book.id));
  });

  it("selezione singola/multipla solo per ID esatti e libro, nessuna retention automatica",async()=>{
    let book=await bookFixture();
    const other=await bookFixture();
    await setTaskProseConsent(book.id,true);
    await setTaskProseConsent(other.id,true);
    const ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
    for(const [i,id] of ids.entries()) book=await commit(book,id,"B".repeat(i+1));
    const otherId=crypto.randomUUID();
    await commit(other,otherId,"SEGRETO_ALTRO_LIBRO");
    expect((await loadTaskProseInventory(book.id))!.records).toBe(3);
    expect(await deleteSelectedTaskProse(book.id,[ids[0]!,ids[1]!])).toBe(2);
    expect(await wasTaskProseManuallyRemoved(book.id,ids[1]!)).toBe(true);
    expect(await deleteSelectedTaskProse(book.id,[otherId])).toBe(0);
    expect(await loadTaskProseCheckpoint(other.id,otherId)).toBeTruthy();
    expect((await loadTaskProseInventory(book.id))!.records).toBe(1);
    expect((await getBook(book.id))!.chapters[0]!.scenes[0]!.text).toBe("BBB");
    for(const bad of [[],[ids[2]!,ids[2]!],Array(21).fill("x")] as string[][])
      await expect(deleteSelectedTaskProse(book.id,bad)).rejects.toThrow(/Seleziona/);
    await expect(setTaskProseLimit(book.id,0)).rejects.toThrow(/Limite/);
    await expect(setTaskProseLimit(book.id,1.5)).rejects.toThrow(/Limite/);
    await setTaskProseLimit(book.id,null);
    expect((await loadTaskProseInventory(book.id))!.limitMiB).toBeNull();
    // Ledger does not exist until a limit is configured. Initializing it
    // from legacy opt-in copies gives revocation a concrete index to reset.
    await setTaskProseLimit(book.id,1);
    expect(await (await getDb()).get("meta",taskProseUsageKey(book.id)))
      .toMatchObject({records:1});
    await setTaskProseConsent(book.id,false);
    await expect((await getDb()).get("meta",taskProseUsageKey(book.id)))
      .resolves.toMatchObject({records:0,estimatedBytes:0});
  });

  it("configurazione limite corrotta blocca il task (fail-closed), non elimina testi",async()=>{
    const book=await bookFixture();
    await setTaskProseConsent(book.id,true);
    const db=await getDb();
    await db.put("meta",0,taskProseLimitKey(book.id));
    const current=(await getBook(book.id))!;
    const next=structuredClone(current);
    const id=crypto.randomUUID();
    await expect(saveBookAndActivity(next,{
      id,bookId:book.id,runId:"run",phase:"prose",title:"Quota",
      reason:"Salva",nextStep:"Controlla",status:"succeeded",
      createdAt:new Date().toISOString(),
    },current.updatedAt)).rejects.toThrow(/non valido/);
    expect((await getBook(book.id))!.updatedAt).toBe(current.updatedAt);
    expect(await db.get("activities",id)).toBeUndefined();
  });
});
