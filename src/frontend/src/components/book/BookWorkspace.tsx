import { useState } from "react";
import { BookOpenText, CheckCircle2, ChevronDown, ListOrdered, ScrollText } from "lucide-react";
import type { BookProject, Chapter, Scene } from "../../domain/types";
import { relevantKnowledge } from "../../domain/knowledge-index";
import { ENTITY_LABELS } from "../../domain/knowledge";
import { CHANGE_STATE_LABELS } from "../../domain/narrative-change";
import { Button } from "../ui/button";
import { Badge, Tabs } from "../ui/primitives";
import { ChangePromptBox } from "../world/ChangePromptBox";

const STATUS_TEXT: Record<Scene["status"], string> = { planned: "pianificata", draft: "bozza", canon: "canonica" };
const STATUS_TONE: Record<Scene["status"], "neutral" | "amber" | "emerald"> = { planned: "neutral", draft: "amber", canon: "emerald" };
type ChapterTab = "text" | "scenes" | "summary";

export function chapterStatus(book: BookProject, chapter: Chapter): { label: string; tone: "emerald" | "sky" | "amber" | "neutral" } {
  if (chapter.frozenAt) return { label: "Revisione completata", tone: "emerald" };
  if (book.editorialCycle?.chapterId === chapter.id) return { label: "In redazione · tornata " + book.editorialCycle.round, tone: "sky" };
  if (chapter.scenes.some(s => s.text.trim())) return { label: chapter.scenes.every(s => s.status === "canon") ? "In attesa di redazione" : "In scrittura", tone: "amber" };
  return { label: "Da scrivere", tone: "neutral" };
}
function provisionalSummary(chapter: Chapter): string {
  return chapter.scenes.filter(s => s.summary?.trim()).map(s => s.summary!.trim()).join(" ");
}

function SceneText({ book, scene, busy, onApprove }: { book: BookProject; scene: Scene; busy: boolean; onApprove: (id: string) => void }) {
  return <section id={`book-scene-${scene.id}`} className="mb-6 scroll-mt-24">
    <h4 className="mb-2 font-semibold">{scene.number}. {scene.title} <span className="muted text-xs">({STATUS_TEXT[scene.status]})</span></h4>
    {scene.text ? <p className="whitespace-pre-wrap break-words font-serif text-[1.05rem] leading-8">{scene.text}</p>
      : <p className="muted text-sm">Scena non ancora scritta. Obiettivo: {scene.objective}</p>}
    {book.editorialReviewSceneIds?.includes(scene.id) && <div className="mt-3 space-y-2 rounded-lg border border-amber-500/40 p-3">
      <p className="text-sm">Questa scena fusa richiede la tua rilettura e conferma prima di riprendere l'autopilot.</p>
      <Button variant="outline" disabled={busy || book.status === "running"} onClick={() => onApprove(scene.id)}><CheckCircle2 size={16}/> Conferma scena come canonica</Button>
    </div>}
  </section>;
}

function SceneCard({ book, chapter, scene, onRefresh, onStart }: { book: BookProject; chapter: Chapter; scene: Scene; onRefresh: () => Promise<void>; onStart: (bookId: string) => void }) {
  const [open, setOpen] = useState(false);
  const kb = book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
  const found = kb ? relevantKnowledge(book, kb, scene.text + "\n" + scene.title, scene.id, chapter.number) : undefined;
  const changes = (book.changeOperations ?? []).filter(op => op.target.id === scene.id || op.plan?.rewriteSceneIds.includes(scene.id));
  const written = scene.status !== "planned" && !!scene.text.trim();
  return <li className="rounded-xl border border-slate-300 dark:border-slate-700">
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold dark:bg-slate-800">{scene.number}</span>
        <b className="[overflow-wrap:anywhere]">{scene.title}</b><Badge tone={STATUS_TONE[scene.status]}>{STATUS_TEXT[scene.status]}</Badge>
        {changes.length > 0 && <Badge tone="violet">{changes.length} modific{changes.length === 1 ? "a" : "he"}</Badge>}
      </div>
      <p className="text-sm">{scene.summary?.trim() || <span className="muted">{written ? "Riassunto non ancora disponibile." : "Obiettivo: " + scene.objective}</span>}</p>
      {found && (found.entities.length > 0 || found.events.length > 0) && <ul className="flex flex-wrap gap-1.5" aria-label={"Elementi della scena " + scene.number}>
        {found.entities.map(e => <li key={e.id}><Badge tone="violet">{ENTITY_LABELS[e.type].one}: {e.name}</Badge></li>)}
        {found.events.map(e => <li key={e.id}><Badge tone="sky">Evento: {e.title}</Badge></li>)}
      </ul>}
      {changes.length > 0 && <p className="muted text-xs">Ultima modifica: «{changes.at(-1)!.instruction}» — {CHANGE_STATE_LABELS[changes.at(-1)!.state]}</p>}
      <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(v => !v)}><ChevronDown size={15} className={open ? "rotate-180" : ""}/> {open ? "Chiudi" : written ? "Leggi e modifica" : "Dettagli"}</Button>
    </div>
    {open && <div className="space-y-3 border-t border-slate-300 p-3 dark:border-slate-700">
      {written ? <p className="max-h-96 overflow-y-auto whitespace-pre-wrap font-serif leading-7">{scene.text}</p> : <p className="muted text-sm">La scena sarà scritta dall'autopilot.</p>}
      {written && <ChangePromptBox book={book} target={{ kind: "scene", id: scene.id }} label={scene.title} onRefresh={onRefresh} onStart={onStart}
        examples={["Rendi questo dialogo più teso, ma non modificare le informazioni rivelate né l'esito della scena.", "Accorcia le descrizioni e mostra le emozioni con i gesti.", "Fai arrivare Markus alla fine della scena."]}/>}
    </div>}
  </li>;
}

function ChapterView({ book, chapter, busy, onApprove, onRefresh, onStart }: {
  book: BookProject; chapter: Chapter; busy: boolean; onApprove: (id: string) => void; onRefresh: () => Promise<void>; onStart: (bookId: string) => void;
}) {
  const [tab, setTab] = useState<ChapterTab>("text");
  const status = chapterStatus(book, chapter);
  const summary = chapter.summary?.trim();
  const provisional = provisionalSummary(chapter);
  const kb = book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
  const found = kb ? relevantKnowledge(book, kb, chapter.scenes.map(s => s.text).join("\n").slice(0, 60_000), undefined, chapter.number) : undefined;
  const chapterEvents = kb?.events.filter(e => e.sceneIds.some(id => chapter.scenes.some(s => s.id === id)) || e.plannedChapter === chapter.number) ?? [];
  return <article className="mb-8 min-w-0">
    <header className="mb-3 space-y-2 border-b border-slate-300 pb-3 dark:border-slate-700">
      <h3 className="flex flex-wrap items-baseline gap-2 text-xl font-bold"><span>Capitolo {chapter.number} — {chapter.title}</span>
        {chapter.frozenAt && <span className="rounded-full border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">congelato</span>}</h3>
      <div className="flex flex-wrap gap-1.5"><Badge>{chapter.scenes.length} scene</Badge><Badge tone={status.tone}>{status.label}</Badge></div>
      <p className="muted text-sm">{chapter.purpose}</p>
      <Tabs label={"Viste del capitolo " + chapter.number} value={tab} onChange={setTab} tabs={[
        { id: "text", label: "Testo completo", icon: <BookOpenText size={15}/> },
        { id: "scenes", label: "Scene", icon: <ListOrdered size={15}/>, count: chapter.scenes.length },
        { id: "summary", label: "Riassunto", icon: <ScrollText size={15}/> },
      ]}/>
    </header>
    <div role="tabpanel" id={"panel-" + tab} aria-labelledby={"tab-" + tab}>
      {tab === "text" && chapter.scenes.map(scene => <SceneText key={scene.id} book={book} scene={scene} busy={busy} onApprove={onApprove}/>)}
      {tab === "scenes" && <ol className="space-y-2" aria-label={"Scene del capitolo " + chapter.number}>
        {chapter.scenes.map(scene => <SceneCard key={scene.id} book={book} chapter={chapter} scene={scene} onRefresh={onRefresh} onStart={onStart}/>)}</ol>}
      {tab === "summary" && <div className="space-y-4">
        <section className="rounded-xl border border-slate-300 p-4 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">Riassunto del capitolo</h4>
            <Badge tone={summary ? "emerald" : "amber"}>{summary ? "Consolidato alla revisione" : "Provvisorio, dai riassunti delle scene"}</Badge></div>
          <p className="mt-2 leading-7">{summary || provisional || <span className="muted">Nessun riassunto ancora: si crea scena dopo scena.</span>}</p>
        </section>
        <section><h4 className="mb-2 text-sm font-semibold">Scena per scena</h4>
          <ol className="space-y-2">{chapter.scenes.map(s => <li key={s.id} className="flex gap-3 text-sm"><span className="muted w-6 shrink-0 text-right font-semibold">{s.number}.</span>
            <span><b>{s.title}</b> — {s.summary?.trim() || <span className="muted">{s.text.trim() ? "riassunto non disponibile" : "da scrivere"}</span>}</span></li>)}</ol></section>
        {found && (found.entities.length > 0 || chapterEvents.length > 0) && <section><h4 className="mb-2 text-sm font-semibold">Elementi e snodi del capitolo</h4>
          <ul className="flex flex-wrap gap-1.5">{found.entities.map(e => <li key={e.id}><Badge tone="violet">{ENTITY_LABELS[e.type].one}: {e.name}</Badge></li>)}
            {chapterEvents.map(e => <li key={e.id}><Badge tone="sky">Evento: {e.title}</Badge></li>)}</ul></section>}
        <p className="muted text-xs">I riassunti descrivono cosa accade, non giudicano la qualità; quello consolidato nasce quando il capitolo supera la redazione.</p>
      </div>}
    </div>
  </article>;
}

/** The book, chapter by chapter, with full text, scenes and summaries. */
export function BookWorkspace({ book, chapterId, onChapter, busy, onApprove, onRefresh, onStart }: {
  book: BookProject; chapterId: string; onChapter: (id: string) => void; busy: boolean;
  onApprove: (sceneId: string) => void; onRefresh: () => Promise<void>; onStart: (bookId: string) => void;
}) {
  const selected = book.chapters.find(ch => ch.id === chapterId);
  return <div className="min-w-0 space-y-4">
    <nav aria-label="Capitoli" className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
      <button type="button" aria-pressed={!selected} onClick={() => onChapter("")}
        className={"rounded-xl border p-2.5 text-left text-sm font-semibold transition-colors max-sm:min-h-11 " + (!selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 hover:border-emerald-500 dark:border-slate-700")}>
        Tutto il libro<span className={"block text-xs font-normal " + (!selected ? "text-white/80" : "muted")}>{book.chapters.length} capitoli</span></button>
      {book.chapters.map(ch => {
        const status = chapterStatus(book, ch);
        const active = selected?.id === ch.id;
        return <button key={ch.id} type="button" aria-label={`Cap. ${ch.number}`} aria-pressed={active} title={ch.title} onClick={() => onChapter(ch.id)}
          className={"min-w-0 rounded-xl border p-2.5 text-left transition-colors max-sm:min-h-11 " + (active ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 hover:border-emerald-500 dark:border-slate-700")}>
          <span className="block text-xs font-semibold">Cap. {ch.number}</span>
          <span className="block truncate text-sm">{ch.title}</span>
          <span className={"mt-0.5 block truncate text-[11px] " + (active ? "text-white/80" : "muted")}>{status.label}</span>
        </button>;
      })}
    </nav>
    {selected ? <ChapterView key={selected.id} book={book} chapter={selected} busy={busy} onApprove={onApprove} onRefresh={onRefresh} onStart={onStart}/>
      : book.chapters.map(ch => <article key={ch.id} className="mb-8">
        <h3 className="mb-3 flex flex-wrap items-baseline gap-2 border-b border-slate-300 pb-2 text-xl font-bold dark:border-slate-700">
          <span>Capitolo {ch.number} — {ch.title}</span>
          {ch.frozenAt && <span className="rounded-full border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">congelato</span>}
        </h3>
        <p className="muted mb-4 text-sm">{ch.purpose}</p>
        {ch.scenes.map(scene => <SceneText key={scene.id} book={book} scene={scene} busy={busy} onApprove={onApprove}/>)}
      </article>)}
  </div>;
}
