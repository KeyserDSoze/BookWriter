import { useMemo, useState } from "react";
import type { Activity, AppSettings } from "../domain/types";
import { listBookAiCostHistory } from "../domain/ai-cost-ledger";
import { Button } from "./ui/button";

const PAGE_SIZE = 10;
const tokenFormat = new Intl.NumberFormat("it-IT");
const estimatedMoney = new Intl.NumberFormat("it-IT", {
  style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 8,
});

const phaseNames: Record<Activity["phase"], string> = {
  brainstorm: "Ideazione", validate: "Validazione", audience: "Lettori",
  adversarial: "Analisi critica", outline: "Scaletta", prose: "Scrittura",
  review: "Revisione", consolidate: "Consolidamento",
  chapterReview: "Revisione del capitolo", revision: "Correzione",
  completed: "Completamento",
};
const statusNames: Record<Activity["status"], string> = {
  running: "In corso", succeeded: "Completato",
  cancelled: "Interrotto", failed: "Fallito",
};
const coverageNames = {
  completo: "Token completi", parziale: "Token parziali",
  mancante: "Token sconosciuti", in_corso: "Consumo in corso",
} as const;
const priceNames = {
  snapshot: "Tariffa salvata al tentativo",
  listino_corrente: "Listino corrente (record legacy)",
  snapshot_non_valido: "Snapshot tariffa non valido",
  tariffa_assente: "Tariffa non disponibile",
} as const;

function localDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("it-IT") : "Data non disponibile";
}
function estimatedCost(value: number | undefined): string {
  if (value === undefined) return "Non calcolabile";
  if (value > 0 && value < 0.00000001) return "Inferiore a 0,00000001 € (stima positiva)";
  return estimatedMoney.format(value);
}

/** Read-only per-task history. Never display raw errors, prompts or AI output. */
export function AiCostHistoryPanel({
  bookId, activities, settings,
}: {
  bookId: string; activities: readonly Activity[]; settings: AppSettings;
}) {
  const [onlyUnknown, setOnlyUnknown] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const rows = useMemo(
    () => listBookAiCostHistory(bookId, activities, settings).reverse(),
    [bookId, activities, settings],
  );
  const filtered = onlyUnknown ? rows.filter(row => row.assessment.estimatedEur === undefined) : rows;
  const visible = filtered.slice(0, visibleCount);

  return <section aria-label="Storico costi AI per task"
    className="mt-4 min-w-0 space-y-3 border-t border-slate-300 pt-3 dark:border-slate-700">
    <h3 className="text-sm font-semibold">Storico dei costi per task AI</h3>
    <p className="muted text-xs">
      Tentativi del libro, dal più recente. Importi stimati usando solo token osservati
      e tariffe manuali; non sono fatture o saldi effettivi. Un importo ignoto non equivale a zero.
    </p>
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" aria-label="Solo tentativi senza stima"
        checked={onlyUnknown}
        onChange={event => { setOnlyUnknown(event.target.checked); setVisibleCount(PAGE_SIZE); }}/>
      Solo tentativi senza stima
    </label>
    <p className="muted text-xs" role="status">
      {filtered.length} {filtered.length === 1 ? "tentativo visualizzabile" : "tentativi visualizzabili"} su {rows.length} registrati.
    </p>
    {visible.length ? <ol className="min-w-0 space-y-2">
      {visible.map(row => {
        const assessment = row.assessment;
        const isUnknown = assessment.estimatedEur === undefined;
        return <li key={row.id}
          className="min-w-0 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="break-words font-semibold">{row.taskTitle?.trim() || "Task AI senza titolo"}</p>
              <p className="muted mt-1 break-words text-xs">
                {phaseNames[row.phase]} · {localDate(row.createdAt)} · {statusNames[row.status]}
              </p>
            </div>
            <p className={isUnknown ?
              "text-sm font-semibold text-amber-700 dark:text-amber-300" :
              "text-sm font-semibold tabular-nums"}>
              {isUnknown ? "Stima non calcolabile" : estimatedCost(assessment.estimatedEur) + " (stima)"}
            </p>
          </div>
          <p className="muted mt-2 break-all text-xs">
            Modello: {row.modelId || "sconosciuto"} · Endpoint: {row.endpointId || "sconosciuto"}
          </p>
          <p className="muted mt-1 break-words text-xs">
            {coverageNames[assessment.usageCoverage]} ·
            Input {assessment.inputTokens === undefined ? "?" : tokenFormat.format(assessment.inputTokens)} ·
            Output {assessment.outputTokens === undefined ? "?" : tokenFormat.format(assessment.outputTokens)}
          </p>
          <p className={assessment.rateOrigin === "listino_corrente" ?
            "mt-1 break-words text-xs text-amber-700 dark:text-amber-300" :
            "muted mt-1 break-words text-xs"}>
            {priceNames[assessment.rateOrigin]}
          </p>
        </li>;
      })}
    </ol> : <p className="muted text-sm">
      {rows.length ? "Nessun tentativo corrisponde al filtro." :
        "Nessun tentativo AI registrato per questo libro."}
    </p>}
    {visibleCount < filtered.length &&
      <Button size="sm" variant="outline" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>
        Mostra altri 10 tentativi
      </Button>}
    <p className="muted text-xs">
      Il CSV riporta l'intera cronologia. In questa vista non sono mostrati prompt,
      prosa o errori del provider; verifica sempre gli addebiti sul portale del provider.
    </p>
  </section>;
}
