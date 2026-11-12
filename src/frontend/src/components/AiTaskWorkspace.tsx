import { useEffect, useState } from "react";
import type { Activity } from "../domain/types";
import {
  loadAiTrace, type AiLocalTrace, type LiveAiTrace,
} from "../infrastructure/ai-observability";

interface Props {
  bookId: string;
  activities: Activity[];
  live: LiveAiTrace | null;
  inspectionEnabled: boolean;
  onPrepareRevision: (activity: Activity) => void;
  compact?: boolean;
}

/** Task-first, read-only inspector. Provisional tokens are NEVER canonical. */
export function AiTaskWorkspace({
  bookId, activities, live, inspectionEnabled, onPrepareRevision, compact=false,
}: Props) {
  const [chosen,setChosen]=useState("");
  const [trace,setTrace]=useState<AiLocalTrace|null>(null);
  const [message,setMessage]=useState("");
  const [clock,setClock]=useState(Date.now());
  useEffect(()=>{
    const timer=setInterval(()=>setClock(Date.now()),1000);
    return ()=>clearInterval(timer);
  },[]);
  useEffect(()=>{setChosen("");setTrace(null);setMessage("");},[bookId,inspectionEnabled]);
  const recent=compact?activities.slice(0,8):activities;
  const active=live?.bookId===bookId?live:null;
  const elapsed=active?Math.max(0,Math.floor(((active.endedAt??clock)-active.startedAt)/1000)):0;
  const inspect=async(id:string)=>{
    setChosen(id);setTrace(null);setMessage("");
    if(!inspectionEnabled) {
      setMessage("Attiva l'ispezione locale in Impostazioni per registrare le prossime richieste. Le attività precedenti non contengono il prompt integrale.");
      return;
    }
    try{
      const saved=await loadAiTrace(bookId,id);
      setTrace(saved);
      if(!saved)setMessage("Nessuna richiesta integrale conservata per questo task. L'ispezione non è retroattiva.");
    }catch{setMessage("Impossibile leggere il tracciato locale da IndexedDB.");}
  };
  const status=(s:Activity["status"])=>s==="succeeded"?"Completato":
    s==="running"?"In corso":s==="cancelled"?"Interrotto":"Fallito";
  return <section className="panel min-w-0 p-4 sm:p-5" aria-label="Timeline task AI">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">Cosa sta facendo adesso · Timeline dei task</h2>
      <span className="muted text-xs">{activities.length} attività registrate</span>
    </div>
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
    <p className="muted mt-3 text-sm">Ogni attività è separata e ispezionabile. Un output in streaming non modifica il libro finché non supera i controlli di validazione e viene confermato come canonico.</p>
    {!activities.length ? <p className="muted mt-3 text-sm">Nessun task ancora eseguito per questo libro.</p> :
      <ol className="mt-4 space-y-2" aria-label="Storico task">
        {recent.map((item,index)=><li key={item.id}>
          <details className="rounded-lg border border-slate-300 p-3 dark:border-slate-700" open={item.status==="running"}>
            <summary className="cursor-pointer text-sm">
              <span className="font-semibold">{index+1}. {item.title}</span>
              <span className="muted ml-2 text-xs">{status(item.status)} · {new Date(item.createdAt).toLocaleString("it-IT")}</span>
              <span className="muted mt-1 block text-xs">{item.summary??item.reason}</span>
            </summary>
            <div className="mt-3 space-y-2 border-t border-slate-300 pt-3 text-sm dark:border-slate-700">
              <p><b>Obiettivo:</b> {item.reason}</p>
              <p><b>Prossimo:</b> {item.nextStep}</p>
              <p><b>Fase:</b> {item.phase} · <b>Esito:</b> {status(item.status)}</p>
              {item.endpointId&&<p className="muted text-xs">Endpoint: {item.endpointId} · Modello: {item.modelId??"non configurato"} · Richiesta: {item.aiRequested?"tentata":"non inviata"}</p>}
              {item.inputTokens!==undefined&&<p className="text-xs">Token input: {item.inputTokens}, output: {item.outputTokens??"N/D"}</p>}
              {item.requestedReasoningEffort&&<p className="text-xs">Reasoning richiesto: {item.requestedReasoningEffort} (non certifica il valore effettivo usato dal provider)</p>}
              {item.error&&!compact&&<p className="text-sm text-red-600 dark:text-red-300">{item.error}</p>}
              {item.output&&<details className="rounded border border-slate-400/30 p-2">
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
                {trace&&<div className="space-y-3">
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
        </li>)}
      </ol>}
    {compact&&activities.length>recent.length&&<p className="muted mt-3 text-xs">Mostrati gli ultimi {recent.length} task. Apri Attività per lo storico completo.</p>}
  </section>;
}
