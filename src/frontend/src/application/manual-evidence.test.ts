import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorialCycle } from "../domain/editorial-board";
import { extendArchiveCatalog } from "../domain/archival-catalog";
import { type ManualExcerptInput } from "../domain/manual-evidence";
import { newBook, type BookProject } from "../domain/types";
import { getBook, getDb, listActivities, saveBook } from "../infrastructure/db";
import { attachManualEvidence } from "./manual-evidence";

const at="2026-11-06T01:35:00.000Z";
const query="telegraph correspondence 1848";
const item={id:"loc:2020123456:"+Date.parse(at),provider:"loc.gov" as const,itemId:"2020123456",
  title:"Telegraph correspondence",url:"https://www.loc.gov/item/2020123456/",query,retrievedAt:at};
const entry:ManualExcerptInput={
  catalogItemId:item.id,locator:"Page 12, column 2",
  text:"Telegraph communication was documented during the winter months of eighteen forty eight.",
  documentDate:"1848 original",rightsBasis:"permission",rightsAttested:true,
  rightsNote:"Permission granted by the rights holder for this short excerpt.",
};
async function fixture(frozen=false):Promise<BookProject>{
  const book=newBook("Segreto di Mara","Castello","Prosa sobria","Adulti");
  book.status="paused";book.phase="prose";
  book.memory.secrets.chiave="La chiave segreta non va condivisa con esterni.";
  book.chapters=[{
    id:"c1",number:1,title:"Partenza",purpose:"Aprire la vicenda",
    scenes:[{id:"s1",number:1,title:"La lettera",objective:"Scrivere",
      text:"Mara scrive una lettera.",status:"canon"}],
    historicalDossier:extendArchiveCatalog(undefined,[query],[item],at),
    ...(frozen?{frozenAt:at,summary:"Mara scrive una lettera.",
      bookSummaryAtFreeze:"Mara scrive una lettera."}:{})},
    {id:"c2",number:2,title:"Arrivo",purpose:"Proseguire",
      scenes:[{id:"s2",number:1,title:"Il viaggio",objective:"Partire",
        text:"Mara sale sul treno.",status:"canon"}],
      ...(frozen?{frozenAt:at,summary:"Mara sale sul treno.",
        bookSummaryAtFreeze:"Mara scrive una lettera e sale sul treno."}:{})},
  ];
  if(frozen){book.status="completed";book.phase="completed";
    book.bookSummary="Mara scrive una lettera e sale sul treno.";}
  book.remote={owner:"owner",repository:"repo",branch:"main",autoSync:true,
    lastSyncedCommit:"a".repeat(40)};
  await saveBook(book);
  return book;
}
beforeEach(async()=>{
  const db=await getDb();
  for(const store of ["books","activities","outbox"] as const)await db.clear(store);
  vi.stubGlobal("navigator",{locks:{request:async (
    _name:string,_options:unknown,fn:(lock:object)=>Promise<unknown>,
  )=>fn({name:"lock"})}});
});
afterEach(()=>vi.unstubAllGlobals());

describe("Salvataggio locale di citazioni da originali consultati dall'autore",()=>{
  it("salva solo il testo confermato, mai scarica documenti o modifica la prosa",async()=>{
    const book=await fixture();
    const fetchSpy=vi.fn();vi.stubGlobal("fetch",fetchSpy);
    const result=await attachManualEvidence(book.id,"c1",book.updatedAt,entry);
    expect(result.reopened).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    const saved=await getBook(book.id);
    expect(saved?.chapters[0]?.historicalDossier?.manualEvidence?.excerpts[0]?.locator)
      .toBe("Page 12, column 2");
    expect(saved?.chapters[0]?.scenes[0]?.text).toBe("Mara scrive una lettera.");
    expect(saved?.remote?.autoSync).toBe(false);
    expect((await listActivities(book.id)).some(a=>a.title.includes("Trascrizione"))).toBe(true);
  });
  it("riapre capitoli congelati, ripristina sinossi e invalida successivi",async()=>{
    const b=await fixture(true);
    const result=await attachManualEvidence(b.id,"c1",b.updatedAt,entry);
    const saved=await getBook(b.id);
    expect(result.reopened).toBe(true);
    expect(saved?.chapters[0]?.frozenAt).toBeUndefined();
    expect(saved?.chapters[1]?.frozenAt).toBeUndefined();
    expect(saved?.bookSummary).toBe("");
    expect(saved?.editorialCycle?.chapterId).toBe("c1");
    expect(saved?.status).toBe("paused");
    expect(saved?.phase).toBe("chapterReview");
    expect(saved?.chapters[1]?.continuityRecheck).toMatchObject({
      originChapterId:"c1",trigger:"historical_evidence",originSceneIds:[],
    });
  });
  it("rifiuta condizioni di diritti non confermate o fonte non più attiva senza corrompere il libro",async()=>{
    const b=await fixture();
    await expect(attachManualEvidence(b.id,"c1",b.updatedAt,
      {...entry,rightsAttested:false} as unknown as ManualExcerptInput)).rejects.toThrow(/consenso/);
    await expect(attachManualEvidence(b.id,"c1",b.updatedAt,
      {...entry,catalogItemId:"loc:fake:42"})).rejects.toThrow(/scheda d'archivio/);
    expect((await getBook(b.id))?.chapters[0]?.historicalDossier?.manualEvidence).toBeUndefined();
  });
  it("rifiuta il salvataggio dopo una modifica concorrente o durante la redazione",async()=>{
    const b=await fixture();
    const changed=(await getBook(b.id))!;
    changed.authorConstraints.push("Non alterare la cronologia.");
    await saveBook(changed,false);
    await expect(attachManualEvidence(b.id,"c1",b.updatedAt,entry))
      .rejects.toThrow(/modificato/);
    const latest=(await getBook(b.id))!;
    latest.editorialCycle=createEditorialCycle("c1");
    await saveBook(latest,false);
    await expect(attachManualEvidence(b.id,"c1",latest.updatedAt,entry))
      .rejects.toThrow(/redazione in corso/);
  });
  it("rifiuta lock mancanti senza salvare",async()=>{
    const b=await fixture();
    vi.stubGlobal("navigator",{locks:{request:async(
      _name:string,_opts:unknown,fn:(lock:null)=>Promise<unknown>,
    )=>fn(null)}});
    await expect(attachManualEvidence(b.id,"c1",b.updatedAt,entry))
      .rejects.toThrow(/altra scheda/);
    expect((await getBook(b.id))?.chapters[0]?.historicalDossier?.manualEvidence).toBeUndefined();
  });
});
