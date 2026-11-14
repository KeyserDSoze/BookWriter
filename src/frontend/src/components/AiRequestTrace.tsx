import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { currentTaskAi, loadAiTrace, subscribeLiveAi, type AiLocalTrace } from "../infrastructure/ai-observability";
import { AiTraceReadFence } from "../domain/ai-trace-read-fence";
import { AiStreamText } from "./AiStreamText";

/** Mounted only after an explicit, identity-fenced inspection with current consent. */
export function AiRequestTrace({ trace }: {trace:AiLocalTrace}) {
  const live=useSyncExternalStore(subscribeLiveAi,()=>currentTaskAi(trace.bookId,trace.activityId));
  const [settled,setSettled]=useState<AiLocalTrace|null>(null);
  const reads=useRef(new AiTraceReadFence());
  // Continue this explicitly opened inspection after settlement. Keep the final
  // local reply visible even when newer tasks evict its volatile stream cache.
  useEffect(()=>{
    const ticket=reads.current.begin();
    if(live?.endedAt!==undefined)void loadAiTrace(trace.bookId,trace.activityId).then(saved=>{
      if(reads.current.isCurrent(ticket)&&saved)setSettled(saved);
    }).catch(()=>undefined);
    return ()=>{reads.current.invalidate();};
  },[live?.endedAt,trace.bookId,trace.activityId]);
  const saved=settled??trace;
  const visible=live?.inspect?live:null;
  const response=visible?.textPreview||saved.response;
  const reasoning=visible?.reasoningPreview||saved.reasoning;
  const truncated=saved.truncated||!!visible&&(visible.textCharacters>visible.textPreview.length||
    visible.reasoningCharacters>visible.reasoningPreview.length);
  return <div className="min-w-0 space-y-3" role="region" aria-label="Richiesta e risposta private del task">
    <p className="muted text-xs">Registro privato del browser, non nei backup o su GitHub.
      {truncated?" Contenuti troncati ai limiti locali (prompt/risposta 120.000 caratteri, reasoning 20.000).":" Nessun troncamento applicato."}</p>
    <details><summary className="min-h-11 cursor-pointer font-semibold">Messaggio system inviato</summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{trace.systemPrompt}</pre></details>
    <details><summary className="min-h-11 cursor-pointer font-semibold">Messaggio user inviato</summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{trace.userPrompt}</pre></details>
    {reasoning&&<details open><summary className="min-h-11 cursor-pointer font-semibold">Reasoning reso disponibile dal provider</summary>
      <AiStreamText text={reasoning} label="Reasoning della richiesta selezionata"/></details>}
    <div>
      <p className="font-semibold">{visible&&!visible.endedAt?"Risposta modello in arrivo — provvisoria":"Risposta modello restituita"}</p>
      <p className="muted mb-2 text-xs">Testo ricevuto dal provider, non una conferma di applicazione al libro.
        Fanno fede l'esito del task e i controlli del canone.</p>
      {response?<AiStreamText text={response} label="Risposta della richiesta selezionata"/>
        :<p className="muted text-xs">Nessun testo di risposta disponibile{visible&&!visible.endedAt?" per ora":" nella traccia locale"}.</p>}
    </div>
  </div>;
}
