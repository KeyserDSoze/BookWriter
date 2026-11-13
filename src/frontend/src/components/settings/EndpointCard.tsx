import { RefreshCw } from "lucide-react";
import type { AppSettings, EndpointProfile } from "../../domain/types";
import { reasoningSupport } from "../../domain/model-reasoning";
import { endpointAutoRetry } from "../../application/auto-retry";
import { DEFAULT_CHAT_HEADER_TIMEOUT_SECONDS, MAX_CHAT_HEADER_TIMEOUT_SECONDS, MIN_CHAT_HEADER_TIMEOUT_SECONDS } from "../../infrastructure/ai-header-timeout";
import { ReasoningSelect } from "../ReasoningSelect";
import { Button } from "../ui/button";

function F({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return <label className={`block min-w-0 ${className}`}>
    <span className="mb-0.5 block text-xs font-semibold">{label}</span>{children}
    {hint && <span className="muted mt-0.5 block text-[11px]">{hint}</span>}
  </label>;
}

/** One endpoint: the few fields everybody needs up front, everything else under «Opzioni avanzate». */
export function EndpointCard({ endpoint, settings, keyDraft, onKeyDraft, onUpdate, onDiscover, onRemove }: {
  endpoint: EndpointProfile; settings: AppSettings; keyDraft: string;
  onKeyDraft: (value: string) => void;
  onUpdate: (update: Partial<EndpointProfile>) => void;
  onDiscover: () => void;
  onRemove?: () => void;
}) {
  const retry = endpointAutoRetry(endpoint);
  const isDefault = settings.defaultRoute.endpointId === endpoint.id;
  const defaultModel = isDefault ? settings.defaultRoute.modelId : "";
  const local = endpoint.authMode === "none";
  return <div className="space-y-2 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <F label="Nome endpoint"><input className="field field-sm" value={endpoint.name} onChange={e => onUpdate({ name: e.target.value })} /></F>
      <F label="Base URL" className="lg:col-span-2"><input className="field field-sm" inputMode="url" value={endpoint.baseUrl} onChange={e => onUpdate({ baseUrl: e.target.value })} /></F>
      <div className="block min-w-0">
        <label className="mb-0.5 block text-xs font-semibold" htmlFor={`endpoint-auth-${endpoint.id}`}>Autenticazione AI</label>
        <select id={`endpoint-auth-${endpoint.id}`} className="field field-sm" value={endpoint.authMode ?? "api_key"}
          onChange={e => onUpdate({ authMode: e.target.value as "api_key" | "none" })}>
          <option value="api_key">API key (Bearer)</option>
          <option value="none">Nessuna (solo localhost)</option>
        </select>
      </div>
      {!local && <F label={endpoint.secret ? "Nuova API key (opzionale; già salvata)" : "API key"}>
        <input type="password" className="field field-sm" autoComplete="off" value={keyDraft} onChange={e => onKeyDraft(e.target.value)}
          placeholder={endpoint.secret ? "••••••••••" : "Inserisci la chiave"} />
      </F>}
      <F label="Modelli rilevati / manuali" className={local ? "lg:col-span-3" : "lg:col-span-2"}
        hint="Alimentano i menu a tendina del router. «Leggi /models» li scarica dal provider.">
        <input className="field field-sm" value={endpoint.models.join(", ")} placeholder="es. model-a, model-b"
          onChange={e => onUpdate({ models: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })} />
      </F>
      <div className="flex items-end gap-2">
        <Button variant="outline" onClick={onDiscover}><RefreshCw size={16} /> Leggi /models</Button>
        {onRemove && <Button variant="destructive" onClick={onRemove}>Rimuovi</Button>}
      </div>
    </div>

    <details className="rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700">
      <summary className="cursor-pointer text-sm font-semibold">Opzioni avanzate</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <F label="Protocollo AI per le richieste Chat">
          <select className="field field-sm" value={endpoint.apiProtocol ?? "openai"}
            onChange={e => onUpdate({ apiProtocol: e.target.value as "openai" | "lmstudio_native" })}>
            <option value="openai">OpenAI-compatible /v1/chat/completions</option>
            <option value="lmstudio_native">LM Studio nativo /api/v1/chat (solo localhost)</option>
          </select>
        </F>
        <F label="Streaming Chat Completions">
          <select className="field field-sm" value={endpoint.streamMode ?? (local ? "sse" : "off")}
            onChange={e => onUpdate({ streamMode: e.target.value as "off" | "sse" })}>
            <option value="off">Compatibilità JSON (nessuno streaming)</option>
            <option value="sse">Streaming SSE (provider compatibile)</option>
          </select>
        </F>
        <F label="Tempo massimo senza dati dallo streaming (secondi)" hint="Si azzera a ogni dato ricevuto.">
          <input className="field field-sm" type="number" min={600} max={3600} step={300}
            value={endpoint.streamTimeoutSeconds ?? 600}
            onChange={e => onUpdate({ streamTimeoutSeconds: Number(e.target.value) })} />
        </F>
        <F label="Attesa massima header AI (secondi)">
          <input className="field field-sm" type="number" min={MIN_CHAT_HEADER_TIMEOUT_SECONDS}
            max={MAX_CHAT_HEADER_TIMEOUT_SECONDS} step={60}
            value={endpoint.headerTimeoutSeconds ?? DEFAULT_CHAT_HEADER_TIMEOUT_SECONDS}
            onChange={e => onUpdate({ headerTimeoutSeconds: Number(e.target.value) })} />
        </F>
        <F label="Parametro limite output API">
          <select className="field field-sm" value={endpoint.outputTokenParameter ?? "max_tokens"}
            onChange={e => onUpdate({ outputTokenParameter: e.target.value as "max_tokens" | "max_completion_tokens" })}>
            <option value="max_tokens">max_tokens (compatibilità precedente)</option>
            <option value="max_completion_tokens">max_completion_tokens (modelli compatibili)</option>
          </select>
        </F>
        <div className="min-w-0">
          <label className="mb-0.5 block text-xs font-semibold" htmlFor={`endpoint-reasoning-${endpoint.id}`}>Reasoning effort AI</label>
          <ReasoningSelect id={`endpoint-reasoning-${endpoint.id}`} hideAutomatic compact
            value={endpoint.reasoningEffort} inheritLabel="Automatico (non inviare parametro)"
            support={reasoningSupport(endpoint, defaultModel)}
            onChange={value => onUpdate({ reasoningEffort: value as "low" | "medium" | "high" | "xhigh" | undefined })} />
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <label className="flex min-w-0 items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={retry.enabled} onChange={e => onUpdate({ autoRetry: e.target.checked })} />
          <span>Ritenta da solo i task falliti, così l'autopilot può proseguire senza supervisione.
            {local ? " Endpoint locale senza chiave: i tentativi non hanno costo."
              : " Attenzione: su un provider con chiave ogni tentativo può essere fatturato, anche se fallisce; tra un tentativo e l'altro c'è una pausa crescente."}
            {" "}Non ritenta errori di credenziali o configurazione, né oltre il budget AI.</span>
        </label>
        {retry.enabled && <label className="flex items-center gap-2 text-sm">Tentativi massimi per task
          <select className="field field-sm w-24" aria-label={`Tentativi massimi per ${endpoint.name}`} value={retry.max}
            onChange={e => onUpdate({ autoRetryMax: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>}
      </div>

      {endpoint.apiProtocol === "lmstudio_native" && <p className="muted mt-2 text-xs">
        Modalità nativa: una sola richiesta SSE a /api/v1/chat con store:false; mostra caricamento modello, avanzamento prompt e reasoning solo quando LM Studio li trasmette.
        Il parametro è reasoning (Low/Medium/High; xhigh non supportato). Nessun tool, plugin o salvataggio della conversazione.
      </p>}
      <details className="mt-2">
        <summary className="muted cursor-pointer text-xs font-semibold">Guida e avvertenze</summary>
        <p className="muted mt-1 text-xs">Per LM Studio imposta http://localhost:1234/v1 e «Nessuna» autenticazione (solo localhost/127.0.0.1): al salvataggio la chiave precedente viene eliminata e Authorization omesso. Abilita CORS nel server locale e non esporre un server senza autenticazione in rete. Il parametro limite output si invia solo quando il budget AI imposta il tetto: se il provider lo rifiuta, correggi la scelta e riprova a mano. max_completion_tokens può includere token di ragionamento non visibili. L'attesa degli header va da 60 a 1800 s (default 300); la lettura JSON ha un limite separato di 60 s; lo stream SSE si interrompe dopo il tempo senza dati indicato (600–3600 s) e puoi sempre fermarlo a mano. Un timeout non esclude addebiti. reasoning_effort OpenAI-compatible è facoltativo e può essere ignorato; la API LM Studio nativa usa invece reasoning. Per diagnosticare il Network controlla la scheda che ospita BookWriter.</p>
      </details>
    </details>
  </div>;
}
