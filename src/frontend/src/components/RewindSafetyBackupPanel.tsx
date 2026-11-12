import { useEffect, useRef, useState } from "react";
import { AiTraceReadFence } from "../domain/ai-trace-read-fence";
import {
  downloadBookSafetyBackup, prepareBookSafetyBackup,
  verifyDownloadedBookSafetyBackup, type BookSafetyEvidence,
} from "../infrastructure/rewind-safety-backup";

interface Props {
  bookId: string;
  activityId: string;
  bookRevision: string;
  bookStatus: string;
}

/** Local manual safeguard, deliberately not a rewind or a restore control. */
export function RewindSafetyBackupPanel({
  bookId, activityId, bookRevision, bookStatus,
}: Props) {
  const [evidence,setEvidence]=useState<BookSafetyEvidence|null>(null);
  const [verified,setVerified]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const fence=useRef(new AiTraceReadFence());
  useEffect(()=>()=>{fence.current.invalidate();},[]);

  const generate=async()=>{
    const ticket=fence.current.begin();
    setBusy(true);setMessage("");setEvidence(null);setVerified(false);
    try {
      const prepared=await prepareBookSafetyBackup(bookId,bookRevision,activityId);
      if(!fence.current.isCurrent(ticket))return;
      // Only an explicit author click ever triggers the file download.
      downloadBookSafetyBackup(prepared.blob,bookId);
      const {blob: _blob,...metadata}=prepared;
      setEvidence(metadata);
      setMessage("Archivio verificato in memoria e download richiesto. " +
        "Per verificare i byte realmente salvati seleziona qui lo ZIP scaricato.");
    } catch(error) {
      if(fence.current.isCurrent(ticket))
        setMessage(error instanceof Error?error.message:"Impossibile preparare lo ZIP di sicurezza.");
    } finally {
      if(fence.current.isCurrent(ticket))setBusy(false);
    }
  };
  const verify=async(file:File|null)=>{
    const ticket=fence.current.begin();
    setBusy(true);setVerified(false);setMessage("");
    if(!file||!evidence) {
      setBusy(false);setMessage("Genera prima un archivio e seleziona il file scaricato.");
      return;
    }
    try {
      await verifyDownloadedBookSafetyBackup(file,evidence);
      if(fence.current.isCurrent(ticket)) {
        setVerified(true);
        setMessage("ZIP scaricato verificato: SHA-256, formato, libro, " +
          "revisione, task e conteggi corrispondono. Conserva il file in un luogo sicuro.");
      }
    } catch(error) {
      if(fence.current.isCurrent(ticket))
        setMessage(error instanceof Error?error.message:"Verifica del file fallita.");
    } finally {
      if(fence.current.isCurrent(ticket))setBusy(false);
    }
  };
  return <section aria-label="Copia di sicurezza prima del rewind"
    className="space-y-2 rounded-lg border border-amber-500/50 p-3 text-sm">
    <h4 className="font-semibold">Copia di sicurezza del libro corrente (non un rewind)</h4>
    <p className="muted text-xs">Prima di un futuro ripristino puoi scaricare lo ZIP
      portabile del <b>solo libro selezionato nello stato attuale</b>, con
      attività e bozze di fusione relative. È un archivio content-only:
      contiene manoscritto, memoria narrativa privata, note e output delle attività;
      <b> non contiene password, API key, impostazioni, altri libri né copie storiche
      opzionali IndexedDB</b>. Non è cifrato: custodiscilo privatamente.
      Non ricostruisce il libro com'era al momento del task selezionato,
      non applica modifiche e non autorizza undo, fork o ripristini.</p>
    {bookStatus==="running"&&<p role="alert" className="text-xs">
      Autopilot in esecuzione: mettilo in pausa prima della copia.</p>}
    <button type="button" disabled={busy||bookStatus==="running"}
      className="rounded-lg border border-amber-600 px-3 py-2 text-xs disabled:opacity-40"
      onClick={()=>void generate()}>
      Genera e scarica ZIP di sicurezza del libro corrente
    </button>
    {evidence&&<div className="space-y-2 text-xs"
      aria-label="Dati della copia di sicurezza">
      <p>Libro: {evidence.bookId}. Revisione: {evidence.bookRevision}.
        Task di riferimento: {evidence.activityId}.</p>
      <p>Attività: {evidence.activityCount}; bozze di fusione: {evidence.mergeDraftCount}.
        ZIP: {evidence.zipBytes} byte.</p>
      <p>Impronta SHA-256 dello ZIP generato:</p>
      <code className="block break-all select-all">{evidence.sha256}</code>
      <label className="block space-y-1">
        <span>Verifica ZIP scaricato (scegli il file sul dispositivo)</span>
        <input type="file" accept=".zip,application/zip"
          aria-label="Verifica ZIP scaricato" disabled={busy}
          onChange={event=>{
            const file=event.currentTarget.files?.[0]??null;
            event.currentTarget.value="";
            void verify(file);
          }}/>
      </label>
      <p aria-label="Stato verifica file scaricato">
        {verified?"File scaricato verificato":"File scaricato non ancora verificato"}</p>
    </div>}
    {message&&<p role="status" className="text-xs">{message}</p>}
    <p className="muted text-xs">I dati non vengono inviati all'AI o a GitHub.
      Un download richiesto dal browser non prova che il file sia stato
      conservato correttamente: ricaricalo qui per verificarlo. La sola
      presenza dello ZIP non abilita «Riparti da qui».</p>
  </section>;
}
