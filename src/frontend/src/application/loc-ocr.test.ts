import "fake-indexeddb/auto";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { newBook,type BookProject } from "../domain/types";
import { extendArchiveCatalog } from "../domain/archival-catalog";
import { appendInstitutionalInspection } from "../domain/institutional-inspection";
import { activeLocOcrExcerpts,allLocOcrExcerpts,type LocOcrExcerpt } from "../domain/loc-ocr";
import { createEditorialCycle } from "../domain/editorial-board";
import { getBook,getDb,saveBook,listActivities } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
const {readMock}=vi.hoisted(()=>({readMock:vi.fn()}));
vi.mock("../infrastructure/loc-ocr",()=>({fetchLocOcrExcerpt:readMock}));
import { attachLocOcrExcerpt } from "./loc-ocr";

const at="2026-11-06T11:00:00.000Z",query="telegraph correspondence 1848";
const catalog={id:"loc:2020123456:"+Date.parse(at),provider:"loc.gov" as const,
  itemId:"2020123456",title:"Telegraph correspondence",
  url:"https://www.loc.gov/item/2020123456/",query,retrievedAt:at};
const inspectedAt="2026-11-06T11:02:00.000Z";
const inspection={id:"locdetail:2020123456:"+Date.parse(inspectedAt),provider:"loc.gov" as const,
  catalogItemId:catalog.id,itemId:catalog.itemId,url:catalog.url,inspectedAt,
  digitized:true,accessRestricted:false,hasDigitalResources:true,hasTextResourceLink:true,
  rightsAdvisory:[],accessAdvisory:[],evidenceStatus:"catalog_metadata_only" as const,
  rightsStatus:"undetermined" as const};
const acquiredAt="2026-11-06T11:05:00.000Z";
const hash="a".repeat(64);
const source:LocOcrExcerpt={
  id:"lococr:2020123456:"+Date.parse(acquiredAt)+":"+hash.slice(0,16),
  provider:"loc.gov-ocr",catalogItemId:catalog.id,inspectionId:inspection.id,
  itemId:catalog.itemId,title:catalog.title,url:catalog.url,
  textUrl:"https://tile.loc.gov/storage-services/service/a/letter.txt",
  excerpt:"The telegraph apparatus was operated at the station during the winter of 1848.",
  contentSha256:hash,contentLength:400,excerptOffset:10,acquiredAt,
  rightsBasis:"permission",rightsNote:"Permesso ottenuto per breve citazione e trattamento AI.",
  rightsAttested:true,evidenceStatus:"institutional_ocr_unverified",
  rightsStatus:"author_attested_unverified",
};
const rights={rightsBasis:"permission" as const,
  rightsNote:"Permesso ottenuto per breve citazione e trattamento AI.",rightsAttested:true as const};
async function fixture(frozen=false):Promise<BookProject>{
  const book=newBook("Romanzo privato","Il castello","Sobrio","Adulti");
  book.status="paused";book.phase="prose";
  book.memory.secrets.cifrario="Il segreto non deve arrivare a LoC.";
  book.chapters=[{id:"ch1",number:1,title:"Lettere",purpose:"Inizio",
    scenes:[{id:"s1",number:1,title:"Telegramma",objective:"Comunicare",
      text:"Mara invia un telegramma.",status:"canon"}],
    historicalDossier:appendInstitutionalInspection(
      extendArchiveCatalog(undefined,[query],[catalog],at),inspection),
    ...(frozen?{frozenAt:at,summary:"Mara scrive.",bookSummaryAtFreeze:"Mara scrive."}:{})},
    {id:"ch2",number:2,title:"Partenza",purpose:"Viaggio",
      scenes:[{id:"s2",number:1,title:"La carrozza",objective:"Partire",
        text:"Mara parte in carrozza.",status:"canon"}],
      ...(frozen?{frozenAt:at,summary:"Mara parte.",bookSummaryAtFreeze:"Mara scrive e parte."}:{})},
  ];
  if(frozen){book.status="completed";book.phase="completed";
    book.bookSummary="Mara scrive e parte.";}
  book.remote={owner:"alice",repository:"book",branch:"main",
    autoSync:true,lastSyncedCommit:"a".repeat(40)};
  await saveBook(book);return book;
}
beforeEach(async()=>{
  const db=await getDb();
  for(const name of ["books","activities","outbox"] as const)await db.clear(name);
  readMock.mockReset();readMock.mockResolvedValue(source);
  vi.stubGlobal("navigator",{locks:{request:async(
    _name:string,_opts:unknown,callback:(lock:object)=>Promise<unknown>,
  )=>callback({name:"lock"})}});
});
afterEach(()=>vi.unstubAllGlobals());
describe("OCR LoC: author rights approval, local-first immutable write",()=>{
  it("salva solo un estratto breve, non invia segreti né modifica la prosa",async()=>{
    const b=await fixture();
    const res=await attachLocOcrExcerpt(b.id,"ch1",b.updatedAt,catalog.id,inspection.id,rights);
    expect(res.sourceId).toBe(source.id);
    expect(res.reopened).toBe(false);
    expect(readMock.mock.calls[0]).toEqual([catalog.itemId,catalog.id,inspection.id,
      catalog.title,rights,undefined]);
    expect(JSON.stringify(readMock.mock.calls)).not.toContain("Il segreto");
    const saved=await getBook(b.id);
    expect(activeLocOcrExcerpts(saved?.chapters[0]?.historicalDossier)).toEqual([source]);
    expect(saved?.chapters[0]?.scenes[0]?.text).toBe("Mara invia un telegramma.");
    expect(saved?.remote?.autoSync).toBe(false);
    expect(await getOutbox(b.id)).toBeUndefined();
    expect((await listActivities(b.id)).some(a=>a.title.includes("OCR LoC"))).toBe(true);
  });
  it("riapre un frozen e ripristina la sinossi antecedente alla nuova evidenza",async()=>{
    const b=await fixture(true);
    const res=await attachLocOcrExcerpt(b.id,"ch1",b.updatedAt,catalog.id,inspection.id,rights);
    const saved=await getBook(b.id);
    expect(res.reopened).toBe(true);
    expect(saved?.chapters[0]?.frozenAt).toBeUndefined();
    expect(saved?.chapters[1]?.frozenAt).toBeUndefined();
    expect(saved?.bookSummary).toBe("");
    expect(saved?.editorialCycle?.chapterId).toBe("ch1");
    expect(saved?.phase).toBe("chapterReview");
  });
  it("un salvataggio concorrente durante la rete rifiuta l'OCR senza perdere il canon",async()=>{
    const b=await fixture();
    readMock.mockImplementationOnce(async()=>{
      const changed=(await getBook(b.id))!;
      changed.authorConstraints.push("Un nuovo vincolo inserito durante la rete.");
      await saveBook(changed,false);
      return source;
    });
    await expect(attachLocOcrExcerpt(b.id,"ch1",b.updatedAt,catalog.id,inspection.id,rights))
      .rejects.toThrow(/modificato durante/);
    const saved=await getBook(b.id);
    expect(allLocOcrExcerpts(saved?.chapters[0]?.historicalDossier)).toEqual([]);
    expect(saved?.authorConstraints).toContain("Un nuovo vincolo inserito durante la rete.");
  });
  it("non chiama rete con ispezioni assenti/ristrette o redazione già avviata",async()=>{
    const b=await fixture();
    await expect(attachLocOcrExcerpt(b.id,"ch1",b.updatedAt,catalog.id,"locdetail:other:123",rights))
      .rejects.toThrow(/Occorre/);
    expect(readMock).not.toHaveBeenCalled();
    const started=(await getBook(b.id))!;
    started.editorialCycle=createEditorialCycle("ch1");
    await saveBook(started,false);
    await expect(attachLocOcrExcerpt(b.id,"ch1",started.updatedAt,catalog.id,inspection.id,rights))
      .rejects.toThrow(/Concludi/);
    expect(readMock).not.toHaveBeenCalled();
  });
  it("errori del file OCR non salvano dossier parziali",async()=>{
    const b=await fixture();
    readMock.mockRejectedValueOnce(new Error("OCR HTTP 503"));
    await expect(attachLocOcrExcerpt(b.id,"ch1",b.updatedAt,catalog.id,inspection.id,rights))
      .rejects.toThrow(/503/);
    expect(allLocOcrExcerpts((await getBook(b.id))?.chapters[0]?.historicalDossier))
      .toHaveLength(0);
  });
});
