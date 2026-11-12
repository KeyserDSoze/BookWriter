import { AlertTriangle, ArrowRight, Wallet } from "lucide-react";
import type { Activity, AppSettings, BookProject } from "../domain/types";
import { accountBookAiBudget, assessAiBudgetHeadroom } from "../domain/ai-budget";
import { summarizeAiUsage } from "../domain/ai-usage";
import { Button } from "./ui/button";

const number = new Intl.NumberFormat("it-IT");
const money = (value: number) => new Intl.NumberFormat("it-IT", {
  style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4,
}).format(value);

/** Read-only glance at spending; limits and the full ledger live in the Costi page. */
export function CostGlance({ book, activities, settings, onOpen }: {
  book: BookProject; activities: Activity[]; settings: AppSettings; onOpen: () => void;
}) {
  const usage = summarizeAiUsage(activities);
  const calls = usage.completeReports + usage.partialReports + usage.missingReports;
  const budget = book.aiBudget?.enabled ? book.aiBudget : undefined;
  const accounting = budget ? accountBookAiBudget(activities, settings, budget) : undefined;
  const headroom = budget && accounting ? assessAiBudgetHeadroom(accounting, budget.limitEur) : undefined;
  const uncertain = usage.missingReports + usage.partialReports > 0 || headroom?.status === "incerto";
  const percent = headroom?.knownUsedFraction === undefined ? undefined
    : Math.min(999, Math.round(headroom.knownUsedFraction * 100));
  return <section aria-label="Costi AI in sintesi" className="panel min-w-0 space-y-2 p-4">
    <h2 className="flex items-center gap-2 text-base font-semibold"><Wallet size={18}/> Costi AI in sintesi</h2>
    {calls === 0 ? <p className="muted text-sm">Nessuna chiamata AI registrata per questo libro.</p> : <>
      <p className="text-sm">
        <b className="tabular-nums">{number.format(usage.totalTokens)}</b> token comunicati dai provider
        in {number.format(calls)} {calls === 1 ? "chiamata" : "chiamate"}.
      </p>
      {budget && accounting && (headroom?.status === "incerto"
        ? <p className="text-sm">Budget attivo: la spesa non è calcolabile con certezza perché alcune chiamate
          non hanno token o tariffa validi.</p>
        : <>
          <p className="text-sm">Spesa stimata <b className="tabular-nums">{money(accounting.estimatedSpentEur)}</b> su
            un limite di <b className="tabular-nums">{money(budget.limitEur)}</b>
            {percent !== undefined && <> ({percent}%)</>}.</p>
          {percent !== undefined && <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            role="progressbar" aria-label="Quota di budget stimata usata" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.min(100, percent)}>
            <div className={`h-full ${headroom?.status === "raggiunto" ? "bg-red-500" :
              headroom?.status === "vicino" ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${Math.min(100, percent)}%` }}/>
          </div>}
        </>)}
      {!budget && <p className="muted text-sm">Nessun limite di spesa attivo per questo libro.</p>}
      {uncertain && <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
        <AlertTriangle size={15} className="mt-0.5 shrink-0"/>
        Alcune chiamate non riportano i token: i valori sono parziali, non un conto del provider.</p>}
    </>}
    <Button variant="outline" onClick={onOpen}>Apri costi e budget <ArrowRight size={16}/></Button>
  </section>;
}
