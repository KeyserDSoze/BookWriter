import { useEffect, useRef, useState } from "react";
import { AiTraceReadFence } from "../domain/ai-trace-read-fence";
import { HistoricalReviewPlanPanel } from "./HistoricalReviewPlanPanel";
import {
  TASK_BOOK_PAIR_LIMIT_BYTES, TASK_BOOK_TOTAL_LIMIT_BYTES,
  type TaskBookCheckpointSummary,
} from "../domain/task-book-checkpoint";
import type { NarrativeHistoryImpact } from "../domain/narrative-task-history-impact";
import {
  inspectTaskBookCheckpoint, inspectNarrativeTaskHistoryImpact,
  loadTaskBookConsent, loadTaskBookInventory,
  setTaskBookConsent, type TaskBookInventory,
} from "../infrastructure/task-book-checkpoint";

interface Props { bookId:string; focusedTaskId:string|null; }
const mib=(n:number)=>(n/(1024*1024)).toFixed(2);

/** No narrative text ever leaves the storage layer; no restore control. */
export function TaskBookHistoryPanel({bookId,focusedTaskId}:Props){
  const [consent,setConsent]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [revokePending,setRevokePending]=useState(false);
  const [inventory,setInventory]=useState<TaskBookInventory|null>(null);
  const [checkpoint,setCheckpoint]=useState<TaskBookCheckpointSummary|null>(null);
  const [inspectMessage,setInspectMessage]=useState("");
  const [impact,setImpact]=useState<NarrativeHistoryImpact|null>(null);
  const [impactMessage,setImpactMessage]=useState("");
  const consentFence=useRef(new AiTraceReadFence());
  const inspectFence=useRef(new AiTraceReadFence());
  const impactFence=useRef(new AiTraceReadFence());

  useEffect(()=>{
    const ticket=consentFence.current.begin();
    setConsent(null);setMessage("");setBusy(false);
    setRevokePending(false);setInventory(null);
    void loadTaskBookConsent(bookId).then(enabled=>{
      if(consentFence.current.isCurrent(ticket))setConsent(enabled);
    }).catch(()=>{
      if(consentFence.current.isCurrent(ticket))
        setMessage("Impossibile leggere il consenso locale: nessun checkpoint attivato.");
    });
    return ()=>{consentFence.current.invalidate();};
  },[bookId]);
  useEffect(()=>{
    inspectFence.current.invalidate();impactFence.current.invalidate();
    setCheckpoint(null);setInspectMessage("");
    setImpact(null);setImpactMessage("");
    return ()=>{
      inspectFence.current.invalidate();impactFence.current.invalidate();
    };
  },[bookId,focusedTaskId]);

  const change=async(enabled:boolean)=>{
    const ticket=consentFence.current.begin();
    inspectFence.current.invalidate();impactFence.current.invalidate();
    setCheckpoint(null);setInspectMessage("");setInventory(null);
    setImpact(null);setImpactMessage("");
    setBusy(true);setMessage("");setRevokePending(false);
    try{
      await setTaskBookConsent(bookId,enabled);
      if(!consentFence.current.isCurrent(ticket))return;
      setConsent(enabled);
      setMessage(enabled
        ?"Consenso attivo per i prossimi task riusciti: nessuno storico retroattivo."
        :"Consenso revocato: coppie narrative locali eliminate solo per questo libro.");
    }catch(error){
      if(consentFence.current.isCurrent(ticket)){
        setConsent(null);
        setMessage(error instanceof Error?error.message:
          "Operazione non riuscita: ricarica per verificare lo stato.");
      }
    }finally{
      if(consentFence.current.isCurrent(ticket))setBusy(false);
    }
  };
  const refresh=async()=>{
    const ticket=consentFence.current.begin();
    setInventory(null);setMessage("");
    try{
      const result=await loadTaskBookInventory(bookId);
      if(consentFence.current.isCurrent(ticket)) {
        setInventory(result);
        if(!result)setMessage("Libro non trovato: impossibile leggere l'inventario.");
      }
    }catch{
      if(consentFence.current.isCurrent(ticket))
        setMessage("Impossibile leggere il contatore locale delle copie narrative.");
    }
  };
  const inspect=async()=>{
    if(!focusedTaskId||consent!==true)return;
    const id=focusedTaskId;
    const ticket=inspectFence.current.begin();
    setCheckpoint(null);setInspectMessage("");
    try{
      const found=await inspectTaskBookCheckpoint(bookId,id);
      if(!inspectFence.current.isCurrent(ticket))return;
      if(found)setCheckpoint(found);
      else setInspectMessage("Nessun checkpoint narrativo verificabile per questo task: " +
        "consenso assente al commit, task legacy o copie revocate.");
    }catch{
      if(inspectFence.current.isCurrent(ticket))
        setInspectMessage("Lettura locale non riuscita: nessuna copia mostrata.");
    }
  };
  const inspectImpact=async()=>{
    if(!focusedTaskId||consent!==true)return;
    const id=focusedTaskId;
    const ticket=impactFence.current.begin();
    setImpact(null);setImpactMessage("");
    try{
      const result=await inspectNarrativeTaskHistoryImpact(bookId,id);
      if(!impactFence.current.isCurrent(ticket))return;
      if(result)setImpact(result);
      else setImpactMessage("Impossibile confrontare i checkpoint narrativi: " +
        "storico assente, consenso revocato oppure identità di capitoli/scene ambigue.");
    }catch{
      if(impactFence.current.isCurrent(ticket))
        setImpactMessage("Confronto storico non verificabile: nessun dato mostrato.");
    }
  };
  return <section role="region" aria-label="Checkpoint narrativi integrali per rewind"
    className="mt-3 space-y-2 rounded-lg border border-amber-500/40 p-3 text-sm">
    <h4 className="font-semibold">Checkpoint narrativi integrali per task (opt-in separato)</h4>
    <p className="muted text-xs">Per default disattivati. Una scelta esplicita
      conserva <b>prima e dopo</b> di ciascun futuro task riuscito: testo di
      tutte le scene anche in bozza, brief, memoria e segreti narrativi,
      freeze, decisioni autoriali e fase del libro. Dati altamente riservati,
      duplicati solo in IndexedDB locale e non cifrati: nessuna trasmissione
      all’AI, ZIP o GitHub. Sono esclusi remote e credenziali di sincronizzazione.
      Nessuna ricostruzione retroattiva, nessun restore o undo automatico.</p>
    <p className="muted text-xs">Il limite applicativo obbligatorio è
      {" "}{mib(TASK_BOOK_PAIR_LIMIT_BYTES)} MiB stimati per coppia,
      {" "}{mib(TASK_BOOK_TOTAL_LIMIT_BYTES)} MiB per libro. Oltre quota il
      task non viene confermato: non si tronca il contenuto e non si cancellano
      snapshot automaticamente. Lo spazio fisico IndexedDB dipende dal browser
      e può esaurirsi anche prima.</p>
    <p className="text-xs">Stato consenso integrale: {consent===null
      ?"in caricamento o non verificabile":consent?"attivo":"disattivato"}.</p>
    {consent!==true?
      <button type="button" disabled={busy||consent===null}
        className="rounded-lg border border-amber-600 px-3 py-2 text-xs disabled:opacity-40"
        onClick={()=>void change(true)}>
        Attiva checkpoint narrativi integrali per questo libro
      </button>:
      <>
        <button type="button" disabled={busy}
          className="rounded-lg border border-amber-600 px-3 py-2 text-xs disabled:opacity-40"
          onClick={()=>setRevokePending(true)}>
          Richiedi revoca checkpoint narrativi integrali
        </button>
        {revokePending&&<div className="space-y-2 rounded-lg border border-red-600/40 p-2"
          aria-label="Conferma revoca checkpoint narrativi">
          <p className="text-xs">Revocando elimini definitivamente solo
            le coppie integrali di questo libro. Il canone, la cronologia
            attività, i checkpoint strutturali e le copie di prosa separate
            rimarranno invariati. Confermi?</p>
          <button type="button" disabled={busy}
            className="rounded-lg border border-red-600 px-3 py-2 text-xs disabled:opacity-40"
            onClick={()=>void change(false)}>
            Conferma revoca ed elimina checkpoint integrali
          </button>
          <button type="button" disabled={busy}
            className="ml-2 rounded-lg border border-slate-400 px-3 py-2 text-xs disabled:opacity-40"
            onClick={()=>setRevokePending(false)}>Annulla revoca integrale</button>
        </div>}
        <button type="button" disabled={busy}
          className="block rounded-lg border border-slate-400 px-3 py-2 text-xs disabled:opacity-40"
          onClick={()=>void refresh()}>
          Aggiorna spazio checkpoint narrativi
        </button>
        {inventory&&inventory.bookId===bookId&&<p className="text-xs"
          aria-label="Inventario checkpoint narrativi">
          Coppie conservate: {inventory.records};
          stima JSON UTF-8: {mib(inventory.estimatedBytes)} MiB
          ({inventory.estimatedBytes} byte);
          limite locale {mib(inventory.totalLimitBytes)} MiB.
        </p>}
        {focusedTaskId&&<div className="space-y-2 border-t border-slate-400/30 pt-2">
          <p className="muted text-xs">Carica soltanto metadati del task selezionato.
            Nessuna prosa o memoria viene mostrata in questa schermata.</p>
          <button type="button" disabled={busy}
            className="rounded-lg border border-slate-400 px-3 py-2 text-xs disabled:opacity-40"
            onClick={()=>void inspect()}>
            Verifica checkpoint narrativo integrale del task
          </button>
          {checkpoint&&checkpoint.bookId===bookId&&
            checkpoint.activityId===focusedTaskId&&<div className="text-xs space-y-1"
              role="region" aria-label="Metadati checkpoint narrativo integrale">
              <p>Checkpoint integrale locale presente. Nessun ripristino disponibile.</p>
              <p>Revisione prima: {checkpoint.revisionBefore};
                dopo: {checkpoint.revisionAfter}.</p>
              <p>Capitoli: {checkpoint.chaptersBefore} prima,
                {" "}{checkpoint.chaptersAfter} dopo.
                Scene (incluse bozze): {checkpoint.scenesBefore} prima,
                {" "}{checkpoint.scenesAfter} dopo.</p>
              <p>Capitoli congelati: {checkpoint.frozenBefore} prima,
                {" "}{checkpoint.frozenAfter} dopo.</p>
            </div>}
          {inspectMessage&&<p role="status" className="text-xs">{inspectMessage}</p>}
          <div className="border-t border-slate-400/30 pt-2 space-y-2">
            <p className="muted text-xs">Confronta su richiesta il prima/dopo del task
              e ricava solo <b>conteggi</b> di capitoli, scene e memoria modificati.
              La lista dei capitoli correnti da riesaminare è prudenziale:
              <b> non dimostra legami causali</b>, non sblocca freeze e non modifica nulla.</p>
            <button type="button" disabled={busy}
              className="rounded-lg border border-slate-400 px-3 py-2 text-xs disabled:opacity-40"
              onClick={()=>void inspectImpact()}>
              Analizza differenze narrative storiche
            </button>
            {impact&&impact.bookId===bookId&&impact.activityId===focusedTaskId&&
              <div role="region" aria-label="Anteprima impatto narrativo storico"
                className="space-y-1 rounded-lg border border-slate-400/30 p-2 text-xs">
                <p className="font-semibold">Differenze storiche del task (sola lettura)</p>
                <p>Revisione prima: {impact.revisionBefore}; dopo: {impact.revisionAfter}.</p>
                <p>Capitoli aggiunti: {impact.chaptersAdded};
                  {" "}rimossi: {impact.chaptersRemoved};
                  {" "}modificati: {impact.chaptersChanged}.</p>
                <p>Scene (anche bozze) aggiunte: {impact.scenesAdded};
                  {" "}rimosse: {impact.scenesRemoved};
                  {" "}modificate: {impact.scenesChanged}.</p>
                <p>Freeze aggiunti: {impact.frozenAdded};
                  {" "}rimossi: {impact.frozenRemoved}.</p>
                <p>Ordine dei capitoli cambiato: {impact.chapterOrderChanged?"sì":"no"};
                  {" "}capitoli con ordine delle scene diverso:
                  {" "}{impact.sceneOrderChangedChapters}.</p>
                <p>Campi narrativi globali modificati: {impact.narrativeFieldsChanged};
                  {" "}memoria cambiata: {impact.memoryChanged?"sì":"no"};
                  {" "}fase cambiata: {impact.phaseChanged?"sì":"no"}.</p>
                <p>Revisione del libro attuale: {impact.currentRevision}.
                  {" "}{impact.currentRevisionEqualsRecordedAfter
                    ?"Coincide con la revisione post-task registrata."
                    :"È diversa dalla revisione post-task: potrebbero esserci sviluppi successivi."}</p>
                <p className="font-semibold">Capitoli correnti candidati a revisione:
                  {" "}{impact.candidateChapterCount}.</p>
                {impact.globalNarrativeChange
                  ?<p>Variazioni narrative globali: tutti i capitoli correnti
                    sono considerati candidati, non soltanto i successivi.</p>
                  :impact.firstChangedChapterNumber!==null
                    ?<p>Dal capitolo numero {impact.firstChangedChapterNumber}
                      in poi, inclusa l'area cambiata (senza causalità accertata).</p>
                    :<p>Non risultano variazioni di capitolo o campi narrativi
                      considerate da questa euristica. Non prova continuità.</p>}
                <p aria-label="Numeri dei capitoli candidati">
                  {impact.candidateChapterNumbers.length
                    ?"Numeri: "+impact.candidateChapterNumbers.join(", ")+"."
                    :"Nessun numero di capitolo candidato da mostrare."}
                  {impact.candidateChapterNumbersOmitted>0
                    ?` Altri ${impact.candidateChapterNumbersOmitted} non visualizzati.`:""}
                </p>
                <p className="muted">La selezione è conservativa, non un grafo
                  di dipendenze, una diagnosi editoriale o un'autorizzazione
                  a riscrivere. Nessun ripristino/undo/fork storico disponibile.</p>
              </div>}
            {impact&&impact.bookId===bookId&&impact.activityId===focusedTaskId&&
              <HistoricalReviewPlanPanel
                key={bookId+":"+focusedTaskId+":"+impact.currentRevision}
                bookId={bookId} activityId={focusedTaskId}/>}
            {impactMessage&&<p role="status" className="text-xs">{impactMessage}</p>}
          </div>
        </div>}
      </>}
    {message&&<p role="status" className="text-xs">{message}</p>}
  </section>;
}
