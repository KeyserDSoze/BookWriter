import { useMemo } from "react";
import type { BookProject } from "@engine/domain/types";
import type { LiveAiTrace } from "@engine/infrastructure/ai-observability";
import { describeLiveProgress, type LiveAction, type LiveTone, type SceneResolver } from "@engine/domain/live-progress";

/** Scene titles of a book, to say «capitolo 2 · scena 3 «La lettera»» instead of an id. */
export function sceneResolver(book: Pick<BookProject, "chapters"> | undefined): SceneResolver | undefined {
  if (!book) return undefined;
  const titles = new Map<string, string>();
  for (const chapter of book.chapters) for (const scene of chapter.scenes) titles.set(scene.id, scene.title);
  return id => titles.get(id);
}

const TONE: Record<LiveTone, { bar: string; badge: string }> = {
  critical: { bar: "border-l-red-500", badge: "bg-red-500/15 text-red-700 dark:text-red-300" },
  major: { bar: "border-l-orange-500", badge: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  minor: { bar: "border-l-amber-500", badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  ok: { bar: "border-l-emerald-500", badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  accept: { bar: "border-l-emerald-500", badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  reject: { bar: "border-l-slate-400", badge: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  info: { bar: "border-l-sky-500", badge: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
};

function ActionCard({ action, compact }: { action: LiveAction; compact: boolean }) {
  const tone = TONE[action.tone];
  return <li className={`live-card-in min-w-0 rounded-lg border border-slate-300/70 border-l-4 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800/60 ${tone.bar}`}>
    <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
      {action.badge && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide ${tone.badge}`}>{action.badge}</span>}
      <span className={"min-w-0 [overflow-wrap:anywhere] " + (compact ? "truncate" : "")}>{action.title}</span>
    </p>
    {action.detail && <p className={"muted mt-0.5 text-xs [overflow-wrap:anywhere] " + (compact ? "line-clamp-1" : "line-clamp-3")}>{action.detail}</p>}
    {!compact && action.meta?.map(item => <span key={item} className="mr-1.5 mt-1 inline-block rounded bg-slate-200/70 px-1.5 py-0.5 text-[0.7rem] dark:bg-slate-700/70">{item}</span>)}
  </li>;
}

/** What the model is doing, as it does it: the last two things finished, the one being written
 * now, and counters. The text scrolling underneath is shown by the caller. Derived from the
 * text received so far; it stores and approves nothing. */
export function LiveActionFeed({ active, book, compact = false }: {
  active: LiveAiTrace; book?: Pick<BookProject, "chapters">; compact?: boolean;
}) {
  const resolve = useMemo(() => sceneResolver(book), [book]);
  const progress = useMemo(
    () => describeLiveProgress({ title: active.title, text: active.textPreview }, resolve),
    // textCharacters moves with every delta; previewClearedAt when the author deleted the text
    // (the text itself is read from `active` on purpose: it changes exactly when these do)
    [active.activityId, active.title, active.textCharacters, active.previewClearedAt, resolve],
  );
  const last = progress.actions.slice(-2);
  if (!last.length && !progress.forming && !progress.counters.length) return null;
  const earlier = progress.actions.length - last.length;
  return <div role="region" aria-label="Azioni del modello" className="min-w-0 space-y-1.5">
    {progress.counters.length > 0 && <p className="flex flex-wrap gap-x-3 text-xs tabular-nums" aria-label="Conteggi">
      {progress.counters.map(counter => <span key={counter.label}><b>{counter.value.toLocaleString("it-IT")}</b> <span className="muted">{counter.label}</span></span>)}
    </p>}
    {last.length > 0 && <ol className="min-w-0 space-y-1.5" aria-label="Ultime azioni completate" aria-live="polite" aria-relevant="additions">
      {last.map(action => <ActionCard key={action.id} action={action} compact={compact} />)}
    </ol>}
    {progress.forming && <div aria-label="Azione in corso"
      className="min-w-0 rounded-lg border border-dashed border-emerald-600/60 px-2.5 py-1.5">
      <p className="flex min-w-0 items-center gap-2 text-sm">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
        {progress.forming.badge && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide ${TONE[progress.forming.tone ?? "ok"].badge}`}>{progress.forming.badge}</span>}
        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{progress.forming.label}</span>
      </p>
      {progress.forming.excerpt && <p className={"muted mt-0.5 text-xs italic [overflow-wrap:anywhere] " + (compact ? "line-clamp-1" : "line-clamp-2")}>«{progress.forming.excerpt}»</p>}
    </div>}
    {!compact && earlier > 0 && <details className="text-xs">
      <summary className="muted min-h-11 cursor-pointer py-2">Tutte le azioni fatte finora ({progress.actions.length})</summary>
      <ol className="space-y-1" aria-label="Tutte le azioni completate">
        {progress.actions.map(action => <li key={action.id} className="min-w-0 [overflow-wrap:anywhere]">
          {action.badge && <b className="mr-1.5">[{action.badge}]</b>}{action.title}
          {action.meta?.length ? <span className="muted"> — {action.meta.join(" · ")}</span> : null}
        </li>)}
      </ol>
    </details>}
  </div>;
}
