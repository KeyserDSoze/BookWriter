import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBook } from "../domain/types";
import { getBook, getDb, listActivities, saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import { createEditorialCycle } from "../domain/editorial-board";
import { reopenChapterReview } from "./editorial-control";

beforeEach(async()=>{
  const db=await getDb();
  await db.clear("books");await db.clear("activities");await db.clear("outbox");
  vi.stubGlobal("navigator",{locks:{request:async(
    _name:string,_options:unknown,callback:(lock:object)=>Promise<unknown>
  )=>callback({name:"lock"})}});
});
afterEach(()=>vi.unstubAllGlobals());
async function sample(){
  const book=newBook("Un racconto","Riapertura","Stile","Adulti");
  book.status="completed";book.phase="completed";
  book.bookSummary="Due capitoli congelati: Mara arriva e poi scopre il castello.";
  book.remote={owner:"owner",repository:"novel",branch:"main",
    lastSyncedCommit:"a".repeat(40),autoSync:true};
  book.chapters=[1,2].map(number=>({
    id:"ch-"+number,number,title:"Capitolo "+number,purpose:"Un obiettivo",
    frozenAt:new Date().toISOString(),
    summary:"Riassunto del capitolo "+number,
    scenes:[{id:"scene-"+number,number:1,title:"Scena",objective:"Avanzare",
      text:"Mara incontra un personaggio e prosegue.",
      status:"canon" as const}],
  }));
  await saveBook(book);
  return book;
}
describe("Riapertura conservativa di capitoli congelati",()=>{
  it("invalida il capitolo scelto e tutti i successivi, spegne autosync e cancella la coda",async()=>{
    const book=await sample();
    expect(await getOutbox(book.id)).toBeDefined();
    await reopenChapterReview(book.id,"ch-1");
    const updated=await getBook(book.id);
    expect(updated?.phase).toBe("chapterReview");
    expect(updated?.status).toBe("paused");
    expect(updated?.editorialCycle?.chapterId).toBe("ch-1");
    expect(updated?.editorialCycle?.stage).toBe("review");
    expect(updated?.chapters.every(ch=>!ch.frozenAt)).toBe(true);
    expect(updated?.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect((await listActivities(book.id)).some(x=>x.title==="Riapertura redazione capitolo")).toBe(true);
  });
  it("può riaprire solo il capitolo più recente lasciando congelati i precedenti",async()=>{
    const book=await sample();
    await reopenChapterReview(book.id,"ch-2");
    const result=await getBook(book.id);
    expect(result?.chapters[0]?.frozenAt).toBeDefined();
    expect(result?.chapters[1]?.frozenAt).toBeUndefined();
    expect(result?.bookSummary).toBe("Riassunto del capitolo 1");
  });
  it("riapre un capitolo usando la sinossi globale esatta salvata al freeze precedente",async()=>{
    const book=await sample();
    const clue="La promessa iniziale torna negli indizi del castello. ".repeat(210);
    book.chapters[0]!.bookSummaryAtFreeze=clue;
    book.chapters[1]!.bookSummaryAtFreeze=clue+"Segue il capitolo due.";
    await saveBook(book,false);
    await reopenChapterReview(book.id,"ch-2");
    const updated=await getBook(book.id);
    expect(updated?.bookSummary).toBe(clue);
    expect(updated?.chapters[0]?.bookSummaryAtFreeze).toBe(clue);
    expect(updated?.chapters[1]?.bookSummaryAtFreeze).toBeUndefined();
    expect(updated?.chapters[1]?.frozenAt).toBeUndefined();
  });
  it("rifiuta il rewind di molte sinossi legacy senza snapshot prima di toccare libri o outbox",async()=>{
    const book=await sample();
    book.chapters[0]!.summary="Indizio non eliminabile. ".repeat(390);
    await saveBook(book,false);
    const before=await getOutbox(book.id);
    await expect(reopenChapterReview(book.id,"ch-2")).rejects.toThrow(/non verranno troncate/);
    const after=await getBook(book.id);
    expect(after?.chapters[1]?.frozenAt).toBeDefined();
    expect(after?.remote?.autoSync).toBe(true);
    expect((await getOutbox(book.id))?.operationId).toBe(before?.operationId);
  });
  it("dopo tre round bloccati richiede istruzione autore e mantiene i rapporti",async()=>{
    const book=await sample();
    book.editorialCycle=createEditorialCycle("ch-1");
    book.editorialCycle.stage="blocked";
    book.editorialCycle.round=4;
    book.editorialCycle.priorRounds=[{
      round:1,reports:[],judgment:{reasoning:"Un problema rimasto aperto.",
        decisions:[],verdict:"repair",createdAt:new Date().toISOString()},
    }];
    await saveBook(book,false);
    await expect(reopenChapterReview(book.id,"ch-1","breve")).rejects.toThrow(/almeno 12/);
    await reopenChapterReview(book.id,"ch-1",
      "Mantieni l'ambiguità ma evita un possibile spoiler.");
    const updated=await getBook(book.id);
    expect(updated?.editorialCycle?.round).toBe(1);
    expect(updated?.chapters[0]?.editorialRounds).toHaveLength(1);
    expect(updated?.authorConstraints.at(-1)).toContain("Mantieni");
  });
  it("blocca la riapertura se una scheda concorrente possiede il lock",async()=>{
    const book=await sample();
    vi.stubGlobal("navigator",{locks:{request:async(
      _name:string,_options:unknown,cb:(lock:null)=>Promise<unknown>
    )=>cb(null)}});
    await expect(reopenChapterReview(book.id,"ch-1")).rejects.toThrow(/un'altra scheda/);
    expect((await getBook(book.id))?.chapters.every(ch=>!!ch.frozenAt)).toBe(true);
  });
});
