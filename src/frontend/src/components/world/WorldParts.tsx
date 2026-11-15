import { useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, CalendarClock, Flag, History, MapPin, Package, Pencil, Plus, Users } from "lucide-react";
import type { BookProject } from "../../domain/types";
import { ATTRIBUTE_FIELDS, ENTITY_LABELS, MEMORY_FOLDER, NARRATION_LABELS, STANCE_LABELS, type EntityType, type KnowledgeEntity, type KnowledgeEvent } from "../../domain/knowledge";
import { dependentEvents, entityReferences, entityState, eventState, STATE_LABELS, timelineOrders, type NarrativeState, type SceneRef } from "../../domain/knowledge-index";
import { attributeLabel } from "../../domain/knowledge-markdown";
import { shiftEvent } from "../../application/book-editing";
import { Button } from "../ui/button";
import { Badge, EmptyState, Segmented } from "../ui/primitives";
import { EditHistory, PendingEditActions, PromptEditChoices, ReviewStateBadge } from "../edit/EditKit";
import { EntityEditor, EventEditor, NewEntityForm, TimelineManager } from "../edit/KnowledgeEditors";

/** The parts of the world page that show and edit sheets, events and timelines. */
export const fold = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it");
export const has = (haystack: string, query: string) => fold(haystack).includes(fold(query.trim()));
export const entityMatches = (e: KnowledgeEntity, query: string) => has([e.name, ...e.aliases, e.summary, ...Object.values(e.attributes)].join(" "), query);
export const ICONS: Record<EntityType, typeof Users> = { character: Users, location: MapPin, item: Package, faction: Flag };
export const eventMatches = (kb: NonNullable<BookProject["knowledge"]>, event: KnowledgeEvent, query: string) =>
  has([event.title, event.summary, event.when ?? "", ...event.involves.map(id => kb.entities.find(e => e.id === id)?.name ?? "")].join(" "), query);
const STATE_TONE: Record<NarrativeState, "neutral" | "sky" | "emerald"> = { planned: "neutral", narrated: "sky", consolidated: "emerald" };
const IMPORTANCE: Record<KnowledgeEntity["importance"], string> = { main: "Principale", secondary: "Secondario", minor: "Minore" };
const EXAMPLES: Record<EntityType, string[]> = {
  character: ["Rendilo impulsivo ed emotivo, ma mantieni invariato il suo obiettivo principale.", "Cambia il suo modo di parlare: frasi brevi e ironiche.", "Rendi ambigua la sua lealtà fino al capitolo finale."],
  location: ["Rendi questo luogo più cupo e opprimente.", "Sposta questo luogo vicino al porto."],
  item: ["Questo oggetto deve avere un potere nascosto rivelato solo alla fine.", "Rendilo un ricordo di famiglia."],
  faction: ["Questa fazione deve essere divisa al suo interno.", "Rendi i suoi metodi meno violenti ma più subdoli."],
};
function where(book: BookProject, ref: SceneRef): string {
  const scene = book.chapters.find(c => c.id === ref.chapterId)?.scenes.find(s => s.id === ref.sceneId);
  return `Cap. ${ref.chapterNumber} · ${ref.sceneNumber}${scene ? ". " + scene.title : ""}`;
}

function EntityDetail({ book, entity, onSelect, onRefresh, onStart }: {
  book: BookProject; entity: KnowledgeEntity; onSelect: (id?: string) => void; onRefresh: () => Promise<void>; onStart: (bookId: string) => void;
}) {
  const kb = book.knowledge!;
  const refs = useMemo(() => entityReferences(book, kb, entity), [book, kb, entity]);
  const events = kb.events.filter(e => e.involves.includes(entity.id) || e.perspectives.some(p => p.entityId === entity.id));
  const memory = book.memory[MEMORY_FOLDER[entity.type]][entity.name];
  const [editing, setEditing] = useState(false);
  const fields = [...ATTRIBUTE_FIELDS[entity.type].map(f => f.key), ...Object.keys(entity.attributes).filter(k => !ATTRIBUTE_FIELDS[entity.type].some(f => f.key === k))];
  const Icon = ICONS[entity.type];
  return <article aria-label={"Scheda di " + entity.name} className="space-y-4">
    <header className="space-y-2">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><Icon size={22}/></span>
        <div className="min-w-0">
          <h3 className="text-xl font-bold [overflow-wrap:anywhere]">{entity.name}</h3>
          {entity.aliases.length > 0 && <p className="muted text-xs">Detto anche: {entity.aliases.join(", ")}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="violet">{ENTITY_LABELS[entity.type].one}</Badge><Badge>{IMPORTANCE[entity.importance]}</Badge>
        <Badge tone={STATE_TONE[entityState(book, refs)]}>{STATE_LABELS[entityState(book, refs)]}</Badge>
        <Badge tone={entity.status === "validated" ? "emerald" : "amber"}>{entity.status === "validated" ? "Validata" : "Bozza"}</Badge>
        <Badge>v{entity.version}</Badge>
        <ReviewStateBadge book={book} target={{ kind: "entity", id: entity.id }} quiet/>
      </div>
    </header>
    {entity.summary && <p className="text-[15px] leading-7">{entity.summary}</p>}
    {fields.some(k => entity.attributes[k]) && <dl className="grid gap-3 sm:grid-cols-2">
      {fields.filter(k => entity.attributes[k]).map(key => <div key={key} className="rounded-lg border border-slate-300 p-2.5 dark:border-slate-700">
        <dt className="muted text-[11px] font-semibold uppercase tracking-wide">{attributeLabel(entity.type, key)}</dt>
        <dd className="mt-0.5 text-sm [overflow-wrap:anywhere]">{entity.attributes[key]}</dd></div>)}
    </dl>}
    {entity.relationships.length > 0 && <section><h4 className="mb-1.5 text-sm font-semibold">Relazioni principali</h4>
      <ul className="flex flex-wrap gap-1.5">{entity.relationships.map(r => {
        const target = kb.entities.find(e => e.id === r.targetId);
        return <li key={r.targetId}><button type="button" onClick={() => onSelect(r.targetId)} title={r.note}
          className="rounded-full border border-slate-300 px-2.5 py-1 text-xs hover:border-violet-500 dark:border-slate-600 max-sm:min-h-11">
          <span className="muted">{r.type}</span> · <b>{target?.name ?? r.targetId}</b></button></li>;
      })}</ul></section>}
    <section><h4 className="mb-1.5 text-sm font-semibold">Presenza nel libro ({refs.length})</h4>
      {refs.length ? <ul className="flex flex-wrap gap-1.5">{refs.map(ref => <li key={ref.sceneId}>
        <Badge tone={ref.via === "event" ? "neutral" : "sky"}>{where(book, ref)}{ref.via === "event" ? " · prevista" : ""}</Badge></li>)}</ul>
        : <p className="muted text-sm">Non ancora presente nelle scene.</p>}</section>
    {events.length > 0 && <section><h4 className="mb-1.5 text-sm font-semibold">Eventi ({events.length})</h4>
      <ul className="space-y-1.5 text-sm">{events.map(e => {
        const stance = e.perspectives.find(p => p.entityId === entity.id);
        return <li key={e.id} className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{e.title}</span>
          <Badge>{NARRATION_LABELS[e.narration]}</Badge>{e.secret && <Badge tone="rose">Segreto</Badge>}
          {stance && <Badge tone="amber">{STANCE_LABELS[stance.stance]}{stance.note ? ": " + stance.note : ""}</Badge>}</li>;
      })}</ul></section>}
    {memory && <section className="rounded-lg bg-slate-100 p-3 dark:bg-slate-900"><h4 className="text-sm font-semibold">Stato attuale nella memoria narrativa</h4>
      <p className="muted mt-1 whitespace-pre-wrap text-sm">{memory}</p></section>}
    <PromptEditChoices book={book} request={{ kind: "entity", id: entity.id }} propagate={{ kind: "entity", id: entity.id }} label={entity.name}
      examples={EXAMPLES[entity.type]} onRefresh={onRefresh} onStart={onStart}/>
    <details open={editing} onToggle={e => setEditing((e.target as HTMLDetailsElement).open)} className="rounded-xl border border-slate-300 dark:border-slate-700">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-semibold"><Pencil size={15}/> Modifica la scheda a mano (senza riscrivere le scene)</summary>
      <div className="border-t border-slate-300 p-3 dark:border-slate-700">
        {editing && <EntityEditor book={book} entity={entity} onRefresh={onRefresh} onDeleted={() => onSelect(undefined)}/>}
      </div>
    </details>
    <EditHistory book={book} target={{ kind: "entity", id: entity.id }} label={entity.name} onRefresh={onRefresh}/>
    <PendingEditActions book={book} target={{ kind: "entity", id: entity.id }} label={entity.name} onRefresh={onRefresh} onStart={onStart}/>
    {(entity.history?.length ?? 0) > 0 && <details className="text-sm"><summary className="cursor-pointer font-semibold"><History size={14} className="mr-1 inline"/>Versioni precedenti ({entity.history!.length})</summary>
      <ol className="mt-2 space-y-2">{[...entity.history!].reverse().map(h => <li key={h.version} className="rounded-lg border border-slate-300 p-2 dark:border-slate-700">
        <p className="text-xs font-semibold">v{h.version} · {new Date(h.at).toLocaleString("it-IT")}</p><p className="muted text-xs">{h.reason}</p>
        <p className="mt-1 text-xs">{h.snapshot.summary}</p></li>)}</ol></details>}
  </article>;
}

export function EntityBrowser({ book, type, query, onRefresh, onStart, selected, onSelect }: {
  book: BookProject; type: EntityType; query: string; onRefresh: () => Promise<void>; onStart: (bookId: string) => void;
  selected?: string; onSelect: (id?: string) => void;
}) {
  const kb = book.knowledge!;
  const [importance, setImportance] = useState<"all" | KnowledgeEntity["importance"]>("all");
  const all = kb.entities.filter(e => e.type === type);
  const shown = all.filter(e => importance === "all" || e.importance === importance)
    .filter(e => !query.trim() || entityMatches(e, query));
  const rank = { main: 0, secondary: 1, minor: 2 } as const;
  const entity = kb.entities.find(e => e.id === selected && e.type === type);
  const Icon = ICONS[type];
  const [creating, setCreating] = useState(false);
  return <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
    <div className={"min-w-0 space-y-3 " + (entity ? "max-lg:hidden" : "")}>
      <Button variant={creating ? "outline" : "default"} size="sm" aria-expanded={creating} onClick={() => setCreating(v => !v)}><Plus size={15}/> {creating ? "Chiudi" : "Nuova scheda"}</Button>
      {creating && <NewEntityForm book={book} type={type} onRefresh={onRefresh} onCreated={id => { setCreating(false); onSelect(id); }}/>}
      <div className="space-y-2">
        <Segmented label="Importanza" value={importance} onChange={setImportance} options={[{ value: "all", label: "Tutti" }, { value: "main", label: "Principali" },
          { value: "secondary", label: "Secondari" }, { value: "minor", label: "Minori" }]}/>
      </div>
      {!all.length ? <EmptyState title={"Nessuna scheda: " + ENTITY_LABELS[type].many.toLowerCase()} icon={<Icon size={26}/>}>Le schede nascono con la pianificazione e crescono durante la scrittura.</EmptyState>
        : !shown.length ? <p className="muted text-sm">Nessun risultato per i filtri scelti.</p>
          : <ul className="grid gap-2" aria-label={ENTITY_LABELS[type].many}>
            {[...shown].sort((a, b) => rank[a.importance] - rank[b.importance] || a.name.localeCompare(b.name)).map(e => {
              const refs = entityReferences(book, kb, e);
              const chapters = [...new Set(refs.filter(r => r.via !== "event").map(r => r.chapterNumber))];
              const state = entityState(book, refs);
              return <li key={e.id}><button type="button" onClick={() => onSelect(e.id)} aria-current={selected === e.id}
                className={"w-full rounded-xl border p-3 text-left transition-colors hover:border-violet-500 focus-visible:outline-2 focus-visible:outline-violet-500 " +
                  (selected === e.id ? "border-violet-500 bg-violet-500/5" : "border-slate-300 dark:border-slate-700")}>
                <span className="flex flex-wrap items-center gap-1.5"><b className="[overflow-wrap:anywhere]">{e.name}</b>
                  <Badge>{IMPORTANCE[e.importance]}</Badge><Badge tone={STATE_TONE[state]}>{STATE_LABELS[state]}</Badge></span>
                {(e.attributes.role || e.summary) && <span className="muted mt-1 line-clamp-2 block text-sm">{e.attributes.role ? e.attributes.role + " — " : ""}{e.summary}</span>}
                <span className="muted mt-1 block text-xs">{chapters.length ? "Capitoli " + chapters.join(", ") : "Non ancora nelle scene"}</span>
              </button></li>;
            })}
          </ul>}
    </div>
    <div className="min-w-0">
      {entity ? <div className="panel p-3 sm:p-4">
        <Button variant="ghost" size="sm" className="mb-2 lg:hidden" onClick={() => onSelect(undefined)}><ArrowLeft size={15}/> Torna all'elenco</Button>
        <EntityDetail key={entity.id} book={book} entity={entity} onRefresh={onRefresh} onStart={onStart} onSelect={onSelect}/>
      </div> : all.length > 0 && <p className="muted hidden rounded-xl border border-dashed border-slate-400 p-6 text-center text-sm lg:block dark:border-slate-600">Scegli una scheda per vedere dettagli, relazioni, presenza e modifiche.</p>}
    </div>
  </div>;
}

function EventCard({ book, event, index, onRefresh, onStart, move }: { book: BookProject; event: KnowledgeEvent; index: number; onRefresh: () => Promise<void>; onStart: (bookId: string) => void;
  /** Story order only: move one step earlier/later. */
  move?: { first: boolean; last: boolean; timelineId?: string } }) {
  const kb = book.knowledge!;
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  async function shift(direction: -1 | 1) {
    setMessage("");
    try { await shiftEvent(book.id, event.id, direction, move?.timelineId); await onRefresh(); }
    catch (error) { await onRefresh().catch(() => undefined); setMessage(error instanceof Error ? error.message : "Evento non spostato."); }
  }
  const name = (id: string) => kb.entities.find(e => e.id === id)?.name ?? id;
  const state = eventState(book, event);
  const dependents = dependentEvents(kb, event.id);
  const scenes = event.sceneIds.map(id => book.chapters.flatMap(c => c.scenes.map(s => ({ c, s }))).find(x => x.s.id === id)).filter(Boolean);
  return <li className="relative pl-10">
    <span aria-hidden className="absolute left-0 top-1 flex size-7 items-center justify-center rounded-full border-2 border-violet-500 bg-white text-xs font-bold dark:bg-slate-950">{index + 1}</span>
    <div className="rounded-xl border border-slate-300 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-1.5"><b className="[overflow-wrap:anywhere]">{event.title}</b>
        <Badge>{NARRATION_LABELS[event.narration]}</Badge><Badge tone={STATE_TONE[state]}>{STATE_LABELS[state]}</Badge>
        {event.secret && <Badge tone="rose">Segreto</Badge>}
        <ReviewStateBadge book={book} target={{ kind: "event", id: event.id }} quiet/>
        <span className="ml-auto flex items-center gap-1">
          {move && <><Button size="icon" variant="ghost" aria-label={`Sposta prima nella storia: ${event.title}`} disabled={move.first} onClick={() => void shift(-1)}><ArrowUp size={16}/></Button>
            <Button size="icon" variant="ghost" aria-label={`Sposta dopo nella storia: ${event.title}`} disabled={move.last} onClick={() => void shift(1)}><ArrowDown size={16}/></Button></>}
          <Button size="sm" variant={editing ? "outline" : "ghost"} aria-expanded={editing} aria-label={`Modifica l'evento ${event.title}`} onClick={() => setEditing(v => !v)}><Pencil size={14}/><span className="text-xs">{editing ? "Chiudi" : "Modifica"}</span></Button>
        </span></div>
      {message && <p role="status" className="text-xs text-rose-700 dark:text-rose-300">{message}</p>}
      {editing && <div className="my-2 rounded-lg border border-emerald-600/50 bg-emerald-500/5 p-3"><EventEditor book={book} event={event} onRefresh={onRefresh} onDone={() => setEditing(false)}/></div>}
      <p className="muted mt-0.5 text-xs">{event.when ? event.when + " · " : ""}{scenes.length ? scenes.map(x => `Cap. ${x!.c.number}, scena ${x!.s.number}`).join("; ") : event.plannedChapter ? "Previsto nel capitolo " + event.plannedChapter : "Non ancora collocato"}</p>
      {event.summary && <p className="mt-1.5 text-sm">{event.summary}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {event.involves.map(id => <Badge key={id} tone="violet">{name(id)}</Badge>)}
        {event.causes.map(id => <Badge key={id}>dipende da: {kb.events.find(e => e.id === id)?.title ?? id}</Badge>)}
        {dependents.length > 0 && <Badge tone="amber">{dependents.length} eventi dipendono da questo</Badge>}
      </div>
      {event.perspectives.length > 0 && <p className="muted mt-1.5 text-xs">{event.perspectives.map(p => name(p.entityId) + ": " + STANCE_LABELS[p.stance].toLowerCase()).join(" · ")}</p>}
      <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold">Modifica questo evento con un prompt</summary>
        <div className="mt-2"><PromptEditChoices book={book} request={{ kind: "event", id: event.id }} propagate={{ kind: "event", id: event.id }} label={event.title}
          onRefresh={onRefresh} onStart={onStart}
          examples={["Questo evento deve accadere prima, durante l'infanzia della protagonista.", "Rendi l'evento un incidente invece di un tradimento."]}/></div></details>
      <div className="mt-2"><EditHistory book={book} target={{ kind: "event", id: event.id }} label={event.title} onRefresh={onRefresh}/></div>
      <div className="mt-2"><PendingEditActions book={book} target={{ kind: "event", id: event.id }} label={event.title} onRefresh={onRefresh} onStart={onStart}/></div>
    </div>
  </li>;
}

export function TimelineView({ book, query, onRefresh, onStart }: { book: BookProject; query: string; onRefresh: () => Promise<void>; onStart: (bookId: string) => void }) {
  const kb = book.knowledge!;
  const [order, setOrder] = useState<"story" | "narration">("story");
  const [timeline, setTimeline] = useState("");
  const orders = useMemo(() => timelineOrders(book, kb, timeline || undefined), [book, kb, timeline]);
  const events = orders[order];
  const shownEvents = events.map((event, index) => ({ event, index })).filter(({ event }) => !query.trim() || eventMatches(kb, event, query));
  const manager = <TimelineManager book={book} onRefresh={onRefresh} onStart={onStart} selected={timeline || undefined}/>;
  if (!kb.events.length) return <div className="space-y-3"><EmptyState title="Nessun evento" icon={<CalendarClock size={26}/>}>Gli eventi nascono dal piano e dalle scene scritte, oppure li crei tu.</EmptyState>{manager}</div>;
  return <div className="space-y-3">
    {manager}
    <div className="flex flex-wrap items-center gap-2">
      <Segmented label="Ordine" value={order} onChange={setOrder} options={[{ value: "story", label: "Ordine della storia", hint: "Cronologia degli eventi" },
        { value: "narration", label: "Ordine del racconto", hint: "Come i capitoli li raccontano" }]}/>
      {kb.timelines.length > 0 && <label className="text-sm"><span className="sr-only">Timeline</span>
        <select aria-label="Timeline" className="field max-w-xs" value={timeline} onChange={e => setTimeline(e.target.value)}>
          <option value="">Timeline globale (tutti gli eventi)</option>
          {kb.timelines.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select></label>}
    </div>
    <p className="muted text-xs">{order === "story" ? "Gli eventi nell'ordine in cui accadono nella storia, anche se raccontati in flashback." : "Gli eventi nell'ordine in cui il lettore li incontra nei capitoli."}</p>
    {(() => {
      const chosen = kb.timelines.find(t => t.id === timeline);
      if (!chosen || (!chosen.summary && !chosen.subjectIds?.length)) return null;
      const follows = (chosen.subjectIds ?? []).map(id => kb.entities.find(e => e.id === id)?.name ?? id);
      return <p className="text-sm [overflow-wrap:anywhere]">{chosen.summary}{follows.length ? <span className="muted"> {chosen.summary ? "· " : ""}Segue: {follows.join(", ")} (anche i loro eventi)</span> : null}</p>;
    })()}
    <ol aria-label={order === "story" ? "Timeline nell'ordine della storia" : "Timeline nell'ordine del racconto"}
      className="relative space-y-3 before:absolute before:bottom-2 before:left-3.5 before:top-2 before:w-px before:bg-slate-300 dark:before:bg-slate-700">
      {shownEvents.map(({ event, index }) => <EventCard key={event.id} book={book} event={event} index={index} onRefresh={onRefresh} onStart={onStart}
        move={order === "story" && !query.trim() ? { first: index === 0, last: index === events.length - 1, ...(timeline ? { timelineId: timeline } : {}) } : undefined}/>)}
    </ol>
    {query.trim() && !shownEvents.length && <p className="muted text-sm">Nessun evento corrisponde alla ricerca in questa timeline.</p>}
  </div>;
}

