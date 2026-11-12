import { useEffect, useRef, useState } from "react";
import { AiTraceReadFence } from "../domain/ai-trace-read-fence";
import {
  type HistoricalPlanBlocker, type HistoricalRewindReviewPlan,
  type HistoricalTarget,
} from "../domain/historical-rewind-review-plan";
import { prepareHistoricalRewindReviewPlan } from "../infrastructure/task-book-checkpoint";

interface Props { bookId:string; activityId:string; }
const BLOCKER_LABELS:Record<HistoricalPlanBlocker,string>={
  book_running:"Autopilot del libro attualmente in esecuzione",
  running_activity:"Sono presenti task del libro ancora in esecuzione",
  remote_lease_unverified:"Origine GitHub configurata: lease distribuito non verificato",
  external_backup_unverified:"Backup recuperabile su file esterno non attestato per il piano",
  historical_fork_unavailable:"Fork storico non ancora implementato: nessuna destinazione sicura di restore",
  editorial_approval_unavailable:"Approvazioni, freeze e rivalidazione dei capitoli a valle non ancora implementate",
};

/** A read-only review plan, NOT a restore executor or authorization surface.
 * Correction text lives only in this mounted React component. */
export function HistoricalReviewPlanPanel({bookId,activityId}:Props){
  const [target,setTarget]=useState<HistoricalTarget>("before");
  const [plan,setPlan]=useState<HistoricalRewindReviewPlan|null>(null);
  const [instruction,setInstruction]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const fence=useRef(new AiTraceReadFence());
  useEffect(()=>()=>fence.current.invalidate(),[]);
  const changeTarget=(next:HistoricalTarget)=>{
    fence.current.invalidate();
    setTarget(next);setPlan(null);setInstruction("");setMessage("");setBusy(false);
  };
  const prepare=async()=>{
    const ticket=fence.current.begin();
    setBusy(true);setPlan(null);setMessage("");
    try{
      const next=await prepareHistoricalRewindReviewPlan(bookId,activityId,target);
      if(!fence.current.isCurrent(ticket))return;
      if(next)setPlan(next);
      else setMessage("Piano non verificabile: consenso revocato, task/copia assenti, " +
        "identità storiche ambigue o troppi task da controllare.");
    }catch{
      if(fence.current.isCurrent(ticket))
        setMessage("Impossibile preparare il piano locale: nessun ripristino autorizzato.");
    }finally{
      if(fence.current.isCurrent(ticket))setBusy(false);
    }
  };
  const revalidate=async()=>{
    if(!plan)return;
    const baseline=plan;
    const ticket=fence.current.begin();
    setBusy(true);setMessage("");
    try{
      const next=await prepareHistoricalRewindReviewPlan(bookId,activityId,target);
      if(!fence.current.isCurrent(ticket))return;
      const unchanged=next && next.targetSha256===baseline.targetSha256 &&
        next.currentSha256===baseline.currentSha256 &&
        next.targetRevision===baseline.targetRevision &&
        next.currentRevision===baseline.currentRevision &&
        next.runningActivityCount===baseline.runningActivityCount &&
        JSON.stringify(next.blockers)===JSON.stringify(baseline.blockers);
      if(!unchanged){
        setPlan(null);
        setInstruction("");
        setMessage("Baseline non più verificabile o cambiata: piano scartato. " +
          "Genera un nuovo preflight dopo aver controllato il libro.");
      }else{
        setMessage("Impronte e baseline confermate al momento della nuova lettura. " +
          "La verifica NON blocca altri writer e NON autorizza un rewind.");
      }
    }catch{
      if(fence.current.isCurrent(ticket)){
        setPlan(null);setInstruction("");
        setMessage("Riconvalida fallita: piano scartato, nessuna modifica eseguita.");
      }
    }finally{
      if(fence.current.isCurrent(ticket))setBusy(false);
    }
  };
  return <section role="region" aria-label="Piano di revisione storica non eseguibile"
    className="space-y-2 rounded-lg border border-amber-500/50 p-3 text-xs">
    <h5 className="font-semibold">Bozza piano di revisione storica (non eseguibile)</h5>
    <p className="muted">Scegli esattamente una delle due versioni del task
      selezionato. Le impronte SHA-256 verificano solo il contenuto letto
      nel browser, non costituiscono backup, approvazione o lock. Ogni
      ripartenza storica resta disabilitata.</p>
    <label className="block space-y-1">
      <span>Stato storico da esaminare</span>
      <select aria-label="Stato storico da esaminare"
        className="w-full rounded-lg border border-slate-500 bg-transparent px-2 py-2"
        disabled={busy} value={target}
        onChange={event=>changeTarget(event.target.value as HistoricalTarget)}>
        <option value="before">Prima del task (pre-task)</option>
        <option value="after">Dopo il task (post-task)</option>
      </select>
    </label>
    <button type="button" disabled={busy}
      className="rounded-lg border border-amber-600 px-3 py-2 disabled:opacity-40"
      onClick={()=>void prepare()}>
      Genera preflight del piano storico
    </button>
    {plan&&plan.target===target&&
      <div role="region" aria-label="Metadati piano storico"
        className="space-y-2 rounded-lg border border-slate-400/40 p-2">
        <p className="font-semibold">Piano solo di analisi · stato
          {" "}{target==="before"?"PRIMA":"DOPO"} del task</p>
        <p>Revisione storica scelta: {plan.targetRevision}.
          Revisione del libro corrente: {plan.currentRevision}.</p>
        <p>{plan.currentEqualsTargetRevision
          ?"La revisione corrente coincide con quella storica selezionata."
          :"La revisione attuale è diversa dalla selezionata: non applicare alcun recupero."}</p>
        <p>Capitoli della versione scelta: {plan.targetChapterCount};
          {" "}scene (incluse bozze): {plan.targetSceneCount};
          {" "}capitoli congelati: {plan.targetFrozenCount}.
          {" "}Freeze nel libro attuale: {plan.currentFrozenCount}.</p>
        <p>Capitoli correnti candidati a riesame: {plan.candidateChapterCount};
          {" "}numeri visibili: {plan.candidateChapterNumbers.join(", ")||"nessuno"}.
          {plan.candidateNumbersOmitted>0
            ?` Altri ${plan.candidateNumbersOmitted} non visualizzati.`:""}
          {" "}Sono candidati prudenziali, non dipendenze certificate.</p>
        <p>Impronta SHA-256 del contenuto storico scelto:</p>
        <code className="block break-all" aria-label="Impronta SHA-256 storica">
          {plan.targetSha256}
        </code>
        <p>Impronta SHA-256 del contenuto narrativo attuale:</p>
        <code className="block break-all" aria-label="Impronta SHA-256 attuale">
          {plan.currentSha256}
        </code>
        <p>Task attualmente in esecuzione per il libro: {plan.runningActivityCount}.
          {" "}Remote GitHub configurato: {plan.remoteConfigured?"sì":"no"}.</p>
        <p className="font-semibold">Prerequisiti NON soddisfatti per il vero rewind</p>
        <ul className="list-inside list-disc space-y-1"
          aria-label="Blocchi piano storico">
          {plan.blockers.map(blocker=><li key={blocker}>
            {BLOCKER_LABELS[blocker]}
          </li>)}
        </ul>
        <label className="block space-y-1">
          <span>Istruzione correttiva (bozza volatile, non inviata)</span>
          <textarea aria-label="Istruzione correttiva locale non inviata"
            value={instruction} maxLength={2000} rows={3}
            onChange={event=>setInstruction(event.target.value)}
            className="w-full rounded-lg border border-slate-500 bg-transparent px-2 py-2"
            placeholder="Descrivi cosa vorresti correggere, senza inviare all’AI"/>
        </label>
        <p className="muted">{instruction.length}/2000 caratteri solo in memoria
          della schermata. Non viene salvato, esportato o inviato.
          Non costituisce un permesso di riscrittura.</p>
        <button type="button" disabled={busy}
          className="rounded-lg border border-amber-600 px-3 py-2 disabled:opacity-40"
          onClick={()=>void revalidate()}>
          Riconvalida impronte e revisione
        </button>
        <p className="muted">Non è presente alcuna azione di
          ripristino o conferma del canone: il piano non è eseguibile.
          Prima di un futuro fork storico servono un backup verificato,
          lease writer e approvazioni sui capitoli congelati e downstream.</p>
      </div>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
