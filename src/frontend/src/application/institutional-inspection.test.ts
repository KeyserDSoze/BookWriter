import "fake-indexeddb/auto";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createEditorialCycle } from "../domain/editorial-board";
import { extendArchiveCatalog } from "../domain/archival-catalog";
import { activeInstitutionalInspections,allInstitutionalInspections,
  type InstitutionalInspection } from "../domain/institutional-inspection";
import { newBook,type BookProject } from "../domain/types";
import { getBook,getDb,listActivities,saveBook } from "../infrastructure/db";
import { getOutbox } from "../infrastructure/outbox";
const {inspectMock}=vi.hoisted(()=>({inspectMock:vi.fn()}));
vi.mock("../infrastructure/loc-item-inspection",()=>({inspectLocItem:inspectMock}));
import { attachInstitutionalInspection } from "./institutional-inspection";

const at="2026-11-06T10:00:00.000Z";
const query="telegraph correspondence 1848";
const item={id:"loc:2020123456:"+Date.parse(at),provider:"loc.gov" as const,
  itemId:"2020123456",url:"https://www.loc.gov/item/2020123456/",
  title:"Letters about the telegraph",query,retrievedAt:at};
const stamp="2026-11-06T10:05:00.000Z";
const inspection:InstitutionalInspection={
  id:"locdetail:2020123456:"+Date.parse(stamp),provider:"loc.gov",
  catalogItemId:item.id,itemId:item.itemId,url:item.url,inspectedAt:stamp,
  digitized:true,accessRestricted:false,rightsAdvisory:["No known restrictions is not a license."],
  accessAdvisory:[],hasDigitalResources:true,hasTextResourceLink:true,
  evidenceStatus:"catalog_metadata_only",rightsStatus:"undetermined",
};
async function fixture(frozen=false):Promise<BookProject>{
  const b=newBook("Un romanzo riservato","Titolo","Sobrio","Adulti");
  b.status="paused";b.phase="prose";
  b.memory.secrets.mara="Mai inviare questa frase segreta all'archivio.";
  b.chapters=[{id:"c1",number:1,title:"Lettere",purpose:"Introduzione",
    scenes:[{id:"s1",number:1,title:"Telegramma",objective:"Comunicare",
      status:"canon",text:"Mara scrive un telegramma."}],
    historicalDossier:extendArchiveCatalog(undefined,[query],[item],at),
    ...(frozen?{frozenAt:at,summary:"Mara scrive.",bookSummaryAtFreeze:"Mara scrive."}:{})},
    {id:"c2",number:2,title:"Viaggio",purpose:"Sviluppo",scenes:[
      {id:"s2",number:1,title:"Partenza",objective:"Viaggiare",
        status:"canon",text:"Mara parte per il viaggio."}],
      ...(frozen?{frozenAt:at,summary:"Mara viaggia.",bookSummaryAtFreeze:"Mara scrive e parte."}:{})},
  ];
  if(frozen){b.status="completed";b.phase="completed";b.bookSummary="Mara scrive e parte.";}
  b.remote={owner:"a",repository:"b",branch:"main",autoSync:true,
    lastSyncedCommit:"a".repeat(40)};
  await saveBook(b);return b;
}
beforeEach(async()=>{
  const db=await getDb();
  for(const store of ["books","activities","outbox"] as const)await db.clear(store);
  inspectMock.mockReset();inspectMock.mockResolvedValue(inspection);
  vi.stubGlobal("navigator",{locks:{request:async(_name:string,_opts:unknown,
    f:(lock:object)=>Promise<unknown>)=>f({name:"test"})}});
});
afterEach(()=>vi.unstubAllGlobals());
describe("Ispezione dei metadati istituzionali consentita",()=>{
  it("richiede solo l'ID di una scheda attiva e salva il dettaglio senza segreti",async()=>{
    const b=await fixture();
    const result=await attachInstitutionalInspection(b.id,"c1",b.updatedAt,item.id);
    expect(result.reopened).toBe(false);
    expect(inspectMock.mock.calls).toEqual([[item.itemId,item.id,undefined]]);
    expect(JSON.stringify(inspectMock.mock.calls)).not.toContain("frase segreta");
    const saved=await getBook(b.id);
    expect(activeInstitutionalInspections(saved?.chapters[0]?.historicalDossier))
      .toEqual([inspection]);
    expect(saved?.chapters[0]?.scenes[0]?.text).toBe("Mara scrive un telegramma.");
    expect(saved?.remote?.autoSync).toBe(false);
    expect(await getOutbox(b.id)).toBeUndefined();
    expect((await listActivities(b.id)).some(x=>x.title.includes("Library of Congress"))).toBe(true);
  });
  it("riapre un frozen conservando sinossi pregressa e invalidando i successivi",async()=>{
    const b=await fixture(true);
    const r=await attachInstitutionalInspection(b.id,"c1",b.updatedAt,item.id);
    const saved=await getBook(b.id);
    expect(r.reopened).toBe(true);
    expect(saved?.chapters[0]?.frozenAt).toBeUndefined();
    expect(saved?.chapters[1]?.frozenAt).toBeUndefined();
    expect(saved?.bookSummary).toBe("");
    expect(saved?.editorialCycle?.chapterId).toBe("c1");
    expect(saved?.phase).toBe("chapterReview");
  });
  it("rifiuta concorrenza dopo il fetch e conserva il canon",async()=>{
    const b=await fixture();
    inspectMock.mockImplementationOnce(async()=>{
      const changed=(await getBook(b.id))!;
      changed.authorConstraints.push("Aggiornamento durante la rete.");
      await saveBook(changed,false);
      return inspection;
    });
    await expect(attachInstitutionalInspection(b.id,"c1",b.updatedAt,item.id))
      .rejects.toThrow(/modificato durante/);
    expect(allInstitutionalInspections((await getBook(b.id))?.chapters[0]?.historicalDossier))
      .toHaveLength(0);
  });
  it("una scheda non attiva, un ciclo editoriale e la rete fallita non salvano nulla",async()=>{
    const b=await fixture();
    await expect(attachInstitutionalInspection(b.id,"c1",b.updatedAt,
      "loc:another:123")).rejects.toThrow(/non è più attiva/);
    expect(inspectMock).not.toHaveBeenCalled();
    inspectMock.mockRejectedValueOnce(new Error("HTTP 503"));
    await expect(attachInstitutionalInspection(b.id,"c1",b.updatedAt,item.id))
      .rejects.toThrow(/503/);
    const changed=(await getBook(b.id))!;
    changed.editorialCycle=createEditorialCycle("c1");
    await saveBook(changed,false);
    await expect(attachInstitutionalInspection(b.id,"c1",changed.updatedAt,item.id))
      .rejects.toThrow(/Concludi/);
    expect(activeInstitutionalInspections((await getBook(b.id))?.chapters[0]?.historicalDossier))
      .toEqual([]);
  });
});
