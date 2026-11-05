import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorialCycle } from "../domain/editorial-board";
import { newBook, type BookProject } from "../domain/types";
import { getBook, getDb, listActivities, saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import type { BibliographicWork } from "../domain/bibliography";
const { lookupMock } = vi.hoisted(()=>({lookupMock:vi.fn()}));
vi.mock("../infrastructure/crossref",()=>({lookupCrossrefDois:lookupMock}));
import { attachBibliographyToChapter } from "./historical-bibliography";
const when="2026-11-05T21:00:00.000Z";
const work:BibliographicWork={
  id:"crossref:10.1000/xyz123:"+Date.parse(when),
  provider:"crossref",doi:"10.1000/xyz123",
  title:"Le ferrovie europee",authors:["Anna Rossi"],workType:"journal-article",
  publicationYear:2005,publisher:"Editore",url:"https://doi.org/10.1000/xyz123",
  retrievedAt:when,
};
async function fixture(frozen=false):Promise<BookProject>{
  const b=newBook("Romanzo segreto","In treno","Prosa","Adulti");
  b.status="paused";b.phase="prose";
  b.memory.secrets.password="Il messaggio non deve essere scoperto.";
  b.chapters=[
    {id:"ch1",number:1,title:"Partenza",purpose:"Raccogliere indizi",
      scenes:[{id:"s1",number:1,title:"La stazione",objective:"Partire",
        text:"Mara sale sul treno.",status:"canon"}],
      ...(frozen?{frozenAt:when,summary:"Il treno",
        bookSummaryAtFreeze:"Mara parte sul treno."}:{}),
    },
    {id:"ch2",number:2,title:"Arrivo",purpose:"Cambiare luogo",
      scenes:[{id:"s2",number:1,title:"Il ritorno",objective:"Arrivare",
        text:"Mara arriva alla stazione.",status:"canon"}],
      ...(frozen?{frozenAt:when,summary:"Mara arriva",
        bookSummaryAtFreeze:"Mara parte sul treno e arriva."}:{}),
    },
  ];
  if(frozen){b.status="completed";b.phase="completed";
    b.bookSummary="Mara parte sul treno e arriva.";}
  b.remote={owner:"owner",repository:"book",branch:"main",autoSync:true,
    lastSyncedCommit:"a".repeat(40)};
  await saveBook(b);
  return b;
}
beforeEach(async()=>{
  const db=await getDb();
  for(const store of ["books","activities","outbox"] as const)await db.clear(store);
  lookupMock.mockReset();lookupMock.mockResolvedValue([work]);
  vi.stubGlobal("navigator",{locks:{request:async(
    _name:string,_options:unknown,callback:(lock:object)=>Promise<unknown>,
  )=>callback({name:"lock"})}});
});
afterEach(()=>vi.unstubAllGlobals());

describe("Bibliografia DOI con decisione esplicita dell'autore",()=>{
  it("richiede solo DOI al servizio esterno, conserva bibliografia senza alterare la prosa",async()=>{
    const book=await fixture();
    const response=await attachBibliographyToChapter(book.id,"ch1",book.updatedAt,
      ["https://doi.org/10.1000/XYZ123"]);
    expect(response.sourceCount).toBe(1);
    expect(lookupMock.mock.calls[0]?.[0]).toEqual(["10.1000/xyz123"]);
    expect(JSON.stringify(lookupMock.mock.calls)).not.toContain("Il messaggio non deve");
    const saved=await getBook(book.id);
    expect(saved?.chapters[0]?.historicalDossier?.bibliography?.works[0]?.doi)
      .toBe("10.1000/xyz123");
    expect(saved?.chapters[0]?.historicalDossier?.sources).toEqual([]);
    expect(saved?.chapters[0]?.scenes[0]?.text).toBe("Mara sale sul treno.");
    expect(saved?.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect((await listActivities(book.id)).some(x=>x.title.includes("Crossref"))).toBe(true);
  });
  it("dopo update DOI su capitolo congelato riapre la redazione e preserva la sinossi precedente",async()=>{
    const book=await fixture(true);
    const answer=await attachBibliographyToChapter(book.id,"ch2",book.updatedAt,
      ["10.1000/xyz123"]);
    const saved=await getBook(book.id);
    expect(answer.reopened).toBe(true);
    expect(saved?.chapters[0]?.frozenAt).toBeDefined();
    expect(saved?.chapters[1]?.frozenAt).toBeUndefined();
    expect(saved?.bookSummary).toBe("Mara parte sul treno.");
    expect(saved?.editorialCycle?.chapterId).toBe("ch2");
    expect(saved?.phase).toBe("chapterReview");
    expect(saved?.status).toBe("paused");
  });
  it("non salva metadati obsoleti se un'altra scheda modifica il libro durante la ricerca",async()=>{
    const book=await fixture();
    lookupMock.mockImplementationOnce(async()=>{
      const changed=(await getBook(book.id))!;
      changed.authorConstraints.push("Non cambiare la cronologia.");
      await saveBook(changed,false);
      return [work];
    });
    await expect(attachBibliographyToChapter(book.id,"ch1",book.updatedAt,
      ["10.1000/xyz123"])).rejects.toThrow(/modificato durante/);
    const updated=await getBook(book.id);
    expect(updated?.chapters[0]?.historicalDossier).toBeUndefined();
    expect(updated?.authorConstraints).toContain("Non cambiare la cronologia.");
  });
  it("rifiuta ricerche durante la redazione senza mandare DOI a Crossref",async()=>{
    const b=await fixture();
    b.editorialCycle=createEditorialCycle("ch1");
    await saveBook(b,false);
    await expect(attachBibliographyToChapter(b.id,"ch1",b.updatedAt,
      ["10.1000/xyz123"])).rejects.toThrow(/redazione in corso/);
    expect(lookupMock).not.toHaveBeenCalled();
  });
  it("una ricerca senza DOI censiti non equivale a una prova negativa",async()=>{
    const b=await fixture();
    lookupMock.mockResolvedValueOnce([]);
    const answer=await attachBibliographyToChapter(b.id,"ch1",b.updatedAt,
      ["10.1000/xyz123"]);
    expect(answer.missingDois).toEqual(["10.1000/xyz123"]);
    const saved=await getBook(b.id);
    expect(saved?.chapters[0]?.historicalDossier?.bibliography?.works).toEqual([]);
  });
  it("blocca modifica se Web Locks non disponibile, senza cancellare outbox",async()=>{
    const b=await fixture();
    vi.stubGlobal("navigator",{locks:{request:async(
      _name:string,_options:unknown,callback:(lock:null)=>Promise<unknown>,
    )=>callback(null)}});
    await expect(attachBibliographyToChapter(b.id,"ch1",b.updatedAt,
      ["10.1000/xyz123"])).rejects.toThrow(/altra scheda/);
    expect((await getBook(b.id))?.chapters[0]?.historicalDossier).toBeUndefined();
    expect(await getOutbox(b.id)).toBeDefined();
  });
});
