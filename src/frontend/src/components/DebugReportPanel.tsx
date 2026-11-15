import { useState } from "react";
import { Bug, Check, Copy, RefreshCw } from "lucide-react";
import type { Activity, BookProject } from "../domain/types";
import { buildDebugReport } from "../domain/debug-report";
import { Button } from "./ui/button";

/** A ready-to-paste prompt with the book state and the latest errors, for the developer. Built on the device, sent nowhere. */
export function DebugReportPanel({ book, activities, version }: { book: BookProject; activities: Activity[]; version: string }) {
  const [report, setReport] = useState("");
  const [message, setMessage] = useState("");
  const build = () => {
    setReport(buildDebugReport(book, activities, { version, now: new Date().toISOString(), userAgent: navigator.userAgent }));
    setMessage("");
  };
  async function copy() {
    try { await navigator.clipboard.writeText(report); setMessage("Copiato: incollalo nella chat."); }
    catch { setMessage("Copia non riuscita: seleziona il testo e copialo a mano."); }
  }
  return <details className="panel" onToggle={e => { if ((e.target as HTMLDetailsElement).open && !report) build(); }}>
    <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-3 text-base font-semibold sm:px-4">
      <Bug size={18} aria-hidden className="text-rose-600 dark:text-rose-300"/> Debug: prompt con gli ultimi errori</summary>
    <div className="space-y-3 border-t border-slate-300 p-3 sm:p-4 dark:border-slate-700">
      <p className="muted text-sm">Raccoglie stato del libro, ultimo errore e task falliti con modello, fase e messaggio. Non include testo del libro, memoria, segreti, prompt o risposte del modello; chiavi e token sono redatti. Resta sul tuo dispositivo finché non lo copi tu.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void copy()} disabled={!report}><Copy size={16}/> Copia il prompt</Button>
        <Button type="button" variant="outline" onClick={build}><RefreshCw size={16}/> Aggiorna</Button>
        {message && <p role="status" className="flex items-center gap-1 text-sm"><Check size={15}/> {message}</p>}
      </div>
      <label className="block text-sm"><span className="sr-only">Prompt di debug</span>
        <textarea readOnly className="field min-h-64 font-mono text-xs" rows={16} value={report} onFocus={e => e.currentTarget.select()}/></label>
    </div>
  </details>;
}
