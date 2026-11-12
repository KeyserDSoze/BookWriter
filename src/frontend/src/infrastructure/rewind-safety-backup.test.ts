import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { newBook, type Activity, type BookProject } from "../domain/types";
import { getBook, getDb, listBooks, saveActivity, saveBook } from "./db";
import { importBackup, importBackupAsLocalFork, readBackup } from "./backup";
import {
  canonicalJson, createLocalForkFromVerifiedSafetyBackup, prepareBookSafetyBackup,
  sha256OfZip, verifyDownloadedBookSafetyBackup,
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
afterEach(()=>{
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it("fork locale separato dal file verificato: originale immutato, remote e consenso non ereditati",async()=>{
    const {book,task}=await fixture();
    const db=await getDb();
    const original=structuredClone((await getBook(book.id))!);
    original.remote={
      owner:"utente",repository:"romanzo",branch:"main",
      lastSyncedCommit:"a".repeat(40),autoSync:true,
    };
    await saveBook(original,false,book.updatedAt);
    const current=(await getBook(book.id))!;
    await db.put("meta",true,"task-prose-consent:v1:"+book.id);
    await db.put("meta",{private:"DATI_PRIVATI_FORK_META"},"trace:"+book.id);
    const archive=await prepareBookSafetyBackup(book.id,current.updatedAt,task.id);
    const before=new Set((await listBooks()).map(b=>b.id));
    const id=await createLocalForkFromVerifiedSafetyBackup(archive.blob as File,archive);
    expect(id).toBeTruthy();
    expect(id).not.toBe(book.id);
    const fork=(await getBook(id))!;
    expect(fork).toMatchObject({
      id,title:current.title+" (fork locale)",status:"paused",
    });
    expect(fork.previousError).toContain("Fork locale da ZIP verificato");
    expect(fork.remote).toBeUndefined();
    expect(fork.chapters).toEqual(current.chapters);
    expect(fork.memory).toEqual(current.memory);
    expect(fork.phase).toBe(current.phase);
    const copiedActivities=(await db.getAll("activities") as Activity[])
      .filter(a=>a.bookId===id);
    expect(copiedActivities).toHaveLength(1);
    expect(copiedActivities[0]?.id).not.toBe(task.id);
    expect(copiedActivities[0]?.output).toBe(task.output);
    expect(await db.get("meta","task-prose-consent:v1:"+id)).toBeUndefined();
    expect(await db.get("meta","trace:"+id)).toBeUndefined();
    expect(await db.get("meta","task-prose-consent:v1:"+book.id)).toBe(true);
    expect(await getBook(book.id)).toEqual(current);
    expect(await listBooks()).toHaveLength(before.size+1);
  });

  it("fork rifiutato dopo modifica sorgente: CAS nella stessa transazione, nessuna copia",async()=>{
    const {book,task}=await fixture();
    const archive=await prepareBookSafetyBackup(book.id,book.updatedAt,task.id);
    const parsed=await readBackup(archive.blob as File);
    const changed=structuredClone((await getBook(book.id))!);
    changed.brief="Nuovo brief non presente nello ZIP";
    await saveBook(changed,false,book.updatedAt);
    const before=(await listBooks()).length;
    await expect(createLocalForkFromVerifiedSafetyBackup(archive.blob as File,archive))
      .rejects.toThrow(/revisione o writer cambiati/);
    await expect(importBackupAsLocalFork(parsed,{
      bookId:book.id,expectedRevision:book.updatedAt,activityId:task.id,
    })).rejects.toThrow(/revisione o writer cambiati/);
    expect(await listBooks()).toHaveLength(before);
    expect((await getBook(book.id))!.brief).toBe(changed.brief);
  });

  it("fork non procede con file alterato, writer occupato o Web Locks mancanti",async()=>{
    const {book,task}=await fixture();
    const existingCount=(await listBooks()).length;
    const archive=await prepareBookSafetyBackup(book.id,book.updatedAt,task.id);
    const bytes=new Uint8Array(await archive.blob.arrayBuffer());
    const mutated=bytes.slice();
    const i=Math.floor(mutated.length/2);
    mutated[i]=mutated[i]!^1;
    const file=new Blob([mutated],{type:"application/zip"}) as File;
    await expect(createLocalForkFromVerifiedSafetyBackup(file,archive))
      .rejects.toThrow(/SHA-256/);
    vi.stubGlobal("navigator",{});
    await expect(createLocalForkFromVerifiedSafetyBackup(archive.blob as File,archive))
      .rejects.toThrow(/Web Locks non disponibili/);
    vi.stubGlobal("navigator",{locks:{
      request:async(_name:string,_options:unknown,fn:(lock:null)=>Promise<unknown>)=>fn(null),
    }});
    await expect(createLocalForkFromVerifiedSafetyBackup(archive.blob as File,archive))
      .rejects.toThrow(/in uso da un'altra scheda/);
    expect(await listBooks()).toHaveLength(existingCount);
  });

  it("ID nuovo collisionato fa fallire tutta la transazione senza sovrascrivere l'originale",async()=>{
    const {book,task}=await fixture();
    const existingCount=(await listBooks()).length;
    const archive=await prepareBookSafetyBackup(book.id,book.updatedAt,task.id);
    const before=structuredClone((await getBook(book.id))!);
    const log=structuredClone(await (await getDb()).get("activities",task.id));
    vi.spyOn(globalThis.crypto,"randomUUID").mockReturnValue(book.id as `${string}-${string}-${string}-${string}-${string}`);
    await expect(createLocalForkFromVerifiedSafetyBackup(archive.blob as File,archive))
      .rejects.toThrow();
    expect(await getBook(book.id)).toEqual(before);
    expect(await (await getDb()).get("activities",task.id)).toEqual(log);
    expect(await listBooks()).toHaveLength(existingCount);
  });

  it("un task sorgente in esecuzione impedisce ogni fork anche con libro paused",async()=>{
    const {book,task}=await fixture();
    const archive=await prepareBookSafetyBackup(book.id,book.updatedAt,task.id);
    const live:Activity={...task,id:crypto.randomUUID(),status:"running"};
    await saveActivity(live);
    const count=(await listBooks()).length;
    await expect(createLocalForkFromVerifiedSafetyBackup(archive.blob as File,archive))
      .rejects.toThrow(/revisione o writer cambiati/);
    expect(await listBooks()).toHaveLength(count);
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

describe("Confronto del manoscritto indipendente dall'ordine dei campi",()=>{
  it("un libro arricchito durante il lavoro supera la verifica round-trip dello ZIP",async()=>{
    const {book,task}=await fixture();
    // Fields appended after creation keep insertion order in IndexedDB,
    // while the ZIP validator rebuilds objects in schema order.
    book.previousError="Attività interrotta; nessun output canonizzato.";
    book.ideas="Idee LONG MID SHORT";
    book.startMode="synopsis";
    book.authorChapterSynopses=[{synopsis:"Mara arriva al porto."}];
    book.authorInterventions=[{id:"nota",createdAt:"2026-11-12T12:00:00.000Z",
      instruction:"Più ironia.",scope:"next_step",phase:"prose",stepLabel:"Scrittura"}];
    await saveBook(book,false);
    const saved=(await getBook(book.id))!;
    const archive=await prepareBookSafetyBackup(saved.id,saved.updatedAt,task.id);
    expect(archive.bookRevision).toBe(saved.updatedAt);
  });
  it("canonicalJson ignora solo l'ordine delle chiavi, non i valori o l'ordine degli array",()=>{
    expect(canonicalJson({b:1,a:{d:[2,1],c:null}})).toBe(canonicalJson({a:{c:null,d:[2,1]},b:1}));
    expect(canonicalJson({a:[1,2]})).not.toBe(canonicalJson({a:[2,1]}));
    expect(canonicalJson({a:"x"})).not.toBe(canonicalJson({a:"y"}));
  });
});
