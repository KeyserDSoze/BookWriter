import "fake-indexeddb/auto";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createEditorialCycle } from "../domain/editorial-board";
import { extendWikisourceDossier,activeWikisourceExcerpts,type WikisourceExcerpt } from "../domain/wikisource-excerpts";
import { newBook,type BookProject } from "../domain/types";
import { getBook,getDb,listActivities,saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import { quarantineWikisourceSource } from "./wikisource-audit";
const at="2026-11-06T07:30:00.000Z";
const query="Lettere e telegrafo nel 1848";
const source:WikisourceExcerpt={
  id:"itwsr:42:321:aaaaaaaaaaaaaaaa",provider:"it.wikisource.org",
  pageId:42,revisionId:321,revisionAt:"2025-01-15T10:00:00Z",
  title:"Lettere dal 1848",url:"https://it.wikisource.org/wiki/Lettere_dal_1848",
  excerpt:"La stazione telegrafica durante l'inverno trasmise numerose lettere urgenti.",
  query,retrievedAt:at,evidenceStatus:"community_transcription_unverified",
  rightsStatus:"work_rights_not_verified",
  revisionProof:{method:"exact_revid_wikitext",contentSha256:"a".repeat(64),contentLength:1500,excerptOffset:10},
};
async function fixture(frozen=false):Promise<BookProject>{
  const b=newBook("Il segreto di Mara","Libro storico","Sobrio","Adulti");
  b.status="paused";b.phase="prose";
  b.memory.secrets.chiave="Mai inviare il segreto privato.";
  b.chapters=[{id:"c1",number:1,title:"La lettera",purpose:"Presentazione",
    scenes:[{id:"s1",number:1,title:"La missiva",objective:"Scrivere",text:"Mara scrive la lettera.",status:"canon"}],
    historicalDossier:extendWikisourceDossier(undefined,[query],[source],at),
    ...(frozen?{frozenAt:at,summary:"Mara scrive la lettera.",
      bookSummaryAtFreeze:"Mara scrive la lettera."}:{})},
    {id:"c2",number:2,title:"Il viaggio",purpose:"Proseguire",scenes:[
      {id:"s2",number:1,title:"La carrozza",objective:"Viaggiare",status:"canon",text:"Mara parte in carrozza."}],
      ...(frozen?{frozenAt:at,summary:"Mara viaggia.",bookSummaryAtFreeze:"Mara scrive e viaggia."}:{})},
  ];
  if(frozen){b.status="completed";b.phase="completed";b.bookSummary="Mara scrive e viaggia.";}
  b.remote={owner:"alice",repository:"repo",branch:"main",autoSync:true,lastSyncedCommit:"a".repeat(40)};
  await saveBook(b);
  return b;
}
beforeEach(async()=>{
  const db=await getDb();
  for(const name of ["books","activities","outbox"] as const)await db.clear(name);
  vi.stubGlobal("navigator",{locks:{request:async(
    _name:string,_options:unknown,fn:(lock:object)=>Promise<unknown>,
  )=>fn({name:"lock"})}});
});
afterEach(()=>vi.unstubAllGlobals());

describe("Esclusione consensuale di una fonte Wikisource non coerente",()=>{
  it("esclude solo l'ID attivo e non elimina snapshot, quote o prosa",async()=>{
    const book=await fixture();
    const fetchSpy=vi.fn();vi.stubGlobal("fetch",fetchSpy);
    const result=await quarantineWikisourceSource(book.id,"c1",book.updatedAt,source.id);
    expect(result.reopened).toBe(false);
    const saved=await getBook(book.id);
    expect(activeWikisourceExcerpts(saved?.chapters[0]?.historicalDossier)).toEqual([]);
    expect(saved?.chapters[0]?.historicalDossier?.wikisource?.excerpts).toHaveLength(1);
    expect(saved?.chapters[0]?.scenes[0]?.text).toBe("Mara scrive la lettera.");
    expect(saved?.remote?.autoSync).toBe(false);
    expect(await getOutbox(book.id)).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await listActivities(book.id)).some(a=>a.title.includes("esclusa"))).toBe(true);
  });
  it("se capitolo frozen, ripristina sinossi e invalida downstream",async()=>{
    const book=await fixture(true);
    const result=await quarantineWikisourceSource(book.id,"c1",book.updatedAt,source.id);
    const saved=await getBook(book.id);
    expect(result.reopened).toBe(true);
    expect(saved?.chapters[0]?.frozenAt).toBeUndefined();
    expect(saved?.chapters[1]?.frozenAt).toBeUndefined();
    expect(saved?.bookSummary).toBe("");
    expect(saved?.editorialCycle?.chapterId).toBe("c1");
    expect(saved?.status).toBe("paused");
    expect(saved?.phase).toBe("chapterReview");
  });
  it("rifiuta stale version, ID non attivo e redazione in corso senza perdite",async()=>{
    const b=await fixture();
    await expect(quarantineWikisourceSource(b.id,"c1",b.updatedAt,"itwsr:fake:1:x"))
      .rejects.toThrow(/non è più attiva/);
    const changed=(await getBook(b.id))!;
    changed.authorConstraints.push("Non modificare il canone.");
    await saveBook(changed,false);
    await expect(quarantineWikisourceSource(b.id,"c1",b.updatedAt,source.id))
      .rejects.toThrow(/modificato/);
    const fresh=(await getBook(b.id))!;
    fresh.editorialCycle=createEditorialCycle("c1");
    await saveBook(fresh,false);
    await expect(quarantineWikisourceSource(b.id,"c1",fresh.updatedAt,source.id))
      .rejects.toThrow(/redazione in corso/);
    expect(activeWikisourceExcerpts((await getBook(b.id))?.chapters[0]?.historicalDossier)).toHaveLength(1);
  });
  it("senza locks o con lock non acquisito non cambia il libro",async()=>{
    const b=await fixture();
    vi.stubGlobal("navigator",{locks:{request:async(
      _name:string,_options:unknown,fn:(lock:null)=>Promise<unknown>,
    )=>fn(null)}});
    await expect(quarantineWikisourceSource(b.id,"c1",b.updatedAt,source.id))
      .rejects.toThrow(/altra scheda/);
    expect(activeWikisourceExcerpts((await getBook(b.id))?.chapters[0]?.historicalDossier)).toHaveLength(1);
  });
});
