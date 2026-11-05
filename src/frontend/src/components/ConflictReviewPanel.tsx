import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, GitCompareArrows, GitBranch, Save, ShieldCheck } from "lucide-react";
import type { BookProject } from "../domain/types";
import {
  shortConflictPreview,
  type ConflictUnit, type ResolutionChoice,
} from "../domain/conflicts";
import {
  applyBookConflictResolution, inspectBookConflict, preserveRemoteVersion,
  type ConflictReview,
} from "../infrastructure/conflict-recovery";
import { Button } from "./ui/button";

interface Props {
  book?: BookProject;
  hasGitHubToken: boolean;
  onRefresh: () => Promise<void>;
  onSelectBook: (bookId: string) => void;
}
const originLabels = {
  "only-local": "Modifica locale",
  "only-remote": "Modifica GitHub",
  "both-changed": "Entrambe modificate",
  "unknown": "Diverse — baseline non disponibile",
};

function UnitRow({
  unit, selected, onSelect,
}: { unit: ConflictUnit; selected: ResolutionChoice; onSelect: (choice: ResolutionChoice) => void }) {
  return <details className="min-w-0 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
    <summary className="cursor-pointer text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold break-words">{unit.label}</span>
        <span className="muted text-xs">{originLabels[unit.origin]}</span>
      </div>
    </summary>
    <div className="mt-3 space-y-3">
      <label className="block text-sm font-semibold">
        Versione da conservare per questa differenza
        <select className="field mt-1" aria-label={"Versione da conservare: " + unit.id}
          value={selected} onChange={e => onSelect(e.target.value as ResolutionChoice)}>
          <option value="local">Mantieni la versione locale</option>
          <option value="remote">Usa la versione GitHub</option>
        </select>
      </label>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <div className="min-w-0 rounded-lg bg-slate-100 p-3 dark:bg-slate-900">
          <p className="mb-2 text-xs font-semibold">Locale</p>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">
            {shortConflictPreview(unit.local, 1600)}
          </pre>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs underline">Mostra tutto il contenuto locale</summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
              {unit.local === undefined ? "(assente)" : typeof unit.local === "string" ? unit.local : JSON.stringify(unit.local, null, 2)}
            </pre>
          </details>
        </div>
        <div className="min-w-0 rounded-lg bg-slate-100 p-3 dark:bg-slate-900">
          <p className="mb-2 text-xs font-semibold">GitHub</p>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">
            {shortConflictPreview(unit.remote, 1600)}
          </pre>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs underline">Mostra tutto il contenuto GitHub</summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
              {unit.remote === undefined ? "(assente)" : typeof unit.remote === "string" ? unit.remote : JSON.stringify(unit.remote, null, 2)}
            </pre>
          </details>
        </div>
      </div>
      {(unit.local === undefined || unit.remote === undefined) &&
        <p className="text-xs text-amber-700 dark:text-amber-300">Una delle versioni non contiene questo elemento: scegliendola potresti eliminarlo dal libro principale. Le copie di sicurezza lo conserveranno.</p>}
    </div>
  </details>;
}

/**
 * Non-destructive conflict inspector: the remote repository is read-only here.
 * Applying requires a paused runner, a fresh remote HEAD and two safety copies.
 */
export function ConflictReviewPanel({ book, hasGitHubToken, onRefresh, onSelectBook }: Props) {
  const [review, setReview] = useState<ConflictReview | null>(null);
  const [choices, setChoices] = useState<Record<string, ResolutionChoice>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setReview(null); setChoices({}); setMessage(""); setError("");
  }, [book?.id]);

  const remoteSelections = useMemo(
    () => review?.units.filter(unit => choices[unit.id] === "remote").length ?? 0,
    [review, choices],
  );
  const groups = useMemo(() => {
    if (!review) return [];
    const items = new Map<string, ConflictUnit[]>();
    for (const unit of review.units) {
      const list = items.get(unit.group) ?? [];
      list.push(unit);
      items.set(unit.group, list);
    }
    return [...items.entries()];
  }, [review]);

  async function perform(action: () => Promise<string>) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { setMessage(await action()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Operazione non riuscita."); }
    finally { setBusy(false); }
  }
  function inspect() {
    if (!book) return;
    void perform(async () => {
      const result = await inspectBookConflict(book.id);
      setReview(result); setChoices({});
      return "Confronto pronto: " + result.units.length +
        " differenze tra browser e commit " + result.headSha.slice(0, 12) + ". Nessun dato modificato.";
    });
  }
  function saveGitHubCopy() {
    if (!review) return;
    void perform(async () => {
      const newId = await preserveRemoteVersion(review);
      await onRefresh();
      onSelectBook(newId);
      return "Versione GitHub conservata come libro separato, senza sovrascrivere la copia originale.";
    });
  }
  function apply() {
    if (!review) return;
    if (!window.confirm(
      "Vuoi applicare le scelte al libro principale? Verranno create in IndexedDB DUE copie di sicurezza indipendenti, una locale e una GitHub. " +
      "L'autosync verrà disattivato e nessun commit sarà inviato finché non farai un push manuale. Procedere?",
    )) return;
    void perform(async () => {
      const outcome = await applyBookConflictResolution(review, choices);
      setReview(null); setChoices({});
      await onRefresh();
      return "Risoluzione applicata (" + outcome.remoteSelections + " elementi GitHub). " +
        "Backup locale " + outcome.localBackupId.slice(0, 8) +
        " e backup GitHub " + outcome.remoteBackupId.slice(0, 8) +
        " salvati tra i libri. Leggi il risultato prima di sincronizzarlo.";
    });
  }

  return <section className="panel min-w-0 p-4 sm:p-5">
    <h2 className="flex items-center gap-2 text-lg font-semibold">
      <GitCompareArrows size={20}/> Confronto e recupero delle versioni
    </h2>
    <p className="muted mt-1 text-sm">
      Confronta il manoscritto locale con il canon su GitHub. Le differenze si scelgono per scena,
      capitolo, elemento del mondo narrativo o sezione progettuale.
    </p>
    {!book?.remote ? <p className="muted mt-3 text-sm">Collega prima un libro a una repository GitHub.</p> :
      <div className="mt-4 space-y-3">
        <p className="muted text-xs">
          Repository: {book.remote.owner}/{book.remote.repository} · branch {book.remote.branch}
        </p>
        <Button variant="outline" disabled={!hasGitHubToken || busy || book.status === "running"}
          onClick={inspect}><GitBranch size={17}/> Confronta locale e GitHub</Button>
        {book.status === "running" && <p className="text-sm text-amber-600 dark:text-amber-300">Metti prima in pausa l'autopilot.</p>}
        {!hasGitHubToken && <p className="text-sm text-amber-600 dark:text-amber-300">Configura prima un PAT GitHub.</p>}
      </div>}
    {error && <p role="alert" className="mt-3 rounded-lg border border-red-500/40 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
    {message && <p role="status" className="mt-3 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">{message}</p>}
    {review && <div className="mt-4 space-y-4">
      <div className="space-y-2 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
        <p><b>Versione locale:</b> {new Date(review.localUpdatedAt).toLocaleString("it-IT")}</p>
        <p><b>GitHub HEAD:</b> <code className="break-all">{review.headSha.slice(0, 16)}</code></p>
        <p><b>Baseline:</b> {review.baseAvailable ? "Disponibile (confronto a tre versioni)" :
          "Non disponibile (confronto a due versioni)"}</p>
        {review.baselineWarning && <p className="text-xs text-amber-700 dark:text-amber-300">{review.baselineWarning}</p>}
        <p><b>Differenze:</b> {review.units.length} · <b>Scelte da GitHub:</b> {remoteSelections}</p>
        <p className="muted text-xs">Tutti gli elementi inizialmente mantengono la versione locale. Le modifiche non si applicano finché non confermi.</p>
      </div>

      {groups.map(([group, units]) => <section key={group} className="space-y-2">
        <h3 className="font-semibold">{group} ({units.length})</h3>
        {units.map(unit => <UnitRow key={unit.id} unit={unit}
          selected={choices[unit.id] ?? "local"}
          onSelect={choice => setChoices(prev => ({ ...prev, [unit.id]: choice }))}/>)}
      </section>)}

      {!review.units.length &&
        <p className="text-sm text-emerald-600 dark:text-emerald-400">I contenuti del libro coincidono. Non è necessaria una risoluzione.</p>}

      <div className="space-y-3 rounded-lg border border-amber-500/40 p-3">
        <p className="flex items-start gap-2 text-sm"><ShieldCheck size={18} className="shrink-0"/>
          Prima di applicare verranno salvate due copie indipendenti (locale e GitHub).
          Il libro principale sarà messo in pausa e l'autosync disattivato.
          Il server GitHub NON verrà modificato da questa schermata.
        </p>
        <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle size={15} className="shrink-0"/>
          Le copie sono in IndexedDB: scarica anche un backup ZIP per proteggerti da perdita dei dati del browser.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={saveGitHubCopy}>
            <Save size={17}/> Salva GitHub come copia separata
          </Button>
          <Button disabled={busy || !review.units.length || book?.status === "running"} onClick={apply}>
            <GitCompareArrows size={17}/> Applica scelte con doppio backup
          </Button>
        </div>
      </div>
    </div>}
  </section>;
}
