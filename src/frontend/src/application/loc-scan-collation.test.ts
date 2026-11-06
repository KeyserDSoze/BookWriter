import "fake-indexeddb/auto";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { extendArchiveCatalog } from "../domain/archival-catalog";
import { createEditorialCycle } from "../domain/editorial-board";
import { appendInstitutionalInspection } from "../domain/institutional-inspection";
import { appendLocOcrExcerpt,type LocOcrExcerpt } from "../domain/loc-ocr";
import { activeLocScanCollations,allLocScanCollations } from "../domain/loc-scan-collation";
import { newBook,type BookProject } from "../domain/types";
import { getBook,getDb,saveBook,listActivities } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
import { attachLocScanCollation } from "./loc-scan-collation";

const at="2026-11-06T10:00:00.000Z";
const query="telegraph historical correspondence";
const catalog={id:"loc:2020123456:"+Date.parse(at),provider:"loc.gov" as const,
  itemId:"2020123456",title:"Telegraph correspondence",
  url:"https://www.loc.gov/item/2020123456/",query,retrievedAt:at};
const inspectedAt="2026-11-06T10:05:00.000Z";
const inspection={id:"locdetail:2020123456:"+Date.parse(inspectedAt),
  provider:"loc.gov" as const,itemId:catalog.itemId,
  catalogItemId:catalog.id,url:catalog.url,inspectedAt,
  digitized:true,accessRestricted:false,rightsAdvisory:[],accessAdvisory:[],
  hasDigitalResources:true,hasTextResourceLink:true,
  evidenceStatus:"catalog_metadata_only" as const,rightsStatus:"undetermined" as const};
const acquiredAt="2026-11-06T10:07:00.000Z",hash="a".repeat(64);
const source:LocOcrExcerpt={
  id:"lococr:2020123456:"+Date.parse(acquiredAt)+":"+hash.slice(0,16),
  provider:"loc.gov-ocr",catalogItemId:catalog.id,inspectionId:inspection.id,
  itemId:catalog.itemId,title:catalog.title,url:catalog.url,
  textUrl:"https://tile.loc.gov/storage-services/service/gdc/letter.txt",
  excerpt:"The telegraph station received messages in the bitter winter of 1848.",
  contentSha256:hash,contentLength:400,excerptOffset:15,acquiredAt,
  rightsBasis:"permission",rightsNote:"Permesso consultato per questo estratto OCR.",
  rightsAttested:true,evidenceStatus:"institutional_ocr_unverified",
  rightsStatus:"author_attested_unverified",
};
const input={ocrSourceId:source.id,pageLocator:"Pagina 12, colonna 2",
  observedText:"The telegraph station received messages in the bitter winter of 1848.",
  observedOriginalAttested:true as const,excerptRightsAttested:true as const};
async function fixture(frozen=false):Promise<BookProject>{
  const book=newBook("La storia segreta di Mara","Le lettere","Sobrio","Adulti");
  book.status="paused";book.phase="prose";
  book.memory.secrets.chiave="La lettera privata non va inviata a LoC.";
  book.chapters=[{id:"c1",number:1,title:"Lettera",purpose:"Introduzione",
    scenes:[{id:"s1",number:1,title:"Telegramma",objective:"Scrivere",
      status:"canon",text:"Mara usa un telegrafo."}],
    historicalDossier:appendLocOcrExcerpt(appendInstitutionalInspection(
      extendArchiveCatalog(undefined,[query],[catalog],at),inspection),source),
    ...(frozen?{frozenAt:at,summary:"Mara usa un telegrafo.",
      bookSummaryAtFreeze:"Mara usa un telegrafo."}:{})},
    {id:"c2",number:2,title:"Carrozza",purpose:"Partenza",
      scenes:[{id:"s2",number:1,title:"Viaggio",objective:"Partire",
        status:"canon",text:"Mara viaggia in carrozza."}],
      ...(frozen?{frozenAt:at,summary:"Mara parte.",
        bookSummaryAtFreeze:"Mara usa il telegrafo e parte."}:{})},
  ];
  if(frozen){book.status="completed";book.phase="completed";
    book.bookSummary="Mara usa il telegrafo e parte.";}
  book.remote={owner:"alice",repository:"book",branch:"main",autoSync:true,
    lastSyncedCommit:"a".repeat(40)};
  await saveBook(book);return book;
}
beforeEach(async()=>{
  const db=await getDb();
  for(const store of ["books","activities","outbox"] as const)await db.clear(store);
  vi.stubGlobal("navigator",{locks:{request:async(
    _name:string,_options:unknown,cb:(lock:object)=>Promise<unknown>)=>cb({name:"lock"})}});
});
afterEach(()=>vi.unstubAllGlobals());
describe("Collazione visiva LoC: dichiarazione dell'autore e salvataggio locale atomico",()=>{
  it("confronta solo testo senza rete, conserva il brano e lascia intatte le scene",async()=>{
    const b=await fixture();
    const fetchSpy=vi.fn();vi.stubGlobal("fetch",fetchSpy);
    const result=await attachLocScanCollation(b.id,"c1",b.updatedAt,input);
    expect(result).toMatchObject({comparison:"text_overlap",reopened:false});
    const saved=await getBook(b.id);
    const active=activeLocScanCollations(saved?.chapters[0]?.historicalDossier);
    expect(active).toHaveLength(1);
    expect(active[0]?.observedText).toBe(input.observedText);
    expect(active[0]?.scanPageUrl).toBe(catalog.url);
    expect(saved?.chapters[0]?.scenes[0]?.text).toBe("Mara usa un telegrafo.");
    expect(saved?.remote?.autoSync).toBe(false);
    expect(await getOutbox(b.id)).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await listActivities(b.id)).some(x=>x.title.includes("Collazione OCR"))).toBe(true);
  });
  it("registra una discrepanza e riapre tutti i capitoli frozen senza cancellare la prosa",async()=>{
    const b=await fixture(true);
    const other={...input,observedText:
      "The telegraph station was shut down for the entire winter of 1848."};
    const result=await attachLocScanCollation(b.id,"c1",b.updatedAt,other);
    expect(result).toMatchObject({comparison:"text_discrepancy",reopened:true});
    const saved=await getBook(b.id);
    const active=activeLocScanCollations(saved?.chapters[0]?.historicalDossier);
    expect(active[0]?.comparison).toBe("text_discrepancy");
    expect(saved?.chapters[0]?.frozenAt).toBeUndefined();
    expect(saved?.chapters[1]?.frozenAt).toBeUndefined();
    expect(saved?.bookSummary).toBe("");
    expect(saved?.editorialCycle?.chapterId).toBe("c1");
    expect(saved?.phase).toBe("chapterReview");
    expect(saved?.chapters[1]?.scenes[0]?.text).toBe("Mara viaggia in carrozza.");
  });
  it("blocca attestazione assente e salvataggi obsoleti/concurrenti",async()=>{
    const b=await fixture();
    await expect(attachLocScanCollation(b.id,"c1",b.updatedAt,{
      ...input,observedOriginalAttested:false as never})).rejects.toThrow(/confermare/);
    const changed=(await getBook(b.id))!;
    changed.authorConstraints.push("Non cambiare la storia.");
    await saveBook(changed,false);
    await expect(attachLocScanCollation(b.id,"c1",b.updatedAt,input))
      .rejects.toThrow(/modificato/);
    const fresh=(await getBook(b.id))!;
    fresh.editorialCycle=createEditorialCycle("c1");
    await saveBook(fresh,false);
    await expect(attachLocScanCollation(b.id,"c1",fresh.updatedAt,input))
      .rejects.toThrow(/redazione in corso/);
    expect(allLocScanCollations((await getBook(b.id))?.chapters[0]?.historicalDossier))
      .toHaveLength(0);
  });
  it("rifiuta OCR ritirato e lock mancanti senza toccare il dossier",async()=>{
    const b=await fixture();
    await expect(attachLocScanCollation(b.id,"c1",b.updatedAt,{
      ...input,ocrSourceId:"lococr:old:123"})).rejects.toThrow(/non più attivo/);
    vi.stubGlobal("navigator",{});
    await expect(attachLocScanCollation(b.id,"c1",b.updatedAt,input))
      .rejects.toThrow(/Web Locks/);
    vi.stubGlobal("navigator",{locks:{request:async(_name:string,_options:unknown,
      cb:(lock:null)=>Promise<unknown>)=>cb(null)}});
    await expect(attachLocScanCollation(b.id,"c1",b.updatedAt,input))
      .rejects.toThrow(/altra scheda/);
    expect(allLocScanCollations((await getBook(b.id))?.chapters[0]?.historicalDossier))
      .toHaveLength(0);
  });
});
