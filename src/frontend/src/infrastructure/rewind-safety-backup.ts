import { strToU8, zipSync } from "fflate";
import type { Activity, BookProject } from "../domain/types";
import type { SceneMergeDraft } from "../domain/scene-merge";
import { getBook, getDb } from "./db";
import { importBackupAsLocalFork, readBackup } from "./backup";

const MAX_ZIP_BYTES = 40 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 80 * 1024 * 1024;

export interface BookSafetyEvidence {
  bookId: string;
  bookRevision: string;
  activityId: string;
  activityCount: number;
  mergeDraftCount: number;
  sha256: string;
  zipBytes: number;
}
export interface PreparedBookSafetyBackup extends BookSafetyEvidence {
  blob: Blob;
}

export async function sha256OfZip(file: Blob): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  return Array.from(hash, b => b.toString(16).padStart(2,"0")).join("");
}

function requireMetadata(bookId:string, revision:string, activityId:string): void {
  if(!bookId || !revision || !activityId)
    throw new Error("Seleziona un libro, una revisione e un task validi.");
}

/**
 * Snapshot of ONE current book. The read-only transaction is coherent across
 * book, activities and merge drafts; no settings or IndexedDB meta are read.
 * The Web Lock and two revision checks block active cooperating writers.
 */
export async function prepareBookSafetyBackup(
  bookId: string, expectedRevision: string, activityId: string,
): Promise<PreparedBookSafetyBackup> {
  requireMetadata(bookId,expectedRevision,activityId);
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if(!locks?.request)throw new Error(
    "Web Locks non disponibili: impossibile attestare la copia di sicurezza.",
  );
  return locks.request("bookwriter:writer:" + bookId,{ifAvailable:true},async lock=>{
    if(!lock)throw new Error(
      "Il libro è in uso da un'altra scheda: ferma l'autopilot prima del backup.",
    );
    const db=await getDb();
    const tx=db.transaction(["books","activities","mergeDrafts"],"readonly");
    const book=await tx.objectStore("books").get(bookId) as BookProject|undefined;
    const activities=(await tx.objectStore("activities").getAll() as Activity[])
      .filter(a=>a.bookId===bookId);
    const mergeDrafts=(await tx.objectStore("mergeDrafts").getAll() as SceneMergeDraft[])
      .filter(d=>d.bookId===bookId);
    await tx.done;
    if(!book)throw new Error("Libro non trovato: nessun ZIP creato.");
    if(book.status==="running")throw new Error(
      "Il libro è in esecuzione: metti in pausa l'autopilot.",
    );
    if(book.updatedAt!==expectedRevision)throw new Error(
      "La revisione del libro è cambiata: aggiorna la pagina prima di esportare.",
    );
    if(!activities.some(a=>a.id===activityId))
      throw new Error("Il task selezionato non appartiene al libro corrente.");

    const data={
      version:1 as const,kind:"content" as const,createdAt:new Date().toISOString(),
      books:[book],activities,mergeDrafts,
    };
    const payload=strToU8(JSON.stringify(data));
    if(payload.length>MAX_UNPACKED_BYTES)throw new Error(
      "Il libro supera il limite di 80 MiB del backup compatibile.",
    );
    const manifest={
      format:"bookwriter-backup",version:1,mode:"content",encrypted:false,
      createdAt:data.createdAt,
      notice:"ZIP del solo libro corrente; contiene prosa, memoria privata e audit. Non include credenziali o copie meta.",
    };
    const zip=zipSync({
      "manifest.json":strToU8(JSON.stringify(manifest)),
      "content.json":payload,
    },{level:6});
    if(zip.byteLength>MAX_ZIP_BYTES)throw new Error(
      "Lo ZIP supera il limite di 40 MiB del backup compatibile.",
    );
    const blob=new Blob([new Uint8Array(zip)],{type:"application/zip"});
    // Round-trip with the real strict ZIP validator before allowing download.
    const parsed=await readBackup(blob as File);
    if(parsed.kind!=="content" || parsed.settings!==undefined ||
       parsed.books.length!==1 || parsed.books[0]!.id!==bookId ||
       parsed.books[0]!.updatedAt!==expectedRevision ||
       parsed.activities.length!==activities.length ||
       (parsed.mergeDrafts??[]).length!==mergeDrafts.length ||
       !parsed.activities.some(a=>a.id===activityId) ||
       parsed.activities.some(a=>a.bookId!==bookId) ||
       (parsed.mergeDrafts??[]).some(d=>d.bookId!==bookId))
      throw new Error("Verifica interna ZIP non riuscita: archivio non esportato.");
    // Check data against what we captured, including the complete manuscript.
    if(JSON.stringify(parsed.books[0])!==JSON.stringify(book))
      throw new Error("Il manoscritto nello ZIP differisce dalla revisione acquisita.");
    const current=await getBook(bookId);
    if(!current || current.updatedAt!==expectedRevision ||
       current.status==="running")throw new Error(
      "La revisione è cambiata durante la preparazione: ZIP non esportato.",
    );
    const sha256=await sha256OfZip(blob);
    return {
      blob,sha256,bookId,bookRevision:expectedRevision,activityId,
      activityCount:activities.length,mergeDraftCount:mergeDrafts.length,
      zipBytes:blob.size,
    };
  });
}

/** Re-read the actual saved file: hashes + book ID + revision + schema. */
export async function verifyDownloadedBookSafetyBackup(
  file: File, evidence: BookSafetyEvidence,
): Promise<BookSafetyEvidence> {
  if(file.size!==evidence.zipBytes)
    throw new Error("File diverso per dimensione: seleziona lo ZIP scaricato corretto.");
  const digest=await sha256OfZip(file);
  if(digest!==evidence.sha256)throw new Error(
    "SHA-256 non corrispondente: lo ZIP è diverso oppure è stato modificato.",
  );
  const parsed=await readBackup(file);
  if(parsed.kind!=="content" || parsed.settings!==undefined ||
     parsed.books.length!==1 || parsed.books[0]!.id!==evidence.bookId ||
     parsed.books[0]!.updatedAt!==evidence.bookRevision ||
     parsed.activities.length!==evidence.activityCount ||
     (parsed.mergeDrafts??[]).length!==evidence.mergeDraftCount ||
     !parsed.activities.some(a=>a.id===evidence.activityId) ||
     parsed.activities.some(a=>a.bookId!==evidence.bookId) ||
     (parsed.mergeDrafts??[]).some(d=>d.bookId!==evidence.bookId))
    throw new Error("Il contenuto non corrisponde al libro e al task attesi.");
  return evidence;
}

/** Download only from an explicit button, never automatically on mount. */
export function downloadBookSafetyBackup(blob:Blob,bookId:string):void {
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement("a");
  anchor.href=url;
  anchor.download="bookwriter-sicurezza-"+bookId.slice(0,8)+"-"+
    new Date().toISOString().slice(0,10)+".zip";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60_000);
}

/** The author explicitly confirmed a SECOND action after verifying the file.
 * Re-validate the exact downloaded bytes while holding the original writer's
 * Web Lock. importBackupAsLocalFork performs another CAS in its write tx.
 * Never restores a task's historical BookProject or overwrites the original. */
export async function createLocalForkFromVerifiedSafetyBackup(
  file: File, evidence: BookSafetyEvidence,
): Promise<string> {
  if(!evidence.bookId || !evidence.activityId || !evidence.bookRevision)
    throw new Error("Origine del fork non valida.");
  const locks=typeof navigator==="undefined"?undefined:navigator.locks;
  if(!locks?.request)throw new Error(
    "Web Locks non disponibili: impossibile creare un fork sicuro.",
  );
  return locks.request("bookwriter:writer:"+evidence.bookId,
    {ifAvailable:true},async lock=>{
      if(!lock)throw new Error(
        "Il libro è in uso da un'altra scheda: fork non creato.",
      );
      await verifyDownloadedBookSafetyBackup(file,evidence);
      const data=await readBackup(file);
      const id=await importBackupAsLocalFork(data,{
        bookId:evidence.bookId,
        expectedRevision:evidence.bookRevision,
        activityId:evidence.activityId,
      });
      return id;
    });
}
