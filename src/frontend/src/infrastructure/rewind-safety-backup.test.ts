import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { newBook, type Activity, type BookProject } from "../domain/types";
import { getBook, getDb, listBooks, saveActivity, saveBook } from "./db";
import { importBackup, readBackup } from "./backup";
import {
  prepareBookSafetyBackup, sha256OfZip, verifyDownloadedBookSafetyBackup,
} from "./rewind-safety-backup";

beforeEach(()=>{
  vi.stubGlobal("navigator",{locks:{
    request:async (_name:string, options:{ifAvailable:boolean},
      fn:(lock:{name:string}|null)=>Promise<unknown>)=>{
      expect(options.ifAvailable).toBe(true);
      return fn({name:"bookwriter:writer:test"});
    },
  }});
});
afterEach(()=>vi.unstubAllGlobals());

async function fixture(){
  const book=newBook("STORIA_PRIVATA","Libro di test","Narrativo","Adulti");
  book.chapters=[{id:"c",number:1,title:"Titolo",
    purpose:"Svolgimento",scenes:[{id:"s",number:1,title:"Scena",
      objective:"Progresso",text:"TESTO_CANONICO_INTEGRALE",status:"canon"}]}];
  book.memory.secrets["sorpresa"]="SEGRETO_NARRATIVO";
  await saveBook(book,false);
  const current=(await getBook(book.id))!;
  const task:Activity={
    id:crypto.randomUUID(),bookId:book.id,runId:"run",
    phase:"prose",title:"Genera",reason:"Scrittura",nextStep:"Rivedi",
    status:"succeeded",createdAt:"2026-11-12T12:00:00Z",
    output:"OUTPUT_AI_CONFIDENZIALE",
  };
  await saveActivity(task);
  return {book:current,task};
}
describe("Copia di sicurezza del solo libro per rewind futuro (#170)",()=>{
  it("ZIP consistente contiene un solo libro e audit relativo, senza settings/meta/altri libri",async()=>{
    const a=await fixture();
    const b=await fixture();
    const db=await getDb();
    await db.put("meta",{trace:"TRACCIA_PRIVATA_MAI_IN_ZIP"},"secret:v1");
    const other:Activity={
      ...a.task,id:crypto.randomUUID(),bookId:b.book.id,title:"Altro libro",
    };
    await saveActivity(other);
    const archive=await prepareBookSafetyBackup(
      a.book.id,a.book.updatedAt,a.task.id,
    );
    expect(archive).toMatchObject({
      bookId:a.book.id,bookRevision:a.book.updatedAt,activityId:a.task.id,
      activityCount:1,mergeDraftCount:0,
    });
    expect(archive.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(archive.sha256).toBe(await sha256OfZip(archive.blob));
    const parsed=await readBackup(archive.blob as File);
    expect(parsed.kind).toBe("content");
    expect(parsed.settings).toBeUndefined();
    expect(parsed.books.map(x=>x.id)).toEqual([a.book.id]);
    expect(parsed.activities.map(x=>x.id)).toEqual([a.task.id]);
    expect(parsed.books[0]?.chapters[0]?.scenes[0]?.text)
      .toBe("TESTO_CANONICO_INTEGRALE");
    expect(parsed.books[0]?.memory.secrets.sorpresa).toBe("SEGRETO_NARRATIVO");
    const zip=unzipSync(new Uint8Array(await archive.blob.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(["content.json","manifest.json"]);
    const content=strFromU8(zip["content.json"]!);
    expect(content).not.toContain(b.book.id);
    expect(content).not.toContain(other.id);
    expect(content).not.toContain("TRACCIA_PRIVATA_MAI_IN_ZIP");
    const verified=await verifyDownloadedBookSafetyBackup(archive.blob as File,archive);
    expect(verified.sha256).toBe(archive.sha256);
    // Ordinary import is a separate, explicit action; it must create a copy.
    const before=await listBooks();
    const imported=await importBackup(parsed,false);
    expect(imported).toBe(1);
    expect(await listBooks()).toHaveLength(before.length+1);
    expect((await getBook(a.book.id))?.updatedAt).toBe(a.book.updatedAt);
  });

  it("non mostra verde dopo un file diverso, modificato o corrotto",async()=>{
    const {book,task}=await fixture();
    const archive=await prepareBookSafetyBackup(book.id,book.updatedAt,task.id);
    const bytes=new Uint8Array(await archive.blob.arrayBuffer());
    const changed=bytes.slice();
    const midpoint=Math.floor(changed.length/2);
    changed[midpoint]=changed[midpoint]!^1;
    const fake=new Blob([changed],{type:"application/zip"}) as File;
    await expect(verifyDownloadedBookSafetyBackup(fake,archive))
      .rejects.toThrow(/SHA-256 non corrispondente/);
    const truncated=new Blob([changed.subarray(0,changed.length-4)]) as File;
    await expect(verifyDownloadedBookSafetyBackup(truncated,archive))
      .rejects.toThrow(/File diverso per dimensione/);
    await expect(verifyDownloadedBookSafetyBackup(archive.blob as File,{
      ...archive,bookRevision:"revision-mismatched",
    })).rejects.toThrow(/contenuto non corrisponde/);
    await expect(verifyDownloadedBookSafetyBackup(archive.blob as File,{
      ...archive,activityCount:2,
    })).rejects.toThrow(/contenuto non corrisponde/);
  });

  it("fallisce senza Web Locks o se il writer è occupato",async()=>{
    const {book,task}=await fixture();
    vi.stubGlobal("navigator",{});
    await expect(prepareBookSafetyBackup(book.id,book.updatedAt,task.id))
      .rejects.toThrow(/Web Locks non disponibili/);
    vi.stubGlobal("navigator",{locks:{
      request:async (_name:string,_options:unknown,fn:(lock:null)=>Promise<unknown>)=>fn(null),
    }});
    await expect(prepareBookSafetyBackup(book.id,book.updatedAt,task.id))
      .rejects.toThrow(/in uso da un'altra scheda/);
  });

  it("non esporta running, revisione CAS obsoleta, task altro libro o task inesistente",async()=>{
    const {book,task}=await fixture();
    const other=await fixture();
    await expect(prepareBookSafetyBackup(book.id,"obsolete",task.id))
      .rejects.toThrow(/revisione del libro è cambiata/);
    await expect(prepareBookSafetyBackup(book.id,book.updatedAt,other.task.id))
      .rejects.toThrow(/non appartiene/);
    await expect(prepareBookSafetyBackup(book.id,book.updatedAt,"missing"))
      .rejects.toThrow(/non appartiene/);
    const running=structuredClone(book) as BookProject;
    running.status="running";
    await saveBook(running,false,book.updatedAt);
    await expect(prepareBookSafetyBackup(running.id,running.updatedAt,task.id))
      .rejects.toThrow(/in esecuzione/);
    expect((await getBook(book.id))?.status).toBe("running");
  });
});
