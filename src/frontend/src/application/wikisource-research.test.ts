import "fake-indexeddb/auto";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createEditorialCycle } from "../domain/editorial-board";
import { newBook,type BookProject } from "../domain/types";
import { getBook,getDb,listActivities,saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import type { WikisourceExcerpt } from "../domain/wikisource-excerpts";
const {searchMock}=vi.hoisted(()=>({searchMock:vi.fn()}));
vi.mock("../infrastructure/wikisource",()=>({searchWikisource:searchMock}));
import { attachWikisourceResearch } from "./wikisource-research";

const query="Lettere e telegrafo nel 1848";
const at="2026-11-06T02:40:00.000Z";
const source:WikisourceExcerpt={
  id:"itws:42:321",provider:"it.wikisource.org",pageId:42,revisionId:321,
  revisionAt:"2025-01-15T10:00:00Z",title:"Lettere dal 1848",
  url:"https://it.wikisource.org/wiki/Lettere_dal_1848",
  excerpt:"La stazione telegrafica durante l'inverno trasmise numerose lettere urgenti.",
  query,retrievedAt:at,
  evidenceStatus:"community_transcription_unverified",
  rightsStatus:"work_rights_not_verified",
};
async function fixture(frozen=false):Promise<BookProject>{
  const b=newBook("Romanzo storico riservato","Il segreto","Sobrio","Adulti");
  b.status="paused";b.phase="prose";
  b.memory.secrets.chiave="Il segreto riguarda un passaggio privato.";
  b.chapters=[{id:"c1",number:1,title:"La lettera",purpose:"Presentazione",scenes:[
    {id:"s1",number:1,title:"Telegramma",objective:"Comunicare",text:"Mara invia una lettera.",status:"canon"}],
    ...(frozen?{frozenAt:at,summary:"Mara invia una lettera.",
      bookSummaryAtFreeze:"Mara invia una lettera."}:{})},
    {id:"c2",number:2,title:"Il viaggio",purpose:"Continuare",scenes:[
      {id:"s2",number:1,title:"La carrozza",objective:"Partire",
        text:"Mara parte in carrozza.",status:"canon"}],
      ...(frozen?{frozenAt:at,summary:"Mara parte in carrozza.",
        bookSummaryAtFreeze:"Mara viaggia dopo la lettera."}:{})},
  ];
  if(frozen){b.status="completed";b.phase="completed";b.bookSummary="Mara viaggia dopo la lettera.";}
  b.remote={owner:"alice",repository:"book",branch:"main",autoSync:true,
    lastSyncedCommit:"a".repeat(40)};
  await saveBook(b);
  return b;
}
beforeEach(async()=>{
  const db=await getDb();
  for(const store of ["books","activities","outbox"] as const)await db.clear(store);
  searchMock.mockReset();searchMock.mockResolvedValue([source]);
  vi.stubGlobal("navigator",{locks:{request:async(
    _name:string,_opts:unknown,callback:(lock:object)=>Promise<unknown>,
  )=>callback({name:"lock"})}});
});
afterEach(()=>vi.unstubAllGlobals());
describe("Ricerca Wikisource local-first con consenso",()=>{
  it("usa solo le query confermate dall'autore e salva la revisione senza segreti",async()=>{
    const b=await fixture();
    const result=await attachWikisourceResearch(b.id,"c1",b.updatedAt,[query]);
    expect(result.excerptCount).toBe(1);
    expect(result.reopened).toBe(false);
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock.mock.calls[0]![0]).toEqual([query]);
    expect(JSON.stringify(searchMock.mock.calls)).not.toContain("passaggio privato");
    const stored=await getBook(b.id);
    expect(stored?.chapters[0]?.historicalDossier?.wikisource?.excerpts[0]?.revisionId).toBe(321);
    expect(stored?.chapters[0]?.scenes[0]?.text).toBe("Mara invia una lettera.");
    expect(stored?.remote?.autoSync).toBe(false);
    expect(await getOutbox(b.id)).toBeUndefined();
    expect((await listActivities(b.id)).some(a=>a.title.includes("Wikisource"))).toBe(true);
  });
  it("ripristina la sinossi prima di riaprire un capitolo frozen e i dipendenti",async()=>{
    const b=await fixture(true);
    const res=await attachWikisourceResearch(b.id,"c1",b.updatedAt,[query]);
    const after=await getBook(b.id);
    expect(res.reopened).toBe(true);
    expect(after?.chapters[0]?.frozenAt).toBeUndefined();
    expect(after?.chapters[1]?.frozenAt).toBeUndefined();
    expect(after?.bookSummary).toBe("");
    expect(after?.editorialCycle?.chapterId).toBe("c1");
    expect(after?.status).toBe("paused");
    expect(after?.phase).toBe("chapterReview");
  });
  it("rifiuta modifiche concorrenti dopo la rete, senza perdere canon preesistente",async()=>{
    const b=await fixture();
    searchMock.mockImplementationOnce(async()=>{
      const other=(await getBook(b.id))!;
      other.authorConstraints.push("Dettaglio cambiato dopo la ricerca");
      await saveBook(other,false);
      return [source];
    });
    await expect(attachWikisourceResearch(b.id,"c1",b.updatedAt,[query]))
      .rejects.toThrow(/modificato durante/);
    expect((await getBook(b.id))?.chapters[0]?.historicalDossier?.wikisource).toBeUndefined();
    expect((await getBook(b.id))?.authorConstraints).toContain("Dettaglio cambiato dopo la ricerca");
  });
  it("non avvia ricerche per libri in review, senza locks o con quote risposte non valide",async()=>{
    const b=await fixture();
    b.editorialCycle=createEditorialCycle("c1");
    await saveBook(b,false);
    await expect(attachWikisourceResearch(b.id,"c1",b.updatedAt,[query]))
      .rejects.toThrow(/redazione in corso/);
    expect(searchMock).not.toHaveBeenCalled();
  });
  it("un errore di rete non scrive parzialmente il dossier",async()=>{
    const b=await fixture();
    searchMock.mockRejectedValueOnce(new Error("HTTP 503"));
    await expect(attachWikisourceResearch(b.id,"c1",b.updatedAt,[query]))
      .rejects.toThrow(/503/);
    expect((await getBook(b.id))?.chapters[0]?.historicalDossier).toBeUndefined();
  });
  it("senza risultati non si inventano conferme di fatti",async()=>{
    const b=await fixture();
    searchMock.mockResolvedValueOnce([]);
    const res=await attachWikisourceResearch(b.id,"c1",b.updatedAt,[query]);
    expect(res.missingQueries).toEqual([query]);
    expect((await getBook(b.id))?.chapters[0]?.historicalDossier?.wikisource?.activeExcerptIds).toEqual([]);
  });
});
