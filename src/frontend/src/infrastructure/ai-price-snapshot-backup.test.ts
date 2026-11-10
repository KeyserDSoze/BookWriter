import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createBackup, readBackup } from "./backup";
import { getDb, saveActivity, saveBook } from "./db";
import { newBook, type Activity } from "../domain/types";

beforeEach(async () => {
  const db=await getDb();
  await db.clear("books"); await db.clear("activities");
  await db.clear("mergeDrafts"); await db.clear("outbox");
});
describe("ZIP content-only: tariffe per tentativo AI",()=>{
  it("preserva il listino storico senza settings o credenziali e rifiuta un listino ostile",async()=>{
    const book=newBook("Trama","Romanzo","Sobrio","Adulti");
    await saveBook(book,false);
    const row: Activity={
      id:crypto.randomUUID(),bookId:book.id,runId:crypto.randomUUID(),
      phase:"chapterReview",title:"Revisore",reason:"Controllo",
      nextStep:"Riprendere",status:"failed",aiRequested:true,
      createdAt:"2026-11-10T10:00:00.000Z",
      endpointId:"openai",modelId:"model-A",inputTokens:200,outputTokens:40,
      priceRateSnapshot:{endpointId:"openai",modelId:"model-A",
        inputEurPerMillion:3,outputEurPerMillion:9},
    };
    await saveActivity(row);
    const zip=await createBackup("content");
    const parsed=await readBackup(zip as File);
    expect(parsed.settings).toBeUndefined();
    expect(parsed.activities.find(x=>x.id===row.id)?.priceRateSnapshot)
      .toEqual(row.priceRateSnapshot);
    expect(JSON.stringify(parsed)).not.toContain("sk-test-secret");
    const entries=unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const payload=JSON.parse(strFromU8(entries["content.json"]!));
    const activity=payload.activities.find((x:{id:string})=>x.id===row.id);
    activity.priceRateSnapshot.inputEurPerMillion=-9;
    const corrupt=zipSync({
      "manifest.json":entries["manifest.json"]!,
      "content.json":strToU8(JSON.stringify(payload)),
    },{level:6});
    await expect(readBackup(new Blob([new Uint8Array(corrupt)]) as File))
      .rejects.toThrow(/Schema backup non valido/);
  });
  it("legge archivi legacy senza priceRateSnapshot",async()=>{
    const book=newBook("Trama","Romanzo legacy","Sobrio","Adulti");
    await saveBook(book,false);
    await saveActivity({
      id:crypto.randomUUID(),bookId:book.id,runId:crypto.randomUUID(),
      phase:"prose",title:"Scena",reason:"Test",nextStep:"Riprendi",
      createdAt:"2026-11-01T10:00:00.000Z",status:"succeeded",
      endpointId:"openai",modelId:"model-old",inputTokens:45,outputTokens:20,
      aiRequested:true,
    });
    const parsed=await readBackup(await createBackup("content") as File);
    expect(parsed.activities).toHaveLength(1);
    expect(parsed.activities[0]?.priceRateSnapshot).toBeUndefined();
  });
});
