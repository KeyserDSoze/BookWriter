import { useEffect, useState } from "react";
import type { LiveAiTrace } from "../infrastructure/ai-observability";

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
export function LiveTaskStream({ active, inspectionEnabled }: { active: LiveAiTrace; inspectionEnabled: boolean }) {
  const elapsed = useElapsedSeconds(active.startedAt, active.endedAt);
  return <div role="region" aria-label="Streaming task corrente"
    className="mt-3 space-y-2 rounded-lg border border-emerald-600/40 p-3">
    <p className="font-semibold">{active.title}</p>
    <p className="text-sm" aria-live="polite">{liveStageText(active)}</p>
    {active.error && <p role="alert" className="text-sm text-red-500 dark:text-red-300">{active.error}</p>}
    {inspectionEnabled && active.reasoningPreview && <details className="rounded-lg border border-slate-400/30 p-2" open>
      <summary className="cursor-pointer text-sm font-semibold">Reasoning trasmesso dal provider (provvisorio)</summary>
      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words text-xs">{active.reasoningPreview}</pre>
    </details>}
    {inspectionEnabled && active.textPreview && <div>
      <p className="text-sm font-semibold">Risposta in streaming — non ancora approvata</p>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{active.textPreview}</pre>
    </div>}
    {!inspectionEnabled && <p className="muted text-xs">Per vedere il testo mentre viene scritto e i prompt completi abilita «Ispezione locale richieste AI» nelle Impostazioni. Contiene dati potenzialmente riservati.</p>}
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
