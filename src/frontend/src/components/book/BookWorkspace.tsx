import { useState } from "react";
import { AlertTriangle, BookOpenText, CheckCircle2, ChevronDown, ListOrdered, Pencil, ScrollText } from "lucide-react";
import type { BookProject, Chapter, Scene } from "../../domain/types";
import { relevantKnowledge } from "../../domain/knowledge-index";
import { ENTITY_LABELS } from "../../domain/knowledge";
import { CHANGE_STATE_LABELS } from "../../domain/narrative-change";
import { Button } from "../ui/button";
import { Badge, Segmented, Tabs } from "../ui/primitives";
import { EditHistory, PromptEditChoices, ReviewStateBadge } from "../edit/EditKit";
import { SceneEditor } from "../edit/SceneEditor";
import { ChapterEditor } from "../edit/ChapterEditor";

const STATUS_TEXT: Record<Scene["status"], string> = { planned: "pianificata", draft: "bozza", canon: "canonica" };
const STATUS_TONE: Record<Scene["status"], "neutral" | "amber" | "emerald"> = { planned: "neutral", draft: "amber", canon: "emerald" };
type ChapterTab = "text" | "scenes" | "summary" | "edit";
const SCENE_EXAMPLES = ["Rendi questo dialogo più teso, ma non modificare le informazioni rivelate né l'esito della scena.",
  "Accorcia le descrizioni e mostra le emozioni con i gesti.", "Fai arrivare Markus alla fine della scena."];

export function chapterStatus(book: BookProject, chapter: Chapter): { label: string; tone: "emerald" | "sky" | "amber" | "neutral" } {
  if (chapter.frozenAt && chapter.reviewStale) return { label: "Modificato dopo la revisione", tone: "amber" };
  if (chapter.frozenAt) return { label: "Revisione completata", tone: "emerald" };
  if (book.editorialCycle?.chapterId === chapter.id) return { label: "In redazione · tornata " + book.editorialCycle.round, tone: "sky" };
  if (chapter.scenes.some(s => s.text.trim())) return { label: chapter.scenes.every(s => s.status === "canon") ? "In attesa di redazione" : "In scrittura", tone: "amber" };
  return { label: "Da scrivere", tone: "neutral" };
}
function provisionalSummary(chapter: Chapter): string {
  return chapter.scenes.filter(s => s.summary?.trim()).map(s => s.summary!.trim()).join(" ");
}
interface Shared { book: BookProject; onRefresh: () => Promise<void>; onStart: (bookId: string) => void; onOpenReviews?: () => void }

function StaleChapterNote({ chapter, onOpenReviews }: { chapter: Chapter; onOpenReviews?: () => void }) {
  if (!chapter.reviewStale) return null;
  return <div role="note" className="flex flex-wrap items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-2.5 text-sm">
    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300"/>
    <span className="min-w-0 flex-1">Hai modificato questo capitolo dopo la revisione ({chapter.reviewStale.editIds.length} {chapter.reviewStale.editIds.length === 1 ? "modifica" : "modifiche"}): il controllo precedente non copre più il testo. Resta congelato finché non scegli tu una review.</span>
    {onOpenReviews && <Button size="sm" variant="outline" onClick={onOpenReviews}><span className="text-xs">Scegli una review</span></Button>}
  </div>;
}

function SceneText({ book, chapter, scene, busy, onApprove, onRefresh, onOpenReviews }: Shared & { chapter: Chapter; scene: Scene; busy: boolean; onApprove: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  return <section id={`book-scene-${scene.id}`} className="mb-6 scroll-mt-24">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h4 className="font-semibold">{scene.number}. {scene.title} <span className="muted text-xs">({STATUS_TEXT[scene.status]})</span></h4>
      <ReviewStateBadge book={book} target={{ kind: "scene", id: scene.id }} quiet/>
      {!editing && <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Modifica la scena ${scene.number}. ${scene.title}`} onClick={() => setEditing(true)}>
        <Pencil size={14}/><span className="text-xs">Modifica</span></Button>}
    </div>
    {editing ? <SceneEditor book={book} chapter={chapter} scene={scene} onRefresh={onRefresh} onClose={() => setEditing(false)} onOpenReviews={onOpenReviews}/>
      : scene.text ? <p className="whitespace-pre-wrap break-words font-serif text-[1.05rem] leading-8">{scene.text}</p>
        : <p className="muted text-sm">Scena non ancora scritta. Obiettivo: {scene.objective}</p>}
    {book.editorialReviewSceneIds?.includes(scene.id) && <div className="mt-3 space-y-2 rounded-lg border border-amber-500/40 p-3">
      <p className="text-sm">Questa scena fusa richiede la tua rilettura e conferma prima di riprendere l'autopilot.</p>
      <Button variant="outline" disabled={busy || book.status === "running"} onClick={() => onApprove(scene.id)}><CheckCircle2 size={16}/> Conferma scena come canonica</Button>
    </div>}
  </section>;
}

function SceneCard({ book, chapter, scene, onRefresh, onStart, onOpenReviews }: Shared & { chapter: Chapter; scene: Scene }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const kb = book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
  const found = kb ? relevantKnowledge(book, kb, scene.text + "\n" + scene.title, scene.id, chapter.number) : undefined;
  const changes = (book.changeOperations ?? []).filter(op => op.target.id === scene.id || op.plan?.rewriteSceneIds.includes(scene.id));
  const written = scene.status !== "planned" && !!scene.text.trim();
  const target = { kind: "scene" as const, id: scene.id };
  return <li className="rounded-xl border border-slate-300 dark:border-slate-700">
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold dark:bg-slate-800">{scene.number}</span>
        <b className="[overflow-wrap:anywhere]">{scene.title}</b><Badge tone={STATUS_TONE[scene.status]}>{STATUS_TEXT[scene.status]}</Badge>
        {changes.length > 0 && <Badge tone="violet">{changes.length} modific{changes.length === 1 ? "a" : "he"}</Badge>}
        <ReviewStateBadge book={book} target={target} quiet/>
        {scene.summaryStale && <Badge tone="amber">Riassunto da aggiornare</Badge>}
      </div>
      <p className="text-sm">{scene.summary?.trim() || <span className="muted">{written ? "Riassunto non ancora disponibile." : "Obiettivo: " + scene.objective}</span>}</p>
      {found && (found.entities.length > 0 || found.events.length > 0) && <ul className="flex flex-wrap gap-1.5" aria-label={"Elementi della scena " + scene.number}>
        {found.entities.map(e => <li key={e.id}><Badge tone="violet">{ENTITY_LABELS[e.type].one}: {e.name}</Badge></li>)}
        {found.events.map(e => <li key={e.id}><Badge tone="sky">Evento: {e.title}</Badge></li>)}
      </ul>}
      {changes.length > 0 && <p className="muted text-xs">Ultima modifica: «{changes.at(-1)!.instruction}» — {CHANGE_STATE_LABELS[changes.at(-1)!.state]}</p>}
      <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(v => !v)}><ChevronDown size={15} className={open ? "rotate-180" : ""}/> {open ? "Chiudi" : "Leggi e modifica"}</Button>
    </div>
    {open && <div className="space-y-3 border-t border-slate-300 p-3 dark:border-slate-700">
      {editing ? <SceneEditor book={book} chapter={chapter} scene={scene} onRefresh={onRefresh} onClose={() => setEditing(false)} onOpenReviews={onOpenReviews}/> : <>
        {written ? <p className="max-h-96 overflow-y-auto whitespace-pre-wrap font-serif leading-7">{scene.text}</p>
          : <p className="muted text-sm">Scena da scrivere: puoi scriverla tu oppure lasciarla all'autopilot.</p>}
        <Button variant="outline" onClick={() => setEditing(true)}><Pencil size={16}/> {written ? "Modifica a mano" : "Scrivila tu"}</Button>
      </>}
      {written && !editing && <PromptEditChoices book={book} request={{ kind: "scene", id: scene.id }} label={scene.title} examples={SCENE_EXAMPLES}
        propagate={{ kind: "scene", id: scene.id }} onRefresh={onRefresh} onStart={onStart}/>}
      <EditHistory book={book} target={target} label={scene.title} onRefresh={onRefresh}/>
    </div>}
  </li>;
}

function ChapterEditTab({ book, chapter, onRefresh, onStart, onSelectChapter }: Shared & { chapter: Chapter; onSelectChapter: (id: string) => void }) {
  const [scope, setScope] = useState<"details" | "text">("details");
  const written = chapter.scenes.filter(s => s.text.trim()).length;
  return <div className="space-y-4">
    <ChapterEditor key={chapter.id} book={book} chapter={chapter} onRefresh={onRefresh} onSelectChapter={onSelectChapter}/>
    <PromptEditChoices book={book} request={{ kind: "chapter", id: chapter.id, scope }} label={`Capitolo ${chapter.number}`} onRefresh={onRefresh} onStart={onStart}
      examples={scope === "details" ? ["Dai al capitolo un titolo più evocativo e uno scopo più preciso.", "Riscrivi il riassunto in tre frasi asciutte."]
        : ["Uniforma il tono del capitolo: più cupo e asciutto, senza cambiare gli eventi.", "Sostituisci «telefono» con «telegrafo» in tutto il capitolo."]}
      scopeControl={<div className="space-y-1"><p className="text-xs font-semibold">Cosa modificare</p>
        <Segmented label="Cosa modificare del capitolo" value={scope} onChange={setScope} options={[{ value: "details", label: "Titolo, scopo, riassunto" },
          { value: "text", label: written ? `Testo delle scene (${written} chiamate AI)` : "Testo delle scene" }]}/></div>}/>
    <EditHistory book={book} target={{ kind: "chapter", id: chapter.id }} label={`Capitolo ${chapter.number}`} onRefresh={onRefresh}/>
    <EditHistory book={book} target={{ kind: "structure", id: "book" }} label="Struttura del libro" onRefresh={onRefresh}/>
  </div>;
}

function ChapterView({ book, chapter, busy, onApprove, onRefresh, onStart, onOpenReviews, onSelectChapter }: Shared & {
  chapter: Chapter; busy: boolean; onApprove: (id: string) => void; onSelectChapter: (id: string) => void;
}) {
  const [tab, setTab] = useState<ChapterTab>("text");
  const status = chapterStatus(book, chapter);
  const summary = chapter.summary?.trim();
  const provisional = provisionalSummary(chapter);
  const kb = book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
  const found = kb ? relevantKnowledge(book, kb, chapter.scenes.map(s => s.text).join("\n").slice(0, 60_000), undefined, chapter.number) : undefined;
  const chapterEvents = kb?.events.filter(e => e.sceneIds.some(id => chapter.scenes.some(s => s.id === id)) || e.plannedChapter === chapter.number) ?? [];
  const shared = { book, onRefresh, onStart, onOpenReviews };
  return <article className="mb-8 min-w-0">
    <header className="mb-3 space-y-2 border-b border-slate-300 pb-3 dark:border-slate-700">
      <h3 className="flex flex-wrap items-baseline gap-2 text-xl font-bold"><span>Capitolo {chapter.number} — {chapter.title}</span>
        {chapter.frozenAt && <span className="rounded-full border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">congelato</span>}</h3>
      <div className="flex flex-wrap gap-1.5"><Badge>{chapter.scenes.length} scene</Badge><Badge tone={status.tone}>{status.label}</Badge>
        <ReviewStateBadge book={book} target={{ kind: "chapter", id: chapter.id }} quiet/></div>
      <p className="muted text-sm">{chapter.purpose}</p>
      <StaleChapterNote chapter={chapter} onOpenReviews={onOpenReviews}/>
      <Tabs label={"Viste del capitolo " + chapter.number} value={tab} onChange={setTab} tabs={[
        { id: "text", label: "Testo completo", icon: <BookOpenText size={15}/> },
        { id: "scenes", label: "Scene", icon: <ListOrdered size={15}/>, count: chapter.scenes.length },
        { id: "summary", label: "Riassunto", icon: <ScrollText size={15}/> },
        { id: "edit", label: "Modifica", icon: <Pencil size={15}/> },
      ]}/>
    </header>
    <div role="tabpanel" id={"panel-" + tab} aria-labelledby={"tab-" + tab}>
      {tab === "text" && chapter.scenes.map(scene => <SceneText key={scene.id} {...shared} chapter={chapter} scene={scene} busy={busy} onApprove={onApprove}/>)}
      {tab === "scenes" && <ol className="space-y-2" aria-label={"Scene del capitolo " + chapter.number}>
        {chapter.scenes.map(scene => <SceneCard key={scene.id} {...shared} chapter={chapter} scene={scene}/>)}</ol>}
      {tab === "summary" && <div className="space-y-4">
        <section className="rounded-xl border border-slate-300 p-4 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">Riassunto del capitolo</h4>
            <Badge tone={summary ? "emerald" : "amber"}>{summary ? "Consolidato alla revisione" : "Provvisorio, dai riassunti delle scene"}</Badge>
            {summary && chapter.summaryStale && <Badge tone="amber">Non aggiornato alle modifiche</Badge>}</div>
          <p className="mt-2 leading-7">{summary || provisional || <span className="muted">Nessun riassunto ancora: si crea scena dopo scena.</span>}</p>
        </section>
        <section><h4 className="mb-2 text-sm font-semibold">Scena per scena</h4>
          <ol className="space-y-2">{chapter.scenes.map(s => <li key={s.id} className="flex gap-3 text-sm"><span className="muted w-6 shrink-0 text-right font-semibold">{s.number}.</span>
            <span><b>{s.title}</b> — {s.summary?.trim() || <span className="muted">{s.text.trim() ? "riassunto non disponibile" : "da scrivere"}</span>}
              {s.summaryStale && <span className="ml-1.5"><Badge tone="amber">da aggiornare</Badge></span>}</span></li>)}</ol></section>
        {found && (found.entities.length > 0 || chapterEvents.length > 0) && <section><h4 className="mb-2 text-sm font-semibold">Elementi e snodi del capitolo</h4>
          <ul className="flex flex-wrap gap-1.5">{found.entities.map(e => <li key={e.id}><Badge tone="violet">{ENTITY_LABELS[e.type].one}: {e.name}</Badge></li>)}
            {chapterEvents.map(e => <li key={e.id}><Badge tone="sky">Evento: {e.title}</Badge></li>)}</ul></section>}
        <p className="muted text-xs">I riassunti descrivono cosa accade, non giudicano la qualità; quello consolidato nasce quando il capitolo supera la redazione. Puoi correggerli dalla scheda «Modifica».</p>
      </div>}
      {tab === "edit" && <ChapterEditTab {...shared} chapter={chapter} onSelectChapter={onSelectChapter}/>}
    </div>
  </article>;
}

/** The book, chapter by chapter, with full text, scenes, summaries and editing. */
export function BookWorkspace({ book, chapterId, onChapter, busy, onApprove, onRefresh, onStart, onOpenReviews }: {
  book: BookProject; chapterId: string; onChapter: (id: string) => void; busy: boolean;
  onApprove: (sceneId: string) => void; onRefresh: () => Promise<void>; onStart: (bookId: string) => void; onOpenReviews?: () => void;
}) {
  const selected = book.chapters.find(ch => ch.id === chapterId);
  const shared = { book, onRefresh, onStart, onOpenReviews };
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
          <span className={"mt-0.5 block truncate text-[11px] " + (active ? "text-white/80" : status.tone === "amber" && ch.frozenAt ? "text-amber-700 dark:text-amber-300" : "muted")}>{status.label}</span>
        </button>;
      })}
    </nav>
    {selected ? <ChapterView key={selected.id} {...shared} chapter={selected} busy={busy} onApprove={onApprove} onSelectChapter={onChapter}/>
      : book.chapters.map(ch => <article key={ch.id} className="mb-8">
        <h3 className="mb-3 flex flex-wrap items-baseline gap-2 border-b border-slate-300 pb-2 text-xl font-bold dark:border-slate-700">
          <span>Capitolo {ch.number} — {ch.title}</span>
          {ch.frozenAt && <span className="rounded-full border border-emerald-600/50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">congelato</span>}
        </h3>
        <p className="muted mb-4 text-sm">{ch.purpose}</p>
        <div className="mb-3"><StaleChapterNote chapter={ch} onOpenReviews={onOpenReviews}/></div>
        {ch.scenes.map(scene => <SceneText key={scene.id} {...shared} chapter={ch} scene={scene} busy={busy} onApprove={onApprove}/>)}
      </article>)}
  </div>;
}
