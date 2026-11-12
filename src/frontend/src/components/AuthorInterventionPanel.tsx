import { useMemo, type RefObject } from "react";
import { History, MessageSquareText, PlayCircle, Square, WandSparkles } from "lucide-react";
import type { AuthorInterventionScope, BookProject } from "../domain/types";
import {
  INTERVENTION_SCOPE_HELP, INTERVENTION_SCOPE_LABELS, MAX_INTERVENTION_CHARS,
  interventionStatusText, pendingAuthorNotes,
} from "../domain/author-interventions";
import { describeNextAutopilotStep } from "../domain/autopilot-step";
import { Button } from "./ui/button";

export type InterventionSubmitMode = "record" | "record_and_continue" | "interrupt_and_record";

interface Props {
  book: BookProject;
  draft: string;
  onDraftChange: (value: string) => void;
  scope: AuthorInterventionScope;
  onScopeChange: (scope: AuthorInterventionScope) => void;
  runningHere: boolean;
  busy: boolean;
  onSubmit: (mode: InterventionSubmitMode) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}

const SCOPES: AuthorInterventionScope[] = ["next_step", "from_now", "rewrite"];

/** Why a scope cannot be used right now (mirrors the application guard). */
export function interventionScopeBlocker(book: BookProject, scope: AuthorInterventionScope): string | undefined {
  const completed = book.status === "completed" || book.phase === "completed";
  if (scope !== "rewrite") return completed ? "Il libro è completato: usa «Rivedi anche il già scritto»." : undefined;
  if (book.editorialReviewSceneIds?.length) return "Conferma prima le scene fuse nella pagina Libro.";
  const stage = book.editorialCycle?.stage;
  if (stage === "blocked") return "Redazione bloccata: rispondi nel pannello Redazione più in basso.";
  if (book.editorialCycle && !["review", "adjudicate", "summary"].includes(stage ?? ""))
    return "La redazione sta applicando correzioni: attendi la fine di questa fase.";
  if (!book.chapters.length) return "Non c'è ancora un piano o un testo da riscrivere.";
  return undefined;
}

export function AuthorInterventionPanel({
  book, draft, onDraftChange, scope, onScopeChange, runningHere, busy, onSubmit, textareaRef,
}: Props) {
  const step = useMemo(() => describeNextAutopilotStep(book), [book]);
  const pending = pendingAuthorNotes(book);
  const history = [...(book.authorInterventions ?? [])].reverse();
  const running = book.status === "running";
  const blocker = interventionScopeBlocker(book, scope);
  const written = book.chapters.some(ch => ch.scenes.some(s => s.text.trim()));
  const canContinue = !book.editorialReviewSceneIds?.length && book.status !== "completed";
  const empty = !draft.trim();
  const target = scope === "next_step"
    ? step.acceptsAuthorNotes
      ? `Riceverà la nota: ${step.headline}`
      : "Il prossimo passo è una verifica indipendente: la nota attenderà il primo task di scrittura o correzione successivo."
    : scope === "rewrite"
      ? written ? "Alla ripresa: analisi d'impatto e riscrittura delle scene coinvolte e delle successive."
        : "Non c'è ancora testo: verrà rifatto il piano dei capitoli con questo vincolo."
      : "Vale per tutti i task successivi, compresi i revisori specialisti e il direttore.";

  return <section aria-label="Intervento dell'autore" className="panel min-w-0 p-4 sm:p-5" id="author-intervention">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><MessageSquareText size={19}/> Intervieni sull'autopilot</h2>
    <p className="muted mt-1 text-sm">Scrivi un prompt per l'AI. Viene registrato con data, ora e passo in corso nel libro
      e nelle Attività; le tue indicazioni prevalgono su quelle dell'AI.</p>
    <textarea ref={textareaRef} className="field mt-3 min-h-28" value={draft} maxLength={MAX_INTERVENTION_CHARS}
      onChange={e => onDraftChange(e.target.value)} aria-label="Il tuo intervento"
      placeholder="Es.: In questa scena Marco non deve rivelare il suo nome; il tono deve restare ironico…"/>
    <fieldset className="mt-3 space-y-2">
      <legend className="text-sm font-semibold">Come applicarlo</legend>
      {SCOPES.map(option => {
        const reason = interventionScopeBlocker(book, option);
        return <label key={option} className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${scope === option
          ? "border-emerald-500 bg-emerald-500/5" : "border-slate-300 dark:border-slate-700"} ${reason ? "opacity-60" : ""}`}>
          <input type="radio" name="intervention-scope" className="mt-1 size-4 shrink-0" value={option}
            checked={scope === option} disabled={!!reason} onChange={() => onScopeChange(option)}/>
          <span className="min-w-0">
            <span className="block font-semibold">{INTERVENTION_SCOPE_LABELS[option]}</span>
            <span className="muted block text-xs">{reason ?? INTERVENTION_SCOPE_HELP[option]}</span>
          </span>
        </label>;
      })}
    </fieldset>
    <p className="mt-2 text-xs" aria-live="polite">{blocker ?? target}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {running ? runningHere ? <Button disabled={empty || busy || !!blocker}
          onClick={() => onSubmit("interrupt_and_record")}><Square size={16}/> Interrompi e registra intervento</Button>
        : <p className="muted text-xs">L'autopilot lavora in un'altra scheda: intervieni da lì.</p>
        : <>
          <Button disabled={empty || busy || !!blocker} onClick={() => onSubmit("record")}>
            <WandSparkles size={16}/> Registra intervento</Button>
          {canContinue && <Button variant="outline" disabled={empty || busy || !!blocker}
            onClick={() => onSubmit("record_and_continue")}><PlayCircle size={16}/> Registra e continua</Button>}
        </>}
    </div>
    {running && runningHere && <p className="muted mt-2 text-xs">Il task in corso viene interrotto subito (la richiesta già
      inviata potrebbe essere comunque addebitata) e ripetuto alla ripresa tenendo conto del tuo intervento.</p>}
    {book.revision && <p className="mt-3 text-sm">Revisione in corso: {book.revision.instruction}
      {" "}({book.revision.cursor}/{book.revision.affectedSceneIds.length} scene riscritte)</p>}
    {pending.length > 0 && <section className="mt-4 rounded-lg border border-emerald-600/40 p-3" aria-label="Indicazioni in attesa">
      <p className="text-sm font-semibold">Indicazioni in attesa del prossimo task di scrittura ({pending.length})</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
        {pending.map(entry => <li key={entry.id} className="whitespace-pre-wrap break-words">{entry.instruction}</li>)}
      </ul>
    </section>}
    {(book.authorConstraints?.length ?? 0) > 0 && <details className="mt-3 rounded-lg border border-slate-400/40 p-3">
      <summary className="cursor-pointer text-sm font-semibold">Vincoli permanenti attivi ({book.authorConstraints.length})</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {book.authorConstraints.map((constraint, index) =>
          <li key={index} className="whitespace-pre-wrap break-words">{constraint}</li>)}
      </ul>
    </details>}
    {history.length > 0 && <details className="mt-3 rounded-lg border border-slate-400/40 p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <History size={16}/> Registro dei tuoi interventi ({history.length})</summary>
      <ol className="mt-2 space-y-2" aria-label="Registro interventi">
        {history.slice(0, 30).map(entry => <li key={entry.id} className="rounded border border-slate-300 p-2 text-sm dark:border-slate-700">
          <p className="muted text-xs">{new Date(entry.createdAt).toLocaleString("it-IT")} · {INTERVENTION_SCOPE_LABELS[entry.scope]}
            {" "}· durante: {entry.stepLabel}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{entry.instruction}</p>
          <p className="mt-1 text-xs font-semibold">{interventionStatusText(entry)}</p>
        </li>)}
      </ol>
      {history.length > 30 && <p className="muted mt-2 text-xs">Mostrati gli ultimi 30 di {history.length}; tutti restano nel
        backup ZIP e nel registro Attività.</p>}
    </details>}
  </section>;
}
