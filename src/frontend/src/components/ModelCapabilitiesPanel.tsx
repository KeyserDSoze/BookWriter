import { useMemo, useState } from "react";
import type { AppSettings, AuxiliaryModelCapability, ModelCapability, ModelRoute } from "../domain/types";
import {
  AUXILIARY_MODEL_CAPABILITIES, MODEL_CAPABILITIES, MODEL_CAPABILITY_LABELS,
  declaredModelCapabilities, sameModelRoute, withModelCapability,
} from "../domain/model-capabilities";

interface Props {
  settings: AppSettings;
  updateSettings: (update: (current: AppSettings) => AppSettings) => void;
}

const PAGE_SIZE = 20;
type CatalogItem = { endpointId: string; endpointName: string; modelId: string; route: ModelRoute };
function routeValue(route: ModelRoute): string {
  return JSON.stringify([route.endpointId, route.modelId]);
}

/** Model metadata is solely an author's declaration; /models does not attest
 * capability. No provider requests are initiated when tagging a model. */
export function ModelCapabilitiesPanel({ settings, updateSettings }: Props) {
  const [filter, setFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const models = useMemo<CatalogItem[]>(() => settings.endpoints.flatMap(endpoint =>
    [...new Set(endpoint.models)].map(modelId => ({
      endpointId: endpoint.id, endpointName: endpoint.name, modelId,
      route: { endpointId: endpoint.id, modelId },
    })),
  ), [settings.endpoints]);
  const visible = models.filter(model =>
    `${model.endpointName} ${model.modelId}`.toLocaleLowerCase("it")
      .includes(filter.trim().toLocaleLowerCase("it")));
  const tagged = (item: CatalogItem, role: ModelCapability): boolean =>
    declaredModelCapabilities(settings.endpoints.find(e => e.id === item.endpointId)!, item.modelId)
      .includes(role);

  const updateTag = (item: CatalogItem, role: ModelCapability, enabled: boolean) => {
    updateSettings(current => {
      const next: AppSettings = {
        ...current,
        endpoints: current.endpoints.map(endpoint => endpoint.id === item.endpointId
          ? withModelCapability(endpoint, item.modelId, role, enabled) : endpoint),
      };
      if (!enabled && role === "chat" && sameModelRoute(current.defaultRoute, item.route))
        next.defaultRoute = { endpointId: item.endpointId, modelId: "" };
      if (!enabled && role !== "chat" && sameModelRoute(current.capabilityRoutes?.[role], item.route)) {
        const routes = { ...current.capabilityRoutes };
        delete routes[role];
        next.capabilityRoutes = routes;
      }
      return next;
    });
  };

  const updateAuxiliaryRoute = (role: AuxiliaryModelCapability, choice: string) => {
    const candidate = models.find(model =>
      routeValue(model.route) === choice && tagged(model, role));
    updateSettings(current => {
      const routes = { ...current.capabilityRoutes };
      if (candidate) routes[role] = candidate.route;
      else delete routes[role];
      return { ...current, capabilityRoutes: routes };
    });
  };

  return <section className="panel min-w-0 p-4 sm:p-5" aria-label="Ruoli dei modelli AI">
    <h2 className="text-lg font-semibold">Ruoli dei modelli AI</h2>
    <p className="muted mt-1 text-sm">
      Assegna manualmente uno o più tag a ogni modello letto da /models.
      I tag non sono verificati dal provider e non abilitano automaticamente API di voce,
      embedding o tool calling. Il router Chat / scrittura usa ancora il modello predefinito
      e gli override delle attività.
    </p>
    {models.length === 0 ? <p className="muted mt-4 text-sm">Leggi /models o inserisci manualmente gli ID dei modelli per assegnare i ruoli.</p> : <>
      <div className="mt-4">
        <label className="mb-1 block text-sm font-semibold" htmlFor="model-capability-search">Cerca modello</label>
        <input id="model-capability-search" className="field" value={filter}
          onChange={e => { setFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}
          placeholder="Filtra per nome o endpoint" />
      </div>
      <p className="muted mt-2 text-xs">{visible.length} modelli visualizzabili su {models.length} configurati.</p>
      <div className="mt-3 space-y-3">
        {visible.slice(0, visibleCount).map(item =>
          <fieldset key={routeValue(item.route)}
            aria-label={`Ruoli per ${item.modelId} (${item.endpointName})`}
            className="min-w-0 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
            <legend className="sr-only">{item.modelId}</legend>
            <p className="break-all text-sm font-semibold">{item.modelId}</p>
            <p className="muted text-xs">{item.endpointName}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
              {MODEL_CAPABILITIES.map(role =>
                <label key={role} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4"
                    checked={tagged(item, role)}
                    onChange={e => updateTag(item, role, e.target.checked)} />
                  {MODEL_CAPABILITY_LABELS[role]}
                </label>)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {sameModelRoute(settings.defaultRoute, item.route)
                ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Predefinito per Chat / scrittura</span>
                : tagged(item, "chat") &&
                  <button className="rounded border border-slate-400 px-3 py-1.5 text-xs dark:border-slate-600"
                    type="button" onClick={() => updateSettings(current => ({
                      ...current, defaultRoute: item.route,
                    }))}>Usa come predefinito Chat</button>}
            </div>
          </fieldset>)}
        {visible.length === 0 && <p className="muted text-sm">Nessun modello corrisponde alla ricerca.</p>}
        {visible.length > visibleCount &&
          <button className="rounded border border-slate-400 px-3 py-2 text-sm dark:border-slate-600"
            type="button" onClick={() => setVisibleCount(n => n + PAGE_SIZE)}>
            Mostra altri modelli ({visible.length - visibleCount} rimanenti)
          </button>}
      </div>
    </>}
    <div className="mt-5 border-t border-slate-300 pt-4 dark:border-slate-700">
      <h3 className="font-semibold">Modelli predefiniti per capacità future</h3>
      <p className="muted mt-1 text-xs">
        Queste scelte sono salvate per i futuri flussi di lavoro.
        Non generano ancora voce, vettori embedding o chiamate a strumenti.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {AUXILIARY_MODEL_CAPABILITIES.map(role => {
          const current = settings.capabilityRoutes?.[role];
          const choices = models.filter(model => tagged(model, role));
          const stale = current && !choices.some(model => sameModelRoute(current, model.route));
          return <div key={role} className="min-w-0">
            <label htmlFor={`model-default-${role}`} className="mb-1 block text-sm font-semibold">
              Predefinito {MODEL_CAPABILITY_LABELS[role]}
            </label>
            <select id={`model-default-${role}`} className="field min-w-0"
              value={current ? routeValue(current) : ""}
              onChange={e => updateAuxiliaryRoute(role, e.target.value)}>
              <option value="">Nessuno</option>
              {stale && <option value={routeValue(current)}>Non disponibile: {current.modelId}</option>}
              {choices.map(model => <option key={routeValue(model.route)} value={routeValue(model.route)}>
                {model.endpointName}: {model.modelId}
              </option>)}
            </select>
          </div>;
        })}
      </div>
    </div>
  </section>;
}
