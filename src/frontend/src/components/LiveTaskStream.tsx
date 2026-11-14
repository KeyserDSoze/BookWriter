import { useEffect, useState } from "react";
import type { LiveAiTrace } from "../infrastructure/ai-observability";
import { AiStreamText } from "./AiStreamText";

/** Plain-language state of the in-flight provider request. */
export function liveStageText(active: LiveAiTrace): string {
  if (active.stage === "rifiutata") return "Risposta rifiutata: il testo non è stato applicato al libro.";
  if (active.stage === "interrotta") return "Richiesta interrotta: nessun testo applicato.";
  if (active.stage === "completata") return "Risposta ricevuta e salvata dopo i controlli.";
  if (active.providerPhase === "model_loading") return "Il modello si sta caricando in LM Studio…";
  if (active.providerPhase === "prompt_processing") return "Il modello sta leggendo il contesto…";
  if (active.providerPhase === "reasoning" || (active.reasoningCharacters > 0 && active.textCharacters === 0))
    return "Il modello sta ragionando prima di scrivere…";
  if (active.textCharacters > 0)
    return `Il modello sta scrivendo: ${active.textCharacters.toLocaleString("it-IT")} caratteri ricevuti.`;
  if (active.stage === "inviata") return "Richiesta inviata al modello: in attesa della risposta…";
  return "Il modello ha risposto: in attesa del primo testo…";
}

export function useElapsedSeconds(startedAt: number, endedAt?: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (endedAt !== undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endedAt]);
  return Math.max(0, Math.floor(((endedAt ?? now) - startedAt) / 1000));
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min ${seconds % 60} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Provisional, never canonical: previews only exist with the inspection opt-in. */
export function LiveTaskStream({ active, inspectionEnabled, onOpenInspection }: {
  active: LiveAiTrace; inspectionEnabled: boolean; onOpenInspection?:()=>void;
}) {
  const elapsed = useElapsedSeconds(active.startedAt, active.endedAt);
  const visible=inspectionEnabled&&active.inspect;
  return <div role="region" aria-label="Streaming task corrente"
    className="mt-3 space-y-2 rounded-lg border border-emerald-600/40 p-3">
    <p className="font-semibold">{active.title}</p>
    <p className="text-sm" aria-live="polite">{liveStageText(active)}</p>
    {active.error && <p role="alert" className="text-sm text-red-500 dark:text-red-300">{active.error}</p>}
    {visible && active.reasoningPreview && <details className="min-w-0 rounded-lg border border-slate-400/30 p-2" open>
      <summary className="cursor-pointer text-sm font-semibold">Reasoning trasmesso dal provider (provvisorio)</summary>
      <AiStreamText key={active.activityId+":reasoning"} text={active.reasoningPreview} label="Reasoning in arrivo"/>
    </details>}
    {visible && active.textPreview && <div>
      <p className="text-sm font-semibold">Risposta in streaming — non ancora approvata</p>
      <AiStreamText key={active.activityId+":text"} text={active.textPreview} label="Risposta in arrivo"/>
    </div>}
    {visible&&(active.textCharacters>active.textPreview.length||active.reasoningCharacters>active.reasoningPreview.length)&&
      <p className="muted text-xs">Anteprima abbreviata ai limiti locali: risposta 120.000 caratteri, reasoning 20.000.</p>}
    {!visible && <div className="space-y-1 text-xs">
      <p className="muted">Per vedere il testo mentre viene scritto e i prompt completi abilita «Ispezione locale richieste AI» nelle Impostazioni prima della prossima richiesta. Contiene dati potenzialmente riservati; non è retroattiva.</p>
      {onOpenInspection&&<button type="button" className="min-h-11 rounded-lg border border-slate-400 px-3"
        onClick={onOpenInspection}>Apri impostazioni d'ispezione</button>}
    </div>}
    <details className="text-xs">
      <summary className="muted cursor-pointer">Dettagli tecnici della richiesta</summary>
      <div className="mt-2 space-y-1">
        <p className="muted">Stato: {active.stage} · {formatElapsed(elapsed)} · Modello {active.modelId} · Endpoint {active.endpointId}</p>
        <p>Reasoning richiesto: {active.requestedReasoning ?? "automatico (nessun parametro)"} ·
          Limite streaming: {active.streamDeadlineSeconds ?? 600} secondi.</p>
        <p>
          {active.providerPhase === "model_loading" ? "LM Studio: caricamento modello" :
            active.providerPhase === "prompt_processing" ? "LM Studio: elaborazione del prompt" :
            active.providerPhase === "reasoning" ? "LM Studio: fase reasoning" :
            active.providerPhase === "message" ? "LM Studio: scrittura della risposta" :
            active.transportEvents > 0 ? "Il provider ha inviato eventi ma non necessariamente testo" :
            active.stage === "inviata" ? "Richiesta inviata: in attesa degli header HTTP" :
            "Header ricevuti: in attesa del primo evento SSE o del primo token."}
          {active.providerProgress !== undefined ? ` — ${Math.round(active.providerProgress * 100)}% (dal provider)` : ""}
        </p>
        <p className="muted">Eventi SSE ricevuti: {active.transportEvents} · Byte di rete ricevuti: {active.transportBytes}.
          {active.stage === "rifiutata" ? " Il testo non è stato applicato al libro." : ""}</p>
        <p>Output ricevuto: {active.textCharacters} caratteri.
          {active.reasoningCharacters > 0 ? ` Reasoning ricevuto: ${active.reasoningCharacters} caratteri.` :
            " Nessun contenuto di reasoning trasmesso dal provider."}
        </p>
      </div>
    </details>
  </div>;
}
