import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, Check, GitCompareArrows, History, RotateCcw, Sparkles, Square, X } from "lucide-react";
import type { BookProject } from "../../domain/types";
import { diffSceneText } from "../../domain/scene-diff";
import { CHANGE_KIND_LABELS, elementReviewState, REVIEW_STATE_LABELS, REVIEW_STATE_TONES, type BookEdit, type EditTarget } from "../../domain/book-edits";
import { MAX_AI_EDIT_INSTRUCTION, type AiEditProposal, type AiEditRequest } from "../../domain/ai-edit";
import type { ChangeTarget } from "../../domain/narrative-change";
import { acceptAiEditChange, proposeAiEdit } from "../../application/ai-edit";
import { editBase, restoreEdit } from "../../application/book-editing";
import { Button } from "../ui/button";
import { Badge, Segmented } from "../ui/primitives";
import { ChangePromptBox } from "../world/ChangePromptBox";

const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

/** Word-level comparison (paragraphs for long texts). Never a merge: read-only. */
export function DiffView({ before, after, label = "Confronto prima e dopo", serif = true }: { before: string; after: string; label?: string; serif?: boolean }) {
  const diff = useMemo(() => diffSceneText(before, after), [before, after]);
  const removed = diff.pieces.filter(p => p.kind === "local").reduce((n, p) => n + p.text.length, 0);
  const added = diff.pieces.filter(p => p.kind === "remote").reduce((n, p) => n + p.text.length, 0);
  return <figure aria-label={label} className="min-w-0 space-y-1.5">
    <figcaption className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded bg-rose-500/15 px-1.5 text-rose-800 line-through dark:text-rose-300">tolto</span>
      <span className="rounded bg-emerald-500/15 px-1.5 text-emerald-800 dark:text-emerald-300">aggiunto</span>
      <span className="muted">{removed ? `−${removed.toLocaleString("it-IT")}` : "0"} / +{added.toLocaleString("it-IT")} caratteri{diff.fallback ? " · confronto per paragrafi (testo lungo)" : ""}</span>
    </figcaption>
    <div className={"max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-slate-300 p-3 leading-7 dark:border-slate-700 " + (serif ? "font-serif text-[15px]" : "text-sm")}>
      {diff.pieces.map((piece, index) => piece.kind === "same" ? <span key={index}>{piece.text}</span>
        : piece.kind === "local" ? <del key={index} className="rounded bg-rose-500/15 text-rose-800 dark:text-rose-300"><span className="sr-only">[tolto: </span>{piece.text}<span className="sr-only">]</span></del>
          : <ins key={index} className="rounded bg-emerald-500/15 text-emerald-800 no-underline dark:text-emerald-300"><span className="sr-only">[aggiunto: </span>{piece.text}<span className="sr-only">]</span></ins>)}
    </div>
  </figure>;
}

export function ReviewStateBadge({ book, target, quiet }: { book: BookProject; target: EditTarget; quiet?: boolean }) {
  const state = elementReviewState(book, target);
  if (state === "clean" || (quiet && (state === "review_passed" || state === "review_skipped"))) return null;
  return <Badge tone={REVIEW_STATE_TONES[state]}>{REVIEW_STATE_LABELS[state]}</Badge>;
}

/** Multi-select as removable chips plus an "add" dropdown: touch friendly, scales to long lists. */
export function ChipPicker({ label, options, value, onChange, disabled, empty = "Nessuno" }: {
  label: string; options: ReadonlyArray<{ value: string; label: string }>; value: readonly string[];
  onChange: (value: string[]) => void; disabled?: boolean; empty?: string;
}) {
  const remaining = options.filter(o => !value.includes(o.value));
  const name = (id: string) => options.find(o => o.value === id)?.label ?? id;
  return <fieldset className="min-w-0 space-y-1.5">
    <legend className="text-sm font-medium">{label}</legend>
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {value.length ? value.map(id => <li key={id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 py-0.5 pl-2.5 pr-1 text-xs">
        <span className="truncate">{name(id)}</span>
        <button type="button" disabled={disabled} aria-label={`Togli ${name(id)} da ${label}`} onClick={() => onChange(value.filter(v => v !== id))}
          className="flex size-6 items-center justify-center rounded-full hover:bg-violet-500/20 max-sm:size-9"><X size={13}/></button></li>)
        : <li className="muted text-xs">{empty}</li>}
    </ul>
    {remaining.length > 0 && <select aria-label={`Aggiungi a ${label}`} className="field field-sm" disabled={disabled} value=""
      onChange={e => { if (e.target.value) onChange([...value, e.target.value]); }}>
      <option value="">+ Aggiungi…</option>
      {remaining.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>}
  </fieldset>;
}

/** Human-readable version of a stored snapshot, for the comparison. */
export function readableSnapshot(edit: BookEdit, side: "before" | "after"): string {
  const raw = edit[side];
  if (raw === null) return "";
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (edit.target.kind === "scene" && typeof value.text === "string") return `${String(value.title ?? "")}\n\n${value.text}` + (value.summary ? `\n\nRiassunto: ${String(value.summary)}` : "");
    if (edit.target.kind === "structure") return Array.isArray(value) ? value.map((row, i) => `Capitolo ${i + 1}: ${(row as string[]).length - 1} scene`).join("\n") : "";
    const inner = (value.entity ?? value.event ?? value.chapter ?? value.scene ?? value) as Record<string, unknown>;
    return Object.entries(inner).filter(([key]) => !["history", "version", "updatedAt", "origin"].includes(key))
      .map(([key, field]) => `${key}: ${typeof field === "string" ? field : JSON.stringify(field)}`).join("\n");
  } catch { return raw; }
}

/** The change history of one element, newest first, with comparison and restore. */
export function EditHistory({ book, target, label, onRefresh }: { book: BookProject; target: EditTarget; label: string; onRefresh: () => Promise<void> }) {
  const edits = (book.edits ?? []).filter(e => e.target.kind === target.kind && e.target.id === target.id).reverse();
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (!edits.length) return null;
  async function restore(edit: BookEdit) {
    if (!window.confirm(`Ripristinare «${label}» com'era prima di questa modifica? La versione attuale resta nella cronologia e potrai tornarci.`)) return;
    setBusy(true); setMessage("");
    try { await restoreEdit(book.id, edit.id, target.kind === "structure" ? undefined : editBase(book, target, label)); await onRefresh(); if (mounted.current) setMessage("Versione precedente ripristinata (registrata come nuova modifica, senza review)."); }
    catch (error) { await onRefresh().catch(() => undefined); if (mounted.current) setMessage(errorText(error, "Ripristino non riuscito.")); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <details className="rounded-xl border border-slate-300 dark:border-slate-700">
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-semibold"><History size={15}/> Cronologia delle modifiche ({edits.length})</summary>
    <ol className="space-y-2 border-t border-slate-300 p-3 dark:border-slate-700" aria-label={"Cronologia di " + label}>
      {edits.map(edit => <li key={edit.id} className="rounded-lg border border-slate-300 p-2.5 text-sm dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={edit.origin === "ai" ? "violet" : "sky"}>{edit.origin === "ai" ? "AI" : "Manuale"}</Badge>
          <Badge>{CHANGE_KIND_LABELS[edit.changeKind]}</Badge>
          <Badge tone={REVIEW_STATE_TONES[edit.reviewState]}>{REVIEW_STATE_LABELS[edit.reviewState]}</Badge>
          <span className="muted text-xs">{new Date(edit.at).toLocaleString("it-IT")} · {edit.field.replace(/\+/g, ", ")}</span>
        </div>
        {edit.prompt && <p className="muted mt-1 text-xs [overflow-wrap:anywhere]">«{edit.prompt.slice(0, 300)}»</p>}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {!edit.pruned && (edit.before !== null || edit.after !== null) && <Button size="sm" variant="ghost" aria-expanded={open === edit.id}
            onClick={() => setOpen(open === edit.id ? undefined : edit.id)}><GitCompareArrows size={14}/><span className="text-xs">{open === edit.id ? "Chiudi il confronto" : "Confronta"}</span></Button>}
          {!edit.pruned && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void restore(edit)}><RotateCcw size={14}/><span className="text-xs">Ripristina com'era prima</span></Button>}
          {edit.pruned && <span className="muted text-xs">Copie non più conservate (storico lungo).</span>}
        </div>
        {open === edit.id && <div className="mt-2"><DiffView before={readableSnapshot(edit, "before")} after={readableSnapshot(edit, "after")} serif={edit.target.kind === "scene"}/></div>}
      </li>)}
    </ol>
    {message && <p role="status" className="px-3 pb-3 text-sm">{message}</p>}
  </details>;
}

/** «Modifica solo questo»: a proposal shown as a comparison; nothing changes until accepted. */
export function AiEditPanel({ book, request, label, examples, scopeControl, onRefresh, onApplied }: {
  book: BookProject; request: AiEditRequest; label: string; examples: string[]; scopeControl?: ReactNode; onRefresh: () => Promise<void>;
  /** Called after a change was applied (the element now has new content). */
  onApplied?: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [proposal, setProposal] = useState<AiEditProposal>();
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const selectionKey = request.kind === "scene" ? JSON.stringify(request.selection ?? null) : request.kind === "chapter" ? request.scope : "";
  useEffect(() => { setProposal(undefined); setMessage(""); }, [request.id, selectionKey]);
  const budgetBlock = book.aiBudget?.enabled && book.status === "running" ? "Con un budget AI attivo metti in pausa l'autopilot prima di chiedere una modifica all'AI." : "";
  async function propose() {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setMessage(""); setProposal(undefined); setProgress("Il modello sta preparando la proposta…");
    try {
      const result = await proposeAiEdit(book.id, request, instruction, abort, (done, total) => {
        if (mounted.current && total > 1) setProgress(`Il modello sta preparando la proposta… ${Math.min(done + 1, total)} di ${total}`);
      });
      if (!mounted.current) return;
      setProposal(result);
      if (!result.changes.length) setMessage("Il modello non ha proposto cambiamenti" + (result.notes.length ? ": " + result.notes.join(" ") : "."));
    } catch (error) { if (mounted.current) setMessage(abort.signal.aborted ? "Proposta interrotta: la chiamata può comunque essere addebitata." : errorText(error, "Proposta non riuscita.")); }
    finally { if (mounted.current) { setBusy(false); setProgress(""); } }
  }
  async function decide(index: number, accept: boolean) {
    if (!proposal) return;
    const change = proposal.changes[index]!;
    if (!accept) { setProposal({ ...proposal, changes: proposal.changes.map((c, i) => i === index ? { ...c, status: "rejected" } : c) }); return; }
    setBusy(true); setMessage("");
    try {
      await acceptAiEditChange(book.id, proposal, change);
      await onRefresh();
      if (!mounted.current) return;
      setProposal(p => p && { ...p, changes: p.changes.map((c, i) => i === index ? { ...c, status: "applied" } : c) });
      setMessage("Applicata come modifica AI. Nessuna review avviata: la trovi fra le modifiche da rivedere.");
      onApplied?.();
    } catch (error) { await onRefresh().catch(() => undefined); if (mounted.current) setMessage(errorText(error, "Modifica non applicata.")); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <div className="space-y-2">
    <label className="block text-sm"><span className="font-semibold">Cosa vuoi cambiare in «{label}»?</span>
      <textarea aria-label={`Richiesta di modifica per «${label}»`} className="field mt-1" rows={3} maxLength={MAX_AI_EDIT_INSTRUCTION}
        disabled={busy} value={instruction} placeholder={examples[0]} onChange={e => setInstruction(e.target.value)}/></label>
    {examples.length > 1 && !instruction && <div className="flex flex-wrap gap-1.5" aria-label="Esempi di richiesta">
      {examples.slice(1).map(example => <button key={example} type="button" disabled={busy} onClick={() => setInstruction(example)}
        className="rounded-full border border-slate-300 px-2.5 py-1 text-left hover:border-violet-500 dark:border-slate-600 max-sm:min-h-11"><span className="text-xs">{example}</span></button>)}
    </div>}
    {scopeControl}
    <p className="muted text-xs">Vedrai il confronto prima/dopo: niente cambia finché non applichi. Nessuna review parte da sola. Ogni proposta è una chiamata AI registrata nelle Attività.</p>
    {budgetBlock && <p className="text-xs text-amber-700 dark:text-amber-300">{budgetBlock}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={busy || !!budgetBlock || instruction.trim().length < 8} onClick={() => void propose()}><Bot size={16}/> Proponi la modifica</Button>
      {busy && progress && <Button variant="outline" onClick={() => controller.current?.abort()}><Square size={14}/> Interrompi</Button>}
      {progress && <p role="status" className="muted text-sm">{progress}</p>}
    </div>
    {proposal && proposal.changes.length > 0 && <ol className="space-y-3" aria-label="Modifiche proposte dall'AI">
      {proposal.changes.map((change, index) => <li key={change.key} className="space-y-2 rounded-xl border border-violet-500/40 p-3">
        <div className="flex flex-wrap items-center gap-1.5"><b className="text-sm [overflow-wrap:anywhere]">{change.label}</b>
          {change.status === "applied" && <Badge tone="emerald">Applicata</Badge>}{change.status === "rejected" && <Badge>Scartata</Badge>}</div>
        <DiffView before={change.before} after={change.after} serif={change.target.kind === "scene"}/>
        {change.status === "proposed" && <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void decide(index, true)}><Check size={16}/> Applica questa modifica</Button>
          <Button variant="outline" disabled={busy} onClick={() => void decide(index, false)}>Scarta</Button>
        </div>}
      </li>)}
    </ol>}
    {proposal && proposal.notes.length > 0 && proposal.changes.length > 0 && <ul className="muted list-disc pl-5 text-xs">{proposal.notes.map(note => <li key={note}>{note}</li>)}</ul>}
    {message && <p role="status" className="text-sm [overflow-wrap:anywhere]">{message}</p>}
  </div>;
}

/** The two AI ways to change an element, side by side and explained. */
export function PromptEditChoices({ book, request, label, examples, propagate, scopeControl, onRefresh, onStart }: {
  book: BookProject; request: AiEditRequest; label: string; examples: string[];
  /** Element supported by the tracked change engine (scene, sheet, event). */
  propagate?: ChangeTarget; scopeControl?: ReactNode; onRefresh: () => Promise<void>; onStart: (bookId: string) => void;
}) {
  const [mode, setMode] = useState<"only" | "propagate">("only");
  return <section className="space-y-2 rounded-xl border border-violet-500/40 bg-violet-500/5 p-3" aria-label={"Modifica con l'AI: " + label}>
    <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles size={15} className="text-violet-600 dark:text-violet-300"/> Modifica con l'AI</p>
    {propagate && <Segmented label="Tipo di modifica con l'AI" value={mode} onChange={setMode} options={[
      { value: "only", label: "Modifica solo questo", hint: "Confronto prima/dopo, nessuna review automatica" },
      { value: "propagate", label: "Modifica e aggiorna il libro", hint: "Analizza l'impatto e riscrive le scene collegate" }]}/>}
    {mode === "only" || !propagate
      ? <AiEditPanel book={book} request={request} label={label} examples={examples} scopeControl={scopeControl} onRefresh={onRefresh}/>
      : <ChangePromptBox book={book} target={propagate} label={label} examples={examples} onRefresh={onRefresh} onStart={onStart}/>}
  </section>;
}
