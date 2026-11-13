import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import type { Activity, BookProject } from "../domain/types";
import { bookProgress, describeNextAutopilotStep } from "../domain/autopilot-step";
import type { LiveAiTrace } from "../infrastructure/ai-observability";

const STAGE: Record<LiveAiTrace["stage"], string> = {
  inviata: "richiesta inviata, in attesa del modello", header: "il modello ha risposto, inizia a scrivere",
  streaming: "sta scrivendo", completata: "completata", rifiutata: "rifiutata", interrotta: "interrotta",
};

/** Small bottom-right card: which books the autopilot is working on and what the last task is. */
export function BackgroundActivityToast({ books, live, currentBookId, currentActivities, onOpen }: {
  books: BookProject[]; live: LiveAiTrace | null; currentBookId: string; currentActivities: Activity[];
  onOpen: (bookId: string, activityId?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
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

  return <aside role="complementary" aria-label="Lavoro in background"
    className="fixed bottom-3 right-3 z-50 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-emerald-600/60 bg-white shadow-xl dark:bg-slate-900">
    <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      aria-expanded={expanded} onClick={() => setExpanded(open => !open)}>
      <Loader2 size={16} className="shrink-0 animate-spin text-emerald-500" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{running.length === 1 ? "Autopilot al lavoro" : `${running.length} libri al lavoro`}</span>
        <span className="muted block truncate text-xs">{first.book.title} · {first.taskTitle ?? first.step.headline}</span>
      </span>
      {expanded ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
    </button>
    {expanded && <ul className="max-h-[60vh] space-y-2 overflow-y-auto border-t border-slate-300 p-2 dark:border-slate-700">
      {rows.map(row => <li key={row.book.id}>
        <button type="button" className="w-full rounded-lg border border-slate-300 p-2 text-left text-xs hover:border-emerald-600 dark:border-slate-700"
          aria-label={`Apri il lavoro in corso su ${row.book.title}`}
          onClick={() => onOpen(row.book.id, row.activityId)}>
          <span className="block text-sm font-semibold">{row.book.title}</span>
          <span className="block">{row.step.headline}</span>
          {row.taskTitle && <span className="mt-1 block"><b>Task:</b> {row.taskTitle}</span>}
          {row.liveHere && <>
            <span className="muted block">{STAGE[row.liveHere.stage]} · {row.liveHere.modelId}</span>
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
