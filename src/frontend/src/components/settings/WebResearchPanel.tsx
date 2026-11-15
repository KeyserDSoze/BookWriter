import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Globe, Search, ShieldCheck, Sparkles } from "lucide-react";
import type { AppSettings, BookProject } from "../../domain/types";
import { defaultWebResearchSettings, RESEARCH_AGENTS, RESEARCH_AGENT_LABELS, type ResearchEntry, type WebResearchSettings } from "../../domain/web-research";
import { researchRoute, testWebResearch, updateWebResearchSettings } from "../../application/web-research";
import { Button } from "../ui/button";
import { Badge, Segmented, Switch } from "../ui/primitives";
import { ModelPicker } from "./ModelPicker";

const CONSENT = "Attivare la ricerca web per questo libro?\n\nQuando gli manca un'informazione, l'AI potrà chiedere ricerche al servizio scelto (il modello di ricerca o Wikipedia). Le domande possono contenere nomi, luoghi, epoche o temi del libro e lasciano il dispositivo. Le query che citano i tuoi segreti vengono bloccate prima dell'invio, ma non è un anonimizzatore.\n\nOgni ricerca con il modello è una chiamata AI a pagamento, registrata nelle Attività e nel registro delle ricerche. I risultati sono dati esterni non verificati: non diventano fatti del canone e le fonti storiche del dossier restano quelle scelte da te.";

export function SourceList({ sources }: { sources: ResearchEntry["sources"] }) {
  if (!sources.length) return <p className="muted text-xs">Nessuna fonte indicata.</p>;
  return <ul className="space-y-1.5">{sources.map(source => <li key={source.url} className="text-xs">
    <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-semibold text-sky-700 underline-offset-2 hover:underline dark:text-sky-300 [overflow-wrap:anywhere]">
      {source.title}<ExternalLink size={12} aria-hidden/></a>
    <span className="muted block [overflow-wrap:anywhere]">{new URL(source.url).hostname}{source.excerpt ? " · " + source.excerpt : ""}</span>
  </li>)}</ul>;
}

/** Per-book consent and limits for the autopilot's web research, plus a quick test. */
export function WebResearchPanel({ book, settings, onRefresh, onRoute }: {
  book: BookProject; settings: AppSettings; onRefresh: () => Promise<void>;
  onRoute: (endpointId: string, modelId: string) => void;
}) {
  const saved = book.webResearch;
  const [draft, setDraft] = useState<WebResearchSettings | undefined>(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ResearchEntry>();
  const mounted = useRef(true);
  const testing = useRef<AbortController | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; testing.current?.abort(); }; }, []);
  useEffect(() => { setDraft(book.webResearch); setMessage(""); setResult(undefined); }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const route = researchRoute(settings, book);
  const bookRoute = book.modelRoutes?.research;
  const endpointId = bookRoute?.endpointId || settings.taskRoutes.research?.endpointId || settings.endpoints[0]?.id || "";
  const endpoint = settings.endpoints.find(e => e.id === endpointId);
  const models = useMemo(() => endpoint?.models ?? [], [endpoint]);
  async function save(next: WebResearchSettings | undefined, success: string) {
    setBusy(true); setMessage("");
    try { await updateWebResearchSettings(book.id, next, book.updatedAt); await onRefresh(); if (mounted.current) { setDraft(next); setMessage(success); } }
    catch (error) { await onRefresh().catch(() => undefined); if (mounted.current) setMessage(error instanceof Error ? error.message : "Impostazioni non salvate."); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function enable() {
    if (!window.confirm(CONSENT)) return;
    await save(saved ? { ...saved, enabled: true, consentAt: new Date().toISOString() } : defaultWebResearchSettings(new Date().toISOString()),
      "Ricerca web attiva: l'AI la userà solo quando le manca un'informazione.");
  }
  async function runTest() {
    testing.current?.abort();
    const controller = new AbortController(); testing.current = controller;
    setBusy(true); setMessage(""); setResult(undefined);
    try {
      const entry = await testWebResearch(book.id, query, controller);
      await onRefresh();
      if (mounted.current) setResult(entry);
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "Ricerca non riuscita."); }
    finally { if (mounted.current) setBusy(false); }
  }
  const patch = (value: Partial<WebResearchSettings>) => setDraft(old => old ? { ...old, ...value } : old);
  return <section className="panel min-w-0 overflow-hidden" aria-label="Ricerca web dell'AI">
    <div className="space-y-2 border-b border-slate-300 p-3 sm:p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Globe size={19} className="text-sky-600 dark:text-sky-300"/> Ricerca web dell'AI</h2>
          <p className="muted text-sm">Quando non sa qualcosa (un dettaglio storico, tecnico, geografico) l'AI può cercarlo sul web invece di inventarlo, poi riprende il lavoro con i risultati.</p>
        </div>
        <Badge tone={saved?.enabled ? "emerald" : "neutral"}>{saved?.enabled ? "Attiva" : "Spenta"}</Badge>
      </div>
    </div>
    <div className="space-y-4 p-3 sm:p-4">
      {!saved?.enabled ? <div className="space-y-3 rounded-xl border border-dashed border-sky-500/50 bg-sky-500/5 p-4">
        <ul className="space-y-1.5 text-sm">
          <li className="flex gap-2"><Search size={16} className="mt-0.5 shrink-0 text-sky-600"/> Cerca solo quando gli serve, con al massimo poche domande per compito.</li>
          <li className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-600"/> Le domande che citano i tuoi segreti non partono; i lettori ciechi non cercano mai.</li>
          <li className="flex gap-2"><Sparkles size={16} className="mt-0.5 shrink-0 text-violet-600"/> Ogni ricerca resta nel registro, con le fonti: nulla diventa canone da solo.</li>
        </ul>
        <Button disabled={busy} onClick={() => void enable()}><Globe size={16}/> Attiva la ricerca web</Button>
      </div> : draft && <>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1"><p className="text-sm font-semibold">Con che cosa cercare</p>
              <Segmented label="Con che cosa cercare" value={draft.provider} disabled={busy} onChange={provider => patch({ provider })}
                options={[{ value: "model", label: "Modello di ricerca", hint: "Un modello che cerca davvero sul web" }, { value: "wikipedia", label: "Wikipedia", hint: "Gratis, senza chiave" }]}/></div>
            {draft.provider === "model" ? <div className="space-y-1.5 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
              <p className="text-sm font-semibold">Modello di ricerca</p>
              <p className="muted text-xs">Scegli un modello che naviga davvero, per esempio Perplexity Sonar, un modello OpenRouter «:online» o un modello OpenAI «search». Un modello normale risponderebbe a memoria.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs">Endpoint<select aria-label="Endpoint del modello di ricerca" className="field field-sm mt-1" disabled={busy || book.status === "running"} value={endpointId}
                  onChange={e => onRoute(e.target.value, bookRoute?.modelId ?? "")}>
                  {settings.endpoints.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
                <label className="text-xs">Modello<ModelPicker ariaLabel="Modello di ricerca del libro" models={models} disabled={busy || book.status === "running"}
                  value={bookRoute?.modelId ?? ""} emptyLabel={settings.taskRoutes.research?.modelId ? "Predefinito: " + settings.taskRoutes.research.modelId : "Scegli il modello"}
                  commitOnBlur resetKey={book.updatedAt} onChange={modelId => onRoute(endpointId, modelId)}/></label>
              </div>
              {route ? <p className="text-xs text-emerald-700 dark:text-emerald-300">In uso: <b>{route.modelId}</b>{bookRoute ? " (solo per questo libro)" : " (predefinito nel router)"}</p>
                : <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">Nessun modello di ricerca scelto: le ricerche falliranno finché non lo imposti qui o nel router («Ricerca web»).</p>}
            </div> : <label className="block text-sm">Lingua di Wikipedia<select aria-label="Lingua di Wikipedia" className="field mt-1" disabled={busy} value={draft.wikipediaLanguage}
              onChange={e => patch({ wikipediaLanguage: e.target.value as "it" | "en" })}><option value="it">Italiano (it.wikipedia.org)</option><option value="en">Inglese (en.wikipedia.org)</option></select></label>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1"><p className="text-sm font-semibold">Domande per compito</p>
                <Segmented<string> label="Domande per compito" value={String(draft.maxQueriesPerTask)} disabled={busy} onChange={v => patch({ maxQueriesPerTask: Number(v) })}
                  options={["1", "2", "3", "4", "6"].map(v => ({ value: v, label: v }))}/></div>
              <div className="space-y-1"><p className="text-sm font-semibold">Ricerche per compito</p>
                <Segmented<string> label="Ricerche per compito" value={String(draft.maxRounds)} disabled={busy} onChange={v => patch({ maxRounds: Number(v) })}
                  options={[{ value: "1", label: "1 giro" }, { value: "2", label: "2 giri" }, { value: "3", label: "3 giri" }]}/></div>
            </div>
            <label className="block text-sm">Riusa risultati già trovati<select aria-label="Riusa risultati già trovati" className="field mt-1" disabled={busy} value={draft.cacheDays}
              onChange={e => patch({ cacheDays: Number(e.target.value) })}>
              <option value={0}>Mai (cerca sempre di nuovo)</option><option value={7}>Fino a 7 giorni</option><option value={30}>Fino a 30 giorni</option><option value={90}>Fino a 90 giorni</option></select></label>
          </div>
          <fieldset className="space-y-1 rounded-xl border border-slate-300 p-3 dark:border-slate-700">
            <legend className="px-1 text-sm font-semibold">Chi può cercare</legend>
            {RESEARCH_AGENTS.map(agent => <Switch key={agent} label={RESEARCH_AGENT_LABELS[agent].label} description={RESEARCH_AGENT_LABELS[agent].hint}
              checked={draft.agents.includes(agent)} disabled={busy}
              onChange={on => patch({ agents: on ? RESEARCH_AGENTS.filter(a => a === agent || draft.agents.includes(a)) : draft.agents.filter(a => a !== agent) })}/>)}
            <p className="muted pt-1 text-xs">I cinque lettori ciechi e la rilettura dello scrittore non cercano mai: leggono come un lettore, senza fonti esterne.</p>
          </fieldset>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || !dirty} onClick={() => void save(draft, "Impostazioni della ricerca salvate.")}>Salva la ricerca web</Button>
          <Button variant="outline" disabled={busy || !dirty} onClick={() => setDraft(saved)}>Annulla modifiche</Button>
          <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Spegnere la ricerca web per questo libro? Le ricerche già fatte restano nel registro.")) void save({ ...draft, enabled: false }, "Ricerca web spenta."); }}>Spegni la ricerca web</Button>
          {dirty && <Badge tone="amber">Modifiche non salvate</Badge>}
        </div>
        <form className="space-y-2 rounded-xl border border-slate-300 p-3 dark:border-slate-700" onSubmit={event => { event.preventDefault(); void runTest(); }}>
          <label className="block text-sm"><span className="font-semibold">Prova una ricerca</span>
            <span className="muted block text-xs">Usa le impostazioni salvate; la ricerca resta nel registro e, con il modello, è una chiamata AI.</span>
            <input className="field mt-1" value={query} maxLength={200} placeholder="es. orari dei treni Milano–Venezia nel 1911" onChange={e => setQuery(e.target.value)}/></label>
          <Button type="submit" variant="outline" disabled={busy || dirty || query.trim().length < 3}><Search size={15}/> Cerca adesso</Button>
          {result && <div className="space-y-2 rounded-lg bg-slate-100 p-3 dark:bg-slate-900" role="status">
            <div className="flex flex-wrap gap-1.5"><Badge tone={result.status === "ok" || result.status === "cached" ? "emerald" : "rose"}>{result.status === "cached" ? "Dalla cache" : result.status === "ok" ? "Trovato" : result.status === "blocked" ? "Bloccata" : "Non riuscita"}</Badge></div>
            {result.summary && <p className="text-sm">{result.summary}</p>}
            {result.error && <p className="text-sm text-rose-700 dark:text-rose-300">{result.error}</p>}
            <SourceList sources={result.sources}/>
          </div>}
        </form>
      </>}
      {message && <p role="status" className="text-sm [overflow-wrap:anywhere]">{message}</p>}
    </div>
  </section>;
}
