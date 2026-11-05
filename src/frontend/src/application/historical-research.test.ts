import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorialCycle } from "../domain/editorial-board";
import { newBook, type BookProject } from "../domain/types";
import { getBook, getDb, listActivities, saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import type { HistoricalSource } from "../domain/historical-research";
const { searchMock } = vi.hoisted(()=>({searchMock:vi.fn()}));
vi.mock("../infrastructure/historical-sources",()=>({searchHistoricalWikipedia:searchMock}));
import { researchHistoricalChapter } from "./historical-research";

const source:HistoricalSource={
  id:"itwiki:42:300",provider:"it.wikipedia.org",pageId:42,revisionId:300,
  title:"Telegrafo",url:"https://it.wikipedia.org/wiki/Telegrafo",
  excerpt:"Il telegrafo elettrico conobbe una diffusione nel corso dell'Ottocento.",
  query:"Telegrafo elettrico nel 1848",retrievedAt:"2026-11-05T20:00:00.000Z",
};
async function makeBook(frozen=false):Promise<BookProject>{
  const b=newBook("Romanzo riservato","Il castello","Stile personale","Adulti");
  b.status="paused";b.phase="prose";
  b.memory.secrets.chiave="La chiave svela la cospirazione del castello.";
  b.chapters=[
    {id:"c1",number:1,title:"La notte",purpose:"Introduzione",
      scenes:[{id:"s1",number:1,title:"Il telegrafo",objective:"Notizia",
        text:"Mara utilizza un telegrafo per inviare la notizia.",status:"canon"}],
      ...(frozen?{frozenAt:"2026-11-05T15:00:00.000Z",
        summary:"Mara invia una notizia",bookSummaryAtFreeze:"Mara arriva e invia una notizia."}:{}),
    },
    {id:"c2",number:2,title:"Il giorno",purpose:"Sviluppo",
      scenes:[{id:"s2",number:1,title:"La carrozza",objective:"Viaggio",
        text:"Mara parte in carrozza.",status:"canon"}],
      ...(frozen?{frozenAt:"2026-11-05T15:30:00.000Z",
        summary:"Mara viaggia",bookSummaryAtFreeze:"Mara arriva, invia la notizia e viaggia."}:{}),
    },
  ];
  if(frozen){
    b.bookSummary="Mara arriva, invia la notizia e viaggia.";
    b.status="completed";b.phase="completed";
  }
  b.remote={owner:"alice",repository:"romanzo",branch:"main",autoSync:true,
    lastSyncedCommit:"a".repeat(40)};
  await saveBook(b);
  return b;
}
beforeEach(async()=>{
  const db=await getDb();
  for(const store of ["books","activities","outbox"] as const) await db.clear(store);
  searchMock.mockReset();
  searchMock.mockResolvedValue([source]);
  vi.stubGlobal("navigator",{locks:{request:async(
    _name:string,_options:unknown,callback:(lock:object)=>Promise<unknown>,
  )=>callback({name:"lock"})}});
});
afterEach(()=>vi.unstubAllGlobals());
describe("Ricerca storica con consenso esplicito e riapertura del canon",()=>{
  it("ricerca solo il testo pubblico digitato dall'autore e conserva dossier locale",async()=>{
    const book=await makeBook();
    const result=await researchHistoricalChapter(book.id,"c1",book.updatedAt,
      ["Telegrafo elettrico nel 1848"]);
    expect(result.sourceCount).toBe(1);
    expect(result.restartedReview).toBe(false);
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock.mock.calls[0]?.[0]).toEqual(["Telegrafo elettrico nel 1848"]);
    expect(JSON.stringify(searchMock.mock.calls)).not.toContain("cospirazione del castello");
    const updated=await getBook(book.id);
    expect(updated?.chapters[0]?.historicalDossier?.sources[0]?.id).toBe(source.id);
    expect(updated?.chapters[0]?.frozenAt).toBeUndefined();
    expect(updated?.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect((await listActivities(book.id)).some(a=>a.title.includes("Ricerca storica"))).toBe(true);
  });
  it("su un capitolo congelato invalida anche i successivi e riparte dal riassunto precedente",async()=>{
    const book=await makeBook(true);
    const result=await researchHistoricalChapter(book.id,"c2",book.updatedAt,
      ["Telegrafo elettrico nel 1848"]);
    expect(result.restartedReview).toBe(true);
    const updated=await getBook(book.id);
    expect(updated?.chapters[0]?.frozenAt).toBeDefined();
    expect(updated?.chapters[1]?.frozenAt).toBeUndefined();
    expect(updated?.chapters[1]?.bookSummaryAtFreeze).toBeUndefined();
    expect(updated?.bookSummary).toBe("Mara arriva e invia una notizia.");
    expect(updated?.editorialCycle?.chapterId).toBe("c2");
    expect(updated?.phase).toBe("chapterReview");
    expect(updated?.status).toBe("paused");
    expect(updated?.remote?.autoSync).toBe(false);
  });
  it("rifiuta un dossier obsoleto dopo modifiche concorrenti senza cambiare i capitoli",async()=>{
    const book=await makeBook();
    searchMock.mockImplementationOnce(async()=>{
      const newer=(await getBook(book.id))!;
      newer.authorConstraints.push("Istruzione aggiornata in un'altra scheda.");
      await saveBook(newer,false);
      return [source];
    });
    await expect(researchHistoricalChapter(book.id,"c1",book.updatedAt,
      ["Telegrafo elettrico nel 1848"])).rejects.toThrow(/modificato durante/);
    const after=await getBook(book.id);
    expect(after?.chapters[0]?.historicalDossier).toBeUndefined();
    expect(after?.authorConstraints).toContain("Istruzione aggiornata in un'altra scheda.");
  });
  it("non consulta terzi se il libro è già nella redazione attiva",async()=>{
    const book=await makeBook();
    book.editorialCycle=createEditorialCycle("c1");
    await saveBook(book,false);
    await expect(researchHistoricalChapter(book.id,"c1",book.updatedAt,
      ["Telegrafo elettrico nel 1848"])).rejects.toThrow(/editoriale attivo/);
    expect(searchMock).not.toHaveBeenCalled();
  });
  it("nessun risultato non diventa una conferma documentale",async()=>{
    const book=await makeBook();
    searchMock.mockResolvedValueOnce([]);
    const res=await researchHistoricalChapter(book.id,"c1",book.updatedAt,
      ["Telegrafo elettrico nel 1848"]);
    expect(res.missingQueries).toEqual(["Telegrafo elettrico nel 1848"]);
    const after=await getBook(book.id);
    expect(after?.chapters[0]?.historicalDossier?.activeSourceIds).toEqual([]);
  });
});
