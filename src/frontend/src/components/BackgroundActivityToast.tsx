import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Minimize2, Maximize2 } from "lucide-react";
import type { Activity, BookProject } from "../domain/types";
import { bookProgress, describeNextAutopilotStep } from "../domain/autopilot-step";
import type { LiveAiTrace } from "../infrastructure/ai-observability";
import { liveStageText } from "./LiveTaskStream";
import { AiStreamText } from "./AiStreamText";

/** Small bottom-right card: which books the autopilot is working on and what the last task is. */
export function BackgroundActivityToast({ books, live, currentBookId, currentActivities, onOpen,
  inspectionEnabled, onOpenInspection }: {
  books: BookProject[]; live: LiveAiTrace | null; currentBookId: string; currentActivities: Activity[];
  onOpen: (bookId: string, activityId?: string) => void;
  inspectionEnabled:boolean;
  onOpenInspection:()=>void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [previewHidden,setPreviewHidden]=useState(false);
  const running = books.filter(book => book.status === "running");
  if (running.length === 0) return null;

  const rows = running.map(book => {
    const liveHere = live && live.bookId === book.id && !live.endedAt ? live : undefined;
    const stored = book.id === currentBookId ? currentActivities.find(a => a.status === "running") : undefined;
    return {
      book, liveHere,
      activityId: liveHere?.activityId ?? stored?.id,
      taskTitle: liveHere?.title ?? stored?.title,
      step: describeNextAutopilotStep(book),
      progress: bookProgress(book),
    };
  });
  const first = rows[0]!;
  const active=first.liveHere;
  const showText=inspectionEnabled&&active?.inspect;
  const text=showText?(active.textTail||active.textPreview):"";
  const reasoning=showText?(active.reasoningTail||active.reasoningPreview):"";

  return <aside role="complementary" aria-label="Lavoro in background"
    className="fixed bottom-3 right-3 z-50 max-h-[calc(100dvh-6rem)] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-emerald-600/60 bg-white shadow-xl dark:bg-slate-900">
    <div className="flex items-center">
    <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
      aria-expanded={expanded} onClick={() => {setExpanded(open => !open);setPreviewHidden(false);}}>
      <Loader2 size={16} className="shrink-0 motion-safe:animate-spin text-emerald-500" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{running.length === 1 ? "Autopilot al lavoro" : `${running.length} libri al lavoro`}</span>
        <span className="muted block truncate text-xs">{first.book.title} · {first.taskTitle ?? first.step.headline}</span>
      </span>
      {expanded ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
    </button>
    <button type="button" className="flex min-h-11 min-w-11 items-center justify-center"
      aria-label={previewHidden?"Mostra anteprima streaming":"Riduci anteprima streaming"}
      title={previewHidden?"Mostra anteprima streaming":"Riduci anteprima streaming"}
      onClick={()=>{setPreviewHidden(hidden=>!hidden);setExpanded(false);}}>
      {previewHidden?<Maximize2 size={16} aria-hidden/>:<Minimize2 size={16} aria-hidden/>}
    </button>
    </div>
    {!previewHidden&&<div className="min-w-0 space-y-2 border-t border-slate-300 px-3 py-2 dark:border-slate-700">
      <p className="text-sm font-semibold [overflow-wrap:anywhere]">{first.taskTitle??first.step.headline}</p>
      {active&&<>
        <p className="muted text-xs">{liveStageText(active)}</p>
        {(text||reasoning)&&<div role="region" aria-label="Anteprima ultime cinque righe">
          <p className="muted text-xs">{text?"Risposta in arrivo":"Reasoning del provider"} · provvisorio</p>
          <AiStreamText key={active.activityId+(text?":text":":reasoning")}
            compact text={text||reasoning} label="Ultime cinque righe ricevute"/>
        </div>}
        <p className="muted text-xs tabular-nums" aria-label="Contatori streaming compatti">
          Output: {active.textCharacters.toLocaleString("it-IT")} caratteri · Reasoning: {active.reasoningCharacters.toLocaleString("it-IT")}
          <span className="block">{active.transportEvents.toLocaleString("it-IT")} eventi · {active.transportBytes.toLocaleString("it-IT")} byte</span>
        </p>
        {!showText&&<button type="button" className="min-h-11 text-left text-xs underline"
          onClick={onOpenInspection}>Abilita l'ispezione per vedere il testo dalle prossime richieste</button>}
      </>}
      <button type="button" className="min-h-11 text-left text-xs font-semibold text-emerald-700 dark:text-emerald-400"
        onClick={()=>onOpen(first.book.id,first.activityId)}>Ispeziona il task in Attività →</button>
    </div>}
    {expanded && <ul className="max-h-[60vh] space-y-2 overflow-y-auto border-t border-slate-300 p-2 dark:border-slate-700">
      {rows.map(row => <li key={row.book.id}>
        <button type="button" className="w-full rounded-lg border border-slate-300 p-2 text-left text-xs hover:border-emerald-600 dark:border-slate-700"
          aria-label={`Apri il lavoro in corso su ${row.book.title}`}
          onClick={() => onOpen(row.book.id, row.activityId)}>
          <span className="block text-sm font-semibold">{row.book.title}</span>
          <span className="block">{row.step.headline}</span>
          {row.taskTitle && <span className="mt-1 block"><b>Task:</b> {row.taskTitle}</span>}
          {row.liveHere && <>
            <span className="muted block">{liveStageText(row.liveHere)} · {row.liveHere.modelId}</span>
            {row.liveHere.textCharacters > 0 && <span className="muted block">{row.liveHere.textCharacters.toLocaleString("it-IT")} caratteri ricevuti</span>}
          </>}
          <span className="muted mt-1 block">
            {row.progress.scenes
              ? `${row.progress.canonScenes}/${row.progress.scenes} scene canoniche · ${row.progress.frozenChapters}/${row.progress.chapters} capitoli congelati`
              : "Piano non ancora creato"}
          </span>
          <span className="mt-1 block font-semibold text-emerald-600 dark:text-emerald-400">Apri il libro e il task in corso →</span>
        </button>
      </li>)}
    </ul>}
  </aside>;
}
