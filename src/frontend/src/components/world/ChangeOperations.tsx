import { useState } from "react";
import { CheckCircle2, CircleDashed, History, Loader2, Play, Undo2, XCircle } from "lucide-react";
import type { BookProject } from "@engine/domain/types";
import { activeChange, CHANGE_STATE_LABELS, type ChangeState, type NarrativeChangeOperation } from "@engine/domain/narrative-change";
import { revertProblem } from "@engine/domain/narrative-change-flow";
import { confirmNarrativeChange, revertNarrativeChange } from "../../application/narrative-change";
import { Button } from "../ui/button";
import { Badge, EmptyState } from "../ui/primitives";
import { DiffView } from "../edit/EditKit";

const STEPS: Array<{ state: ChangeState; label: string }> = [
  { state: "analyzing", label: "Analisi" }, { state: "rewriting", label: "Riscrittura" },
  { state: "reviewing", label: "Revisione" }, { state: "completed", label: "Completata" },
];
const ORDER: Record<ChangeState, number> = { pending: 0, analyzing: 0, awaiting_confirmation: 0.5, rewriting: 1, reviewing: 2, completed: 3,
  failed: -1, cancelled: -1, reverted: -1 };
export function stateTone(state: ChangeState): "emerald" | "amber" | "sky" | "rose" | "neutral" | "violet" {
  return state === "completed" ? "emerald" : state === "awaiting_confirmation" ? "amber" : state === "failed" ? "rose" :
    state === "reverted" || state === "cancelled" ? "neutral" : state === "reviewing" ? "sky" : "violet";
}
function sceneName(book: BookProject, id: string): string {
  for (const chapter of book.chapters) {
    const scene = chapter.scenes.find(s => s.id === id);
    if (scene) return `Cap. ${chapter.number} · ${scene.number}. ${scene.title}`;
  }
  return id;
}
function SceneList({ book, ids, empty }: { book: BookProject; ids: string[]; empty: string }) {
  if (!ids.length) return <p className="muted text-xs">{empty}</p>;
  return <ul className="flex flex-wrap gap-1.5">{ids.map(id => <li key={id}><Badge>{sceneName(book, id)}</Badge></li>)}</ul>;
}
function Progress({ state }: { state: ChangeState }) {
  const at = ORDER[state];
  return <ol aria-label="Avanzamento della modifica" className="flex flex-wrap items-center gap-1 text-xs">
    {STEPS.map((step, index) => {
      const done = at > index || state === "completed";
      const current = Math.floor(at) === index && state !== "completed";
      return <li key={step.state} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${done ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-300" : current ? "border-violet-500 font-semibold" : "border-slate-300 muted dark:border-slate-700"}`}>
        {done ? <CheckCircle2 size={13}/> : current ? <Loader2 size={13} className="motion-safe:animate-spin"/> : <CircleDashed size={13}/>}{step.label}
      </li>;
    })}
  </ol>;
}
function PlanDetails({ book, op }: { book: BookProject; op: NarrativeChangeOperation }) {
  const plan = op.plan;
  if (!plan) return <p className="muted text-sm">L'analisi d'impatto non è ancora stata eseguita.</p>;
  return <div className="space-y-2 text-sm">
    <p><b>Interpretazione:</b> {plan.interpretation}</p>
    <div className="flex flex-wrap gap-1.5">
      <Badge tone={plan.changeKind === "style" ? "sky" : "violet"}>{plan.changeKind === "style" ? "Solo forma e stile" : "Cambiano fatti narrativi"}</Badge>
      {plan.global && <Badge tone="rose">Impatto globale</Badge>}
    </div>
    <div><p className="text-xs font-semibold">Dirette ({plan.direct.length})</p><SceneList book={book} ids={plan.direct} empty="Nessuna scena cita direttamente l'elemento."/></div>
    <div><p className="text-xs font-semibold">Indirette ({plan.indirect.length})</p><SceneList book={book} ids={plan.indirect} empty="Nessuna dipendenza indiretta trovata."/></div>
    <div><p className="text-xs font-semibold">Da riscrivere ({plan.rewriteSceneIds.length})</p><SceneList book={book} ids={plan.rewriteSceneIds} empty="Nessuna scena da riscrivere: si aggiorna solo l'elemento o si rivede il capitolo."/></div>
    {plan.kept && plan.kept.length > 0 && <div><p className="text-xs font-semibold">Dirette lasciate come sono ({plan.kept.length})</p>
      <ul className="space-y-1 text-xs" aria-label="Scene dirette lasciate come sono">{plan.kept.map(k => <li key={k.sceneId}><Badge>{sceneName(book, k.sceneId)}</Badge> <span className="muted">{k.reason}</span></li>)}</ul></div>}
    {plan.changedFacts.length > 0 && <ul className="list-disc pl-5 text-xs">{plan.changedFacts.map(f => <li key={f}>{f}</li>)}</ul>}
    {op.draftText !== undefined && (() => {
      const previous = op.before.scenes.find(s => s.sceneId === op.target.id)?.text ?? "";
      return <div className="space-y-1"><p className="text-xs font-semibold">Scena proposta (il libro non cambia finché non confermi)</p>
        <DiffView before={previous} after={op.draftText} label="Confronto della scena proposta"/></div>;
    })()}
    <p className="muted text-xs">{plan.rationale}</p>
  </div>;
}

/** The change in progress, always visible on top of the World page. */
export function ActiveChangeBanner({ book, onRefresh, onStart, runningHere }: {
  book: BookProject; onRefresh: () => Promise<void>; onStart: (bookId: string) => void; runningHere: boolean;
}) {
  const op = activeChange(book);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!op) return null;
  async function decide(accept: boolean) {
    if (!accept && !window.confirm("Annullare la modifica? Il libro torna com'era prima della richiesta.")) return;
    setBusy(true); setMessage("");
    try {
      await confirmNarrativeChange(book.id, op!.id, accept, book.updatedAt);
      await onRefresh();
      if (accept) onStart(book.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Operazione non riuscita."); await onRefresh().catch(() => undefined); }
    finally { setBusy(false); }
  }
  const idle = book.status !== "running";
  return <section aria-label="Modifica in corso" className="panel space-y-3 border-violet-500/50 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="muted text-xs font-semibold uppercase tracking-wide">Modifica in corso</p>
        <h3 className="font-semibold [overflow-wrap:anywhere]">{op.targetLabel}</h3>
        <p className="text-sm [overflow-wrap:anywhere]">«{op.instruction}»</p>
      </div>
      <Badge tone={stateTone(op.state)}>{CHANGE_STATE_LABELS[op.state]}</Badge>
    </div>
    <Progress state={op.state}/>
    {(op.state === "awaiting_confirmation" || op.plan) && <PlanDetails book={book} op={op}/>}
    <div className="flex flex-wrap gap-2">
      {op.state === "awaiting_confirmation" && <>
        <Button disabled={busy || !idle} onClick={() => void decide(true)}><CheckCircle2 size={16}/> Conferma il piano</Button>
        <Button variant="outline" disabled={busy || !idle} onClick={() => void decide(false)}><XCircle size={16}/> Annulla la modifica</Button>
      </>}
      {op.state !== "awaiting_confirmation" && idle && !runningHere && <Button disabled={busy} onClick={() => onStart(book.id)}><Play size={16}/> Riprendi la modifica</Button>}
      {["pending", "analyzing"].includes(op.state) && idle && <Button variant="outline" disabled={busy} onClick={() => void decide(false)}><XCircle size={16}/> Annulla la modifica</Button>}
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}

/** Every prompt-driven change, its plan, local fact checks and guarded restore. */
export function ChangeHistory({ book, onRefresh }: { book: BookProject; onRefresh: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const ops = [...(book.changeOperations ?? [])].reverse();
  if (!ops.length) return <EmptyState title="Nessuna modifica ancora" icon={<History size={28}/>}>Le richieste fatte con un prompt su schede, eventi e scene compaiono qui, con piano, controlli e ripristino.</EmptyState>;
  async function revert(op: NarrativeChangeOperation) {
    if (!window.confirm("Ripristinare com'era prima di questa modifica? Se il testo torna identico a quello già revisionato, la revisione precedente torna valida; altrimenti i capitoli toccati verranno rivisti di nuovo.")) return;
    setBusy(true); setMessage("");
    try { await revertNarrativeChange(book.id, op.id, book.updatedAt); await onRefresh(); setMessage("Versione precedente ripristinata."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Ripristino non riuscito."); await onRefresh().catch(() => undefined); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3">
    {message && <p role="status" className="text-sm">{message}</p>}
    <ol className="space-y-3" aria-label="Storico delle modifiche">
      {ops.map(op => {
        const problem = revertProblem(book, op);
        const drift = op.report.flatMap(r => r.drift.map(d => ({ sceneId: r.sceneId, text: d })));
        return <li key={op.id} className="rounded-xl border border-slate-300 p-3 dark:border-slate-700">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><p className="font-semibold [overflow-wrap:anywhere]">{op.targetLabel}</p>
              <p className="muted text-xs">{new Date(op.createdAt).toLocaleString("it-IT")} · {op.mode === "confirm" ? "con conferma" : "automatica"}</p></div>
            <Badge tone={stateTone(op.state)}>{CHANGE_STATE_LABELS[op.state]}</Badge>
          </div>
          <p className="mt-1 text-sm [overflow-wrap:anywhere]">«{op.instruction}»</p>
          <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold">Piano e controlli</summary>
            <div className="mt-2 space-y-2"><PlanDetails book={book} op={op}/>
              {drift.length > 0 && <div role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                <p className="font-semibold">Controllo locale dei fatti (nomi, nomi propri e numeri presenti in una sola versione)</p>
                <ul className="list-disc pl-5">{drift.map(d => <li key={d.sceneId + d.text}>{sceneName(book, d.sceneId)}: {d.text}</li>)}</ul></div>}
              {op.before.scenes.length > 0 && <details><summary className="cursor-pointer text-xs font-semibold">Testo precedente ({op.before.scenes.length} scene)</summary>
                {op.before.scenes.map(s => <div key={s.sceneId} className="mt-2"><p className="text-xs font-semibold">{sceneName(book, s.sceneId)}</p>
                  <p className="muted max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-xs dark:bg-slate-900">{s.text}</p></div>)}
              </details>}
              {op.before.pruned && <p className="muted text-xs">Le copie dei testi sono state rimosse per spazio: resta il registro.</p>}
            </div>
          </details>
          {["completed", "reviewing", "failed"].includes(op.state) && <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy || !!problem || book.status === "running"} onClick={() => void revert(op)}><Undo2 size={15}/> Ripristina versione precedente</Button>
            {problem && <span className="muted text-xs">{problem}</span>}
          </div>}
        </li>;
      })}
    </ol>
  </div>;
}
