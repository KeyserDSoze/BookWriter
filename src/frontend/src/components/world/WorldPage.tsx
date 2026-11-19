import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, BookOpen, CalendarClock, ChevronDown, Globe2, History, Play, Search, Users, X } from "lucide-react";
import type { BookProject } from "@engine/domain/types";
import { ENTITY_LABELS, type EntityType } from "@engine/domain/knowledge";
import { MEMORY_FOLDERS, MEMORY_PART_LABELS, parseMemoryId, type MemoryFolder } from "@engine/domain/book-edits";
import { requestKnowledgeGeneration, updateChangeMode } from "../../application/narrative-change";
import { readPref, writePref } from "../../application/ui-prefs";
import { Button } from "../ui/button";
import { Segmented } from "../ui/primitives";
import { ReviewStateBadge } from "../edit/EditKit";
import { MemoryPartEditor, NewMemoryEntryForm } from "../edit/MemoryEditors";
import { ActiveChangeBanner, ChangeHistory } from "./ChangeOperations";
import { ResearchLog } from "./ResearchLog";
import { entityMatches, EntityBrowser, eventMatches, has, ICONS, TimelineView } from "./WorldParts";

const ENTITY_TYPES = ["character", "location", "item", "faction"] as const;
const MEMORY_TITLES: Record<MemoryFolder, string> = { characters: "Memoria · Personaggi", locations: "Memoria · Luoghi", factions: "Memoria · Fazioni",
  items: "Memoria · Oggetti", secrets: "Memoria · Segreti (solo autore)" };
/** Open sections are remembered on this device, never in the book. */
const OPEN_KEY = "worldOpen";

/** Where a link from another page lands: a sheet, an event, a timeline or a part of the memory. */
export type WorldFocus = { kind: "entity" | "event" | "timeline" | "memory"; id: string };

function Accordion({ id, title, count, icon, open, onToggle, badge, children }: {
  id: string; title: string; count?: number; icon: ReactNode; open: boolean; onToggle: () => void; badge?: ReactNode; children: ReactNode;
}) {
  const header = `world-${id}-header`, panel = `world-${id}-panel`;
  return <section data-section={id} className="panel overflow-hidden">
    <h3 className="m-0">
      <button type="button" id={header} aria-expanded={open} aria-controls={panel} onClick={onToggle}
        className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left text-base font-semibold focus-visible:outline-2 focus-visible:outline-violet-500">
        {icon}<span className="min-w-0 [overflow-wrap:anywhere]">{count === undefined ? title : `${title} (${count})`}</span>{badge}
        <ChevronDown size={18} aria-hidden className={"ml-auto shrink-0 transition-transform " + (open ? "rotate-180" : "")}/>
      </button>
    </h3>
    {open && <div id={panel} role="region" aria-labelledby={header} className="min-w-0 border-t border-slate-300 p-3 sm:p-4 dark:border-slate-700">{children}</div>}
  </section>;
}

/** One memory entry: closed by default, editable when opened. */
function MemoryEntry({ book, folder, name, value, forceOpen, startOpen, onRefresh, onStart }: {
  book: BookProject; folder: MemoryFolder; name: string; value: string; forceOpen: boolean; startOpen: boolean;
  onRefresh: () => Promise<void>; onStart: (bookId: string) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const id = folder + ":" + name;
  const shown = open || forceOpen;
  return <li className="rounded-xl border border-slate-300 dark:border-slate-700">
    <button type="button" aria-expanded={shown} onClick={() => setOpen(!open)}
      className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-violet-500">
      <b className="text-sm [overflow-wrap:anywhere]">{name}</b>
      <span className="muted min-w-0 flex-1 truncate text-xs">{value.replace(/\s+/g, " ").slice(0, 90)}</span>
      <ReviewStateBadge book={book} target={{ kind: "memory", id }} quiet/>
      <ChevronDown size={16} aria-hidden className={"shrink-0 transition-transform " + (shown ? "rotate-180" : "")}/>
    </button>
    {shown && <div className="border-t border-slate-300 p-3 dark:border-slate-700"><MemoryPartEditor book={book} id={id} rows={4} removable onRefresh={onRefresh} onStart={onStart}/></div>}
  </li>;
}

function MemoryFolderSection({ book, folder, query, focusName, onRefresh, onStart }: {
  book: BookProject; folder: MemoryFolder; query: string; focusName?: string; onRefresh: () => Promise<void>; onStart: (bookId: string) => void;
}) {
  const searching = !!query.trim();
  const entries = Object.entries(book.memory[folder]).filter(([name, value]) => !searching || has(name + " " + value, query));
  return <div className="space-y-3">
    {folder === "secrets" && <p className="muted text-xs">Solo per te: i segreti guidano l'AI ma non vanno rivelati ai lettori prima del tempo.</p>}
    {entries.length
      ? <ul className="space-y-2">{entries.map(([name, value]) => <MemoryEntry key={name} book={book} folder={folder} name={name} value={value}
        forceOpen={searching && entries.length <= 3} startOpen={focusName === name} onRefresh={onRefresh} onStart={onStart}/>)}</ul>
      : <p className="muted text-sm">Nessuna informazione consolidata.</p>}
    {!searching && <details className="rounded-xl border border-slate-300 dark:border-slate-700">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold">Aggiungi una voce a mano</summary>
      <div className="border-t border-slate-300 p-3 dark:border-slate-700"><NewMemoryEntryForm book={book} folder={folder} title={MEMORY_PART_LABELS[folder]} onRefresh={onRefresh}/></div>
    </details>}
  </div>;
}

interface Section { id: string; group: string; title: string; icon: ReactNode; count?: number; hits: number; badge?: ReactNode; render: () => ReactNode }

/** The book's world on a single column: every part is a closed accordion that remembers if it was open,
 * can be searched all at once and edited by hand or by prompt. */
export function WorldPage({ book, onRefresh, onStart, runningHere, onOpenAgents, onOpenBook, focus }: {
  book: BookProject; onRefresh: () => Promise<void>; onStart: (bookId: string) => void; runningHere: boolean;
  onOpenAgents: () => void; onOpenBook: () => void;
  focus?: WorldFocus;
}) {
  const kb = book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
  const focusedEntity = focus?.kind === "entity" ? kb?.entities.find(e => e.id === focus.id) : undefined;
  const memoryFocus = focus?.kind === "memory" ? parseMemoryId(focus.id) : undefined;
  const focusSection = focusedEntity ? focusedEntity.type : focus?.kind === "event" || focus?.kind === "timeline" ? "timeline"
    : memoryFocus ? (memoryFocus.part === "entry" ? "memory-" + memoryFocus.folder : "memory-" + memoryFocus.part) : undefined;
  const [open, setOpen] = useState<string[]>(() => {
    const saved = readPref<unknown>(OPEN_KEY, []);
    const list = Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string") : [];
    return focusSection && !list.includes(focusSection) ? [...list, focusSection] : list;
  });
  const [selected, setSelected] = useState<Partial<Record<EntityType, string>>>(focusedEntity ? { [focusedEntity.type]: focusedEntity.id } : {});
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusSection) return;
    root.current?.querySelector<HTMLElement>(`[data-section="${focusSection}"]`)?.scrollIntoView?.({ block: "start" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => {
    const next = open.includes(id) ? open.filter(x => x !== id) : [...open, id];
    setOpen(next); writePref(OPEN_KEY, next);
  };
  const q = query.trim();
  const profiles = book.editorialProfiles;
  const agents = (profiles ? profiles.readers.filter(r => r.enabled).length : 5) + 7 + (profiles?.writers.find(w => w.id === profiles.selectedWriterId)?.reviewEnabled ? 1 : 0);
  async function generate() {
    if (!window.confirm("Generare schede, eventi e timeline dal libro? L'autopilot userà una chiamata AI e poi riprenderà il lavoro.")) return;
    setMessage("");
    try { await requestKnowledgeGeneration(book.id, book.updatedAt); await onRefresh(); onStart(book.id); setMessage("Generazione avviata: le schede compariranno qui al termine."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Generazione non avviata."); await onRefresh().catch(() => undefined); }
  }
  async function mode(value: "auto" | "confirm") {
    setMessage("");
    try { await updateChangeMode(book.id, value, book.updatedAt); await onRefresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Modalità non salvata."); await onRefresh().catch(() => undefined); }
  }

  const sections: Section[] = [];
  if (kb) {
    for (const type of ENTITY_TYPES) {
      const all = kb.entities.filter(e => e.type === type);
      const Icon = ICONS[type];
      const hits = q ? all.filter(e => entityMatches(e, q)).length : all.length;
      sections.push({ id: type, group: "Schede", title: ENTITY_LABELS[type].many, icon: <Icon size={18} aria-hidden className="shrink-0 text-violet-600 dark:text-violet-300"/>, count: q ? hits : all.length, hits,
        render: () => <EntityBrowser book={book} type={type} query={q} onRefresh={onRefresh} onStart={onStart} selected={selected[type]}
          onSelect={id => setSelected(s => ({ ...s, [type]: id }))}/> });
    }
    const eventHits = q ? kb.events.filter(e => eventMatches(kb, e, q)).length : kb.events.length;
    sections.push({ id: "timeline", group: "Schede", title: "Timeline ed eventi", icon: <CalendarClock size={18} aria-hidden className="shrink-0 text-violet-600 dark:text-violet-300"/>,
      count: q ? eventHits : kb.events.length, hits: eventHits, render: () => <TimelineView book={book} query={q} onRefresh={onRefresh} onStart={onStart}/> });
  }
  const stateHit = !q || has(book.memory.currentState, q);
  sections.push({ id: "memory-state", group: "Memoria narrativa", title: "Stato corrente", icon: <History size={18} aria-hidden className="shrink-0 text-sky-600 dark:text-sky-300"/>,
    hits: stateHit ? 1 : 0, badge: <ReviewStateBadge book={book} target={{ kind: "memory", id: "state" }} quiet/>,
    render: () => <MemoryPartEditor book={book} id="state" rows={7} onRefresh={onRefresh} onStart={onStart}
      hint="Il punto in cui si trova la storia: guida la scrittura delle prossime scene. Cambiarlo non riscrive il testo."/> });
  const timelineHit = !q || book.memory.timeline.some(line => has(line, q));
  sections.push({ id: "memory-timeline", group: "Memoria narrativa", title: "Cronologia della memoria", count: book.memory.timeline.length, hits: timelineHit ? 1 : 0,
    icon: <History size={18} aria-hidden className="shrink-0 text-sky-600 dark:text-sky-300"/>, badge: <ReviewStateBadge book={book} target={{ kind: "memory", id: "timeline" }} quiet/>,
    render: () => <MemoryPartEditor book={book} id="timeline" rows={9} onRefresh={onRefresh} onStart={onStart} hint="Una voce per riga, in ordine di accadimento."/> });
  for (const folder of MEMORY_FOLDERS) {
    const entries = Object.entries(book.memory[folder]);
    const hits = q ? entries.filter(([name, value]) => has(name + " " + value, q)).length : entries.length;
    sections.push({ id: "memory-" + folder, group: "Memoria narrativa", title: MEMORY_TITLES[folder], count: q ? hits : entries.length, hits,
      icon: <BookOpen size={18} aria-hidden className="shrink-0 text-sky-600 dark:text-sky-300"/>,
      render: () => <MemoryFolderSection book={book} folder={folder} query={q} onRefresh={onRefresh} onStart={onStart}
        {...(memoryFocus?.part === "entry" && memoryFocus.folder === folder ? { focusName: memoryFocus.name } : {})}/> });
  }
  const ops = book.changeOperations ?? [];
  const changeHits = q ? ops.filter(op => has(op.targetLabel + " " + op.instruction, q)).length : ops.length;
  sections.push({ id: "changes", group: "Registro", title: "Modifiche", count: q ? changeHits : ops.length, hits: changeHits,
    icon: <History size={18} aria-hidden className="shrink-0"/>, render: () => <ChangeHistory book={book} onRefresh={onRefresh}/> });
  const log = book.webResearchLog ?? [];
  const researchHits = q ? (log.length && has(JSON.stringify(log), q) ? log.length : 0) : log.length;
  sections.push({ id: "research", group: "Registro", title: "Ricerche", count: log.length, hits: researchHits,
    icon: <Search size={18} aria-hidden className="shrink-0"/>, render: () => <ResearchLog book={book} onRefresh={onRefresh} onOpenSettings={onOpenAgents}/> });

  const visible = sections.filter(s => !q || s.hits > 0);
  const total = q ? visible.reduce((n, s) => n + s.hits, 0) : 0;
  const groups = [...new Set(visible.map(s => s.group))];
  return <div ref={root} className="min-w-0 space-y-4">
    <section className="panel space-y-3 p-3 sm:p-4" aria-label="Worldbuilding del libro">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="flex items-center gap-2 text-lg font-semibold"><Globe2 size={20} className="text-violet-600 dark:text-violet-300"/> Worldbuilding del libro</h2>
          <p className="muted text-sm">Schede, eventi, timeline e memoria narrativa del libro, collegati da identificativi stabili. Ogni parte si può consultare, correggere a mano o cambiare con un prompt: dopo una modifica scegli tu se far aggiornare il libro.</p></div>
        {kb && <div className="space-y-1"><p className="text-xs font-semibold">Applica le modifiche</p>
          <Segmented label="Applica le modifiche" disabled={book.status === "running"} value={book.changeMode ?? "auto"} onChange={value => void mode(value)}
            options={[{ value: "auto", label: "Automaticamente" }, { value: "confirm", label: "Dopo la mia conferma" }]}/></div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onOpenBook}><BookOpen size={15}/> Capitoli ({book.chapters.length})</Button>
        <Button variant="outline" size="sm" onClick={onOpenAgents}><Users size={15}/> Agenti e review ({agents})</Button>
      </div>
      {!kb && <div className="rounded-xl border border-dashed border-violet-500/50 bg-violet-500/5 p-4">
        {book.knowledge?.pending ? <>
          <p className="font-semibold">Schede in arrivo</p>
          <p className="muted text-sm">L'autopilot genererà personaggi, luoghi, oggetti, fazioni, eventi e timeline al prossimo passo.</p>
          {book.status !== "running" && <Button className="mt-2" onClick={() => onStart(book.id)}><Play size={16}/> Avvia l'autopilot</Button>}
        </> : <>
          <p className="font-semibold">Nessuna scheda strutturata per questo libro</p>
          <p className="muted text-sm">{book.chapters.length ? "Puoi generarle dal piano e dalle scene già scritte, senza toccare il testo." : "Si creano automaticamente dopo il piano dei capitoli."}</p>
          {book.chapters.length > 0 && <Button className="mt-2" disabled={book.status === "running"} onClick={() => void generate()}><Bot size={16}/> Genera le schede del libro</Button>}
        </>}
      </div>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
    <ActiveChangeBanner book={book} onRefresh={onRefresh} onStart={onStart} runningHere={runningHere}/>
    <div className="space-y-1">
      <label className="relative block"><span className="sr-only">Cerca nel mondo</span>
        <Search size={16} aria-hidden className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"/>
        <input className="field pl-9 pr-11" type="search" placeholder="Cerca in schede, eventi, memoria e modifiche" value={query} onChange={e => setQuery(e.target.value)}/>
        {query && <button type="button" aria-label="Cancella la ricerca" onClick={() => setQuery("")}
          className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"><X size={16}/></button>}
      </label>
      <p role="status" className="muted min-h-5 text-xs">{q ? (total ? `${total} ${total === 1 ? "risultato" : "risultati"} in ${visible.length} ${visible.length === 1 ? "sezione" : "sezioni"}: le sezioni senza risultati sono nascoste.`
        : "Nessun risultato per «" + q + "».") : "Le sezioni sono chiuse: aprile per vedere e modificare. Il programma ricorda quali tenevi aperte."}</p>
    </div>
    {groups.map(group => <div key={group} className="space-y-2">
      <p className="muted text-xs font-semibold uppercase tracking-wide">{group}</p>
      {visible.filter(s => s.group === group).map(s => <Accordion key={s.id} id={s.id} title={s.title} icon={s.icon} badge={s.badge} {...(s.count !== undefined ? { count: s.count } : {})}
        open={!!q || open.includes(s.id)} onToggle={() => { if (!q) toggle(s.id); }}>{s.render()}</Accordion>)}
    </div>)}
    {!kb && <p className="muted text-xs">Personaggi, luoghi, oggetti, fazioni, eventi e timeline compariranno qui appena le schede esistono.</p>}
  </div>;
}
