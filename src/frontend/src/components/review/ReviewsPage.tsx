import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, ExternalLink, ListChecks, Play, ShieldAlert, SkipForward, XCircle } from "lucide-react";
import type { BookProject } from "../../domain/types";
import { CHANGE_KIND_LABELS, currentStamp, findScene, pendingElements, REVIEW_STATE_LABELS, REVIEW_STATE_TONES,
  type EditTarget, type PendingElement } from "../../domain/book-edits";
import { activeManualReview, estimateBoardCalls, estimateReviewCalls, REVIEW_ENGINE_LABELS, REVIEW_ENGINES, REVIEW_MODE_LABELS, REVIEW_MODES, REVIEW_SCOPE_LABELS, REVIEW_SCOPES,
  boardReviewChapters, type ManualReview, type ReviewEngine, type ReviewMode, type ReviewScope, type ReviewUnit } from "../../domain/manual-review";
import { describeManualReview, MAX_REVIEW_CORRECTIONS } from "../../domain/manual-review-flow";
import { ENTITY_LABELS } from "../../domain/knowledge";
import { cancelManualReview, decideReviewProposal, requestManualReview } from "../../application/manual-review";
import { skipElementReview } from "../../application/book-editing";
import { Button } from "../ui/button";
import { Badge, EmptyState, Segmented, StatTile } from "../ui/primitives";
import { DiffView, readableSnapshot } from "../edit/EditKit";

const keyOf = (t: EditTarget) => t.kind + "|" + t.id;
const SEVERITY = { critical: { label: "Critico", tone: "rose" }, major: { label: "Importante", tone: "amber" }, minor: { label: "Minore", tone: "sky" } } as const;
const RISK = { high: { label: "Rischio alto", tone: "rose" }, medium: { label: "Rischio medio", tone: "amber" }, low: { label: "Rischio basso", tone: "sky" } } as const;
const OUTCOME = { passed: { label: "Superata", tone: "emerald" }, failed: { label: "Problemi trovati", tone: "rose" }, analysis: { label: "Analisi", tone: "sky" } } as const;
type Filter = "all" | "text" | "world" | "structure";

export function targetKindLabel(book: BookProject, target: EditTarget): string {
  switch (target.kind) {
    case "scene": return "Scena";
    case "chapter": return "Capitolo";
    case "entity": { const e = book.knowledge?.entities.find(x => x.id === target.id); return e ? ENTITY_LABELS[e.type].one : "Scheda"; }
    case "event": return "Evento";
    case "timeline": return "Timeline";
    case "structure": return "Struttura";
    default: return "Impostazioni";
  }
}
const exists = (book: BookProject, target: EditTarget) => currentStamp(book, target) !== "deleted";

function PendingItem({ book, item, checked, onToggle, onOpen, excluded, onToggleEdit }: { book: BookProject; item: PendingElement; checked: boolean; onToggle: () => void; onOpen: (t: EditTarget) => void;
  excluded: ReadonlySet<string>; onToggleEdit: (editId: string) => void }) {
  const first = item.edits[0]!, last = item.edits.at(-1)!;
  const before = readableSnapshot(first, "before"), after = readableSnapshot(last, "after");
  const busyState = item.state === "review_pending" || item.state === "review_in_progress" || item.state === "impact_pending";
  const chosen = item.edits.filter(e => !excluded.has(e.id)).length;
  return <li className={"rounded-xl border p-3 " + (checked ? "border-emerald-600 bg-emerald-500/5" : "border-slate-300 dark:border-slate-700")}>
    <div className="flex items-start gap-3">
      <input type="checkbox" className="mt-1 size-5 shrink-0" checked={checked} disabled={busyState} onChange={onToggle}
        aria-label={`Seleziona ${targetKindLabel(book, item.target).toLowerCase()} «${item.label}»`}/>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{targetKindLabel(book, item.target)}</Badge><b className="[overflow-wrap:anywhere]">{item.label}</b>
          <Badge tone={REVIEW_STATE_TONES[item.state]}>{REVIEW_STATE_LABELS[item.state]}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {item.origins.map(o => <Badge key={o} tone={o === "ai" ? "violet" : "sky"}>{o === "ai" ? "Modifica AI" : "Modifica manuale"}</Badge>)}
          {item.changeKinds.map(k => <Badge key={k}>{CHANGE_KIND_LABELS[k]}</Badge>)}
          <span className="muted">{item.edits.length} {item.edits.length === 1 ? "modifica" : "modifiche"} · ultima {new Date(item.lastAt).toLocaleString("it-IT")}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {exists(book, item.target) && <Button size="sm" variant="ghost" onClick={() => onOpen(item.target)}><ExternalLink size={14}/><span className="text-xs">Apri</span></Button>}
          {(before || after) && !first.pruned && !last.pruned && <details className="w-full">
            <summary className="cursor-pointer text-xs font-semibold">Cosa è cambiato</summary>
            <div className="mt-2"><DiffView before={before} after={after} serif={item.target.kind === "scene"}/></div></details>}
        </div>
        {checked && item.edits.length > 1 && <fieldset className="space-y-1 rounded-lg border border-slate-300 p-2 dark:border-slate-700">
          <legend className="px-1 text-xs font-semibold">Quali modifiche rivedere ({chosen} di {item.edits.length})</legend>
          {item.edits.map(edit => <label key={edit.id} className="flex min-h-9 items-center gap-2 text-xs">
            <input type="checkbox" className="size-4 shrink-0" checked={!excluded.has(edit.id)} onChange={() => onToggleEdit(edit.id)}/>
            <span className="[overflow-wrap:anywhere]">{new Date(edit.at).toLocaleString("it-IT")} · {edit.origin === "ai" ? "AI" : "manuale"} · {edit.field.replace(/\+/g, ", ")}{edit.prompt ? ` · «${edit.prompt.slice(0, 80)}»` : ""}</span>
          </label>)}
          <p className="muted text-xs">Quelle escluse restano «da rivedere». Il controllo legge comunque il testo attuale.</p>
        </fieldset>}
      </div>
    </div>
  </li>;
}

/** Where one element of the running review is: read from the review and, for the board, from the chapters. */
function unitProgress(book: BookProject, review: ManualReview, unit: ReviewUnit, index: number): { label: string; tone: "emerald" | "rose" | "amber" | "violet" | "neutral" } {
  if (review.engine === "board") {
    const chapter = book.chapters.find(c => c.id === unit.targetId);
    if (!chapter) return { label: "Non più presente", tone: "neutral" };
    if (chapter.frozenAt) return { label: "Congelato di nuovo", tone: "emerald" };
    if (book.editorialCycle?.chapterId === chapter.id) return { label: book.editorialCycle.stage === "blocked" ? "Redazione bloccata" : "In redazione", tone: book.editorialCycle.stage === "blocked" ? "amber" : "violet" };
    return { label: "In attesa", tone: "neutral" };
  }
  const findings = review.findings.filter(f => f.unitKey === unit.key).length;
  if (unit.status === "done") return findings ? { label: `${findings} ${findings === 1 ? "problema" : "problemi"}`, tone: "rose" } : { label: "Nessun problema", tone: "emerald" };
  if (unit.status === "failed") return { label: "Non controllato", tone: "amber" };
  if (review.stage === "check" && index === review.cursor && review.status === "in_progress") return { label: "In corso", tone: "violet" };
  return { label: "In attesa", tone: "neutral" };
}

function ActiveReview({ book, review, runningHere, onStart, onRefresh }: { book: BookProject; review: ManualReview; runningHere: boolean; onStart: (id: string) => void; onRefresh: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const described = describeManualReview(book, review);
  const board = review.engine === "board";
  const done = board ? review.units.filter(u => book.chapters.find(c => c.id === u.targetId)?.frozenAt).length
    : review.stage === "check" ? review.cursor : review.units.length;
  const total = Math.max(1, review.units.length);
  const percent = review.scope === "impact" ? (review.status === "in_progress" ? 50 : 5) : Math.round((done / total) * 100);
  const waiting = book.status !== "running";
  async function cancel() {
    if (!window.confirm(board ? "Annullare la review? Le modifiche incluse tornano «da rivedere». I capitoli già riaperti restano da congelare: l'autopilot li farà comunque rivedere dalla redazione."
      : "Annullare la review? Le modifiche incluse tornano «da rivedere»; un'eventuale risposta AI in arrivo viene scartata (può essere addebitata).")) return;
    try { await cancelManualReview(book.id, review.id); await onRefresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Review non annullata."); await onRefresh().catch(() => undefined); }
  }
  return <section className="panel space-y-3 border-violet-500/60 p-3 sm:p-4" aria-label="Review in corso">
    <div className="flex flex-wrap items-center gap-2">
      <ClipboardCheck size={18} className="text-violet-600 dark:text-violet-300"/>
      <h3 className="font-semibold">Review in corso</h3>
      <Badge tone="violet">{REVIEW_SCOPE_LABELS[review.scope].label}</Badge>{board ? <Badge>{REVIEW_ENGINE_LABELS.board.label}</Badge> : <Badge>{REVIEW_MODE_LABELS[review.mode].label}</Badge>}
    </div>
    <p className="text-sm">{described.headline}</p>
    <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-label="Avanzamento della review" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <div className="h-full bg-violet-600 transition-[width] motion-reduce:transition-none" style={{ width: percent + "%" }}/>
    </div>
    {review.units.length > 0 && <details className="rounded-lg border border-slate-300 dark:border-slate-700" open={review.units.length <= 8}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-2.5 text-sm font-semibold">{board ? "Capitoli" : "Elementi"} della review ({done} di {review.units.length})</summary>
      <ol className="space-y-1.5 border-t border-slate-300 p-2.5 dark:border-slate-700" aria-label="Avanzamento per elemento">
        {review.units.map((unit, index) => { const progress = unitProgress(book, review, unit, index);
          return <li key={unit.key} className="flex flex-wrap items-center gap-1.5 text-sm">
            <Badge tone={progress.tone}>{progress.label}</Badge><span className="min-w-0 [overflow-wrap:anywhere]">{unit.label}</span>
            {!unit.edited && !board && <span className="muted text-xs">collegato</span>}
          </li>; })}
      </ol>
    </details>}
    {waiting ? <p className="text-sm text-amber-700 dark:text-amber-300">In attesa: la review la esegue l'autopilot. Avviala qui; alla fine il libro torna com'era.</p>
      : !runningHere ? <p className="muted text-sm">L'autopilot la sta eseguendo in un'altra scheda.</p>
        : <p className="muted text-sm">L'autopilot la esegue ora, prima di qualunque altro passo. La vedi in diretta nella Dashboard.</p>}
    <div className="flex flex-wrap gap-2">
      {waiting && <Button onClick={() => onStart(book.id)}><Play size={16}/> Avvia la review</Button>}
      <Button variant="outline" onClick={() => void cancel()}><XCircle size={16}/> Annulla la review</Button>
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}

function ReviewReport({ book, review, onOpen, onReviewTargets, onRefresh }: { book: BookProject; review: ManualReview; onOpen: (t: EditTarget) => void;
  onReviewTargets: (targets: EditTarget[]) => void; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const outcome = review.status === "cancelled" ? { label: "Annullata", tone: "neutral" as const } : review.outcome ? OUTCOME[review.outcome] : { label: "In corso", tone: "violet" as const };
  const pendingProposals = review.proposals.filter(p => p.status === "proposed");
  const [open, setOpen] = useState(pendingProposals.length > 0);
  async function decide(id: string, accept: boolean) {
    setBusy(true); setMessage("");
    try { await decideReviewProposal(book.id, review.id, id, accept); await onRefresh(); setMessage(accept ? "Correzione applicata come modifica AI: puoi rivederla di nuovo." : "Correzione scartata."); }
    catch (error) { await onRefresh().catch(() => undefined); setMessage(error instanceof Error ? error.message : "Decisione non salvata."); }
    finally { setBusy(false); }
  }
  return <li><details className="rounded-xl border border-slate-300 dark:border-slate-700" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
    <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-1.5 px-3 py-2">
      <Badge tone={outcome.tone}>{outcome.label}</Badge><b className="text-sm">{REVIEW_SCOPE_LABELS[review.scope].label}</b>
      <span className="muted text-xs">{REVIEW_MODE_LABELS[review.mode].label} · {new Date(review.createdAt).toLocaleString("it-IT")}</span>
      {pendingProposals.length > 0 && <Badge tone="amber">{pendingProposals.length} da approvare</Badge>}
    </summary>
    <div className="space-y-3 border-t border-slate-300 p-3 dark:border-slate-700">
      {review.summary && <p className="text-sm">{review.summary}</p>}
      {review.error && <p className="text-sm text-amber-700 dark:text-amber-300">{review.error}</p>}
      {review.impacts && <section className="space-y-2"><h4 className="text-sm font-semibold">Possibili conseguenze ({review.impacts.length})</h4>
        {review.impacts.length ? <ul className="space-y-1.5">{review.impacts.map(impact => <li key={impact.targetKind + impact.targetId} className="flex flex-wrap items-start gap-1.5 text-sm">
          <Badge tone={RISK[impact.risk].tone}>{RISK[impact.risk].label}</Badge><b className="[overflow-wrap:anywhere]">{impact.label}</b>
          <span className="muted w-full">{impact.reason}</span>
          {exists(book, { kind: impact.targetKind, id: impact.targetId }) && <Button size="sm" variant="ghost" onClick={() => onOpen({ kind: impact.targetKind, id: impact.targetId })}><ExternalLink size={14}/><span className="text-xs">Apri</span></Button>}
        </li>)}</ul> : <p className="muted text-sm">Nessuna conseguenza individuata.</p>}
        {review.impacts.length > 0 && <Button size="sm" variant="outline" onClick={() => onReviewTargets([...review.targets.map(t => ({ kind: t.kind, id: t.id })),
          ...review.impacts!.filter(i => i.risk !== "low").map(i => ({ kind: i.targetKind, id: i.targetId }))])}><ListChecks size={14}/><span className="text-xs">Prepara una review su modifiche ed elementi a rischio</span></Button>}
      </section>}
      {review.units.length > 0 && <section className="space-y-2"><h4 className="text-sm font-semibold">Elementi controllati</h4>
        <ul className="space-y-2">{review.units.map(unit => {
          const findings = review.findings.filter(f => f.unitKey === unit.key);
          return <li key={unit.key} className="rounded-lg border border-slate-300 p-2.5 text-sm dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-1.5"><b className="[overflow-wrap:anywhere]">{unit.label}</b>
              {!unit.edited && <Badge>Collegato</Badge>}
              <Badge tone={unit.status === "done" ? findings.length ? "rose" : "emerald" : unit.status === "failed" ? "amber" : "neutral"}>
                {unit.status === "done" ? findings.length ? `${findings.length} ${findings.length === 1 ? "problema" : "problemi"}` : "Nessun problema" : unit.status === "failed" ? "Non controllato" : "In attesa"}</Badge></div>
            {unit.note && <p className="muted mt-1 text-xs">{unit.note}</p>}
            {findings.length > 0 && <ul className="mt-2 space-y-2">{findings.map(f => <li key={f.id} className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
              <div className="flex flex-wrap gap-1.5"><Badge tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].label}</Badge><Badge>{f.category}</Badge>{f.ruleId && <Badge tone="violet">Regola {f.ruleId}</Badge>}</div>
              {f.evidence && <blockquote className="mt-1 border-l-2 border-slate-400 pl-2 font-serif text-sm italic">«{f.evidence}»</blockquote>}
              <p className="mt-1">{f.issue}</p><p className="muted mt-0.5 text-xs">Suggerimento: {f.suggestion}</p>
            </li>)}</ul>}
          </li>;
        })}</ul></section>}
      {review.proposals.length > 0 && <section className="space-y-2"><h4 className="text-sm font-semibold">Correzioni</h4>
        <ul className="space-y-3">{review.proposals.map(proposal => {
          const found = findScene(book, proposal.sceneId);
          const current = found && currentStamp(book, { kind: "scene", id: proposal.sceneId }) === proposal.beforeStamp;
          const label = found ? `Cap. ${found.chapter.number} · ${found.scene.number}. ${found.scene.title}` : proposal.sceneId;
          return <li key={proposal.id} className="space-y-2 rounded-lg border border-slate-300 p-2.5 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-1.5"><b className="text-sm">{label}</b>
              <Badge tone={proposal.status === "applied" ? "emerald" : proposal.status === "rejected" ? "neutral" : current ? "amber" : "neutral"}>
                {proposal.status === "applied" ? "Applicata" : proposal.status === "rejected" ? "Scartata" : current ? "Da approvare" : "Superata (scena cambiata)"}</Badge></div>
            {proposal.status === "proposed" && current && found && <>
              <DiffView before={found.scene.text} after={proposal.text}/>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void decide(proposal.id, true)}>Applica la correzione</Button>
                <Button variant="outline" disabled={busy} onClick={() => void decide(proposal.id, false)}>Scarta</Button>
              </div></>}
            {proposal.status === "proposed" && !current && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide(proposal.id, false)}><span className="text-xs">Archivia la proposta superata</span></Button>}
          </li>;
        })}</ul></section>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </div>
  </details></li>;
}

/** Pending edits, the review the author chooses, its progress and its reports. */
export function ReviewsPage({ book, runningHere, onStart, onRefresh, onOpen, preselect, onPreselectUsed }: {
  book: BookProject; runningHere: boolean; onStart: (bookId: string) => void; onRefresh: () => Promise<void>; onOpen: (target: EditTarget) => void;
  /** Elements chosen from another page (a scene just saved, a chapter changed after its review). */
  preselect?: EditTarget[]; onPreselectUsed?: () => void;
}) {
  const pending = useMemo(() => pendingElements(book), [book]);
  const active = activeManualReview(book);
  const [selected, setSelected] = useState<EditTarget[]>([]);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [scope, setScope] = useState<ReviewScope>("targeted");
  const [mode, setMode] = useState<ReviewMode>("check");
  const [engine, setEngine] = useState<ReviewEngine>("verifier");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // A selection only keeps elements that still exist.
  useEffect(() => { setSelected(list => list.filter(t => exists(book, t))); }, [book]);
  useEffect(() => {
    if (!preselect?.length) return;
    const chosen = preselect.filter((t, i) => preselect.findIndex(x => keyOf(x) === keyOf(t)) === i && exists(book, t));
    setSelected(chosen); setScope("targeted");
    setMessage(chosen.length ? `Selezionati ${chosen.length} ${chosen.length === 1 ? "elemento" : "elementi"}: scegli il tipo di review qui sotto.` : "");
    onPreselectUsed?.();
  }, [preselect]); // eslint-disable-line react-hooks/exhaustive-deps
  const board = scope === "full" && engine === "board";
  const staleChapters = book.chapters.filter(c => c.reviewStale);
  const reviews = [...(book.manualReviews ?? [])].reverse().filter(r => r !== active);
  const shown = pending.filter(p => filter === "all" || (filter === "text" ? p.target.kind === "scene" || p.target.kind === "chapter"
    : filter === "structure" ? p.target.kind === "structure" : ["entity", "event", "timeline"].includes(p.target.kind)));
  const isSelected = (t: EditTarget) => selected.some(s => keyOf(s) === keyOf(t));
  const toggle = (t: EditTarget) => setSelected(list => isSelected(t) ? list.filter(s => keyOf(s) !== keyOf(t)) : [...list, t]);
  const extra = selected.filter(t => !pending.some(p => keyOf(p.target) === keyOf(t)));
  const calls = board ? estimateBoardCalls(book) : estimateReviewCalls(book, scope, selected);
  const effectiveMode = scope === "impact" ? "check" : mode;
  // Edits of the selected elements the author left out: the review describes only the others.
  const selectedEdits = pending.filter(p => isSelected(p.target)).flatMap(p => p.edits.map(e => e.id));
  const subset = scope !== "full" && selectedEdits.some(id => excluded.has(id));
  const blocked = active ? "C'è già una review in corso: attendi che finisca o annullala." :
    book.editorialReviewSceneIds?.length ? "Prima conferma le scene fuse nella pagina Libro." :
      board && book.editorialCycle ? "Una redazione di capitolo è già in corso: attendi che finisca." :
        board && !boardReviewChapters(book).length ? "Nessun capitolo revisionato da rileggere." :
          scope !== "full" && !selected.length ? "Seleziona almeno un elemento da controllare." :
            !board && calls > 400 ? "Troppi elementi: scegli una review più mirata." : "";
  async function start() {
    const heavy = scope === "full" || effectiveMode === "auto" || calls > 10;
    const text = board
      ? `${REVIEW_SCOPE_LABELS.full.label} · ${REVIEW_ENGINE_LABELS.board.label}\n\nLa redazione riapre ${boardReviewChapters(book).length} capitoli e li rilegge uno alla volta: almeno ${calls} chiamate AI, di più se trova problemi da correggere (fino a 3 tornate per capitolo).\n\nLe correzioni passano dal giudizio del direttore, come durante la scrittura.\n\nAvviare?`
      : `${REVIEW_SCOPE_LABELS[scope].label} · ${REVIEW_MODE_LABELS[effectiveMode].label}\n\nCirca ${calls} ${calls === 1 ? "chiamata" : "chiamate"} AI` +
      (effectiveMode !== "check" ? ` più al massimo ${MAX_REVIEW_CORRECTIONS} correzioni` : "") + "." +
      (effectiveMode === "auto" ? "\n\nLe correzioni vengono applicate da sole alle scene della review (restano annullabili dalla cronologia)." : "\n\nIl testo non cambia senza la tua approvazione.") +
      "\n\nAvviare?";
    if (heavy && !window.confirm(text)) return;
    setBusy(true); setMessage("");
    try {
      await requestManualReview(book.id, { scope, mode: board ? "auto" : effectiveMode, targets: selected, ...(board ? { engine: "board" as const } : {}),
        ...(subset ? { editIds: selectedEdits.filter(id => !excluded.has(id)) } : {}) });
      await onRefresh();
      if (!mounted.current) return;
      setSelected([]); setExcluded(new Set());
      if (book.status !== "running") { onStart(book.id); setMessage("Review avviata: l'autopilot la esegue ora e poi rimette il libro com'era."); }
      else setMessage(runningHere ? "Review in coda: l'autopilot la esegue prima del prossimo passo." : "Review in coda: la esegue l'autopilot attivo nell'altra scheda.");
    } catch (error) { await onRefresh().catch(() => undefined); if (mounted.current) setMessage(error instanceof Error ? error.message : "Review non avviata."); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function skip() {
    const own = selected.filter(t => pending.some(p => keyOf(p.target) === keyOf(t)));
    if (!own.length || !window.confirm(`Segnare ${own.length} ${own.length === 1 ? "modifica" : "modifiche"} come «review saltata»? Resteranno nella cronologia e torneranno da rivedere se le modifichi ancora.`)) return;
    setBusy(true); setMessage("");
    try { await skipElementReview(book.id, own); await onRefresh(); if (mounted.current) { setSelected([]); setMessage("Review saltata per le modifiche scelte."); } }
    catch (error) { await onRefresh().catch(() => undefined); if (mounted.current) setMessage(error instanceof Error ? error.message : "Operazione non riuscita."); }
    finally { if (mounted.current) setBusy(false); }
  }
  function prepare(targets: EditTarget[]) {
    const unique = targets.filter((t, i) => targets.findIndex(x => keyOf(x) === keyOf(t)) === i && exists(book, t));
    setSelected(unique); setScope("targeted");
    setMessage(`Selezionati ${unique.length} elementi: scegli il tipo di review qui sotto.`);
    document.getElementById("review-actions")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return <div className="min-w-0 space-y-4">
    <section className="panel space-y-3 p-3 sm:p-4" aria-label="Modifiche e review">
      <div className="min-w-0"><h2 className="flex items-center gap-2 text-lg font-semibold"><ListChecks size={20} className="text-emerald-600 dark:text-emerald-300"/> Modifiche e review</h2>
        <p className="muted text-sm">Salvare non è validare: ogni modifica, tua o dell'AI, resta «da rivedere» finché non scegli tu cosa controllare, quando e come. Nessuna review parte da sola.</p></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Da rivedere" value={pending.filter(p => p.state === "modified_unreviewed" || p.state === "review_failed").length}/>
        <StatTile label="Review in corso" value={active ? 1 : 0}/>
        <StatTile label="Capitoli modificati dopo la revisione" value={staleChapters.length}/>
        <StatTile label="Review fatte" value={(book.manualReviews ?? []).filter(r => r.status === "completed").length}/>
      </div>
    </section>
    {active && <ActiveReview book={book} review={active} runningHere={runningHere} onStart={onStart} onRefresh={onRefresh}/>}
    {staleChapters.length > 0 && <section className="panel space-y-2 p-3 sm:p-4" aria-label="Capitoli modificati dopo la revisione">
      <h3 className="flex items-center gap-2 font-semibold"><ShieldAlert size={17} className="text-amber-600"/> Capitoli modificati dopo la revisione</h3>
      <p className="muted text-sm">Restano congelati: il libro va avanti. La validazione precedente però non copre più il testo cambiato.</p>
      <ul className="space-y-1.5">{staleChapters.map(chapter => {
        const targets = chapter.reviewStale!.editIds.map(id => book.edits?.find(e => e.id === id)?.target).filter((t): t is EditTarget => !!t);
        return <li key={chapter.id} className="flex flex-wrap items-center gap-2 text-sm">
          <b>Capitolo {chapter.number} — {chapter.title}</b><Badge tone="amber">{chapter.reviewStale!.editIds.length} {chapter.reviewStale!.editIds.length === 1 ? "modifica" : "modifiche"}</Badge>
          <Button size="sm" variant="outline" onClick={() => prepare(targets)}><span className="text-xs">Seleziona le sue modifiche</span></Button>
        </li>;
      })}</ul>
    </section>}
    <section className="panel space-y-3 p-3 sm:p-4" aria-label="Modifiche da rivedere">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Modifiche da rivedere ({pending.length})</h3>
        {pending.length > 0 && <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setSelected(sel => [...sel.filter(t => !shown.some(p => keyOf(p.target) === keyOf(t))),
            ...shown.filter(p => p.state === "modified_unreviewed" || p.state === "review_failed").map(p => p.target)])}><span className="text-xs">Seleziona tutte</span></Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}><span className="text-xs">Deseleziona</span></Button>
        </div>}
      </div>
      {pending.length > 0 && <Segmented label="Mostra" value={filter} onChange={setFilter} options={[{ value: "all", label: "Tutte" }, { value: "text", label: "Testo e capitoli" },
        { value: "world", label: "Schede ed eventi" }, { value: "structure", label: "Struttura" }]}/>}
      {!pending.length ? <EmptyState title="Nessuna modifica da rivedere" icon={<ClipboardCheck size={26}/>}>Quando modifichi scene, capitoli, schede o eventi le trovi qui, con il confronto prima/dopo.</EmptyState>
        : <ul className="space-y-2" aria-label="Elenco delle modifiche da rivedere">{shown.map(item => <PendingItem key={keyOf(item.target)} book={book} item={item}
          checked={isSelected(item.target)} onToggle={() => toggle(item.target)} onOpen={onOpen} excluded={excluded}
          onToggleEdit={id => setExcluded(set => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; })}/>)}</ul>}
      {extra.length > 0 && <p className="text-sm">Anche <b>{extra.length}</b> {extra.length === 1 ? "elemento collegato" : "elementi collegati"} scelti dall'analisi d'impatto. <Button size="sm" variant="ghost" onClick={() => setSelected(sel => sel.filter(t => !extra.includes(t)))}><span className="text-xs">Togli</span></Button></p>}
    </section>
    <section id="review-actions" className="panel space-y-3 p-3 sm:p-4" aria-label="Scegli la review">
      <h3 className="font-semibold">Cosa fare {selected.length ? `con ${selected.length} ${selected.length === 1 ? "elemento selezionato" : "elementi selezionati"}` : "adesso"}</h3>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Tipo di review">
        {REVIEW_SCOPES.map(value => <button key={value} type="button" role="radio" aria-checked={scope === value} onClick={() => setScope(value)}
          className={"min-h-11 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-emerald-500 " + (scope === value ? "border-emerald-600 bg-emerald-500/10" : "border-slate-300 hover:border-emerald-500 dark:border-slate-700")}>
          <span className="block font-semibold">{REVIEW_SCOPE_LABELS[value].label}</span><span className="muted block text-xs">{REVIEW_SCOPE_LABELS[value].hint}</span></button>)}
      </div>
      {scope === "full" && <div className="space-y-1"><p className="text-sm font-semibold">Chi rilegge</p>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Chi rilegge il libro">
          {REVIEW_ENGINES.map(value => <button key={value} type="button" role="radio" aria-checked={engine === value} onClick={() => setEngine(value)}
            className={"min-h-11 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-emerald-500 " + (engine === value ? "border-violet-600 bg-violet-500/10" : "border-slate-300 hover:border-violet-500 dark:border-slate-700")}>
            <span className="block font-semibold">{REVIEW_ENGINE_LABELS[value].label}</span><span className="muted block text-xs">{REVIEW_ENGINE_LABELS[value].hint}</span></button>)}
        </div></div>}
      {scope !== "impact" && !board && <div className="space-y-1"><p className="text-sm font-semibold">Come</p>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Modalità della review">
          {REVIEW_MODES.map(value => <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)}
            className={"min-h-11 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-emerald-500 " + (mode === value ? "border-violet-600 bg-violet-500/10" : "border-slate-300 hover:border-violet-500 dark:border-slate-700")}>
            <span className="block font-semibold">{REVIEW_MODE_LABELS[value].label}</span><span className="muted block text-xs">{REVIEW_MODE_LABELS[value].hint}</span></button>)}
        </div></div>}
      <p className="text-sm" aria-live="polite">{board
        ? <>Stima: <b>almeno {calls} chiamate AI</b> per {boardReviewChapters(book).length} capitoli (revisori, direttore e sinossi), di più se servono correzioni e nuove tornate. La esegue l'autopilot, capitolo per capitolo; {book.status === "running" ? "prima del prossimo passo." : "poi il libro torna com'era."}</>
        : <>Stima: <b>{calls > 400 ? "oltre 400" : calls} {calls === 1 ? "chiamata" : "chiamate"} AI</b>{effectiveMode !== "check" ? ` più le correzioni (max ${MAX_REVIEW_CORRECTIONS})` : ""}. La esegue l'autopilot con budget, registro e vista in diretta; {book.status === "running" ? "prima del prossimo passo." : "poi il libro torna com'era."}</>}</p>
      {subset && <p className="muted text-xs">Alcune modifiche degli elementi scelti sono escluse: restano «da rivedere».</p>}
      {blocked && <p className="text-sm text-amber-700 dark:text-amber-300">{blocked}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !!blocked} onClick={() => void start()}><Play size={16}/> {scope === "impact" ? "Analizza l'impatto" : "Avvia la review"}</Button>
        <Button variant="ghost" disabled={busy || !selected.some(t => pending.some(p => keyOf(p.target) === keyOf(t)))} onClick={() => void skip()}><SkipForward size={16}/> Salta la review</Button>
      </div>
      {message && <p role="status" className="text-sm [overflow-wrap:anywhere]">{message}</p>}
    </section>
    {reviews.length > 0 && <section className="panel space-y-2 p-3 sm:p-4" aria-label="Rapporti delle review">
      <h3 className="font-semibold">Rapporti ({reviews.length})</h3>
      <ul className="space-y-2">{reviews.map(review => <ReviewReport key={review.id} book={book} review={review} onOpen={onOpen} onReviewTargets={prepare} onRefresh={onRefresh}/>)}</ul>
    </section>}
  </div>;
}
