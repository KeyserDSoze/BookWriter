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
  function bulkModel(modelId: string) {
    if (!modelId || chosen.length === 0) return;
    setSettings(s => {
      const taskRoutes = { ...s.taskRoutes };
      for (const kind of chosen) {
        const endpointId = taskRoutes[kind]?.endpointId ?? "";
        const model = modelId === DEFAULT_CHOICE ? "" : modelId;
        if (!model && (!endpointId || endpointId === s.defaultRoute.endpointId)) delete taskRoutes[kind];
        else taskRoutes[kind] = { endpointId: endpointId || s.defaultRoute.endpointId, modelId: model };
      }
      return { ...s, taskRoutes };
    });
    notify(`Modello ${modelId === DEFAULT_CHOICE ? "predefinito ripristinato" : "«" + modelId + "» assegnato"} a ${chosen.length} attività; il thinking non è cambiato. Salva per conservarlo.`);
  }
  function bulkEndpoint(endpointId: string) {
    if (!endpointId || chosen.length === 0) return;
    setSettings(s => {
      const taskRoutes = { ...s.taskRoutes };
      for (const kind of chosen) {
        const model = taskRoutes[kind]?.modelId ?? "";
        if (!model && endpointId === s.defaultRoute.endpointId) delete taskRoutes[kind];
        else taskRoutes[kind] = { endpointId, modelId: model };
      }
      return { ...s, taskRoutes };
    });
    notify(`Endpoint cambiato per ${chosen.length} attività. Salva per conservarlo.`);
  }
  function bulkThinking(choice: string) {
    if (!choice || chosen.length === 0) return;
    const level = choice === INHERIT_CHOICE ? undefined : choice as TaskReasoning;
    const skipped: TaskKind[] = [];
    const applied: TaskKind[] = [];
    for (const kind of chosen) (level === undefined || reasoningLevelSupported(supportOf(kind), level) ? applied : skipped).push(kind);
    setSettings(s => {
      const taskReasoningEfforts = { ...s.taskReasoningEfforts };
      for (const kind of applied) { if (level === undefined) delete taskReasoningEfforts[kind]; else taskReasoningEfforts[kind] = level; }
      return { ...s, taskReasoningEfforts };
    });
    notify(`Thinking ${level === undefined ? "ereditato" : REASONING_LEVEL_LABEL[level as keyof typeof REASONING_LEVEL_LABEL] ?? "automatico"} per ${applied.length} attività` +
      (skipped.length ? `; ${skipped.length} saltate perché il loro modello non lo supporta (${skipped.map(k => labels[k]).join(", ")})` : "") +
      ". Salva per conservarlo.");
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

    {chosen.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-600/50 bg-emerald-50 p-2 text-xs dark:bg-emerald-950/40">
      <strong className="text-sm">{chosen.length} selezionate</strong>
      <label className="flex items-center gap-1">Modello
        <select className="field field-sm w-auto" aria-label="Cambia modello alle attività selezionate" value=""
          onChange={e => bulkModel(e.target.value)}>
          <option value="">Scegli…</option>
          <option value={DEFAULT_CHOICE}>Predefinito (nessun override)</option>
          {chatModels(defaultEndpoint).map(model => <option key={model} value={model}>{model}</option>)}
        </select></label>
      <label className="flex items-center gap-1">Endpoint
        <select className="field field-sm w-auto" aria-label="Cambia endpoint alle attività selezionate" value=""
          onChange={e => bulkEndpoint(e.target.value)}>
          <option value="">Scegli…</option>
          {settings.endpoints.map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>)}
        </select></label>
      <label className="flex items-center gap-1">Thinking
        <select className="field field-sm w-auto" aria-label="Cambia thinking alle attività selezionate" value=""
          onChange={e => bulkThinking(e.target.value)}>
          <option value="">Scegli…</option>
          <option value={INHERIT_CHOICE}>Eredita dall'endpoint</option>
          <option value="automatic">Automatico (non inviare)</option>
          {REASONING_LEVELS.map(level => <option key={level} value={level}>{REASONING_LEVEL_LABEL[level]}</option>)}
        </select></label>
      <Button variant="outline" onClick={() => setSelected(new Set())}>Deseleziona</Button>
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
                  onChange={e => { setHintKind(kind); setRoute(kind, e.target.value, route?.modelId ?? ""); }}>
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
