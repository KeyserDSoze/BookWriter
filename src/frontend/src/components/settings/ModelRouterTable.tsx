import { useMemo, useState } from "react";
import { TASK_KINDS, type AppSettings, type EndpointProfile, type TaskKind, type TaskReasoning } from "../../domain/types";
import { declaredModelCapabilities } from "../../domain/model-capabilities";
import { REASONING_LEVELS, REASONING_LEVEL_LABEL, reasoningLevelSupported, reasoningSupport } from "../../domain/model-reasoning";
import { FAST_CHECK_TASKS } from "../../domain/model-routing-preset";
import { ReasoningHint, ReasoningSelect } from "../ReasoningSelect";
import { Button } from "../ui/button";
import { ModelPicker } from "./ModelPicker";

const GROUPS: Array<{ id: string; label: string; kinds: readonly TaskKind[] }> = [
  { id: "all", label: "Tutte", kinds: TASK_KINDS },
  { id: "ideation", label: "Ideazione", kinds: ["brainstorm", "validate", "audience", "adversarial", "outline"] },
  { id: "writing", label: "Scrittura", kinds: ["prose", "continuity", "consolidate", "summarize", "revision", "merge"] },
  { id: "editorial", label: "Redazione", kinds: ["chapterAudit", "chapterReaders", "chapterJudge", "chapterRepair"] },
];
const DEFAULT_CHOICE = "__default__";
const INHERIT_CHOICE = "__inherit__";

function chatModels(endpoint?: EndpointProfile): string[] {
  if (!endpoint) return [];
  return endpoint.models.filter(model => {
    const roles = declaredModelCapabilities(endpoint, model);
    return roles.length === 0 || roles.includes("chat");
  });
}

/** Per-task endpoint, model and thinking as one filterable table, with bulk edits on a selection. */
export function ModelRouterTable({ settings, setSettings, labels, notify, onRecommendedThinking }: {
  settings: AppSettings;
  setSettings: (update: React.SetStateAction<AppSettings>) => void;
  labels: Record<TaskKind, string>;
  notify: (message: string) => void;
  onRecommendedThinking: () => void;
}) {
  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [onlyCustom, setOnlyCustom] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<TaskKind>>(new Set());
  const [hintKind, setHintKind] = useState<TaskKind>("brainstorm");

  const defaultEndpoint = settings.endpoints.find(e => e.id === settings.defaultRoute.endpointId);
  const effective = (kind: TaskKind) => {
    const route = settings.taskRoutes[kind];
    const endpointId = route?.endpointId || settings.defaultRoute.endpointId;
    return { endpointId, modelId: route?.modelId || settings.defaultRoute.modelId,
      endpoint: settings.endpoints.find(e => e.id === endpointId) };
  };
  const isCustom = (kind: TaskKind) => !!settings.taskRoutes[kind] || settings.taskReasoningEfforts?.[kind] !== undefined;
  const supportOf = (kind: TaskKind) => { const e = effective(kind); return reasoningSupport(e.endpoint, e.modelId); };

  const visible = useMemo(() => {
    const kinds = GROUPS.find(g => g.id === group)?.kinds ?? TASK_KINDS;
    const needle = query.trim().toLowerCase();
    return TASK_KINDS.filter(kind => kinds.includes(kind) &&
      (!needle || labels[kind].toLowerCase().includes(needle)) &&
      (!onlyCustom || !!settings.taskRoutes[kind] || settings.taskReasoningEfforts?.[kind] !== undefined));
  }, [group, query, onlyCustom, settings.taskRoutes, settings.taskReasoningEfforts, labels]);
  const chosen = visible.filter(kind => selected.has(kind));
  const allVisibleChosen = visible.length > 0 && chosen.length === visible.length;
  const [bulk, setBulk] = useState({ endpointId: "", modelId: "", thinking: "" });
  const chosenEndpoints = new Set(chosen.map(kind => effective(kind).endpointId));
  const bulkCatalogEndpointId = bulk.endpointId || (chosenEndpoints.size === 1 ? [...chosenEndpoints][0]! : "");
  const bulkCatalogEndpoint = settings.endpoints.find(e => e.id === bulkCatalogEndpointId);
  const bulkModels = chatModels(bulkCatalogEndpoint);
  const bulkHasChange = !!(bulk.endpointId || bulk.modelId || bulk.thinking);

  function setRoute(kind: TaskKind, endpointId: string, modelId: string) {
    setSettings(s => {
      const taskRoutes = { ...s.taskRoutes };
      if (!modelId && (!endpointId || endpointId === s.defaultRoute.endpointId)) delete taskRoutes[kind];
      else taskRoutes[kind] = { endpointId: endpointId || s.defaultRoute.endpointId, modelId };
      return { ...s, taskRoutes };
    });
  }
  function toggle(kind: TaskKind, on: boolean) {
    setSelected(old => { const next = new Set(old); if (on) next.add(kind); else next.delete(kind); return next; });
  }
  /** Endpoint + model for a task after moving it to `endpointId`: keep the current model if the new
   * endpoint lists it, otherwise fall back to that endpoint's first chat model (flagged to the author). */
  function retarget(s: AppSettings, kind: TaskKind, endpointId: string, explicitModel: string): { route?: { endpointId: string; modelId: string }; adjusted: boolean } {
    const cur = s.taskRoutes[kind];
    const curEndpoint = cur?.endpointId || s.defaultRoute.endpointId;
    const isDefaultEndpoint = endpointId === s.defaultRoute.endpointId;
    const catalog = chatModels(s.endpoints.find(e => e.id === endpointId));
    let modelId = explicitModel === DEFAULT_CHOICE ? "" : explicitModel || (cur?.modelId ?? "");
    let adjusted = false;
    if (!explicitModel && endpointId !== curEndpoint) {
      const inherited = modelId || s.defaultRoute.modelId;
      if (catalog.length > 0 && !catalog.includes(inherited)) { modelId = catalog[0]!; adjusted = true; }
      else modelId = isDefaultEndpoint ? "" : inherited;
    }
    if (!modelId && isDefaultEndpoint) return { adjusted };
    return { route: { endpointId, modelId }, adjusted };
  }
  function changeRowEndpoint(kind: TaskKind, endpointId: string) {
    let adjusted: string | undefined;
    setSettings(s => {
      const taskRoutes = { ...s.taskRoutes };
      if (!endpointId) { const m = taskRoutes[kind]?.modelId ?? ""; if (m) taskRoutes[kind] = { endpointId: s.defaultRoute.endpointId, modelId: m }; else delete taskRoutes[kind]; return { ...s, taskRoutes }; }
      const result = retarget(s, kind, endpointId, "");
      if (result.route) taskRoutes[kind] = result.route; else delete taskRoutes[kind];
      if (result.adjusted) adjusted = result.route?.modelId;
      return { ...s, taskRoutes };
    });
    if (adjusted) notify(`Il modello precedente non esiste su questo endpoint: impostato «${adjusted}». Cambialo se vuoi.`);
  }
  function applyBulk() {
    if (!bulkHasChange || chosen.length === 0) return;
    const level = bulk.thinking === "" ? undefined : bulk.thinking === INHERIT_CHOICE ? null : bulk.thinking as TaskReasoning;
    const adjustedKinds: TaskKind[] = [];
    const skipped: TaskKind[] = [];
    setSettings(s => {
      const taskRoutes = { ...s.taskRoutes };
      const taskReasoningEfforts = { ...s.taskReasoningEfforts };
      for (const kind of chosen) {
        if (bulk.endpointId || bulk.modelId) {
          const endpointId = bulk.endpointId || taskRoutes[kind]?.endpointId || s.defaultRoute.endpointId;
          const result = retarget(s, kind, endpointId, bulk.modelId);
          if (result.route) taskRoutes[kind] = result.route; else delete taskRoutes[kind];
          if (result.adjusted) adjustedKinds.push(kind);
        }
        if (level !== undefined) {
          const e = s.endpoints.find(x => x.id === (taskRoutes[kind]?.endpointId || s.defaultRoute.endpointId));
          const modelId = taskRoutes[kind]?.modelId || s.defaultRoute.modelId;
          if (level === null) delete taskReasoningEfforts[kind];
          else if (reasoningLevelSupported(reasoningSupport(e, modelId), level)) taskReasoningEfforts[kind] = level;
          else skipped.push(kind);
        }
      }
      return { ...s, taskRoutes, taskReasoningEfforts };
    });
    setBulk({ endpointId: "", modelId: "", thinking: "" });
    const parts = [`Modifiche applicate a ${chosen.length} attività`];
    if (adjustedKinds.length) parts.push(`${adjustedKinds.length} non avevano il modello sul nuovo endpoint e usano il primo disponibile`);
    if (skipped.length) parts.push(`thinking non applicato a ${skipped.map(k => labels[k]).join(", ")} (modello senza quel livello)`);
    notify(parts.join("; ") + ". Il thinking non toccato resta com'era. Salva per conservare.");
  }

  return <section className="panel min-w-0 space-y-3 p-3 sm:p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h2 className="text-lg font-semibold">Router dei modelli</h2>
        <p className="muted text-xs">Una riga per attività. Lascia «Predefinito» per usare il modello predefinito; seleziona più righe per cambiare modello o thinking in un colpo solo.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onRecommendedThinking}>Applica thinking consigliato</Button>
        <Button variant="outline" onClick={() => { setGroup("all"); setSelected(new Set(FAST_CHECK_TASKS)); }}
          title="Revisori, lettori, riassunti e memoria: le chiamate più numerose, adatte a un modello piccolo e veloce">
          Seleziona i controlli
        </Button>
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Gruppo di attività">
        {GROUPS.map(g => <button key={g.id} type="button" aria-pressed={group === g.id}
          onClick={() => setGroup(g.id)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${group === g.id
            ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-400 dark:border-slate-600"}`}>{g.label}</button>)}
      </div>
      <input className="field field-sm max-w-48" aria-label="Filtra attività" placeholder="Filtra attività…"
        value={query} onChange={e => setQuery(e.target.value)} />
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={onlyCustom} onChange={e => setOnlyCustom(e.target.checked)} /> Solo personalizzate
      </label>
      <span className="muted ml-auto text-xs">{visible.length} di {TASK_KINDS.length} attività</span>
    </div>

    {chosen.length > 0 && <div className="space-y-2 rounded-lg border border-emerald-600/50 bg-emerald-50 p-2 text-xs dark:bg-emerald-950/40">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">{chosen.length} selezionate</strong>
        <span className="muted">Scegli cosa cambiare (prima l'endpoint, poi il modello), poi premi «Applica». Nulla cambia finché non applichi; deseleziona dalle caselle della tabella.</span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 font-semibold">1. Endpoint
          <select className="field field-sm w-auto" aria-label="Cambia endpoint alle attività selezionate" value={bulk.endpointId}
            onChange={e => setBulk({ ...bulk, endpointId: e.target.value, modelId: "" })}>
            <option value="">Non cambiare</option>
            {settings.endpoints.map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>)}
          </select></label>
        <label className="flex flex-col gap-0.5 font-semibold">2. Modello
          {bulkCatalogEndpoint
            ? <select className="field field-sm w-auto" aria-label="Cambia modello alle attività selezionate" value={bulk.modelId}
                onChange={e => setBulk({ ...bulk, modelId: e.target.value })}>
                <option value="">{bulk.endpointId ? "Mantieni se disponibile, altrimenti il primo" : "Non cambiare"}</option>
                {(!bulk.endpointId || bulk.endpointId === settings.defaultRoute.endpointId) &&
                  <option value={DEFAULT_CHOICE}>Predefinito (nessun override)</option>}
                {bulkModels.map(model => <option key={model} value={model}>{model}</option>)}
              </select>
            : <select className="field field-sm w-auto" aria-label="Cambia modello alle attività selezionate" value="" disabled>
                <option value="">Scegli prima l'endpoint</option>
              </select>}
        </label>
        <label className="flex flex-col gap-0.5 font-semibold">3. Thinking
          <select className="field field-sm w-auto" aria-label="Cambia thinking alle attività selezionate" value={bulk.thinking}
            onChange={e => setBulk({ ...bulk, thinking: e.target.value })}>
            <option value="">Lascia com'è</option>
            <option value={INHERIT_CHOICE}>Eredita dall'endpoint</option>
            <option value="automatic">Automatico (non inviare)</option>
            {REASONING_LEVELS.map(level => <option key={level} value={level}>{REASONING_LEVEL_LABEL[level]}</option>)}
          </select></label>
        <Button disabled={!bulkHasChange} onClick={applyBulk}>Applica a {chosen.length} attività</Button>
      </div>
      {!bulkCatalogEndpoint && <p className="muted">Le attività selezionate usano endpoint diversi: scegli un endpoint per poter assegnare un modello.</p>}
    </div>}

    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="muted border-b border-slate-300 text-left text-xs dark:border-slate-700">
            <th className="w-8 py-1 pr-2"><input type="checkbox" aria-label="Seleziona tutte le attività visibili"
              checked={allVisibleChosen}
              onChange={e => setSelected(old => {
                const next = new Set(old);
                for (const kind of visible) { if (e.target.checked) next.add(kind); else next.delete(kind); }
                return next;
              })} /></th>
            <th className="py-1 pr-2">Attività</th><th className="py-1 pr-2">Endpoint</th>
            <th className="py-1 pr-2">Modello</th><th className="py-1">Thinking</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-300 bg-slate-100/60 dark:border-slate-700 dark:bg-slate-800/40">
            <td />
            <td className="py-1.5 pr-2 font-semibold">Predefinito</td>
            <td className="py-1.5 pr-2">
              <select className="field field-sm" aria-label="Endpoint predefinito" value={settings.defaultRoute.endpointId}
                onChange={e => setSettings(s => ({ ...s, defaultRoute: { ...s.defaultRoute, endpointId: e.target.value } }))}>
                {settings.endpoints.map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>)}
              </select>
            </td>
            <td className="py-1.5 pr-2">
              <ModelPicker ariaLabel="Modello predefinito" value={settings.defaultRoute.modelId}
                models={chatModels(defaultEndpoint)}
                onChange={modelId => setSettings(s => ({ ...s, defaultRoute: { ...s.defaultRoute, modelId } }))} />
            </td>
            <td className="muted py-1.5 text-xs">per tutte le attività</td>
          </tr>
          {visible.map(kind => {
            const route = settings.taskRoutes[kind];
            const eff = effective(kind);
            return <tr key={kind} className="border-b border-slate-200 align-middle dark:border-slate-800"
              onFocusCapture={() => setHintKind(kind)}>
              <td className="py-1 pr-2"><input type="checkbox" aria-label={`Seleziona ${labels[kind]}`}
                checked={selected.has(kind)} onChange={e => toggle(kind, e.target.checked)} /></td>
              <td className="py-1 pr-2">
                <span className="font-medium">{labels[kind]}</span>
                {isCustom(kind) && <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">personalizzata</span>}
              </td>
              <td className="py-1 pr-2">
                <select className="field field-sm" aria-label={`Endpoint per ${labels[kind]}`} value={route?.endpointId ?? ""}
                  onChange={e => { setHintKind(kind); changeRowEndpoint(kind, e.target.value); }}>
                  <option value="">Predefinito</option>
                  {settings.endpoints.map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>)}
                </select>
              </td>
              <td className="py-1 pr-2">
                <ModelPicker ariaLabel={`Modello per ${labels[kind]}`} value={route?.modelId ?? ""}
                  models={chatModels(eff.endpoint)}
                  emptyLabel={settings.defaultRoute.modelId ? `Predefinito (${settings.defaultRoute.modelId})` : "Predefinito"}
                  onChange={modelId => { setHintKind(kind); setRoute(kind, route?.endpointId ?? "", modelId); }} />
              </td>
              <td className="py-1">
                <ReasoningSelect ariaLabel={`Reasoning di ${labels[kind]}`} emphasizeLevels
                  value={settings.taskReasoningEfforts?.[kind]} inheritLabel="Eredita dall'endpoint"
                  support={supportOf(kind)} compact
                  onChange={value => {
                    setHintKind(kind);
                    setSettings(s => {
                      const next = { ...s.taskReasoningEfforts };
                      if (value === undefined) delete next[kind]; else next[kind] = value;
                      return { ...s, taskReasoningEfforts: next };
                    });
                  }} />
              </td>
            </tr>;
          })}
          {visible.length === 0 && <tr><td colSpan={5} className="muted py-4 text-center text-xs">Nessuna attività corrisponde ai filtri.</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="text-xs">
      <span className="font-semibold">{labels[hintKind]}:</span>
      <ReasoningHint value={settings.taskReasoningEfforts?.[hintKind]} support={supportOf(hintKind)}
        modelId={effective(hintKind).modelId} />
    </div>
  </section>;
}
