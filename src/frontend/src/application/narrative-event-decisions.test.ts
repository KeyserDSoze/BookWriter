import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { newBook } from "../domain/types";
import { buildNarrativeEventCandidateIndex } from "../domain/narrative-event-candidates";
import { getBook, getDb, saveBook, listActivities } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import { recordNarrativeEventDecision } from "./narrative-event-decisions";

beforeEach(async () => {
  const db = await getDb();
  await db.clear("books"); await db.clear("activities"); await db.clear("outbox");
  vi.stubGlobal("navigator", {locks:{request:async(_n:string,_o:unknown,cb:(lock:object)=>Promise<unknown>) =>
    cb({})}});
});
afterEach(() => vi.unstubAllGlobals());
async function sample() {
  const book = newBook("Romanzo", "Menzioni", "Stile", "Adulti");
  book.status = "paused";
  book.remote = {owner:"author",repository:"novel",branch:"main",autoSync:true,
    lastSyncedCommit:"a".repeat(40)};
  book.chapters = [{id:"c",number:1,title:"Capitolo",purpose:"Trama",
    frozenAt:"2026-11-07T10:00:00.000Z",
    scenes:[{id:"s",number:1,title:"Scena",objective:"Consegna",
      text:"Mara consegna la chiave a Elio.",status:"canon"}]}];
  await saveBook(book);
  return (await getBook(book.id))!;
}
describe("Salvataggio protetto dell'annotazione autore", () => {
  it("salva attività e audit atomici, disattiva autosync e svuota l'outbox", async () => {
    const book = await sample(), candidate = buildNarrativeEventCandidateIndex(book).events[0]!;
    expect(await getOutbox(book.id)).toBeDefined();
    await recordNarrativeEventDecision(book.id,book.updatedAt,candidate,"affirmed",
      "La consegna avviene realmente nel romanzo.");
    const after = (await getBook(book.id))!;
    expect(after.narrativeEventDecisions).toHaveLength(1);
    expect(after.memory).toEqual(book.memory);
    expect(after.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect((await listActivities(book.id)).some(a =>
      a.title === "Decisione autore su menzione narrativa")).toBe(true);
  });
  it("rifiuta revisioni concorrenti e testo contraffatto senza effetti collaterali", async () => {
    const book = await sample(), candidate = buildNarrativeEventCandidateIndex(book).events[0]!;
    await expect(recordNarrativeEventDecision(book.id,"2020-01-01",candidate,"affirmed",
      "Questa decisione non è corrente.")).rejects.toThrow(/cambiato/);
    await expect(recordNarrativeEventDecision(book.id,book.updatedAt,
      {...candidate,offset:candidate.offset+1},"affirmed","Testo inventato dal client."))
      .rejects.toThrow(/Menzione/);
    expect((await getBook(book.id))?.remote?.autoSync).toBe(true);
    expect(await getOutbox(book.id)).toBeDefined();
  });
  it("rifiuta l'azione durante autopilot",async()=>{
    const book=await sample(); const c=buildNarrativeEventCandidateIndex(book).events[0]!;
    book.status="running"; await saveBook(book,false);
    await expect(recordNarrativeEventDecision(book.id,book.updatedAt,c,"dismissed",
      "Scena non canonica per scelta autore.")).rejects.toThrow();
  });
});
