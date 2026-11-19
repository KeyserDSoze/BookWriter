import { useEffect, useState } from "react";
import type { LiveAiTrace } from "@engine/infrastructure/ai-observability";
import type { BookProject } from "@engine/domain/types";
import { describeHeadline } from "@engine/domain/live-progress";
import { AiStreamText } from "./AiStreamText";
import { LiveActionFeed } from "./LiveActionFeed";

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

/** Provisional, never canonical. Always shown: what the model sends is visible while it
 * arrives, with no setting to enable. How long it stays readable afterwards is a separate
 * choice (Impostazioni → «Richieste e risposte dell'AI»). */
export function LiveTaskStream({ active, book }: { active: LiveAiTrace; book?: Pick<BookProject, "chapters"> }) {
  const elapsed = useElapsedSeconds(active.startedAt, active.endedAt);
  const cleared = active.previewClearedAt !== undefined;
  return <div role="region" aria-label="Streaming task corrente"
    className="mt-3 space-y-2 rounded-lg border border-emerald-600/40 p-3">
    <p className="font-semibold">{describeHeadline(active.title)}</p>
    <p className="text-sm" aria-live="polite">{liveStageText(active)}</p>
    <LiveActionFeed active={active} book={book} />
    {active.error && <p role="alert" className="text-sm text-red-500 dark:text-red-300">{active.error}</p>}
    {active.reasoningPreview && <details className="min-w-0 rounded-lg border border-slate-400/30 p-2" open>
      <summary className="cursor-pointer text-sm font-semibold">Reasoning trasmesso dal provider (provvisorio)</summary>
      <AiStreamText key={active.activityId+":reasoning"} text={active.reasoningPreview} label="Reasoning in arrivo"/>
    </details>}
    {active.textPreview && <div>
      <p className="text-sm font-semibold">Risposta in streaming — non ancora approvata</p>
      <AiStreamText key={active.activityId+":text"} text={active.textPreview} label="Risposta in arrivo"/>
    </div>}
    {!cleared&&(active.textCharacters>active.textPreview.length||active.reasoningCharacters>active.reasoningPreview.length)&&
      <p className="muted text-xs">Anteprima abbreviata ai limiti locali: risposta 120.000 caratteri, reasoning 20.000.</p>}
    {cleared&&!active.textPreview&&!active.reasoningPreview&&<p className="muted text-xs">
      Hai cancellato le conversazioni salvate: il testo già arrivato non si mostra più. Quello che arriva da ora ricompare qui.</p>}
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
        <p>Funzioni (tools) per consegnare il risultato: {active.toolsRequested === undefined ? "non ancora determinato"
          : !active.toolsRequested ? "non usate (testo/JSON: modello senza tag tools, opzione disattivata o compito di testo)"
          : active.toolsReplied === undefined ? "richieste a questo modello, in attesa della risposta"
          : active.toolsReplied ? "richieste: il modello ha risposto con la funzione"
          : "richieste, ma il modello ha risposto in testo"}.</p>
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
