import { BarChart3, AlertTriangle } from "lucide-react";
import type { Activity, EndpointProfile } from "../domain/types";
import { summarizeAiUsage } from "../domain/ai-usage";

const fmt = new Intl.NumberFormat("it-IT");
export function AiUsagePanel({
  activities, endpoints,
}: { activities: Activity[]; endpoints: EndpointProfile[] }) {
  const usage = summarizeAiUsage(activities);
  const incomplete = usage.missingReports + usage.partialReports > 0;
  const endpointName = (id: string) => endpoints.find(x => x.id === id)?.name ?? id;
  return <section className="panel min-w-0 p-4 sm:p-5" aria-label="Consumi AI">
    <h2 className="flex items-center gap-2 text-lg font-semibold">
      <BarChart3 size={19}/> Consumi AI registrati
    </h2>
    <p className="muted mt-1 text-xs">
      Token comunicati dagli endpoint nei log di questo libro. Nessun saldo crediti o costo in euro stimato automaticamente.
    </p>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-900">
        <p className="muted text-xs">Token input</p>
        <p className="text-lg font-semibold tabular-nums">{fmt.format(usage.inputTokens)}</p>
      </div>
      <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-900">
        <p className="muted text-xs">Token output</p>
        <p className="text-lg font-semibold tabular-nums">{fmt.format(usage.outputTokens)}</p>
      </div>
      <div className="col-span-2 rounded-lg bg-slate-100 p-3 dark:bg-slate-900 sm:col-span-1">
        <p className="muted text-xs">Totale noto</p>
        <p className="text-lg font-semibold tabular-nums">{fmt.format(usage.totalTokens)}</p>
      </div>
    </div>
    <p className="muted mt-3 text-xs">
      Report completi: {usage.completeReports} · Parziali: {usage.partialReports} · Senza conteggio: {usage.missingReports}
    </p>
    {usage.models.length ? <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-300 dark:border-slate-700">
            <th className="py-2 pr-2">Modello / endpoint</th>
            <th className="py-2 px-2 text-right">Chiamate</th>
            <th className="py-2 px-2 text-right">Input</th>
            <th className="py-2 pl-2 text-right">Output</th>
          </tr>
        </thead>
        <tbody>
          {usage.models.map(row => <tr key={JSON.stringify([row.endpointId, row.modelId])}
            className="border-b border-slate-300/50 dark:border-slate-700/50">
            <td className="min-w-28 max-w-56 py-2 pr-2 break-words">
              <b>{row.modelId}</b><span className="muted block">{endpointName(row.endpointId)}</span>
            </td>
            <td className="py-2 px-2 text-right tabular-nums">{fmt.format(row.calls)}</td>
            <td className="py-2 px-2 text-right tabular-nums">{fmt.format(row.inputTokens)}</td>
            <td className="py-2 pl-2 text-right tabular-nums">{fmt.format(row.outputTokens)}</td>
          </tr>)}
        </tbody>
      </table>
    </div> : <p className="muted mt-3 text-sm">
      Non sono ancora disponibili consumi AI comunicati dai provider per questo libro.
    </p>}
    {(incomplete || usage.failedActivities > 0 || usage.interruptedActivities > 0) &&
      <p className="mt-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
        <AlertTriangle size={16} className="shrink-0"/>
        Conteggio incompleto: alcune risposte non riportano token, oppure ci sono
        {usage.failedActivities > 0 ? " errori" : ""}{usage.failedActivities > 0 && usage.interruptedActivities > 0 ? " e" : ""}
        {usage.interruptedActivities > 0 ? " interruzioni" : ""}.
        Anche richieste fallite o interrotte possono generare addebiti. Verifica il consumo effettivo nel portale del provider.
      </p>}
    <p className="muted mt-3 text-xs">
      I token qui mostrati non corrispondono necessariamente ai crediti rimasti:
      possono esserci caching, tariffe differenti e chiamate non tracciate.
    </p>
  </section>;
}
