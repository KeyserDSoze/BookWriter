import {useState} from "react";
import type {BookProject} from "../domain/types";
import {TRANSFER_SHARE_RECIPIENTS,
  type NarrativeTransferShareDecision,type TransferShareRecipient}
  from "../domain/narrative-transfer-sharing";
import {recordNarrativeTransferShareDecision}
  from "../application/narrative-transfer-sharing";
import {Button} from "./ui/button";

const NAMES:Record<TransferShareRecipient,string>={
  continuity:"Continuità",timeline:"Timeline",secrets:"Segreti",
  characterVoice:"Voce dei personaggi",judge:"Giudice critico",
};
export function NarrativeTransferShareControl({book,assessmentId,permission,onRefresh}:{
  book:BookProject;assessmentId:string;
  permission:NarrativeTransferShareDecision|null;onRefresh:()=>Promise<void>;
}){
  const [recipients,setRecipients]=useState<TransferShareRecipient[]>([]);
  const [rationale,setRationale]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const blocked=busy||book.status==="running"||
    (!!book.editorialCycle&&book.editorialCycle.stage!=="blocked");
  const validNote=rationale.trim().length>=12&&rationale.trim().length<=500;
  async function save(status:"allowed"|"revoked"){
    if(blocked||!validNote||(status==="allowed"&&!recipients.length)||
      (status==="revoked"&&!permission))return;
    if(!window.confirm(status==="allowed"
      ?"Inviare nelle PROSSIME chiamate AI soltanto la citazione, il mittente, " +
       "il destinatario e la tua classificazione della pista ai ruoli selezionati? " +
       "È una valutazione fallibile, non canone o prova di ricezione. Le motivazioni " +
       "private restano escluse; i provider esterni possono ricevere gli estratti. " +
       "Nessun vecchio consenso vale per queste piste. L'autosync sarà fermato " +
       "e la coda GitHub cancellata; ZIP e push manuali possono includere spoiler."
      :"Revocare il consenso per i FUTURI invii AI di questa valutazione? " +
       "Non puoi cancellare quanto eventualmente già ricevuto dai provider. " +
       "L'autosync sarà disabilitato e la coda GitHub eliminata."))return;
    setBusy(true);setError("");setMessage("");
    try{
      await recordNarrativeTransferShareDecision(book.id,book.updatedAt,
        assessmentId,status,status==="allowed"?recipients:[],rationale.trim());
      setRecipients([]);setRationale("");
      await onRefresh();
      setMessage(status==="allowed"?
        "Consenso mirato salvato. Soltanto i ruoli scelti potranno vedere il pack minimo."
        :"Consenso revocato per i futuri invii.");
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Consenso non registrato.");
    }finally{setBusy(false);}
  }
  return <details aria-label="Consenso AI pista comunicativa"
    className="mt-2 min-w-0 rounded border border-slate-300 p-2 dark:border-slate-700">
    <summary className="cursor-pointer font-semibold">Condivisione AI specifica — {
      permission?"attiva":"nessun consenso attivo"}</summary>
    <p className="muted mt-1">
      La scelta è <b>separata</b> dai consensi sulle conoscenze.
      Di default nessun ruolo riceve la tua interpretazione.
      Il provider AI vedrà solo citazione, due nomi e verdetto, mai la tua
      motivazione, le altre note private o i collegamenti di conoscenza.
      Nessuna classificazione garantisce un passaggio reale; i cinque lettori
      ciechi non ricevono questo materiale.
    </p>
    {permission&&<p className="mt-1">
      Destinatari già autorizzati: {permission.recipients.map(x=>NAMES[x]).join(", ")}.
    </p>}
    <fieldset className="mt-2" aria-label="Destinatari pista comunicativa">
      <legend className="font-semibold">Destinatari delle prossime chiamate</legend>
      {TRANSFER_SHARE_RECIPIENTS.map(role=><label key={role}
        className="mt-1 flex items-start gap-2">
        <input type="checkbox" aria-label={"Autorizza "+NAMES[role]}
          checked={recipients.includes(role)} disabled={busy}
          onChange={e=>setRecipients(old=>e.target.checked?
            [...old,role]:old.filter(x=>x!==role))}/>
        <span>{NAMES[role]}</span>
      </label>)}
    </fieldset>
    <label className="mt-2 block font-semibold">
      Motivazione privata del consenso/revoca (12–500 caratteri)
      <textarea className="field mt-1 min-h-20"
        aria-label="Motivazione consenso pista comunicativa" maxLength={500}
        value={rationale} onChange={e=>setRationale(e.target.value)}/>
    </label>
    {error&&<p role="alert" className="mt-1 text-red-700">{error}</p>}
    {message&&<p role="status" className="mt-1 text-emerald-700">{message}</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      <Button size="sm" disabled={blocked||!validNote||!recipients.length}
        onClick={()=>void save("allowed")}>Autorizza ruoli selezionati</Button>
      <Button size="sm" variant="outline" disabled={blocked||!validNote||!permission}
        onClick={()=>void save("revoked")}>Revoca autorizzazione</Button>
    </div>
    <p className="muted mt-1">La revoca vale solo per i futuri prompt;
      le chiamate AI già effettuate non possono essere ritirate.</p>
  </details>;
}
