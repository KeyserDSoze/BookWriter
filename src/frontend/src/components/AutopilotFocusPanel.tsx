import { useMemo } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, Circle, CircleDot, Loader2, PauseCircle, Settings2 } from "lucide-react";
import type { Activity, BookProject } from "../domain/types";
import { PIPELINE_STAGES, bookProgress, describeNextAutopilotStep } from "../domain/autopilot-step";
import { describeEta, estimateBookEta } from "../domain/book-eta";
import type { LiveAiTrace } from "../infrastructure/ai-observability";
import { LiveTaskStream, formatElapsed, useElapsedSeconds } from "./LiveTaskStream";
import { Button } from "./ui/button";

interface Props {
  book: BookProject;
  activities: Activity[];
  live: LiveAiTrace | null;
  inspectionEnabled: boolean;
  /** This browser tab owns the running autopilot of this book. */
  runningHere: boolean;
  modelWarning?: string;
  onOpenReader: () => void;
  onOpenSettings: () => void;
}

function Meter({ label, value, total, text }: { label: string; value: number; total: number; text: string }) {
  const percent = total > 0 ? Math.round(value / total * 100) : 0;
  return <div className="min-w-0">
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="muted">{label}</span><b className="tabular-nums">{text}</b>
    </div>
    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-300/60 dark:bg-slate-700/60" aria-hidden="true">
      <div className="h-full rounded-full bg-emerald-500 transition-[width] motion-reduce:transition-none" style={{ width: percent + "%" }}/>
    </div>
  </div>;
}

function RunningTask({ activity }: { activity: Activity }) {
  const elapsed = useElapsedSeconds(Date.parse(activity.createdAt) || Date.now());
  return <p className="muted text-xs">Task in corso: <b>{activity.title}</b> · da {formatElapsed(elapsed)}
    {activity.modelId ? " · modello " + activity.modelId : ""}</p>;
}

/** Read-only, plain-language view of what the autopilot is doing and what comes next. */
export function AutopilotFocusPanel({
  book, activities, live, inspectionEnabled, runningHere, modelWarning, onOpenReader, onOpenSettings,
}: Props) {
  const step = useMemo(() => describeNextAutopilotStep(book), [book]);
  const progress = useMemo(() => bookProgress(book), [book]);
  const etaLine = useMemo(() => describeEta(estimateBookEta(book, activities)), [book, activities]);
  const running = book.status === "running";
  const runningActivity = running ? activities.find(a => a.status === "running") : undefined;
  const active = live?.bookId === book.id ? live : null;
  const lastFinished = activities.find(a => a.status !== "running" && !a.interventionId);
  const stageIndex = PIPELINE_STAGES.findIndex(stage => stage.id === step.stage);
  const planReady = book.phase === "prose" && !!book.pauseAfterOutline && progress.scenes > 0 &&
    progress.writtenScenes === 0 && book.status === "paused";
  const startMode = book.startMode === "synopsis"
    ? `Avviato da una sinossi di ${book.authorChapterSynopses?.length ?? 0} capitoli`
    : book.targetChapterCount ? `Avviato da un'idea · ${book.targetChapterCount} capitoli richiesti` : "Avviato da un'idea";

  return <section aria-label="Lavoro dell'autopilot" className="panel min-w-0 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="muted text-xs font-semibold uppercase tracking-wide">Il tuo libro</p>
        <h2 className="break-words text-xl font-bold">{book.title}</h2>
        <p className="muted text-xs">{startMode}{book.pauseAfterOutline ? " · pausa per approvare il piano" : ""}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onOpenReader}><BookOpen size={16}/> Leggi il libro</Button>
    </div>

    <ol aria-label="Fasi del libro" className="mt-4 grid grid-cols-5 gap-1 sm:gap-2">
      {PIPELINE_STAGES.map((stage, index) => {
        const done = index < stageIndex || step.stage === "done";
        const current = index === stageIndex && step.stage !== "done";
        const Icon = done ? CheckCircle2 : current ? CircleDot : Circle;
        return <li key={stage.id} aria-current={current ? "step" : undefined} title={stage.description}
          className={`flex min-w-0 flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center text-[11px] sm:text-xs ${current
            ? "border-emerald-500 bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300"
            : done ? "border-emerald-600/30 text-emerald-700 dark:text-emerald-400" : "muted border-slate-300 dark:border-slate-700"}`}>
          <Icon size={17} aria-hidden="true"/>
          <span className="w-full truncate">{stage.label}</span>
        </li>;
      })}
    </ol>

    <div className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Avanzamento del libro">
      <Meter label="Scene canoniche" value={progress.canonScenes} total={progress.scenes}
        text={progress.scenes ? `${progress.canonScenes}/${progress.scenes}` : "piano da creare"}/>
      <Meter label="Capitoli congelati" value={progress.frozenChapters} total={progress.chapters}
        text={progress.chapters ? `${progress.frozenChapters}/${progress.chapters}` : "—"}/>
      <div className="min-w-0 text-xs">
        <span className="muted">Parole scritte</span>
        <p className="text-lg font-bold tabular-nums">{progress.words.toLocaleString("it-IT")}</p>
      </div>
    </div>
    {etaLine && <p className="muted mt-2 text-xs" aria-label="Stima dei tempi">{etaLine}</p>}

    <div className={`mt-4 rounded-xl border p-4 ${running ? "border-emerald-500/60" : step.blocked || book.status === "error"
      ? "border-amber-500/60" : "border-slate-400/50"}`}>
      {running && !runningHere ? <>
        <p className="flex items-center gap-2 text-sm font-semibold"><Loader2 size={17} className="motion-safe:animate-spin" aria-hidden="true"/>
          In esecuzione in un'altra scheda o finestra</p>
        <p className="mt-1 text-sm">{step.headline}</p>
        <p className="muted mt-2 text-xs">Per mettere in pausa o intervenire usa la scheda in cui hai avviato l'autopilot:
          questa scheda non può fermare il suo lavoro.</p>
      </> : running ? <>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
          <Loader2 size={15} className="motion-safe:animate-spin" aria-hidden="true"/> Sta lavorando su</p>
        <p className="mt-1 text-lg font-semibold leading-snug">{step.headline}</p>
        {step.detail && <p className="mt-1 text-sm">{step.detail}</p>}
        {runningActivity ? <div className="mt-3 space-y-1 text-sm">
          <RunningTask key={runningActivity.id} activity={runningActivity}/>
          <p><b>Perché:</b> {runningActivity.reason}</p>
          <p><b>Poi:</b> {runningActivity.nextStep}</p>
          {(runningActivity.appliedInterventionIds?.length ?? 0) > 0 &&
            <p className="font-semibold text-emerald-700 dark:text-emerald-300">Questo task sta usando le tue indicazioni.</p>}
        </div> : <p className="muted mt-2 text-xs">Preparazione del prossimo task…</p>}
        {active && <LiveTaskStream active={active} inspectionEnabled={inspectionEnabled} onOpenInspection={onOpenSettings}/>}
      </> : <>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          {book.status === "error" || step.blocked ? <AlertTriangle size={15} aria-hidden="true"/> : <PauseCircle size={15} aria-hidden="true"/>}
          {book.status === "completed" ? "Completato" : book.status === "error" ? "Fermo per un errore" :
            book.status === "idle" ? "Pronto a partire" : "In pausa"} — prossimo passo</p>
        <p className="mt-1 text-lg font-semibold leading-snug">{step.headline}</p>
        {step.detail && <p className="mt-1 text-sm">{step.detail}</p>}
        {step.blocked && <p role="note" className="mt-2 text-sm text-amber-700 dark:text-amber-300">{step.blocked}</p>}
        {planReady && <p role="note" className="mt-2 text-sm">
          Il piano è pronto: {progress.chapters} capitoli e {progress.scenes} scene. Rileggilo nella pagina Libro, poi premi
          Riprendi oppure chiedi modifiche con l'intervento «Rivedi anche il già scritto».</p>}
        {book.status === "error" && book.previousError && <p className="mt-2 break-words text-sm text-red-700 dark:text-red-300">
          {book.previousError}</p>}
        {book.status !== "error" && book.previousError && book.previousError !== step.blocked &&
          <p className="muted mt-2 break-words text-xs">Ultimo messaggio: {book.previousError}</p>}
        <p className="muted mt-2 text-xs">{book.status === "completed"
          ? "Esporta il libro dall'Archivio o registra una revisione qui sotto."
          : book.status === "error"
            ? "Puoi riprovare (nuova richiesta AI), cambiare modello nelle Impostazioni oppure registrare un'indicazione per il prossimo passo."
            : book.status === "idle"
              ? "Premi Autopilot: l'AI procede da sola un task alla volta, sempre interrompibile."
              : "Premi Riprendi per continuare dal punto salvato, oppure intervieni qui sotto prima di ripartire."}</p>
        {lastFinished && <p className="muted mt-2 text-xs">Ultimo task: <b>{lastFinished.title}</b> · {
          lastFinished.status === "succeeded" ? "completato" : lastFinished.status === "cancelled" ? "interrotto" : "fallito"} · {
          new Date(lastFinished.endedAt ?? lastFinished.createdAt).toLocaleString("it-IT")}</p>}
        {active && <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold">Ultima richiesta al modello</summary>
          <LiveTaskStream active={active} inspectionEnabled={inspectionEnabled} onOpenInspection={onOpenSettings}/>
        </details>}
      </>}
      {modelWarning && !running && book.status !== "completed" && <p role="note"
        className="mt-3 flex flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
        <AlertTriangle size={16} aria-hidden="true"/> {modelWarning}
        <Button variant="outline" size="sm" onClick={onOpenSettings}><Settings2 size={15}/> Apri Impostazioni</Button>
      </p>}
    </div>
  </section>;
}
