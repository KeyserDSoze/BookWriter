import { useMemo, useState } from "react";
import { Globe, Search } from "lucide-react";
import type { BookProject } from "../../domain/types";
import type { ResearchEntry } from "../../domain/web-research";
import { clearResearchLog } from "../../application/web-research";
import { Button } from "../ui/button";
import { Badge, EmptyState, Segmented } from "../ui/primitives";
import { SourceList } from "../settings/WebResearchPanel";

const STATUS: Record<ResearchEntry["status"], { label: string; tone: "emerald" | "sky" | "rose" | "amber" }> = {
  ok: { label: "Trovato", tone: "emerald" }, cached: { label: "Dalla cache", tone: "sky" },
  failed: { label: "Non riuscita", tone: "rose" }, blocked: { label: "Bloccata (segreto)", tone: "amber" },
};

/** What the AI looked up, why, with which provider and sources. Read-only history. */
export function ResearchLog({ book, onRefresh, onOpenSettings }: { book: BookProject; onRefresh: () => Promise<void>; onOpenSettings: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ok" | "problems">("all");
  const [message, setMessage] = useState("");
  const entries = useMemo(() => [...(book.webResearchLog ?? [])].reverse(), [book.webResearchLog]);
  const fold = (value: string) => value.toLocaleLowerCase("it");
  const shown = entries.filter(e => (filter === "all" || (filter === "ok" ? e.status === "ok" || e.status === "cached" : e.status === "failed" || e.status === "blocked")) &&
    (!query.trim() || fold([e.query, e.summary, e.taskTitle, ...e.sources.map(s => s.title)].join(" ")).includes(fold(query.trim()))));
  const header = <div className="flex flex-wrap items-start justify-between gap-2">
    <p className="muted max-w-prose text-sm">Ogni ricerca chiesta dall'AI o provata da te: domanda, motivo, compito, servizio usato e fonti. Sono dati esterni non verificati.</p>
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={book.webResearch?.enabled ? "emerald" : "neutral"}>{book.webResearch?.enabled ? "Ricerca attiva" : "Ricerca spenta"}</Badge>
      <Button variant="outline" size="sm" onClick={onOpenSettings}>Impostazioni</Button>
    </div>
  </div>;
  if (!entries.length) return <div className="space-y-3">{header}
    <EmptyState title="Nessuna ricerca ancora" icon={<Globe size={26}/>}>{book.webResearch?.enabled
      ? "L'AI cercherà sul web solo quando le manca un'informazione: le ricerche compariranno qui."
      : "Attiva la ricerca web in Modelli e redazione per permettere all'AI di cercare informazioni storiche e tecniche."}</EmptyState></div>;
  async function clear() {
    if (!window.confirm("Svuotare il registro delle ricerche? Le ricerche non saranno più riusate dalla cache.")) return;
    try { await clearResearchLog(book.id, book.updatedAt); await onRefresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Registro non svuotato."); await onRefresh().catch(() => undefined); }
  }
  return <div className="space-y-3">
    {header}
    <div className="space-y-2">
      <label className="relative block"><span className="sr-only">Cerca nel registro delle ricerche</span>
        <Search size={16} className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"/>
        <input className="field pl-9" type="search" placeholder="Cerca fra domande, fonti e compiti" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <Segmented label="Mostra" value={filter} onChange={setFilter} options={[{ value: "all", label: "Tutte (" + entries.length + ")" },
        { value: "ok", label: "Con risultati" }, { value: "problems", label: "Non riuscite o bloccate" }]}/>
    </div>
    <ol className="space-y-2" aria-label="Registro delle ricerche">
      {shown.map(entry => <li key={entry.id} className="rounded-xl border border-slate-300 p-3 dark:border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-semibold [overflow-wrap:anywhere]">«{entry.query}»</p>
          <Badge tone={STATUS[entry.status].tone}>{STATUS[entry.status].label}</Badge>
        </div>
        <p className="muted text-xs">{new Date(entry.at).toLocaleString("it-IT")} · {entry.taskTitle} · {entry.provider === "wikipedia" ? "Wikipedia" : "Modello " + (entry.modelId ?? "di ricerca")}</p>
        {entry.reason && <p className="muted mt-1 text-xs">Motivo: {entry.reason}</p>}
        {entry.summary && <p className="mt-1.5 text-sm">{entry.summary}</p>}
        {entry.error && <p className="mt-1.5 text-sm text-rose-700 dark:text-rose-300">{entry.error}</p>}
        {entry.sources.length > 0 && <details className="mt-1.5"><summary className="cursor-pointer text-xs font-semibold">Fonti ({entry.sources.length})</summary>
          <div className="mt-1.5"><SourceList sources={entry.sources}/></div></details>}
      </li>)}
    </ol>
    {!shown.length && <p className="muted text-sm">Nessuna ricerca corrisponde ai filtri.</p>}
    <Button variant="ghost" size="sm" onClick={() => void clear()}>Svuota il registro</Button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
