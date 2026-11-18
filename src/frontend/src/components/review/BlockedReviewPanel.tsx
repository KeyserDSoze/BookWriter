import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ClipboardCheck, ListChecks, Save } from "lucide-react";
import type { BookProject } from "../../domain/types";
import { reviewerLabel } from "../../domain/editorial-board";
import { blockedReviewItems, blockedReviewSource, composeBlockedInstruction, emptyDraft, followDirectorOnAll, itemReady, reviewProgress,
  type BlockedReviewDraft, type BlockedReviewItem, type ItemChoice } from "../../domain/blocked-review";
import { clearBlockedDraft, closeBlockedChapterByAuthor, loadBlockedDraft, saveBlockedDraft } from "../../application/blocked-review";
import { reopenChapterReview } from "../../application/editorial-control";
import { updateDirectorDecidesWhenBlocked } from "../../application/book-settings";
import { Button } from "../ui/button";
import { Badge } from "../ui/primitives";

const SEVERITY = { critical: { label: "Critico", tone: "rose" }, major: { label: "Importante", tone: "amber" }, minor: { label: "Minore", tone: "sky" } } as const;
const CHOICE_LABELS: Record<ItemChoice, string> = {
  follow_director: "Accetto la proposta del direttore",
  accept_as_is: "Accetta così com'è (eccezione: non riproporre)",
  custom: "Con una mia indicazione",
};

/** Checkbox that hands the final decision on blocked chapters to the director. */
export function DirectorDecidesToggle({ book, onRefresh }: { book: BookProject; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const checked = book.directorDecidesWhenBlocked === true;
  async function change(next: boolean) {
    if (next && !window.confirm("Quando i cicli di revisione di un capitolo sono finiti con rilievi ancora aperti, il direttore chiuderà il capitolo da solo e l'autopilot andrà avanti, senza chiederti nulla. Ogni decisione resta registrata sul capitolo. Attivare?")) return;
    setBusy(true); setMessage("");
    try { await updateDirectorDecidesWhenBlocked(book.id, book.updatedAt, next); await onRefresh(); }
    catch (error) { await onRefresh().catch(() => undefined); setMessage(error instanceof Error ? error.message : "Impostazione non salvata."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-1">
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={checked} disabled={busy || book.status === "running"} onChange={e => void change(e.target.checked)}/>
      <span><b>Il direttore decide da solo a fine cicli.</b> Se un capitolo resta con rilievi aperti dopo le tornate previste, il direttore lo chiude e si prende la responsabilità: l'autopilot va avanti e scrive il libro in autonomia. La chiusura salta la verifica finale ed è sempre registrata sul capitolo.</span>
    </label>
    {book.status === "running" && <p className="muted text-xs">Metti in pausa l'autopilot per cambiare questa impostazione.</p>}
    {message && <p role="status" className="text-xs text-rose-700 dark:text-rose-300">{message}</p>}
  </div>;
}

function ItemCard({ item, profiles, decision, onChoice, onNote }: {
  item: BlockedReviewItem; profiles: Parameters<typeof reviewerLabel>[1];
  decision: { choice: ItemChoice; note: string } | undefined; onChoice: (choice: ItemChoice) => void; onNote: (note: string) => void;
}) {
  const director = item.director;
  const accepted = director?.action === "accept";
  return <article className="space-y-3 rounded-xl border border-slate-300 p-3 dark:border-slate-700" aria-label={`Rilievo ${item.category}`}>
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={SEVERITY[item.severity].tone}>{SEVERITY[item.severity].label}</Badge>
      <Badge>{reviewerLabel(item.role, profiles)}</Badge>
      <b className="[overflow-wrap:anywhere]">{item.category}</b>
      <span className="muted text-xs">{item.sceneLabel}</span>
    </div>
    <blockquote className="border-l-4 border-slate-300 pl-3 text-sm italic [overflow-wrap:anywhere] dark:border-slate-600">{item.evidence}</blockquote>
    <div className="space-y-1 text-sm">
      <p><b>Cosa segnala il revisore:</b> {item.reason}</p>
      <p><b>Cosa propone:</b> {item.remediation}</p>
    </div>
    <div className={"space-y-1 rounded-lg border p-2.5 text-sm " + (accepted ? "border-emerald-600/60 bg-emerald-500/5" : "border-amber-500/60 bg-amber-500/5")}>
      {director ? <>
        <p><Badge tone={accepted ? "emerald" : "amber"}>{accepted ? "Il direttore ha accettato la correzione" : "Il direttore ha respinto il rilievo"}</Badge></p>
        <p><b>Motivo:</b> {director.rationale}</p>
        {accepted && <p><b>Come l'ha trattato:</b> {director.remediation} <span className="muted">(la correzione è già stata applicata alla scena, ma la tornata dopo non è stata verificata)</span></p>}
      </> : <p className="muted">Il direttore non ha ancora giudicato questo rilievo.</p>}
    </div>
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-semibold">La tua decisione</legend>
      {(Object.keys(CHOICE_LABELS) as ItemChoice[]).map(choice => <label key={choice} className="flex items-center gap-2 text-sm">
        <input type="radio" className="size-5" name={"choice-" + item.findingId} checked={decision?.choice === choice} onChange={() => onChoice(choice)}/>
        {CHOICE_LABELS[choice]}
      </label>)}
      {decision?.choice === "custom" && <label className="block text-sm font-semibold">La tua indicazione
        <textarea className="field mt-1 min-h-32" rows={6} value={decision.note} onChange={e => onNote(e.target.value)}
          placeholder="Scrivi come vuoi che il capitolo affronti questo punto. Nessun limite per la bozza; il testo finale deve entrare nei vincoli del libro."/>
        {decision.note.trim().length < 8 && <span className="muted text-xs font-normal">Servono almeno 8 caratteri.</span>}
      </label>}
    </fieldset>
  </article>;
}

/** Pull-request style review of a blocked editorial round: every finding, the director's
 * handling, the author's choice, a draft kept on this device, then one final action. */
export function BlockedReviewPanel({ book, onRefresh, onStart }: { book: BookProject; onRefresh: () => Promise<void>; onStart: (bookId: string) => void }) {
  const source = blockedReviewSource(book);
  const items = useMemo(() => blockedReviewItems(book), [book]);
  const chapterId = source?.chapter.id ?? "";
  const round = source?.round ?? 0;
  const [draft, setDraft] = useState<BlockedReviewDraft>(() => emptyDraft(chapterId, round));
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [savedAt, setSavedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!chapterId) return;
    let cancelled = false;
    setLoaded(false); dirty.current = false;
    void loadBlockedDraft(book.id, chapterId, round).then(stored => {
      if (cancelled) return;
      setDraft(stored); setLoaded(true);
      if (stored.updatedAt !== new Date(0).toISOString()) setSavedAt(stored.updatedAt);
    }).catch(() => { if (!cancelled) { setDraft(emptyDraft(chapterId, round)); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [book.id, chapterId, round]);
  // Draft kept on this device a moment after the last change.
  useEffect(() => {
    if (!loaded || !dirty.current) return;
    const timer = window.setTimeout(() => {
      void saveBlockedDraft(book.id, draft).then(saved => { dirty.current = false; if (mounted.current) setSavedAt(saved.updatedAt); }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, loaded, book.id]);

  if (!source) return null;
  const update = (next: BlockedReviewDraft) => { dirty.current = true; setDraft(next); };
  const setDecision = (id: string, patch: Partial<{ choice: ItemChoice; note: string }>) =>
    update({ ...draft, decisions: { ...draft.decisions, [id]: { choice: draft.decisions[id]?.choice ?? "follow_director", note: draft.decisions[id]?.note ?? "", ...patch } } });
  const progress = reviewProgress(items, draft);
  const composed = composeBlockedInstruction(book, items, draft);
  const current = items[Math.min(index, Math.max(0, items.length - 1))];
  const hasDirectorOnItems = items.length > 0;

  async function saveNow() {
    try { const saved = await saveBlockedDraft(book.id, draft); dirty.current = false; setSavedAt(saved.updatedAt); setMessage("Bozza salvata su questo dispositivo."); }
    catch { setMessage("Bozza non salvata."); }
  }
  async function apply() {
    if (!window.confirm(`Il capitolo ${source!.chapter.number} riparte con una nuova tornata di revisione tenendo conto delle tue decisioni (${composed.length} caratteri aggiunti ai vincoli del libro). Costa nuove chiamate AI. Procedere?`)) return;
    setBusy(true); setMessage("");
    try {
      await reopenChapterReview(book.id, source!.chapter.id, composed.text);
      await clearBlockedDraft(book.id, chapterId, round).catch(() => undefined);
      await onRefresh();
      if (mounted.current) setMessage("Nuova tornata pronta: l'autopilot riparte.");
      onStart(book.id);
    } catch (error) { await onRefresh().catch(() => undefined); if (mounted.current) setMessage(error instanceof Error ? error.message : "Operazione non riuscita."); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function closeAsIs() {
    if (!window.confirm(`Chiudere il capitolo ${source!.chapter.number} così com'è? Non ci sarà un'altra verifica: l'autopilot scrive la sinossi e lo congela. La decisione resta registrata sul capitolo.`)) return;
    setBusy(true); setMessage("");
    try {
      const note = progress.decided ? composed.text.slice(0, 19000) : "";
      await closeBlockedChapterByAuthor(book.id, book.updatedAt, note);
      await clearBlockedDraft(book.id, chapterId, round).catch(() => undefined);
      await onRefresh();
      if (mounted.current) setMessage("Capitolo chiuso: l'autopilot riparte per sinossi e congelamento.");
      onStart(book.id);
    } catch (error) { await onRefresh().catch(() => undefined); if (mounted.current) setMessage(error instanceof Error ? error.message : "Operazione non riuscita."); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <section id="blocked-review" className="panel space-y-4 border-amber-500/70 p-3 sm:p-4" aria-label="Redazione in attesa di te">
    <div className="min-w-0 space-y-1">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><ClipboardCheck size={20} className="text-amber-600 dark:text-amber-300"/> Redazione in attesa di te · capitolo {source.chapter.number}</h2>
      <p className="text-sm">{source.cycle.blockedReason ?? "La redazione è ferma in attesa di una tua decisione."}</p>
      <p className="muted text-xs">Qui sotto ci sono i rilievi dell'ultima tornata ({items.length}), con il trattamento del direttore. Per ognuno puoi accettare la sua proposta o scrivere la tua indicazione. Le bozze restano su questo dispositivo.</p>
    </div>

    <div className="rounded-lg border border-slate-300 p-3 dark:border-slate-700"><DirectorDecidesToggle book={book} onRefresh={onRefresh}/></div>

    {!hasDirectorOnItems && <p className="rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">Non ci sono rilievi da esaminare per questa tornata. Puoi ripartire con una tua indicazione generale o chiudere il capitolo.</p>}

    {hasDirectorOnItems && <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold" role="status">{progress.decided} di {progress.total} rilievi decisi</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="h-auto" onClick={() => update(followDirectorOnAll(items, draft))}>Accetto tutte le proposte del direttore</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void saveNow()}><Save size={14}/> Salva bozza</Button>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
          <div className="h-full bg-emerald-600" style={{ width: (progress.total ? progress.decided / progress.total * 100 : 0) + "%" }}/>
        </div>
        <p className="muted text-xs">{savedAt ? "Bozza salvata su questo dispositivo alle " + new Date(savedAt).toLocaleTimeString("it-IT") + "." : "Nessuna bozza salvata ancora."}</p>
        <nav aria-label="Rilievi" className="flex flex-wrap gap-1.5">
          {items.map((item, i) => <button key={item.findingId} type="button" onClick={() => setIndex(i)} aria-current={i === index ? "step" : undefined}
            aria-label={`Rilievo ${i + 1}: ${itemReady(draft.decisions[item.findingId]) ? "deciso" : "da decidere"}`}
            className={"size-9 rounded-lg border text-xs font-semibold " + (i === index ? "ring-2 ring-emerald-600 " : "") +
              (itemReady(draft.decisions[item.findingId]) ? "border-emerald-600 bg-emerald-500/15" : "border-slate-300 dark:border-slate-600")}>{i + 1}</button>)}
        </nav>
      </div>

      {current && <ItemCard item={current} profiles={source.cycle.profileSettings} decision={draft.decisions[current.findingId]}
        onChoice={choice => setDecision(current.findingId, { choice })} onNote={note => setDecision(current.findingId, { note })}/>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="outline" disabled={index <= 0} onClick={() => setIndex(i => Math.max(0, i - 1))}><ChevronLeft size={16}/> Precedente</Button>
        <Button type="button" variant="outline" disabled={index >= items.length - 1} onClick={() => setIndex(i => Math.min(items.length - 1, i + 1))}>Successivo <ChevronRight size={16}/></Button>
      </div>
    </>}

    <label className="block text-sm font-semibold">Nota generale per la nuova tornata (facoltativa)
      <textarea className="field mt-1 min-h-24" rows={4} value={draft.generalNote} onChange={e => update({ ...draft, generalNote: e.target.value })}
        placeholder="Indicazioni valide per tutto il capitolo."/>
    </label>

    <div className="space-y-2 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
      <p className="flex items-center gap-2 font-semibold"><ListChecks size={16}/> Cosa succede dopo</p>
      <p><b>Applica e rifai la tornata:</b> le tue decisioni diventano un'unica indicazione compatta per i revisori e il capitolo viene riletto da capo (nuove chiamate AI).</p>
      <p><b>Chiudi il capitolo così:</b> nessuna altra verifica; il direttore scrive la sinossi e lo congela. La scelta resta registrata sul capitolo.</p>
      <p className={composed.fits ? "muted text-xs" : "text-xs font-semibold text-rose-700 dark:text-rose-300"} role="status">
        Indicazione per la nuova tornata: {composed.length} caratteri su {composed.room} disponibili nei vincoli del libro (li leggono tutti i revisori, per questo hanno un limite).
        {!composed.fits && " Accorcia le note: la bozza resta salvata per intero, ma non si può applicare così."}
      </p>
    </div>

    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy || book.status === "running" || (hasDirectorOnItems && !progress.complete) || !composed.fits} onClick={() => void apply()}>Applica e rifai la tornata</Button>
      <Button type="button" variant="outline" disabled={busy || book.status === "running"} onClick={() => void closeAsIs()}>Chiudi il capitolo così (congela)</Button>
    </div>
    {book.status === "running" && <p className="muted text-xs">Metti in pausa l'autopilot per applicare una decisione.</p>}
    {hasDirectorOnItems && !progress.complete && <p className="muted text-xs">Per ripartire devi decidere tutti i rilievi (oppure usa «Accetto tutte le proposte del direttore»).</p>}
    {message && <p role="status" className="text-sm font-semibold">{message}</p>}
  </section>;
}
