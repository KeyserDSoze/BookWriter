import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorialCycle } from "../domain/editorial-board";
import { newBook, type BookProject } from "../domain/types";
import { getBook, getDb, listActivities, saveBook } from "../infrastructure/db";

const {lookupMock}=vi.hoisted(()=>({lookupMock:vi.fn()}));
vi.mock("../infrastructure/library-of-congress",()=>({searchLibraryOfCongress:lookupMock}));
import { attachArchiveCatalog } from "./archival-catalog";

const at="2026-11-06T10:00:00.000Z";
const item={
  id:"loc:2020123456:"+Date.parse(at),provider:"loc.gov",
  itemId:"2020123456",url:"https://www.loc.gov/item/2020123456/",
  title:"Telegraph 1848",query:"telegraph communications 1848",retrievedAt:at,
};
async function fixture(frozen=false):Promise<BookProject>{
  const book=newBook("Segreti di Mara","Castello","Sobrio","Adulti");
  book.status="paused";book.phase="prose";
  book.memory.secrets.chiave="La chiave segreta non va inviata a www.loc.gov.";
  book.chapters=[
    {id:"ch1",number:1,title:"Partenza",purpose:"Prologo",
      scenes:[{id:"s1",number:1,title:"La lettera",objective:"Inizio",
        text:"Mara invia un telegrafo.",status:"canon"}],
      ...(frozen?{frozenAt:at,summary:"Mara invia una lettera.",
        bookSummaryAtFreeze:"Mara invia una lettera."}:{})},
    {id:"ch2",number:2,title:"Arrivo",purpose:"Trama",
      scenes:[{id:"s2",number:1,title:"Il viaggio",objective:"Viaggio",
        text:"Mara prosegue il viaggio.",status:"canon"}],
      ...(frozen?{frozenAt:at,summary:"Mara viaggia.",
        bookSummaryAtFreeze:"Mara invia una lettera e viaggia."}:{})},
  ];
  if(frozen){book.status="completed";book.phase="completed";
    book.bookSummary="Mara invia una lettera e viaggia.";}
  book.remote={owner:"owner",repository:"book",branch:"main",
    autoSync:true,lastSyncedCommit:"a".repeat(40)};
  await saveBook(book);
  return book;
}
beforeEach(async()=>{
  const db=await getDb();
  for(const store of ["books","activities","outbox"] as const) await db.clear(store);
  lookupMock.mockReset();lookupMock.mockResolvedValue([item]);
  vi.stubGlobal("navigator",{locks:{request:async(
    _name:string,_options:unknown,fn:(lock:object)=>Promise<unknown>,
  )=>fn({name:"test-lock"})}});
});
afterEach(()=>vi.unstubAllGlobals());

describe("Consultazione catalogo LoC approvata dall'autore",()=>{
  it("salva schede senza copiare segreti né modificare la prosa",async()=>{
    const b=await fixture();
    const result=await attachArchiveCatalog(b.id,"ch1",b.updatedAt,[item.query]);
    expect(result.itemCount).toBe(1);
    expect(lookupMock.mock.calls[0]?.[0]).toEqual([item.query]);
    expect(JSON.stringify(lookupMock.mock.calls)).not.toContain("La chiave segreta");
    const saved=await getBook(b.id);
    expect(saved?.chapters[0]?.historicalDossier?.archiveCatalog?.items[0]?.itemId)
      .toBe("2020123456");
    expect(saved?.chapters[0]?.scenes[0]?.text).toBe("Mara invia un telegrafo.");
    expect(saved?.remote?.autoSync).toBe(false);
    expect((await listActivities(b.id)).some(x=>x.title.includes("archivistico"))).toBe(true);
  });
  it("riapre un capitolo congelato conservando sinossi precedente e invalidando successivi",async()=>{
    const b=await fixture(true);
    const result=await attachArchiveCatalog(b.id,"ch2",b.updatedAt,[item.query]);
    const saved=await getBook(b.id);
    expect(result.reopened).toBe(true);
    expect(saved?.chapters[0]?.frozenAt).toBeDefined();
    expect(saved?.chapters[1]?.frozenAt).toBeUndefined();
    expect(saved?.bookSummary).toBe("Mara invia una lettera.");
    expect(saved?.editorialCycle?.chapterId).toBe("ch2");
    expect(saved?.status).toBe("paused");
  });
  it("non salva risultati se il libro è cambiato durante la chiamata",async()=>{
    const b=await fixture();
    lookupMock.mockImplementationOnce(async()=>{
      const changed=(await getBook(b.id))!;
      changed.authorConstraints.push("Non usare dati archivistici senza controllare i documenti.");
      await saveBook(changed,false);
      return [item];
    });
    await expect(attachArchiveCatalog(b.id,"ch1",b.updatedAt,[item.query]))
      .rejects.toThrow(/modificato durante/);
    expect((await getBook(b.id))?.chapters[0]?.historicalDossier).toBeUndefined();
  });
  it("non chiama il servizio durante una redazione attiva",async()=>{
    const b=await fixture();
    b.editorialCycle=createEditorialCycle("ch1");await saveBook(b,false);
    await expect(attachArchiveCatalog(b.id,"ch1",b.updatedAt,[item.query]))
      .rejects.toThrow(/redazione attiva/);
    expect(lookupMock).not.toHaveBeenCalled();
  });
  it("non persiste il dossier senza writer lock",async()=>{
    const b=await fixture();
    vi.stubGlobal("navigator",{locks:{request:async(
      _name:string,_options:unknown,fn:(lock:null)=>Promise<unknown>,
    )=>fn(null)}});
    await expect(attachArchiveCatalog(b.id,"ch1",b.updatedAt,[item.query]))
      .rejects.toThrow(/un'altra scheda/);
    expect((await getBook(b.id))?.chapters[0]?.historicalDossier).toBeUndefined();
  });
});
