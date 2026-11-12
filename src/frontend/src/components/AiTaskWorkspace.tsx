import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity, BookProject } from "../domain/types";
import { RewindSafetyBackupPanel } from "./RewindSafetyBackupPanel";
import { TaskBookHistoryPanel } from "./TaskBookHistoryPanel";
import { AiTraceReadFence } from "../domain/ai-trace-read-fence";
import {
  compareBookStructure, type TaskStructuralCheckpoint,
} from "../domain/task-structural-checkpoint";
import { loadTaskStructuralCheckpoint } from "../infrastructure/task-structural-checkpoint";
import { compareCanonProse, type TaskProseCheckpoint } from "../domain/task-prose-checkpoint";
import { CanonProseEditorialDiff } from "./CanonProseEditorialDiff";
import { validProseLimitMiB, PROSE_MIB } from "../domain/task-prose-storage";
import {
  deleteSelectedTaskProse, loadTaskProseInventory, setTaskProseLimit,
  wasTaskProseManuallyRemoved, type TaskProseStorageInventory,
} from "../infrastructure/task-prose-storage";
import {
  loadTaskProseCheckpoint, loadTaskProseConsent, setTaskProseConsent,
} from "../infrastructure/task-prose-checkpoint";
import {
  analyzeRewindPreflight, type RewindPreflightBook,
} from "../domain/rewind-preflight";
import {
  completedTaskDurationSeconds, estimatedTaskCostEur, filterTaskTimeline,
  groupTaskTimelineByRun, resolveTaskFocus,
  formatTaskDuration, summarizeTaskTimeline,
  type TimelineOrder, type TimelineStatus,
} from "../domain/task-timeline";
import {
  loadAiTrace, type AiLocalTrace, type LiveAiTrace,
} from "../infrastructure/ai-observability";

interface Props {
  book?: RewindPreflightBook & Pick<BookProject, "updatedAt">;
  bookId: string;
  activities: Activity[];
  live: LiveAiTrace | null;
  inspectionEnabled: boolean;
  onPrepareRevision: (activity: Activity) => void;
  onForkCreated?: (forkBookId: string) => Promise<void> | void;
  compact?: boolean;
  onOpenFull?: () => void;
}

/** Task-first, read-only inspector. Provisional tokens are NEVER canonical. */
export function AiTaskWorkspace({
  book, bookId, activities, live, inspectionEnabled, onPrepareRevision, compact=false,
  onOpenFull, onForkCreated,
}: Props) {
  const [chosen,setChosen]=useState("");
  const [trace,setTrace]=useState<AiLocalTrace|null>(null);
  const [structural,setStructural]=useState<TaskStructuralCheckpoint|null>(null);
  const [structuralMessage,setStructuralMessage]=useState("");
  const [proseConsent,setProseConsent]=useState<{ bookId:string; enabled:boolean }|null>(null);
  const [consentBusy,setConsentBusy]=useState(false);
  const [consentMessage,setConsentMessage]=useState("");
  const [proseCheckpoint,setProseCheckpoint]=useState<TaskProseCheckpoint|null>(null);
  const [proseMessage,setProseMessage]=useState("");
  const [storageInventory,setStorageInventory]=useState<TaskProseStorageInventory|null>(null);
  const [storageMessage,setStorageMessage]=useState("");
  const [storageBusy,setStorageBusy]=useState(false);
  const [limitDraft,setLimitDraft]=useState("64");
  const [selectedCopyIds,setSelectedCopyIds]=useState<string[]>([]);
  const [pendingDeleteIds,setPendingDeleteIds]=useState<string[]>([]);
  const [message,setMessage]=useState("");
  const [clock,setClock]=useState(Date.now());
  const [search,setSearch]=useState("");
  const [statusFilter,setStatusFilter]=useState<TimelineStatus>("all");
  const [phaseFilter,setPhaseFilter]=useState("");
  const [order,setOrder]=useState<TimelineOrder>("newest");
  const [groupByRun,setGroupByRun]=useState(false);
  const [focusedTaskId,setFocusedTaskId]=useState("");
  const focusHeadingRef=useRef<HTMLHeadingElement>(null);
  // A request may settle after changing books, hiding inspection or choosing
  // another task. Never display stale local prompts or responses.
  const inspectionSequence=useRef(new AiTraceReadFence());
  const checkpointSequence=useRef(new AiTraceReadFence());
  const proseSequence=useRef(new AiTraceReadFence());
  const consentSequence=useRef(new AiTraceReadFence());
  const storageSequence=useRef(new AiTraceReadFence());
  const summary=useMemo(()=>summarizeTaskTimeline(activities),[activities]);
  const phaseOptions=useMemo(()=>[...new Set(activities.map(x=>x.phase))].sort(),[activities]);
  const filtered=useMemo(()=>compact?[]:filterTaskTimeline(activities,{
    query:search,status:statusFilter,phase:phaseFilter,order,
  }),[activities,compact,search,statusFilter,phaseFilter,order]);
  const runGroups=useMemo(()=>!compact&&groupByRun
    ?groupTaskTimelineByRun(filtered):[],[compact,groupByRun,filtered]);
  const runHeaders=new Map(runGroups.map(group=>[group.activities[0]!.id,group]));
  const ordered=useMemo(()=>compact?activities.slice(0,8):
    groupByRun?runGroups.flatMap(group=>group.activities):filtered,
  [activities,compact,groupByRun,runGroups,filtered]);
  const focused=compact?undefined:resolveTaskFocus(ordered,focusedTaskId);
  const recent=focused?[ordered[focused.index]!]:ordered;
  const structuralChanges=structural&&focused&&structural.bookId===bookId&&
    structural.activityId===focused.id?compareBookStructure(structural):null;
  const proseEnabled=proseConsent?.bookId===bookId&&proseConsent.enabled===true;
  const proseReady=proseConsent?.bookId===bookId;
  const proseDiff=proseEnabled&&proseCheckpoint&&focused&&
    proseCheckpoint.bookId===bookId&&proseCheckpoint.activityId===focused.id
    ?compareCanonProse(proseCheckpoint):null;
  const preflight=useMemo(()=>
    !compact&&focused&&book&&book.id===bookId
      ?analyzeRewindPreflight(book,activities,focused.id):null,
  [compact,focused?.id,book,bookId,activities]);
  useEffect(()=>{
    if(focused)focusHeadingRef.current?.focus();
  },[focused?.id,bookId]);
  useEffect(()=>{
    const timer=setInterval(()=>setClock(Date.now()),1000);
    return ()=>clearInterval(timer);
  },[]);
  useEffect(()=>{
    storageSequence.current.invalidate();
    setStorageInventory(null);setStorageMessage("");
    setStorageBusy(false);setSelectedCopyIds([]);setPendingDeleteIds([]);
    setLimitDraft("64");
    return ()=>{storageSequence.current.invalidate();};
  },[bookId,compact]);
  useEffect(()=>{
    if(compact)return;
    const ticket=consentSequence.current.begin();
    setProseConsent(null);setConsentBusy(false);setConsentMessage("");
    void loadTaskProseConsent(bookId).then(enabled=>{
      if(consentSequence.current.isCurrent(ticket))
        setProseConsent({bookId,enabled});
    }).catch(()=>{
      if(consentSequence.current.isCurrent(ticket))
        setConsentMessage("Impossibile leggere il consenso locale: copie disattivate.");
    });
    return ()=>{consentSequence.current.invalidate();};
  },[bookId,compact]);
  useEffect(()=>{
    inspectionSequence.current.invalidate();
    checkpointSequence.current.invalidate();
    proseSequence.current.invalidate();
    setChosen("");setTrace(null);setMessage("");
    setStructural(null);setStructuralMessage("");
    setProseCheckpoint(null);setProseMessage("");
    setSearch("");setStatusFilter("all");setPhaseFilter("");setOrder("newest");
    setGroupByRun(false);setFocusedTaskId("");
    return ()=>{
      inspectionSequence.current.invalidate();
      checkpointSequence.current.invalidate();
      proseSequence.current.invalidate();
    };
  },[bookId,inspectionEnabled]);
  const active=live?.bookId===bookId?live:null;
  const elapsed=active?Math.max(0,Math.floor(((active.endedAt??clock)-active.startedAt)/1000)):0;
  // Switching a focused task always revokes any in-flight IndexedDB inspection.
  const focusTask=(id:string)=>{
    inspectionSequence.current.invalidate();
    checkpointSequence.current.invalidate();
    proseSequence.current.invalidate();
    setChosen("");setTrace(null);setMessage("");
    setStructural(null);setStructuralMessage("");
    setProseCheckpoint(null);setProseMessage("");
    setFocusedTaskId(id);
  };
  const changeProseConsent=async(enabled:boolean)=>{
    const ticket=consentSequence.current.begin();
    setConsentBusy(true);setConsentMessage("");
    // Revocation must hide any previously loaded comparison immediately.
    proseSequence.current.invalidate();
    storageSequence.current.invalidate();
    setProseCheckpoint(null);setProseMessage("");
    setStorageInventory(null);setStorageMessage("");
    setSelectedCopyIds([]);setPendingDeleteIds([]);
    try{
      await setTaskProseConsent(bookId,enabled);
      if(!consentSequence.current.isCurrent(ticket))return;
      setProseConsent({bookId,enabled});
      setConsentMessage(enabled
        ?"Consenso attivo per questo libro: copie complete delle sole scene canoniche dai prossimi task riusciti."
        :"Consenso revocato: copie locali della prosa di questo libro eliminate.");
    }catch{
      if(consentSequence.current.isCurrent(ticket)){
        setProseConsent(null);
        setConsentMessage("Impossibile aggiornare il consenso. Stato sconosciuto: ricarica la pagina prima di riprovare.");
      }
    }finally{
      if(consentSequence.current.isCurrent(ticket))setConsentBusy(false);
    }
  };
  const inspectProse=async(id:string)=>{
    const ticket=proseSequence.current.begin();
    setProseCheckpoint(null);setProseMessage("");
    if(!proseEnabled)return;
    try{
      const stored=await loadTaskProseCheckpoint(bookId,id);
      if(!proseSequence.current.isCurrent(ticket))return;
      if(stored)setProseCheckpoint(stored);
      else {
        const deleted=await wasTaskProseManuallyRemoved(bookId,id);
        if(!proseSequence.current.isCurrent(ticket))return;
        setProseMessage(deleted
          ?"Copia testuale cancellata manualmente dall’autore: il confronto non è più disponibile per questo task."
          :"Nessuna copia testuale locale disponibile per questo task: il consenso non era attivo al commit, il task è legacy o le copie sono state eliminate.");
      }
    }catch{
      if(proseSequence.current.isCurrent(ticket))
        setProseMessage("Impossibile leggere la copia locale della prosa.");
    }
  };
  const refreshStorage=async()=>{
    const ticket=storageSequence.current.begin();
    setStorageInventory(null);setStorageMessage("");
    try{
      const inventory=await loadTaskProseInventory(bookId);
      if(!storageSequence.current.isCurrent(ticket))return;
      if(inventory){
        setStorageInventory(inventory);
        setLimitDraft(String(inventory.limitMiB??64));
      }else setStorageMessage("Libro non trovato: impossibile misurare l'archivio.");
    }catch{
      if(storageSequence.current.isCurrent(ticket))
        setStorageMessage("Impossibile stimare lo spazio dell'archivio locale.");
    }
  };
  const changeStorageLimit=async(limitMiB:number|null)=>{
    if(limitMiB!==null&&!validProseLimitMiB(limitMiB)){
      setStorageMessage("Limite non valido: usa un intero da 1 a 1024 MiB.");
      return;
    }
    const ticket=storageSequence.current.begin();
    setStorageBusy(true);setStorageMessage("");
    try{
      await setTaskProseLimit(bookId,limitMiB);
      if(!storageSequence.current.isCurrent(ticket))return;
      setStorageMessage(limitMiB===null
        ?"Limite applicativo rimosso. Il browser applica ancora la propria quota."
        :`Limite applicativo impostato a ${limitMiB} MiB; nessuna copia eliminata.`);
      const next=await loadTaskProseInventory(bookId);
      if(storageSequence.current.isCurrent(ticket))setStorageInventory(next);
    }catch{
      if(storageSequence.current.isCurrent(ticket))
        setStorageMessage("Impossibile salvare il limite: nessuna copia è stata cancellata.");
    }finally{
      if(storageSequence.current.isCurrent(ticket))setStorageBusy(false);
    }
  };
  const deleteSelectedCopies=async()=>{
    if(!pendingDeleteIds.length)return;
    const ticket=storageSequence.current.begin();
    setStorageBusy(true);setStorageMessage("");
    proseSequence.current.invalidate();
    setProseCheckpoint(null);setProseMessage("");
    try{
      const removed=await deleteSelectedTaskProse(bookId,pendingDeleteIds);
      if(!storageSequence.current.isCurrent(ticket))return;
      setPendingDeleteIds([]);setSelectedCopyIds([]);
      const inventory=await loadTaskProseInventory(bookId);
      if(!storageSequence.current.isCurrent(ticket))return;
      setStorageInventory(inventory);
      setStorageMessage(`Eliminate ${removed} copie testuali selezionate del libro corrente; manoscritto e checkpoint strutturali intatti.`);
    }catch{
      if(storageSequence.current.isCurrent(ticket))
        setStorageMessage("Eliminazione non riuscita: ricontrolla la selezione e riprova.");
    }finally{
      if(storageSequence.current.isCurrent(ticket))setStorageBusy(false);
    }
  };
  const inspectStructure=async(id:string)=>{
    const ticket=checkpointSequence.current.begin();
    setStructural(null);setStructuralMessage("");
    try{
      const stored=await loadTaskStructuralCheckpoint(bookId,id);
      if(!checkpointSequence.current.isCurrent(ticket))return;
      if(stored)setStructural(stored);
      else setStructuralMessage("Nessun checkpoint strutturale valido per questo task. Le attività storiche precedenti alla funzione non sono ricostruibili retroattivamente.");
    }catch{
      if(checkpointSequence.current.isCurrent(ticket))
        setStructuralMessage("Impossibile leggere il checkpoint strutturale locale da IndexedDB.");
    }
  };
  const inspect=async(id:string)=>{
    const ticket=inspectionSequence.current.begin();
    setChosen(id);setTrace(null);setMessage("");
    if(!inspectionEnabled) {
      setMessage("Attiva l'ispezione locale in Impostazioni per registrare le prossime richieste. Le attività precedenti non contengono il prompt integrale.");
      return;
    }
    try{
      const saved=await loadAiTrace(bookId,id);
      if(!inspectionSequence.current.isCurrent(ticket))return;
      setTrace(saved);
      if(!saved)setMessage("Nessuna richiesta integrale conservata per questo task. L'ispezione non è retroattiva.");
    }catch{
      if(inspectionSequence.current.isCurrent(ticket))
        setMessage("Impossibile leggere il tracciato locale da IndexedDB.");
    }
  };
  const status=(s:Activity["status"])=>s==="succeeded"?"Completato":
    s==="running"?"In corso":s==="cancelled"?"Interrotto":"Fallito";
  return <section className="panel min-w-0 p-4 sm:p-5" aria-label="Timeline task AI">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">Cosa sta facendo adesso · Timeline dei task</h2>
      <span className="muted text-xs">{activities.length} attività registrate</span>
    </div>
    {!compact&&<div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" aria-label="Riepilogo dei task">
      <div className="rounded-lg border border-slate-400/30 p-3">
        <p className="muted text-xs">Completati</p><b className="tabular-nums">{summary.completed}</b>
      </div>
      <div className="rounded-lg border border-slate-400/30 p-3">
        <p className="muted text-xs">In corso</p><b className="tabular-nums">{summary.running}</b>
      </div>
      <div className="rounded-lg border border-slate-400/30 p-3">
        <p className="muted text-xs">Falliti / interrotti</p><b className="tabular-nums">{summary.failed+summary.cancelled}</b>
      </div>
      <div className="rounded-lg border border-slate-400/30 p-3">
        <p className="muted text-xs">Stima € parziale</p>
        <b className="tabular-nums">{new Intl.NumberFormat("it-IT",{
          minimumFractionDigits:4,maximumFractionDigits:6,
        }).format(summary.knownEstimatedEur)}</b>
      </div>
    </div>}
    {!compact&&<p className="muted mt-2 text-xs">
      Stima ricavata solo da tariffe storiche inserite dall'autore e conteggi completi del provider:
      {summary.pricedReports} richieste valorizzate, {summary.uncertainAttempts} tentativi
      con consumo o tariffa non determinabili. Non è una fattura né un saldo;
      anche gli errori possono generare addebiti.
    </p>}
    {active && <div role="region" aria-label="Streaming task corrente"
      className="mt-3 space-y-2 rounded-lg border border-emerald-600/40 p-3">
      <p className="font-semibold">{active.title}</p>
      <p className="muted text-sm">Stato: {active.stage} · {elapsed} s · Modello {active.modelId} · Endpoint {active.endpointId}</p>
      <p className="text-xs">Reasoning richiesto: {active.requestedReasoning??"automatico (nessun parametro)"} ·
        Limite streaming: {active.streamDeadlineSeconds??600} secondi.</p>
      <p className="text-xs">
        {active.providerPhase==="model_loading"?"LM Studio: caricamento modello":
          active.providerPhase==="prompt_processing"?"LM Studio: elaborazione del prompt":
          active.providerPhase==="reasoning"?"LM Studio: fase reasoning":
          active.providerPhase==="message"?"LM Studio: scrittura della risposta":
          active.transportEvents>0?"Il provider ha inviato eventi ma non necessariamente testo":
          active.stage==="inviata"?"Richiesta inviata: in attesa degli header HTTP":
          "Header ricevuti: in attesa del primo evento SSE o del primo token."}
        {active.providerProgress!==undefined?` — ${Math.round(active.providerProgress*100)}% (dal provider)`:""}
      </p>
      <p className="muted text-xs">Eventi SSE ricevuti: {active.transportEvents} · Byte di rete ricevuti: {active.transportBytes}.
        {active.stage==="rifiutata"?" Il testo non è stato applicato al libro.":""}</p>
      {active.error&&<p role="alert" className="text-sm text-red-500 dark:text-red-300">{active.error}</p>}
      <p className="text-xs">Output ricevuto: {active.textCharacters} caratteri.
        {active.reasoningCharacters>0?` Reasoning ricevuto: ${active.reasoningCharacters} caratteri.`:
          " Nessun contenuto di reasoning trasmesso dal provider."}
      </p>
      {inspectionEnabled && active.reasoningPreview && <details className="rounded-lg border border-slate-400/30 p-2" open>
        <summary className="cursor-pointer text-sm font-semibold">Reasoning trasmesso dal provider (provvisorio)</summary>
        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words text-xs">{active.reasoningPreview}</pre>
      </details>}
      {inspectionEnabled && active.textPreview && <div>
        <p className="text-sm font-semibold">Risposta in streaming — non ancora approvata</p>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{active.textPreview}</pre>
      </div>}
      {!inspectionEnabled && <p className="muted text-xs">Per vedere i token e i prompt completi abilita «Ispezione locale richieste AI» nelle Impostazioni. Contiene dati potenzialmente riservati.</p>}
    </div>}
    {!compact&&<section aria-label="Consenso copie testuali per il rewind"
      className="mt-3 space-y-2 rounded-lg border border-amber-500/40 p-3 text-sm">
      <p className="font-semibold">Copie locali della prosa canonica per task (opt-in)</p>
      <p className="muted text-xs">Disattivato per impostazione predefinita.
        Se lo attivi, ogni futuro task riuscito salva in IndexedDB una copia
        integrale, non troncata, del testo delle scene canoniche prima e dopo
        il commit. Duplica contenuti riservati e può occupare molto spazio.
        Nessun backup ZIP o GitHub contiene queste copie. Non è un ripristino.</p>
      <p className="text-xs">Stato per questo libro: {proseReady
        ?proseEnabled?"attivo":"disattivato"
        :"in caricamento o non verificabile"}.</p>
      <button type="button" disabled={!proseReady||consentBusy||storageBusy}
        className="rounded-lg border border-amber-600 px-3 py-2 text-sm disabled:opacity-40"
        onClick={()=>void changeProseConsent(!proseEnabled)}>
        {proseEnabled?"Revoca consenso ed elimina tutte le copie testuali del libro"
          :"Attiva copie testuali locali per questo libro"}</button>
      {consentMessage&&<p role="status" className="muted text-xs">{consentMessage}</p>}
      {proseEnabled&&<div className="space-y-2 border-t border-amber-500/30 pt-3"
        aria-label="Gestione spazio snapshot testuali">
        <p className="font-semibold">Spazio e conservazione delle copie testuali</p>
        <p className="muted text-xs">Per default tutte le copie restano conservate finché
          non scegli di eliminarle. Nessuna cancellazione automatica.
          Le dimensioni mostrate sono stime dei payload JSON UTF-8,
          <b> non lo spazio effettivo IndexedDB</b> né la quota fisica del browser.
          Un nuovo task può produrre più testo di quello attuale.</p>
        <button type="button" disabled={storageBusy}
          className="rounded-lg border border-slate-400 px-3 py-2 text-xs disabled:opacity-40"
          onClick={()=>void refreshStorage()}>Aggiorna stima spazio locale</button>
        {storageInventory?.bookId===bookId&&<>
          <p className="text-xs" aria-label="Riepilogo archivio locale">
            Copie conservate: {storageInventory.records};
            stima payload: {(storageInventory.estimatedBytes/PROSE_MIB).toFixed(2)} MiB
            ({storageInventory.estimatedBytes} byte).
            Prossima coppia, <b>ipotizzando la prosa attuale invariata</b>:
            {" "}{(storageInventory.nextPairEstimateBytes/PROSE_MIB).toFixed(2)} MiB.
            {storageInventory.limitMiB===null
              ?" Nessun limite applicativo impostato (resta la quota del browser)."
              :` Limite applicativo: ${storageInventory.limitMiB} MiB.`}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">Limite archivio (MiB, 1–1024)
              <input className="field mt-1 w-32" type="number" min="1" max="1024"
                step="1" value={limitDraft}
                onChange={e=>setLimitDraft(e.target.value)}
                aria-label="Limite copie testuali MiB"/>
            </label>
            <button type="button" disabled={storageBusy}
              className="rounded-lg border border-slate-400 px-3 py-2 text-xs disabled:opacity-40"
              onClick={()=>void changeStorageLimit(Number(limitDraft))}>
              Applica limite copie testuali</button>
            <button type="button" disabled={storageBusy||storageInventory.limitMiB===null}
              className="rounded-lg border border-slate-400 px-3 py-2 text-xs disabled:opacity-40"
              onClick={()=>void changeStorageLimit(null)}>
              Rimuovi limite copie testuali</button>
          </div>
          <p className="muted text-xs">Se la prossima coppia completa supera il limite
            (considerando le copie già presenti), il commit del task viene
            rifiutato: niente troncamenti, rollback parziali o cancellazioni automatiche.</p>
          {storageInventory.entries.length>0&&<div className="space-y-2">
            <p className="font-medium text-xs">Seleziona da 1 a 20 copie da cancellare
              manualmente; vengono mostrati al massimo i primi 20 ID.
              La selezione non modifica il libro.</p>
            <div className="max-h-44 space-y-1 overflow-auto"
              aria-label="Copie testuali disponibili">
              {storageInventory.entries.slice(0,20).map(entry=><label key={entry.activityId}
                className="flex items-center gap-2 text-xs">
                <input type="checkbox"
                  aria-label={`Seleziona copia task ${entry.activityId}`}
                  checked={selectedCopyIds.includes(entry.activityId)}
                  onChange={e=>{
                    setPendingDeleteIds([]);
                    setSelectedCopyIds(ids=>e.target.checked
                      ?[...ids,entry.activityId]:ids.filter(id=>id!==entry.activityId));
                  }}/>
                <span>{activities.find(x=>x.id===entry.activityId)?.title??"Task non presente nel registro"}
                  {" · "}{entry.activityId.slice(0,8)}…
                  {" · "}{(entry.estimatedBytes/1024).toFixed(1)} KiB stimati</span>
              </label>)}
            </div>
            <button type="button" disabled={storageBusy||selectedCopyIds.length===0}
              className="rounded-lg border border-amber-600 px-3 py-2 text-xs disabled:opacity-40"
              onClick={()=>setPendingDeleteIds([...selectedCopyIds])}>
              Richiedi cancellazione copie selezionate ({selectedCopyIds.length})</button>
            {pendingDeleteIds.length>0&&<div className="space-y-2 rounded-lg border border-red-600/40 p-2">
              <p className="text-xs">Confermi la cancellazione irreversibile di
                {" "}{pendingDeleteIds.length} copie testuali di questo libro?
                Manoscritto, audit e checkpoint strutturali rimangono invariati;
                il futuro confronto di quei task non sarà più disponibile.</p>
              <button type="button" disabled={storageBusy}
                className="rounded-lg border border-red-600 px-3 py-2 text-xs"
                onClick={()=>void deleteSelectedCopies()}>
                Conferma cancellazione copie selezionate</button>
              <button type="button" className="ml-2 rounded-lg border border-slate-400 px-3 py-2 text-xs"
                onClick={()=>setPendingDeleteIds([])}>Annulla cancellazione copie</button>
            </div>}
          </div>}
        </>}
        {storageMessage&&<p role="status" className="muted text-xs">{storageMessage}</p>}
      </div>}
    </section>}
    {!compact&&<TaskBookHistoryPanel key={bookId} bookId={bookId}
      focusedTaskId={focused?.id??null}/>}
    <p className="muted mt-3 text-sm">Ogni attività è separata e ispezionabile. Un output in streaming non modifica il libro finché non supera i controlli di validazione e viene confermato come canonico.</p>
    {!compact&&focused&&<div role="region" aria-label="Scheda task dedicata"
      className="mt-4 space-y-3 rounded-xl border border-slate-400/50 p-4">
      <h3 ref={focusHeadingRef} tabIndex={-1} className="text-lg font-semibold">
        Scheda del task · {focused.index+1} di {focused.total}
      </h3>
      <p className="muted text-sm">Visualizzazione singola di sola lettura,
        nel medesimo ordine dei filtri e dei raggruppamenti selezionati.
        Nessun ripristino del libro o invio di richieste AI.</p>
      {preflight&&<section aria-label="Valutazione preliminare di ripartenza"
        className="space-y-2 rounded-lg border border-amber-500/50 p-3 text-sm">
        <h4 className="font-semibold">Prima di ripartire: impatto potenziale (non un rewind)</h4>
        {preflight.kind==="unavailable"?
          <p role="alert">Non è possibile stabilire una cronologia affidabile
            per questo task: identità, libro o data non verificabili.
            Nessun ripristino è disponibile.</p>:
          <>
            <p>Attività registrate con orario successivo: <b>{preflight.laterTaskCount}</b>.
              {preflight.sameTimeCount>0&&` ${preflight.sameTimeCount} attività con lo stesso istante (ordine non determinabile).`}
              {preflight.invalidTimeCount>0&&` ${preflight.invalidTimeCount} attività con data non verificabile.`}</p>
            {preflight.laterTaskSample.length>0&&<div>
              <p className="font-medium">Prime {preflight.laterTaskSample.length} attività successive per orario:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {preflight.laterTaskSample.map(task=>
                  <li key={task.id}>{task.title} · {task.phase} · {status(task.status)}</li>)}
              </ul>
            </div>}
            <p>Stato <b>attuale</b> del libro: {preflight.currentChapterCount} capitoli,
              {" "}{preflight.currentFrozenChapterCount} capitoli congelati,
              {" "}{preflight.currentCanonSceneCount} scene canoniche,
              {" "}{preflight.currentPendingReviewCount} scene segnalate per rilettura.</p>
            {book?.status==="running"&&
              <p className="font-semibold text-amber-700 dark:text-amber-300">
                L'autopilot è in esecuzione: è necessario fermarlo e verificare il checkpoint
                prima di qualsiasi futura revisione.</p>}
            {preflight.runningTaskCount>0&&
              <p className="muted">Sono registrati {preflight.runningTaskCount}
                {" "}altri task in corso; i loro esiti non sono noti.</p>}
            <p className="muted text-xs">Ordine temporale osservato, <b>non</b> dipendenze
              narrative dimostrate. Anche «0 attività successive» non certifica assenza
              di conseguenze: potrebbero esserci date ambigue, revisioni non tracciate
              o capitoli dipendenti.</p>
          </>}
        <p className="text-xs">I nuovi task possono avere checkpoint strutturali;
          le versioni testuali canoniche esistono solo con opt-in locale.
          Il confronto di paragrafi è una vista parziale, non un backup
          dell'intero progetto o un diff certificato delle conseguenze narrative.
          Nessun capitolo viene ripristinato o sbloccato, né vengono inviate
          richieste AI. «Prepara revisione» riguarda il libro corrente;
          vero rewind, undo, approvazioni e controllo a valle restano #158.</p>
      </section>}
      {book?.id===bookId&&<RewindSafetyBackupPanel
        key={bookId+":"+focused.id+":"+book.updatedAt}
        bookId={bookId} activityId={focused.id}
        bookRevision={book.updatedAt} bookStatus={book.status}
        onForkCreated={onForkCreated}/>}
      <section aria-label="Confronto strutturale salvato"
        className="space-y-2 rounded-lg border border-slate-400/40 p-3 text-sm">
        <h4 className="font-semibold">Checkpoint strutturale prima/dopo (sola lettura)</h4>
        <p className="muted text-xs">Solo per nuovi task completati: archivio locale
          versionato nella stessa transazione del canone e dell'audit.
          Non contiene il testo del romanzo, né prompt, segreti o reasoning.
          Non è un backup né permette di ripristinare lo stato precedente.</p>
        <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-700"
          onClick={()=>{if(focused)void inspectStructure(focused.id);}}>
          Carica confronto strutturale</button>
        {structuralMessage&&<p role="status" className="muted text-xs">{structuralMessage}</p>}
        {structuralChanges&&structural&&<div className="space-y-1 text-xs"
          aria-label="Differenze strutturali registrate">
          <p>Revisione prima: {structural.before.revision} · dopo: {structural.after.revision}.</p>
          <p>Capitoli: {structuralChanges.chaptersBefore} prima,
            {" "}{structuralChanges.chaptersAfter} dopo;
            {" "}{structuralChanges.chaptersAdded} aggiunti,
            {" "}{structuralChanges.chaptersRemoved} rimossi.</p>
          <p>Freeze capitoli: {structuralChanges.chaptersFrozen} aggiunti,
            {" "}{structuralChanges.chaptersUnfrozen} tolti.</p>
          <p>Scene: {structuralChanges.scenesAdded} aggiunte,
            {" "}{structuralChanges.scenesRemoved} rimosse,
            {" "}{structuralChanges.sceneStatusesChanged} stati modificati.
            Fase modificata: {structuralChanges.phaseChanged?"sì":"no"}.</p>
          <p className="muted">Anche con zero differenze strutturali, il testo
            potrebbe essere cambiato: questa vista non confronta la prosa,
            le istruzioni o le dipendenze narrative.</p>
        </div>}
      </section>
      <section aria-label="Confronto prosa canonica locale"
        className="space-y-2 rounded-lg border border-amber-500/40 p-3 text-sm">
        <h4 className="font-semibold">Confronto del testo canonico (opt-in, sola lettura)</h4>
        <p className="muted text-xs">La copia pre/post di tutte le scene canoniche
          è locale e disponibile soltanto se hai autorizzato la registrazione
          prima del commit del task. Il confronto conta le scene con testo
          differente, aggiunte o rimosse; non ripristina nulla e non mostra
          automaticamente il testo privato.</p>
        <button type="button" disabled={!proseEnabled}
          className="rounded-lg border border-slate-400 px-3 py-2 text-sm disabled:opacity-40"
          onClick={()=>{if(focused)void inspectProse(focused.id);}}>
          Carica confronto della prosa canonica</button>
        {!proseEnabled&&<p className="muted text-xs">Consenso non attivo: il confronto
          testuale locale non è disponibile.</p>}
        {proseMessage&&<p role="status" className="muted text-xs">{proseMessage}</p>}
        {proseDiff&&proseCheckpoint&&<div className="space-y-1 text-xs"
          aria-label="Differenze della prosa canonica">
          <p>Revisioni: {proseCheckpoint.before.revision} → {proseCheckpoint.after.revision}.</p>
          <p>Scene canoniche: {proseDiff.beforeCount} prima,
            {" "}{proseDiff.afterCount} dopo.
            {" "}{proseDiff.added.length} aggiunte,
            {" "}{proseDiff.removed.length} rimosse,
            {" "}{proseDiff.modified.length} con testo modificato.</p>
          <p className="muted">Si confronta esattamente il testo delle scene
            con lo stesso ID e capitolo. Non si ricostruiscono dipendenze,
            revisioni intermedie o una versione ripristinabile del libro.</p>
          <CanonProseEditorialDiff
            key={bookId+":"+proseCheckpoint.activityId}
            checkpoint={proseCheckpoint}/>
        </div>}
      </section>
      <div className="flex flex-wrap gap-2" aria-label="Navigazione task">
        <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-700"
          onClick={()=>focusTask("")}>Torna al registro dei task</button>
        <button type="button" disabled={!focused.previousId}
          className="rounded-lg border border-slate-400 px-3 py-2 text-sm disabled:opacity-40 dark:border-slate-700"
          onClick={()=>{if(focused.previousId)focusTask(focused.previousId);}}>Task precedente</button>
        <button type="button" disabled={!focused.nextId}
          className="rounded-lg border border-slate-400 px-3 py-2 text-sm disabled:opacity-40 dark:border-slate-700"
          onClick={()=>{if(focused.nextId)focusTask(focused.nextId);}}>Task successivo</button>
      </div>
    </div>}
    {!compact&&!focused&&<div className="mt-4 space-y-2 rounded-lg border border-slate-400/30 p-3" aria-label="Filtri timeline">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">Cerca nei task
          <input className="field mt-1" type="search" aria-label="Cerca nei task"
            placeholder="Titolo, fase, modello, run…" value={search} maxLength={160}
            onChange={e=>setSearch(e.target.value)}/>
        </label>
        <label className="text-sm">Stato
          <select className="field mt-1" aria-label="Filtra stato task" value={statusFilter}
            onChange={e=>setStatusFilter(e.target.value as TimelineStatus)}>
            <option value="all">Tutti gli stati</option>
            <option value="running">In corso</option>
            <option value="succeeded">Completati</option>
            <option value="failed">Falliti</option>
            <option value="cancelled">Interrotti</option>
          </select>
        </label>
        <label className="text-sm">Fase
          <select className="field mt-1" aria-label="Filtra fase task" value={phaseFilter}
            onChange={e=>setPhaseFilter(e.target.value)}>
            <option value="">Tutte le fasi</option>
            {phaseOptions.map(phase=><option key={phase} value={phase}>{phase}</option>)}
          </select>
        </label>
        <label className="text-sm">Ordine
          <select className="field mt-1" aria-label="Ordina task" value={order}
            onChange={e=>setOrder(e.target.value as TimelineOrder)}>
            <option value="newest">Più recenti</option>
            <option value="oldest">Più vecchi</option>
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" aria-label="Raggruppa task per sessione"
          checked={groupByRun} onChange={e=>setGroupByRun(e.target.checked)}/>
        Raggruppa per sessione (run)
      </label>
      {groupByRun&&<p className="muted text-xs">
        Sessioni ordinate dal primo task visibile; ordine scelto conservato all'interno
        di ciascuna sessione. Task senza ID sessione separati.
      </p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="muted text-xs">{filtered.length} task trovati su {activities.length}</p>
        <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-xs dark:border-slate-700"
          onClick={()=>{setSearch("");setStatusFilter("all");setPhaseFilter("");setOrder("newest");setGroupByRun(false);focusTask("");}}>
          Azzera filtri
        </button>
      </div>
    </div>}
    {!activities.length ? <p className="muted mt-3 text-sm">Nessun task ancora eseguito per questo libro.</p> :
      <ol className="mt-4 space-y-2" aria-label="Storico task">
        {recent.map((item,index)=>{
          const group=focused?undefined:runHeaders.get(item.id);
          return <li key={item.id}>
          {group&&<div role="group" aria-label={`Sessione ${group.runId??"senza identificativo"}`}
            className="mb-2 rounded-lg border border-slate-400/50 p-3 text-sm">
            <p className="font-semibold">Sessione: <span className="break-all">
              {group.runId??"senza ID (task isolato)"}</span> · {group.summary.total} task</p>
            <p className="muted text-xs">
              Stima € parziale: {group.summary.pricedReports>0
                ?new Intl.NumberFormat("it-IT",{
                  minimumFractionDigits:4,maximumFractionDigits:6,
                }).format(group.summary.knownEstimatedEur)
                :"non determinabile"} · {group.summary.pricedReports} richieste valorizzate,
              {" "}{group.summary.uncertainAttempts} tentativi incerti.
              Non è una fattura né una stima del totale reale.
            </p>
          </div>}
          {!compact&&!focused&&<button type="button"
            className="mb-2 rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-700"
            onClick={()=>focusTask(item.id)}>Apri scheda task</button>}
          <details className="rounded-lg border border-slate-300 p-3 dark:border-slate-700"
            open={!!focused||item.status==="running"}>
            <summary className="cursor-pointer text-sm">
              <span className="font-semibold">{index+1}. {item.title}</span>
              <span className="muted ml-2 text-xs">{status(item.status)} · {new Date(item.createdAt).toLocaleString("it-IT")}</span>
              <span className="muted mt-1 block text-xs">{item.summary??item.reason}</span>
            </summary>
            <div className="mt-3 space-y-2 border-t border-slate-300 pt-3 text-sm dark:border-slate-700">
              <p><b>Obiettivo:</b> {item.reason}</p>
              <p><b>Prossimo:</b> {item.nextStep}</p>
              <p><b>Fase:</b> {item.phase} · <b>Esito:</b> {status(item.status)}</p>
              <p><b>Durata conclusa:</b> {completedTaskDurationSeconds(item)===undefined
                ?"Non disponibile (attività senza due istanti validi)"
                :formatTaskDuration(completedTaskDurationSeconds(item)!)}</p>
              <p className="text-xs"><b>Run:</b> {item.runId} · <b>ID task:</b> {item.id}</p>
              {item.aiRequested!==false&&<p className="text-xs"><b>Stima costo task:</b> {
                estimatedTaskCostEur(item)===undefined?"non determinabile (tariffa o usage mancanti)"
                  :new Intl.NumberFormat("it-IT",{minimumFractionDigits:4,
                    maximumFractionDigits:6}).format(estimatedTaskCostEur(item)!)+" €"
              } · Valore indicativo da tariffa storica inserita, non fatturazione effettiva.</p>}
              {item.endpointId&&<p className="muted text-xs">Endpoint: {item.endpointId} · Modello: {item.modelId??"non configurato"} · Richiesta: {item.aiRequested?"tentata":"non inviata"}</p>}
              {item.inputTokens!==undefined&&<p className="text-xs">Token input: {item.inputTokens}, output: {item.outputTokens??"N/D"}</p>}
              {item.requestedReasoningEffort&&<p className="text-xs">Reasoning richiesto: {item.requestedReasoningEffort} (non certifica il valore effettivo usato dal provider)</p>}
              {item.error&&!compact&&<p className="text-sm text-red-600 dark:text-red-300">{item.error}</p>}
              {item.output&&<details className="rounded border border-slate-400/30 p-2" open={!!focused}>
                <summary className="cursor-pointer text-sm font-semibold">Risposta AI confermata</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{item.output}</pre>
              </details>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-700"
                  onClick={()=>void inspect(item.id)}>Ispeziona richiesta e risposta</button>
                <button type="button" className="rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-700"
                  onClick={()=>onPrepareRevision(item)}>Prepara revisione da questo task</button>
              </div>
              {chosen===item.id&&<div className="space-y-2 rounded border border-slate-400/30 p-2">
                {message&&<p role="status" className="muted text-xs">{message}</p>}
                {inspectionEnabled&&trace?.bookId===bookId&&trace.activityId===item.id&&<div className="space-y-3">
                  <p className="muted text-xs">Registro privato del browser, non nei backup o su GitHub. {trace.truncated?"Contenuti troncati ai limiti locali.":"Nessun troncamento applicato."}</p>
                  <details><summary className="cursor-pointer font-semibold">Messaggio system inviato</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{trace.systemPrompt}</pre></details>
                  <details><summary className="cursor-pointer font-semibold">Messaggio user inviato</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{trace.userPrompt}</pre></details>
                  {trace.reasoning&&<details><summary className="cursor-pointer font-semibold">Reasoning reso disponibile dal provider</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{trace.reasoning}</pre></details>}
                  {trace.response&&<details><summary className="cursor-pointer font-semibold">Risposta modello restituita</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{trace.response}</pre></details>}
                </div>}
              </div>}
              <p className="muted text-xs">La revisione usa il sistema di correzioni supervisionate del libro attuale: non ripristina automaticamente il checkpoint storico. Il vero rewind controllato è tracciato nella issue #158.</p>
            </div>
          </details>
        </li>;})}
      </ol>}
    {!compact&&activities.length>0&&recent.length===0&&<p className="muted mt-3 text-sm">
      Nessun task corrisponde ai filtri attivi. Modifica i filtri oppure premi «Azzera filtri».
    </p>}
    {compact&&activities.length>recent.length&&<p className="muted mt-3 text-xs">Mostrati gli ultimi {recent.length} task. Apri Attività per lo storico completo.</p>}
    {compact&&onOpenFull&&<button type="button" className="mt-3 rounded-lg border border-slate-400 px-3 py-2 text-sm dark:border-slate-700"
      onClick={onOpenFull}>Apri registro completo e filtri</button>}
  </section>;
}
