import {useState} from "react";
import type {BookProject} from "../domain/types";
import type {VerificationPlanItem} from "../domain/editorial-verification-plan";
import {
  currentEditorialVerificationChoice,type EditorialVerificationChoiceStatus,
} from "../domain/editorial-verification-choices";
import {recordEditorialVerificationChoice}
  from "../application/editorial-verification-choices";
import {Button} from "./ui/button";

/** Does not appear in archived plans, and does not expose any control that
 * could execute an automatic check or approve an editorial remediation. */
export function EditorialVerificationChoiceControl({book,chapterId,item,onRefresh}:{
  book:BookProject;chapterId:string;item:VerificationPlanItem;
  onRefresh:()=>Promise<void>;
}){
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const choice=currentEditorialVerificationChoice(book,chapterId,item);
  const canWrite=!busy&&book.status!=="running" &&
    book.editorialCycle?.chapterId===chapterId &&
    book.editorialCycle?.stage==="blocked";
  const valid=note.trim().length>=20&&note.trim().length<=500;
  async function save(status:EditorialVerificationChoiceStatus){
    if(!canWrite||!valid||(status==="reset"&&!choice))return;
    const descriptions={
      taken_on:"Prendere in carico il controllo suggerito",
      dismissed:"Respingere il controllo suggerito",
      reset:"Azzerare la tua scelta precedente",
    };
    const ok=window.confirm(descriptions[status]+
      "? Questa è soltanto una nota privata dell'autore: NON viene eseguita " +
      "alcuna ricerca o chiamata AI, non si modifica la prosa, non si approva " +
      "una remediation e non si cambia la decisione del giudice. " +
      "Il salvataggio sospende autosync GitHub e svuota la coda remota. " +
      "Un backup ZIP o push manuale può contenere spoiler.");
    if(!ok)return;
    setBusy(true);setError("");setMessage("");
    try{
      await recordEditorialVerificationChoice(book.id,book.updatedAt,
        chapterId,item.key,status,note.trim());
      setNote("");
      await onRefresh();
      setMessage("Scelta salvata solo localmente, senza eseguire il controllo.");
    }catch(e){
      setError(e instanceof Error?e.message:"Annotazione non salvata.");
    }finally{setBusy(false);}
  }
  const history=(book.editorialVerificationChoices??[])
    .filter(x=>x.chapterId===chapterId&&x.planKey===item.key);
  return <details aria-label="Scelta autore sul controllo editoriale"
    className="mt-3 min-w-0 rounded border border-slate-300 p-2 dark:border-slate-700">
    <summary className="cursor-pointer font-semibold">Scelta privata dell'autore — {
      choice?.status==="taken_on"?"presa in carico":
      choice?.status==="dismissed"?"respinta":"nessuna scelta attiva"}</summary>
    <p className="muted mt-1">Questa annotazione non esegue verifiche, non invia
      dati AI e non autorizza modifiche. Il giudizio rimane
      «prove insufficienti» anche se prendi in carico la verifica.</p>
    {choice&&<p className="mt-1"><b>Motivazione della scelta corrente:</b>
      {" "}{choice.rationale}</p>}
    {history.length>0&&<details className="mt-2">
      <summary className="cursor-pointer">Storico delle scelte ({history.length})</summary>
      <ol className="mt-1 space-y-1">
        {history.map(x=><li key={x.id} className="break-words">
          {x.status==="taken_on"?"Presa in carico":
            x.status==="dismissed"?"Respinta":"Azzerata"}
          {" · "}{new Date(x.decidedAt).toLocaleString("it-IT")}
          {" — "}{x.rationale}
        </li>)}
      </ol>
    </details>}
    <label className="mt-2 block font-semibold">
      Motivazione privata (20–500 caratteri)
      <textarea aria-label="Motivazione scelta controllo editoriale"
        className="field mt-1 min-h-20 w-full" maxLength={500}
        value={note} onChange={e=>setNote(e.target.value)}/>
    </label>
    {error&&<p role="alert" className="mt-1 text-red-700 dark:text-red-300">{error}</p>}
    {message&&<p role="status" className="mt-1">{message}</p>}
    {!canWrite&&<p className="muted mt-1">
      Per annotare questa verifica metti in pausa l'autopilot e attendi
      che il ciclo editoriale sia bloccato.</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      <Button size="sm" disabled={!canWrite||!valid}
        onClick={()=>void save("taken_on")}>Prendi in carico</Button>
      <Button size="sm" variant="outline" disabled={!canWrite||!valid}
        onClick={()=>void save("dismissed")}>Respingi suggerimento</Button>
      <Button size="sm" variant="outline" disabled={!canWrite||!valid||!choice}
        onClick={()=>void save("reset")}>Azzera scelta</Button>
    </div>
  </details>;
}
