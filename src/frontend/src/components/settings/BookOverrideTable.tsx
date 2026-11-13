import type { AppSettings, BookProject, TaskKind, TaskReasoning } from "../../domain/types";
import { routeFor } from "../../domain/types";
import { declaredModelCapabilities } from "../../domain/model-capabilities";
import { reasoningSupport } from "../../domain/model-reasoning";
import { ReasoningSelect } from "../ReasoningSelect";
import { ModelPicker } from "./ModelPicker";

const BOOK_TASKS: TaskKind[] = ["brainstorm", "prose", "continuity", "revision", "consolidate", "summarize", "merge",
  "chapterAudit", "chapterReaders", "chapterJudge", "chapterRepair"];

/** Per-book overrides. Each change is a locked, revision-checked write (not part of «Salva impostazioni»). */
export function BookOverrideTable({ book, settings, labels, resets, onRoute, onReasoning, onEditorialMode, onConcurrency }: {
  book: BookProject; settings: AppSettings; labels: Record<TaskKind, string>;
  resets: Partial<Record<TaskKind, number>>;
  onRoute: (kind: TaskKind, endpointId: string, modelId: string) => void;
  onReasoning: (kind: TaskKind, value: TaskReasoning | undefined) => void;
  onEditorialMode: (mode: "full" | "light") => void;
  onConcurrency: (value: number) => void;
}) {
  const running = book.status === "running";
  return <section className="panel min-w-0 space-y-3 p-3 sm:p-4">
    <div>
      <h2 className="text-lg font-semibold">Override del libro: {book.title}</h2>
      <p className="muted text-xs">Valgono solo per questo libro e si applicano subito (non servono «Salva impostazioni»). Si modificano con l'autopilot fermo.</p>
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="muted border-b border-slate-300 text-left text-xs dark:border-slate-700">
            <th className="py-1 pr-2">Attività</th><th className="py-1 pr-2">Endpoint</th>
            <th className="py-1 pr-2">Modello</th><th className="py-1">Thinking</th>
          </tr>
        </thead>
        <tbody>
          {BOOK_TASKS.map(kind => {
            const configured = book.modelRoutes?.[kind];
            const eff = routeFor(kind, settings, book);
            const endpoint = settings.endpoints.find(e => e.id === eff.endpointId);
            const models = (endpoint?.models ?? []).filter(model => {
              const roles = endpoint ? declaredModelCapabilities(endpoint, model) : [];
              return roles.length === 0 || roles.includes("chat");
            });
            return <tr key={kind} className="border-b border-slate-200 align-middle dark:border-slate-800">
              <td className="py-1 pr-2 font-medium">{labels[kind]}</td>
              <td className="py-1 pr-2">
                <select className="field field-sm" aria-label={`Endpoint libro per ${labels[kind]}`}
                  value={configured?.endpointId ?? settings.defaultRoute.endpointId}
                  onChange={e => onRoute(kind, e.target.value, configured?.modelId ?? settings.defaultRoute.modelId)}>
                  {settings.endpoints.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </td>
              <td className="py-1 pr-2">
                <ModelPicker ariaLabel={`Modello libro per ${labels[kind]}`} value={configured?.modelId ?? ""}
                  models={models} emptyLabel="Come impostazioni globali" commitOnBlur
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
  </section>;
}
