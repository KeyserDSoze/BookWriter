import { useState } from "react";
import type { AppSettings, BookProject, TaskKind, TaskReasoning } from "../../domain/types";
import { routeFor } from "../../domain/types";
import { declaredModelCapabilities } from "../../domain/model-capabilities";
import { reasoningSupport } from "../../domain/model-reasoning";
import { ReasoningSelect } from "../ReasoningSelect";
import { Button } from "../ui/button";
import { ModelPicker } from "./ModelPicker";

const BOOK_TASKS: TaskKind[] = ["brainstorm", "prose", "continuity", "revision", "consolidate", "summarize", "merge",
  "chapterAudit", "chapterReaders", "chapterJudge", "chapterRepair"];

/** A book overrides the global router only for the tasks listed in this table. */
export function bookOverridesModels(book: BookProject): boolean {
  return BOOK_TASKS.some(kind => !!book.modelRoutes?.[kind] || book.taskReasoningEfforts?.[kind] !== undefined);
}

/** Per-book overrides. Each change is a locked, revision-checked write (not part of «Salva impostazioni»). */
export function BookOverrideTable({ book, settings, labels, resets, onRoute, onReasoning, onBulkRoute, onInherit, onEditorialMode, onConcurrency }: {
  book: BookProject; settings: AppSettings; labels: Record<TaskKind, string>;
  resets: Partial<Record<TaskKind, number>>;
  onRoute: (kind: TaskKind, endpointId: string, modelId: string) => void;
  onReasoning: (kind: TaskKind, value: TaskReasoning | undefined) => void;
  onBulkRoute: (kinds: TaskKind[], endpointId: string, modelId: string) => void;
  onInherit: (kinds: TaskKind[]) => void;
  onEditorialMode: (mode: "full" | "light") => void;
  onConcurrency: (value: number) => void;
}) {
  const running = book.status === "running";
  const overrides = bookOverridesModels(book);
  const [opened, setOpened] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<TaskKind>>(new Set());
  const [bulk, setBulk] = useState({ endpointId: "", modelId: "" });
  const showTable = overrides || opened;
  const globalEndpoint = settings.endpoints.find(e => e.id === settings.defaultRoute.endpointId);
  const chatModels = (endpointId: string) => {
    const endpoint = settings.endpoints.find(e => e.id === endpointId);
    return (endpoint?.models ?? []).filter(model => {
      const roles = endpoint ? declaredModelCapabilities(endpoint, model) : [];
      return roles.length === 0 || roles.includes("chat");
    });
  };
  const chosen = BOOK_TASKS.filter(kind => selected.has(kind));
  const bulkEndpointId = bulk.endpointId || settings.defaultRoute.endpointId;
  const toggle = (kind: TaskKind, on: boolean) =>
    setSelected(old => { const next = new Set(old); if (on) next.add(kind); else next.delete(kind); return next; });
  function inheritAll() {
    if (!window.confirm("Il libro tornerà a usare modelli e thinking delle Impostazioni globali per tutte le attività. Le scelte fatte qui andranno perse. Continuare?")) return;
    onInherit(BOOK_TASKS);
    setSelected(new Set());
    setOpened(false);
  }

  return <section className="panel min-w-0 space-y-3 p-3 sm:p-4">
    <div>
      <h2 className="text-lg font-semibold">Modelli e redazione: {book.title}</h2>
      <p className="muted text-xs">Le scelte di questa pagina valgono solo per questo libro. Per tutti gli altri libri decidono le Impostazioni globali; le modifiche si applicano subito (non serve «Salva impostazioni») e con l'autopilot fermo.</p>
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block text-xs font-semibold">Redazione dei capitoli
        <select className="field field-sm mt-0.5" aria-label="Modalità di redazione" disabled={running}
          value={book.editorialMode ?? "full"} onChange={e => onEditorialMode(e.target.value as "full" | "light")}>
          <option value="full">Completa: 12 revisori indipendenti</option>
          <option value="light">Leggera: 5 revisori (6 con fonti storiche), più veloce sui modelli locali</option>
        </select>
        <span className="muted mt-0.5 block text-[11px] font-normal">Per i nuovi cicli; il direttore critico e le prove letterali restano.</span>
      </label>
      <label className="block text-xs font-semibold">Revisori in parallelo
        <select className="field field-sm mt-0.5" aria-label="Revisori in parallelo" disabled={running}
          value={book.editorialConcurrency ?? 1} onChange={e => onConcurrency(Number(e.target.value))}>
          <option value={1}>1 — in sequenza (predefinito)</option>
          <option value={2}>2 richieste insieme</option>
          <option value={3}>3 richieste insieme</option>
          <option value={4}>4 richieste insieme</option>
        </select>
        <span className="muted mt-0.5 block text-[11px] font-normal">Utile con provider cloud o server locale a più richieste; ignorato con il budget AI attivo.</span>
      </label>
    </div>

    {!showTable && <div className="space-y-2 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
      <p className="text-sm"><strong>Questo libro eredita modelli e thinking dalle Impostazioni globali.</strong>
        {" "}Modello predefinito: {globalEndpoint?.name ?? "nessun endpoint"} · {settings.defaultRoute.modelId || "nessun modello"}.</p>
      <Button type="button" variant="outline" onClick={() => setOpened(true)}>Crea le impostazioni di questo libro</Button>
    </div>}

    {showTable && <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="muted text-xs">{overrides
          ? "Questo libro ha scelte proprie. Dove una attività è «eredita» vale il router delle Impostazioni globali."
          : "Nessuna scelta ancora: ogni attività eredita dalle Impostazioni globali finché non ne imposti una."}</p>
        <Button type="button" variant="outline" disabled={running} onClick={inheritAll}>
          Eredita tutto dalle Impostazioni
        </Button>
      </div>

      {chosen.length > 0 && <div className="space-y-2 rounded-lg border border-emerald-600/50 bg-emerald-50 p-2 text-xs dark:bg-emerald-950/40">
        <strong className="text-sm">{chosen.length} {chosen.length === 1 ? "attività selezionata" : "attività selezionate"}</strong>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 font-semibold">Endpoint
            <select className="field field-sm w-auto" aria-label="Endpoint per le attività selezionate" value={bulkEndpointId}
              onChange={e => setBulk({ endpointId: e.target.value, modelId: "" })}>
              {settings.endpoints.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <div className="flex min-w-48 flex-col gap-0.5 font-semibold">Modello
            <ModelPicker ariaLabel="Modello per le attività selezionate" value={bulk.modelId} models={chatModels(bulkEndpointId)}
              emptyLabel="Come impostazioni globali" onChange={modelId => setBulk({ ...bulk, modelId })} />
          </div>
          <Button type="button" disabled={running} onClick={() => { onBulkRoute(chosen, bulkEndpointId, bulk.modelId); setSelected(new Set()); }}>
            Applica alle selezionate
          </Button>
          <Button type="button" variant="outline" disabled={running} onClick={() => { onInherit(chosen); setSelected(new Set()); }}>
            Eredita dalle Impostazioni
          </Button>
        </div>
      </div>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="muted border-b border-slate-300 text-left text-xs dark:border-slate-700">
              <th className="w-8 py-1 pr-2">
                <input type="checkbox" aria-label="Seleziona tutte le attività" checked={chosen.length === BOOK_TASKS.length}
                  onChange={e => setSelected(e.target.checked ? new Set(BOOK_TASKS) : new Set())} />
              </th>
              <th className="py-1 pr-2">Attività</th><th className="py-1 pr-2">Endpoint</th>
              <th className="py-1 pr-2">Modello</th><th className="py-1">Thinking</th>
            </tr>
          </thead>
          <tbody>
            {BOOK_TASKS.map(kind => {
              const configured = book.modelRoutes?.[kind];
              const own = !!configured || book.taskReasoningEfforts?.[kind] !== undefined;
              const eff = routeFor(kind, settings, book);
              const endpoint = settings.endpoints.find(e => e.id === eff.endpointId);
              return <tr key={kind} className="border-b border-slate-200 align-middle dark:border-slate-800">
                <td className="py-1 pr-2">
                  <input type="checkbox" aria-label={`Seleziona ${labels[kind]}`} checked={selected.has(kind)}
                    onChange={e => toggle(kind, e.target.checked)} />
                </td>
                <td className="py-1 pr-2 font-medium">{labels[kind]}
                  <span className={`ml-1.5 rounded px-1 text-[10px] font-semibold ${own
                    ? "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                    {own ? "del libro" : "eredita"}</span></td>
                <td className="py-1 pr-2">
                  <select className="field field-sm" aria-label={`Endpoint libro per ${labels[kind]}`}
                    value={configured?.endpointId ?? settings.defaultRoute.endpointId}
                    onChange={e => onRoute(kind, e.target.value, configured?.modelId ?? settings.defaultRoute.modelId)}>
                    {settings.endpoints.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <ModelPicker ariaLabel={`Modello libro per ${labels[kind]}`} value={configured?.modelId ?? ""}
                    models={chatModels(eff.endpointId)} emptyLabel="Come impostazioni globali" commitOnBlur
                    resetKey={`${book.id}:${kind}:${book.updatedAt}:${resets[kind] ?? 0}`}
                    onChange={modelId => onRoute(kind, configured?.endpointId ?? settings.defaultRoute.endpointId, modelId)} />
                </td>
                <td className="py-1">
                  <ReasoningSelect ariaLabel={`Reasoning libro per ${labels[kind]}`} compact disabled={running}
                    value={book.taskReasoningEfforts?.[kind]} inheritLabel="Eredita dal task globale/endpoint"
                    support={reasoningSupport(endpoint, eff.modelId)}
                    onChange={value => onReasoning(kind, value)} />
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </>}
  </section>;
}
