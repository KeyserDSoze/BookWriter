import { useEffect, useRef, useState } from "react";
import { Plus, Save, Sparkles, Trash2 } from "lucide-react";
import type { BookProject } from "../../domain/types";
import { ATTRIBUTE_FIELDS, ENTITY_LABELS, NARRATION_LABELS, NARRATION_MODES, STANCE_LABELS, STANCES,
  type EntityType, type KnowledgeEntity, type KnowledgeEvent, type KnowledgeTimeline } from "../../domain/knowledge";
import { attributeLabel } from "../../domain/knowledge-markdown";
import { createEntity, createEvent, editBase, ElementChangedError, removeEntity, removeEvent, removeTimeline, saveEntityEdit,
  saveEventEdit, saveTimelineEdit } from "../../application/book-editing";
import { Button } from "../ui/button";
import { Badge } from "../ui/primitives";
import { AiEditPanel, ChipPicker, EditHistory, PendingEditActions, PromptEditChoices, ReviewStateBadge } from "./EditKit";

const IMPORTANCE: Record<KnowledgeEntity["importance"], string> = { main: "Principale", secondary: "Secondario", minor: "Minore" };
const errorText = (error: unknown, fallback: string) => error instanceof ElementChangedError
  ? "L'elemento è cambiato nel frattempo (autopilot o altra scheda): ricarica la versione attuale prima di salvare."
  : error instanceof Error ? error.message : fallback;

/** Shared save/feedback logic for the knowledge editors. */
function useSaver(onRefresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true); setMessage("");
    try { await action(); await onRefresh(); if (mounted.current) setMessage(success); return true; }
    catch (error) { await onRefresh().catch(() => undefined); if (mounted.current) setMessage(errorText(error, "Modifica non salvata.")); return false; }
    finally { if (mounted.current) setBusy(false); }
  }
  return { busy, message, run, mounted };
}
const NO_REVIEW = " Nessuna review avviata.";

type EntityDraft = { name: string; aliases: string; importance: KnowledgeEntity["importance"]; summary: string;
  attributes: Array<{ key: string; value: string }>; relationships: KnowledgeEntity["relationships"] };
function entityDraft(entity: KnowledgeEntity): EntityDraft {
  const known = ATTRIBUTE_FIELDS[entity.type].map(f => f.key);
  const keys = [...known, ...Object.keys(entity.attributes).filter(k => !known.includes(k))];
  return { name: entity.name, aliases: entity.aliases.join(", "), importance: entity.importance, summary: entity.summary,
    attributes: keys.map(key => ({ key, value: entity.attributes[key] ?? "" })), relationships: entity.relationships.map(r => ({ ...r })) };
}

/** Every field of a sheet, its relations and its deletion. Saving never starts a review. */
export function EntityEditor({ book, entity, onRefresh, onDeleted }: { book: BookProject; entity: KnowledgeEntity; onRefresh: () => Promise<void>; onDeleted: () => void }) {
  const kb = book.knowledge!;
  const target = { kind: "entity" as const, id: entity.id };
  const [base, setBase] = useState(() => editBase(book, target, entity.name));
  const [draft, setDraft] = useState<EntityDraft>(() => entityDraft(entity));
  const [initial, setInitial] = useState(() => JSON.stringify(entityDraft(entity)));
  const { busy, message, run, mounted } = useSaver(onRefresh);
  const dirty = JSON.stringify(draft) !== initial;
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const savedKey = JSON.stringify(entityDraft(entity));
  useEffect(() => {
    if (dirtyRef.current) return;
    setBase(editBase(book, target, entity.name)); setDraft(entityDraft(entity)); setInitial(JSON.stringify(entityDraft(entity)));
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = kb.entities.filter(e => e.id !== entity.id);
  async function save() {
    const attributes = Object.fromEntries(draft.attributes.filter(a => a.key.trim() && a.value.trim()).map(a => [a.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"), a.value]));
    const ok = await run(() => saveEntityEdit(book.id, entity.id, base, { name: draft.name, importance: draft.importance, summary: draft.summary,
      aliases: draft.aliases.split(",").map(a => a.trim()).filter(Boolean), attributes, relationships: draft.relationships.filter(r => r.targetId && r.type.trim()) }),
    "Scheda salvata: nuova versione." + NO_REVIEW);
    if (ok && mounted.current) setInitial(JSON.stringify(draft));
  }
  async function remove() {
    const refs = kb.events.filter(e => e.involves.includes(entity.id)).length + others.filter(e => e.relationships.some(r => r.targetId === entity.id)).length;
    if (!window.confirm(`Eliminare la scheda «${entity.name}»?${refs ? ` Verrà tolta da ${refs} eventi o relazioni.` : ""} Il testo delle scene non cambia; potrai ripristinarla dalla cronologia.`)) return;
    if (await run(() => removeEntity(book.id, entity.id, base), "Scheda eliminata." + NO_REVIEW)) onDeleted();
  }
  const set = (patch: Partial<EntityDraft>) => setDraft(d => ({ ...d, ...patch }));
  return <form aria-label={"Modifica la scheda di " + entity.name} className="space-y-3" onSubmit={e => { e.preventDefault(); void save(); }}>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">Nome<input className="field mt-1" maxLength={120} value={draft.name} disabled={busy} onChange={e => set({ name: e.target.value })}/></label>
      <label className="block text-sm">Importanza<select className="field mt-1" value={draft.importance} disabled={busy} onChange={e => set({ importance: e.target.value as EntityDraft["importance"] })}>
        {(["main", "secondary", "minor"] as const).map(v => <option key={v} value={v}>{IMPORTANCE[v]}</option>)}</select></label>
    </div>
    <label className="block text-sm">Altri nomi (separati da virgola)<input className="field mt-1" maxLength={1000} value={draft.aliases} disabled={busy} onChange={e => set({ aliases: e.target.value })}/></label>
    <label className="block text-sm">Descrizione breve<textarea className="field mt-1" rows={2} maxLength={600} value={draft.summary} disabled={busy} onChange={e => set({ summary: e.target.value })}/></label>
    <fieldset className="space-y-2"><legend className="text-sm font-semibold">Caratteristiche</legend>
      {draft.attributes.map((attribute, index) => {
        const known = ATTRIBUTE_FIELDS[entity.type].some(f => f.key === attribute.key);
        return <div key={index} className="flex items-end gap-2">
          {known ? <label className="block min-w-0 flex-1 text-sm">{attributeLabel(entity.type, attribute.key)}
            <input className="field mt-1" maxLength={900} value={attribute.value} disabled={busy}
              onChange={e => set({ attributes: draft.attributes.map((a, i) => i === index ? { ...a, value: e.target.value } : a) })}/></label>
            : <>
              <label className="block w-36 text-sm">Campo<input className="field mt-1" maxLength={40} value={attribute.key} disabled={busy}
                onChange={e => set({ attributes: draft.attributes.map((a, i) => i === index ? { ...a, key: e.target.value } : a) })}/></label>
              <label className="block min-w-0 flex-1 text-sm">Valore<input className="field mt-1" maxLength={900} value={attribute.value} disabled={busy}
                onChange={e => set({ attributes: draft.attributes.map((a, i) => i === index ? { ...a, value: e.target.value } : a) })}/></label>
              <Button type="button" size="icon" variant="ghost" aria-label={"Togli il campo " + (attribute.key || "vuoto")} disabled={busy}
                onClick={() => set({ attributes: draft.attributes.filter((_, i) => i !== index) })}><Trash2 size={16}/></Button></>}
        </div>;
      })}
      {draft.attributes.length < 12 && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => set({ attributes: [...draft.attributes, { key: "", value: "" }] })}>
        <Plus size={14}/><span className="text-xs">Aggiungi un campo</span></Button>}
    </fieldset>
    <fieldset className="space-y-2"><legend className="text-sm font-semibold">Relazioni</legend>
      {draft.relationships.map((relation, index) => <div key={index} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-slate-300 p-2 sm:grid-cols-[1fr_1fr_1fr_auto] dark:border-slate-700">
        <label className="text-sm">Con<select className="field field-sm mt-1" value={relation.targetId} disabled={busy}
          onChange={e => set({ relationships: draft.relationships.map((r, i) => i === index ? { ...r, targetId: e.target.value } : r) })}>
          <option value="">Scegli…</option>{others.map(o => <option key={o.id} value={o.id}>{o.name} ({ENTITY_LABELS[o.type].one.toLowerCase()})</option>)}</select></label>
        <Button type="button" size="icon" variant="ghost" className="self-end sm:order-last" aria-label={"Togli la relazione " + (index + 1)} disabled={busy}
          onClick={() => set({ relationships: draft.relationships.filter((_, i) => i !== index) })}><Trash2 size={16}/></Button>
        <label className="text-sm">Tipo<input className="field field-sm mt-1" maxLength={40} placeholder="es. alleato" value={relation.type} disabled={busy}
          onChange={e => set({ relationships: draft.relationships.map((r, i) => i === index ? { ...r, type: e.target.value } : r) })}/></label>
        <label className="text-sm">Nota<input className="field field-sm mt-1" maxLength={240} value={relation.note ?? ""} disabled={busy}
          onChange={e => set({ relationships: draft.relationships.map((r, i) => i === index ? { ...r, note: e.target.value } : r) })}/></label>
      </div>)}
      {draft.relationships.length < 24 && others.length > 0 && <Button type="button" size="sm" variant="ghost" disabled={busy}
        onClick={() => set({ relationships: [...draft.relationships, { targetId: "", type: "" }] })}><Plus size={14}/><span className="text-xs">Aggiungi una relazione</span></Button>}
    </fieldset>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={busy || !dirty}><Save size={16}/> Salva senza review</Button>
      {dirty && <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(JSON.parse(initial) as EntityDraft)}>Annulla modifiche</Button>}
      {dirty && <Badge tone="amber">Non salvata</Badge>}
      <Button type="button" variant="ghost" className="ml-auto text-rose-700 dark:text-rose-300" disabled={busy} onClick={() => void remove()}><Trash2 size={16}/> Elimina la scheda</Button>
    </div>
    <p className="muted text-xs">Cambiare nome o alias aggiorna memoria e metadati delle scene, non la prosa: le scene che usano il vecchio nome restano da rivedere.</p>
    {message && <p role="status" className="text-sm [overflow-wrap:anywhere]">{message}</p>}
  </form>;
}

export function NewEntityForm({ book, type, onRefresh, onCreated }: { book: BookProject; type: EntityType; onRefresh: () => Promise<void>; onCreated: (id: string) => void }) {
  const [draft, setDraft] = useState({ name: "", importance: "secondary" as KnowledgeEntity["importance"], summary: "" });
  const { busy, message, run } = useSaver(onRefresh);
  async function submit() {
    let id = "";
    const ok = await run(async () => { const { edit } = await createEntity(book.id, { type, ...draft }); id = edit.target.id; }, "Scheda creata.");
    if (ok) onCreated(id);
  }
  return <form aria-label={"Nuova scheda: " + ENTITY_LABELS[type].one.toLowerCase()} className="space-y-2 rounded-xl border border-emerald-600/50 p-3" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
      <label className="text-sm">Nome<input className="field mt-1" maxLength={120} value={draft.name} disabled={busy} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}/></label>
      <label className="text-sm">Importanza<select className="field mt-1" value={draft.importance} disabled={busy} onChange={e => setDraft(d => ({ ...d, importance: e.target.value as KnowledgeEntity["importance"] }))}>
        {(["main", "secondary", "minor"] as const).map(v => <option key={v} value={v}>{IMPORTANCE[v]}</option>)}</select></label>
    </div>
    <label className="block text-sm">Descrizione breve<textarea className="field mt-1" rows={2} maxLength={600} value={draft.summary} disabled={busy} onChange={e => setDraft(d => ({ ...d, summary: e.target.value }))}/></label>
    <Button type="submit" disabled={busy || !draft.name.trim()}><Plus size={16}/> Crea la scheda</Button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}

type EventDraft = Pick<KnowledgeEvent, "title" | "summary" | "narration" | "secret" | "involves" | "causes" | "sceneIds" | "timelineIds" | "perspectives">
  & { when: string; storyOrder: string; plannedChapter: string };
const eventDraft = (event: KnowledgeEvent): EventDraft => ({ title: event.title, summary: event.summary, when: event.when ?? "", narration: event.narration,
  secret: event.secret, involves: [...event.involves], causes: [...event.causes], sceneIds: [...event.sceneIds], timelineIds: [...event.timelineIds],
  perspectives: event.perspectives.map(p => ({ ...p })), storyOrder: String(event.storyOrder), plannedChapter: event.plannedChapter ? String(event.plannedChapter) : "" });

/** Every field of an event: who, when, why (causes), where it is told, who knows. */
export function EventEditor({ book, event, onRefresh, onDone }: { book: BookProject; event: KnowledgeEvent; onRefresh: () => Promise<void>; onDone: () => void }) {
  const kb = book.knowledge!;
  const target = { kind: "event" as const, id: event.id };
  const [base, setBase] = useState(() => editBase(book, target, event.title));
  const [draft, setDraft] = useState<EventDraft>(() => eventDraft(event));
  const [initial, setInitial] = useState(() => JSON.stringify(eventDraft(event)));
  const { busy, message, run, mounted } = useSaver(onRefresh);
  const dirty = JSON.stringify(draft) !== initial;
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const savedKey = JSON.stringify(eventDraft(event));
  useEffect(() => {
    if (dirtyRef.current) return;
    setBase(editBase(book, target, event.title)); setDraft(eventDraft(event)); setInitial(JSON.stringify(eventDraft(event)));
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<EventDraft>) => setDraft(d => ({ ...d, ...patch }));
  const scenes = [...book.chapters].sort((a, b) => a.number - b.number).flatMap(c => c.scenes.map(s => ({ value: s.id, label: `Cap. ${c.number} · ${s.number}. ${s.title}` })));
  async function save() {
    const { storyOrder, plannedChapter, ...rest } = draft;
    const ok = await run(() => saveEventEdit(book.id, event.id, base, { ...rest, perspectives: draft.perspectives.filter(p => p.entityId),
      storyOrder: storyOrder.trim() === "" ? Number.NaN : Number(storyOrder.replace(",", ".")), plannedChapter: plannedChapter ? Number(plannedChapter) : null }),
    "Evento salvato." + NO_REVIEW);
    if (ok && mounted.current) setInitial(JSON.stringify(draft));
  }
  async function remove() {
    const dependents = kb.events.filter(e => e.causes.includes(event.id)).length;
    if (!window.confirm(`Eliminare l'evento «${event.title}»?${dependents ? ` ${dependents} eventi non dipenderanno più da questo.` : ""} Potrai ripristinarlo dalla cronologia.`)) return;
    if (await run(() => removeEvent(book.id, event.id, base), "Evento eliminato." + NO_REVIEW)) onDone();
  }
  return <form aria-label={"Modifica l'evento " + event.title} className="space-y-3" onSubmit={e => { e.preventDefault(); void save(); }}>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">Titolo<input className="field mt-1" maxLength={160} value={draft.title} disabled={busy} onChange={e => set({ title: e.target.value })}/></label>
      <label className="block text-sm">Quando accade (nella storia)<input className="field mt-1" maxLength={80} placeholder="es. inverno 1923" value={draft.when} disabled={busy} onChange={e => set({ when: e.target.value })}/></label>
      <label className="block text-sm">Come viene raccontato<select className="field mt-1" value={draft.narration} disabled={busy} onChange={e => set({ narration: e.target.value as EventDraft["narration"] })}>
        {NARRATION_MODES.map(m => <option key={m} value={m}>{NARRATION_LABELS[m]}</option>)}</select></label>
      <label className="flex min-h-11 items-center gap-2 self-end text-sm"><input type="checkbox" className="size-5" checked={draft.secret} disabled={busy} onChange={e => set({ secret: e.target.checked })}/> Evento segreto (non va rivelato prima del tempo)</label>
      <label className="block text-sm">Posizione nella cronologia della storia
        <input className="field mt-1" inputMode="decimal" value={draft.storyOrder} disabled={busy} onChange={e => set({ storyOrder: e.target.value })}/>
        <span className="muted mt-0.5 block text-xs">Più basso = prima nella storia (anche se raccontato dopo). Le frecce della timeline la cambiano per te.</span></label>
      <label className="block text-sm">Capitolo in cui va raccontato
        <select className="field mt-1" value={draft.plannedChapter} disabled={busy} onChange={e => set({ plannedChapter: e.target.value })}>
          <option value="">Non previsto</option>
          {[...book.chapters].sort((a, b) => a.number - b.number).map(c => <option key={c.id} value={String(c.number)}>Cap. {c.number} — {c.title}</option>)}
          {draft.plannedChapter && !book.chapters.some(c => String(c.number) === draft.plannedChapter) && <option value={draft.plannedChapter}>Cap. {draft.plannedChapter} (non ancora nel piano)</option>}
        </select></label>
    </div>
    <label className="block text-sm">Sintesi<textarea className="field mt-1" rows={2} maxLength={800} value={draft.summary} disabled={busy} onChange={e => set({ summary: e.target.value })}/></label>
    <div className="grid gap-3 md:grid-cols-2">
      <ChipPicker label="Chi è coinvolto" disabled={busy} value={draft.involves} onChange={involves => set({ involves })}
        options={kb.entities.map(e => ({ value: e.id, label: e.name }))}/>
      <ChipPicker label="Dipende da (cause)" disabled={busy} value={draft.causes} onChange={causes => set({ causes })} empty="Nessuna causa"
        options={kb.events.filter(e => e.id !== event.id).map(e => ({ value: e.id, label: e.title }))}/>
      <ChipPicker label="Scene in cui accade" disabled={busy} value={draft.sceneIds} onChange={sceneIds => set({ sceneIds })} empty="Non ancora collocato" options={scenes}/>
      <ChipPicker label="Timeline" disabled={busy} value={draft.timelineIds} onChange={timelineIds => set({ timelineIds })} empty="Solo la timeline globale"
        options={kb.timelines.map(t => ({ value: t.id, label: t.title }))}/>
    </div>
    <fieldset className="space-y-2"><legend className="text-sm font-semibold">Chi sa cosa</legend>
      {draft.perspectives.map((perspective, index) => <div key={index} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-slate-300 p-2 sm:grid-cols-[1fr_1fr_1fr_auto] dark:border-slate-700">
        <label className="text-sm">Personaggio<select className="field field-sm mt-1" value={perspective.entityId} disabled={busy}
          onChange={e => set({ perspectives: draft.perspectives.map((p, i) => i === index ? { ...p, entityId: e.target.value } : p) })}>
          <option value="">Scegli…</option>{kb.entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <Button type="button" size="icon" variant="ghost" className="self-end sm:order-last" aria-label={"Togli la prospettiva " + (index + 1)} disabled={busy}
          onClick={() => set({ perspectives: draft.perspectives.filter((_, i) => i !== index) })}><Trash2 size={16}/></Button>
        <label className="text-sm">Cosa sa<select className="field field-sm mt-1" value={perspective.stance} disabled={busy}
          onChange={e => set({ perspectives: draft.perspectives.map((p, i) => i === index ? { ...p, stance: e.target.value as typeof p.stance } : p) })}>
          {STANCES.map(s => <option key={s} value={s}>{STANCE_LABELS[s]}</option>)}</select></label>
        <label className="text-sm">Nota<input className="field field-sm mt-1" maxLength={200} value={perspective.note ?? ""} disabled={busy}
          onChange={e => set({ perspectives: draft.perspectives.map((p, i) => i === index ? { ...p, note: e.target.value || undefined } : p) })}/></label>
      </div>)}
      {draft.perspectives.length < 12 && <Button type="button" size="sm" variant="ghost" disabled={busy}
        onClick={() => set({ perspectives: [...draft.perspectives, { entityId: "", stance: "knows" }] })}><Plus size={14}/><span className="text-xs">Aggiungi una prospettiva</span></Button>}
    </fieldset>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={busy || !dirty}><Save size={16}/> Salva senza review</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => { if (!dirty || window.confirm("Chiudere senza salvare?")) onDone(); }}>{dirty ? "Annulla" : "Chiudi"}</Button>
      <Button type="button" variant="ghost" className="ml-auto text-rose-700 dark:text-rose-300" disabled={busy} onClick={() => void remove()}><Trash2 size={16}/> Elimina l'evento</Button>
    </div>
    <p className="muted text-xs">Le cause non possono formare un cerchio e le scene citate devono esistere: un errore non salva nulla.</p>
    {message && <p role="status" className="text-sm [overflow-wrap:anywhere]">{message}</p>}
  </form>;
}

/** Create, rename and delete timelines; add new events. */
export function TimelineManager({ book, onRefresh, onStart, selected }: { book: BookProject; onRefresh: () => Promise<void>; onStart?: (bookId: string) => void; selected?: string }) {
  const kb = book.knowledge!;
  const [editing, setEditing] = useState<string>();
  const [timeline, setTimeline] = useState<{ title: string; kind: KnowledgeTimeline["kind"]; summary: string; subjectIds: string[] }>({ title: "", kind: "arc", summary: "", subjectIds: [] });
  const [event, setEvent] = useState({ title: "", summary: "", timelineId: selected ?? "" });
  const { busy, message, run } = useSaver(onRefresh);
  const current = kb.timelines.find(t => t.id === editing);
  const globalTimeline = kb.timelines.find(t => t.kind === "global" && t.id !== current?.id);
  const formOf = (found?: KnowledgeTimeline) => found ? { title: found.title, kind: found.kind, summary: found.summary, subjectIds: [...(found.subjectIds ?? [])] }
    : { title: "", kind: "arc" as const, summary: "", subjectIds: [] };
  // The saved version the form shows: without unsaved edits it follows AI edits and restores.
  const shown = useRef("");
  const storedKey = current ? JSON.stringify(formOf(current)) : "";
  useEffect(() => {
    if (!current) return;
    if (JSON.stringify(timeline) === shown.current) setTimeline(formOf(current));
    shown.current = storedKey;
  }, [storedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  function open(id?: string) {
    const found = kb.timelines.find(t => t.id === id);
    setEditing(id ?? "new");
    setTimeline(formOf(found));
    shown.current = found ? JSON.stringify(formOf(found)) : "";
  }
  async function saveTimeline() {
    const ok = await run(() => saveTimelineEdit(book.id, current?.id, current ? editBase(book, { kind: "timeline", id: current.id }, current.title) : undefined, timeline),
      (current ? "Timeline aggiornata." : "Timeline creata.") + NO_REVIEW);
    if (ok) setEditing(undefined);
  }
  async function deleteCurrent() {
    if (!current || !window.confirm(`Eliminare la timeline «${current.title}»? Gli eventi restano nella timeline globale.`)) return;
    if (await run(() => removeTimeline(book.id, current.id, editBase(book, { kind: "timeline", id: current.id }, current.title)), "Timeline eliminata." + NO_REVIEW)) setEditing(undefined);
  }
  return <details className="rounded-xl border border-slate-300 dark:border-slate-700">
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-semibold"><Plus size={15}/> Nuovo evento e gestione delle timeline</summary>
    <div className="grid gap-4 border-t border-slate-300 p-3 lg:grid-cols-2 dark:border-slate-700">
      <form aria-label="Nuovo evento" className="space-y-2" onSubmit={e => { e.preventDefault();
        void run(() => createEvent(book.id, { title: event.title, summary: event.summary, ...(event.timelineId ? { timelineId: event.timelineId } : {}) }), "Evento creato in fondo alla cronologia: spostalo con le frecce." + NO_REVIEW)
          .then(ok => { if (ok) setEvent({ title: "", summary: "", timelineId: event.timelineId }); }); }}>
        <h4 className="font-semibold">Nuovo evento</h4>
        <label className="block text-sm">Titolo<input className="field mt-1" maxLength={160} value={event.title} disabled={busy} onChange={e => setEvent(v => ({ ...v, title: e.target.value }))}/></label>
        <label className="block text-sm">Sintesi<textarea className="field mt-1" rows={2} maxLength={800} value={event.summary} disabled={busy} onChange={e => setEvent(v => ({ ...v, summary: e.target.value }))}/></label>
        {kb.timelines.length > 0 && <label className="block text-sm">Timeline<select className="field mt-1" value={event.timelineId} disabled={busy} onChange={e => setEvent(v => ({ ...v, timelineId: e.target.value }))}>
          <option value="">Solo globale</option>{kb.timelines.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>}
        <Button type="submit" disabled={busy || event.title.trim().length < 2}><Plus size={16}/> Crea l'evento</Button>
      </form>
      <div className="space-y-2">
        <h4 className="font-semibold">Timeline</h4>
        <ul className="flex flex-wrap gap-1.5">{kb.timelines.map(t => <li key={t.id} className="flex items-center gap-1"><Button type="button" size="sm" variant={editing === t.id ? "default" : "outline"} onClick={() => open(t.id)}><span className="text-xs">{t.title}{t.kind === "global" ? " (globale)" : ""}</span></Button>
          <ReviewStateBadge book={book} target={{ kind: "timeline", id: t.id }} quiet/></li>)}
          <li><Button type="button" size="sm" variant={editing === "new" ? "default" : "ghost"} onClick={() => open()}><Plus size={14}/><span className="text-xs">Nuova timeline</span></Button></li></ul>
        {editing && <form aria-label={current ? "Modifica la timeline " + current.title : "Nuova timeline"} className="space-y-2 rounded-lg border border-slate-300 p-2.5 dark:border-slate-700"
          onSubmit={e => { e.preventDefault(); void saveTimeline(); }}>
          <label className="block text-sm">Titolo<input className="field mt-1" maxLength={120} value={timeline.title} disabled={busy} onChange={e => setTimeline(t => ({ ...t, title: e.target.value }))}/></label>
          <label className="block text-sm">Tipo<select className="field mt-1" value={timeline.kind} disabled={busy} onChange={e => setTimeline(t => ({ ...t, kind: e.target.value as KnowledgeTimeline["kind"] }))}>
            <option value="global" disabled={!!globalTimeline && current?.kind !== "global"}>Globale{globalTimeline && current?.kind !== "global" ? ` (c'è già: «${globalTimeline.title}»)` : ""}</option>
            <option value="arc">Arco narrativo o personaggio</option><option value="event">Linea di un evento</option></select></label>
          <label className="block text-sm">Descrizione<textarea className="field mt-1" rows={2} maxLength={600} value={timeline.summary} disabled={busy} onChange={e => setTimeline(t => ({ ...t, summary: e.target.value }))}/></label>
          <ChipPicker label="Chi o cosa segue" disabled={busy} value={timeline.subjectIds} empty="Nessuna scheda: segue solo i suoi eventi"
            onChange={subjectIds => setTimeline(t => ({ ...t, subjectIds: subjectIds.slice(0, 12) }))}
            options={kb.entities.map(e => ({ value: e.id, label: `${e.name} (${ENTITY_LABELS[e.type].one.toLowerCase()})` }))}/>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || timeline.title.trim().length < 2}><Save size={16}/> Salva</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(undefined)}>Chiudi</Button>
            {current && <Button type="button" variant="ghost" className="text-rose-700 dark:text-rose-300" disabled={busy} onClick={() => void deleteCurrent()}><Trash2 size={16}/> Elimina</Button>}
          </div>
        </form>}
        {current && (onStart
          ? <PromptEditChoices book={book} request={{ kind: "timeline", id: current.id }} label={current.title} onRefresh={onRefresh} onStart={onStart}
              propagate={{ kind: "timeline", id: current.id }}
              examples={["Rendi la descrizione più precisa: chi segue e quale periodo copre.", "Fai seguire a questa timeline anche Markus."]}/>
          : <details className="rounded-lg border border-violet-500/40 bg-violet-500/5">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-2.5 text-sm font-semibold"><Sparkles size={15} className="text-violet-600 dark:text-violet-300"/> Modifica questa timeline con l'AI</summary>
            <div className="border-t border-violet-500/30 p-2.5">
              <AiEditPanel book={book} request={{ kind: "timeline", id: current.id }} label={current.title} onRefresh={onRefresh}
                examples={["Rendi la descrizione più precisa: chi segue e quale periodo copre.", "Fai seguire a questa timeline anche Markus."]}/>
            </div>
          </details>)}
        {current && <EditHistory book={book} target={{ kind: "timeline", id: current.id }} label={current.title} onRefresh={onRefresh}/>}
        {current && onStart && <PendingEditActions book={book} target={{ kind: "timeline", id: current.id }} label={current.title} onRefresh={onRefresh} onStart={onStart}/>}
      </div>
      {message && <p role="status" className="text-sm lg:col-span-2">{message}</p>}
    </div>
  </details>;
}
