import "fake-indexeddb/auto";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { extendArchiveCatalog } from "../domain/archival-catalog";
import { createEditorialCycle } from "../domain/editorial-board";
import { appendInstitutionalInspection } from "../domain/institutional-inspection";
import { activeLocOcrExcerpts,allLocOcrExcerpts,type LocOcrExcerpt } from "../domain/loc-ocr";
import { newBook,type BookProject } from "../domain/types";
import { getBook,getDb,listActivities,saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import { quarantineLocOcrSource } from "./loc-ocr-audit";

const at="2026-11-06T11:00:00.000Z";
const q="telegraph correspondence 1848";
const catalog={id:"loc:2020123456:"+Date.parse(at),provider:"loc.gov" as const,
  itemId:"2020123456",title:"Telegraph correspondence",
  url:"https://www.loc.gov/item/2020123456/",query:q,retrievedAt:at};
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
  rightsBasis:"permission",rightsNote:"Permesso ottenuto per una breve citazione con AI.",
  rightsAttested:true,evidenceStatus:"institutional_ocr_unverified",
  rightsStatus:"author_attested_unverified",
};
async function fixture(frozen=false):Promise<BookProject>{
  const b=newBook("Il segreto di Mara","Libro","Sobrio","Adulti");
  b.status="paused";b.phase="prose";
  b.memory.secrets.chiave="Questo segreto non va inviato alla LoC.";
  const dossier=appendInstitutionalInspection(
    extendArchiveCatalog(undefined,[q],[catalog],at),inspection);
  dossier.locOcr={excerpts:[source],activeExcerptIds:[source.id],updatedAt:acquiredAt};
  b.chapters=[
    {id:"c1",number:1,title:"Lettera",purpose:"Presentazione",
      scenes:[{id:"s1",number:1,title:"Telegramma",objective:"Scrivere",status:"canon",
        text:"Mara scrive una lettera."}],historicalDossier:dossier,
      ...(frozen?{frozenAt:at,summary:"Mara scrive.",bookSummaryAtFreeze:"Mara scrive."}:{})},
    {id:"c2",number:2,title:"Viaggio",purpose:"Proseguire",
      scenes:[{id:"s2",number:1,title:"Carrozza",objective:"Viaggiare",status:"canon",
        text:"Mara parte in carrozza."}],
      ...(frozen?{frozenAt:at,summary:"Mara parte.",bookSummaryAtFreeze:"Mara scrive e parte."}:{})},
  ];
  if(frozen){b.status="completed";b.phase="completed";b.bookSummary="Mara scrive e parte.";}
  b.remote={owner:"alice",repository:"repo",branch:"main",autoSync:true,
    lastSyncedCommit:"a".repeat(40)};
  await saveBook(b);return b;
}
beforeEach(async()=>{
  const db=await getDb();
  for(const name of ["books","activities","outbox"] as const)await db.clear(name);
  vi.stubGlobal("navigator",{locks:{request:async(_name:string,_opts:unknown,
    fn:(lock:object)=>Promise<unknown>)=>fn({name:"test"})}});
});
afterEach(()=>vi.unstubAllGlobals());

describe("Quarantena OCR LoC consensuale, senza rete e senza perdita dati",()=>{
  it("ritira solo la fonte attiva, conserva gli snapshot e non cancella la prosa",async()=>{
    const b=await fixture();
    const fetchSpy=vi.fn();vi.stubGlobal("fetch",fetchSpy);
    const out=await quarantineLocOcrSource(b.id,"c1",b.updatedAt,source.id);
    expect(out.reopened).toBe(false);
    const saved=await getBook(b.id);
    expect(activeLocOcrExcerpts(saved?.chapters[0]?.historicalDossier)).toEqual([]);
    expect(allLocOcrExcerpts(saved?.chapters[0]?.historicalDossier)).toEqual([source]);
    expect(saved?.chapters[0]?.scenes[0]?.text).toBe("Mara scrive una lettera.");
    expect(saved?.remote?.autoSync).toBe(false);
    expect(await getOutbox(b.id)).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await listActivities(b.id)).some(a=>a.title.includes("OCR Library of Congress"))).toBe(true);
  });
  it("riapre frozen, ripristina sinossi precedente e invalida capitoli successivi",async()=>{
    const b=await fixture(true);
    const out=await quarantineLocOcrSource(b.id,"c1",b.updatedAt,source.id);
    const saved=await getBook(b.id);
    expect(out.reopened).toBe(true);
    expect(saved?.chapters[0]?.frozenAt).toBeUndefined();
    expect(saved?.chapters[1]?.frozenAt).toBeUndefined();
    expect(saved?.bookSummary).toBe("");
    expect(saved?.editorialCycle?.chapterId).toBe("c1");
    expect(saved?.phase).toBe("chapterReview");
    expect(saved?.status).toBe("paused");
    expect(saved?.chapters[1]?.scenes[0]?.text).toBe("Mara parte in carrozza.");
    expect(saved?.chapters[0]?.continuityRecheck).toBeUndefined();
    expect(saved?.chapters[1]?.continuityRecheck).toMatchObject({
      originChapterId:"c1",originChapterNumber:1,
      trigger:"historical_evidence",originSceneIds:[],
    });
  });
  it("stale revision e redazione attiva non possono eliminare la fonte",async()=>{
    const b=await fixture();
    await expect(quarantineLocOcrSource(b.id,"c1",b.updatedAt,"lococr:fake:0"))
      .rejects.toThrow(/non è più attiva/);
    const changed=(await getBook(b.id))!;
    changed.authorConstraints.push("Nuovo vincolo.");
    await saveBook(changed,false);
    await expect(quarantineLocOcrSource(b.id,"c1",b.updatedAt,source.id))
      .rejects.toThrow(/modificato/);
    const fresh=(await getBook(b.id))!;
    fresh.editorialCycle=createEditorialCycle("c1");
    await saveBook(fresh,false);
    await expect(quarantineLocOcrSource(b.id,"c1",fresh.updatedAt,source.id))
      .rejects.toThrow(/redazione in corso/);
    expect(activeLocOcrExcerpts((await getBook(b.id))?.chapters[0]?.historicalDossier))
      .toHaveLength(1);
  });
  it("Web Locks mancanti o non acquisiti bloccano la quarantena",async()=>{
    const b=await fixture();
    vi.stubGlobal("navigator",{});
    await expect(quarantineLocOcrSource(b.id,"c1",b.updatedAt,source.id))
      .rejects.toThrow(/Web Locks/);
    vi.stubGlobal("navigator",{locks:{request:async(_name:string,_opts:unknown,
      fn:(lock:null)=>Promise<unknown>)=>fn(null)}});
    await expect(quarantineLocOcrSource(b.id,"c1",b.updatedAt,source.id))
      .rejects.toThrow(/altra scheda/);
    expect(activeLocOcrExcerpts((await getBook(b.id))?.chapters[0]?.historicalDossier))
      .toHaveLength(1);
  });
});
