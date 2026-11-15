import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Plus, Save, Users } from "lucide-react";
import type { BookProject, Chapter, Scene } from "../../domain/types";
import { findEntity, MEMORY_FOLDER, type EntityType } from "../../domain/knowledge";
import { SCENE_META_LISTS, type SceneMetaList, type SceneMetaPatch } from "../../domain/book-editing";
import { ElementChangedError, saveSceneMetadata, sceneMetaBase, type EditBase } from "../../application/book-editing";
import { Button } from "../ui/button";
import { Badge } from "../ui/primitives";
import { ChipPicker } from "./EditKit";

const LIST_TYPE: Record<SceneMetaList, EntityType> = { characters: "character", locations: "location", items: "item", factions: "faction" };
const LIST_LABEL: Record<SceneMetaList, string> = { characters: "Personaggi presenti", locations: "Luoghi", items: "Oggetti", factions: "Fazioni" };
type Draft = { viewpoint: string; date: string } & Record<SceneMetaList, string[]>;

/** Known names of one kind: the sheets (when generated) and the narrative memory. */
function candidates(book: BookProject, list: SceneMetaList): string[] {
  const type = LIST_TYPE[list];
  const kb = book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
  return [...new Set([...(kb?.entities.filter(e => e.type === type).map(e => e.name) ?? []), ...Object.keys(book.memory[MEMORY_FOLDER[type]] ?? {})])]
    .sort((a, b) => a.localeCompare(b, "it"));
}
/** A stored value (name, alias or imported reference ID) is shown as the sheet's name. */
function display(book: BookProject, list: SceneMetaList, value: string): string {
  const kb = book.knowledge && !book.knowledge.pending ? book.knowledge : undefined;
  return kb ? findEntity(kb, LIST_TYPE[list], value)?.name ?? value : value;
}
function draftOf(book: BookProject, scene: Scene): Draft {
  const lists = Object.fromEntries(SCENE_META_LISTS.map(key => [key, [...new Set((scene[key] ?? []).map(value => display(book, key, value)))]]));
  return { viewpoint: scene.viewpoint ? display(book, "characters", scene.viewpoint) : "", date: scene.date ?? "", ...lists } as Draft;
}

/** Who and what is in the scene, its point of view and date: their own recorded edit, never a review. */
export function SceneDetailsEditor({ book, chapter, scene, onRefresh }: { book: BookProject; chapter: Chapter; scene: Scene; onRefresh: () => Promise<void> }) {
  const label = `Cap. ${chapter.number} · ${scene.number}. ${scene.title}`;
  const [base, setBase] = useState<EditBase>(() => sceneMetaBase(book, scene.id, label));
  const [initial, setInitial] = useState<Draft>(() => draftOf(book, scene));
  const [draft, setDraft] = useState<Draft>(() => draftOf(book, scene));
  const [extra, setExtra] = useState<{ list: SceneMetaList; name: string }>({ list: "characters", name: "" });
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const changed = (Object.keys(draft) as Array<keyof Draft>).filter(key => JSON.stringify(draft[key]) !== JSON.stringify(initial[key]));
  const dirty = useRef(false);
  dirty.current = changed.length > 0;
  // Without unsaved changes the panel follows the saved scene (autopilot, restore…).
  const savedKey = JSON.stringify(draftOf(book, scene));
  useEffect(() => {
    if (dirty.current) return;
    setBase(sceneMetaBase(book, scene.id, label)); setInitial(draftOf(book, scene)); setDraft(draftOf(book, scene));
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!changed.length || busy) return;
    setBusy(true); setMessage("");
    try {
      const patch = Object.fromEntries(changed.map(key => [key, draft[key]])) as SceneMetaPatch;
      const { book: updated } = await saveSceneMetadata(book.id, scene.id, base, patch);
      await onRefresh();
      if (!mounted.current) return;
      const now = updated.chapters.flatMap(c => c.scenes).find(s => s.id === scene.id)!;
      setBase(sceneMetaBase(updated, scene.id, label)); setInitial(draftOf(updated, now)); setDraft(draftOf(updated, now)); setConflict(false);
      setMessage("Dettagli della scena salvati. Nessuna review avviata: la cronologia della scena li registra.");
    } catch (error) {
      await onRefresh().catch(() => undefined);
      if (!mounted.current) return;
      setConflict(error instanceof ElementChangedError);
      setMessage(error instanceof Error ? error.message : "Dettagli non salvati.");
    } finally { if (mounted.current) setBusy(false); }
  }
  function adoptCurrent() {
    setBase(sceneMetaBase(book, scene.id, label)); setInitial(draftOf(book, scene)); setConflict(false);
    setMessage("Ora il salvataggio sostituirà i dettagli attuali con i tuoi.");
  }
  function addExtra() {
    const name = extra.name.trim();
    if (!name) return;
    setDraft(d => d[extra.list].some(v => v.toLocaleLowerCase("it") === name.toLocaleLowerCase("it")) ? d : { ...d, [extra.list]: [...d[extra.list], name] });
    setExtra(v => ({ ...v, name: "" }));
  }
  const characters = [...new Set([...candidates(book, "characters"), ...(draft.viewpoint ? [draft.viewpoint] : [])])];
  return <details className="rounded-xl border border-slate-300 dark:border-slate-700">
    <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-3 text-sm font-semibold">
      <Users size={15}/> Chi c'è e quando: personaggi, luoghi, punto di vista
      {changed.length > 0 && <Badge tone="amber">Non salvati</Badge>}
    </summary>
    <form aria-label={"Dettagli di " + label} className="space-y-3 border-t border-slate-300 p-3 dark:border-slate-700"
      onSubmit={e => { e.preventDefault(); void save(); }}>
      <p className="muted text-xs">Servono alle schede, alla timeline e ai revisori per sapere chi e cosa compare nella scena. Non cambiano il testo.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Punto di vista
          <select className="field mt-1" value={draft.viewpoint} disabled={busy} onChange={e => setDraft(d => ({ ...d, viewpoint: e.target.value }))}>
            <option value="">Nessuno indicato</option>
            {characters.map(name => <option key={name} value={name}>{name}</option>)}
          </select></label>
        <label className="block text-sm">Data o momento della storia
          <input className="field mt-1" maxLength={100} placeholder="es. 12 marzo 1899, sera" value={draft.date} disabled={busy}
            onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}/></label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {SCENE_META_LISTS.map(key => <ChipPicker key={key} label={LIST_LABEL[key]} disabled={busy} value={draft[key]} empty="Nessuno indicato"
          options={[...new Set([...candidates(book, key), ...draft[key]])].map(name => ({ value: name, label: name }))}
          onChange={value => setDraft(d => ({ ...d, [key]: value }))}/>)}
      </div>
      <fieldset className="flex flex-wrap items-end gap-2">
        <legend className="sr-only">Aggiungi un nome non in elenco</legend>
        <label className="text-sm">Aggiungi a
          <select className="field field-sm mt-1" value={extra.list} disabled={busy} onChange={e => setExtra(v => ({ ...v, list: e.target.value as SceneMetaList }))}>
            {SCENE_META_LISTS.map(key => <option key={key} value={key}>{LIST_LABEL[key]}</option>)}
          </select></label>
        <label className="min-w-0 flex-1 text-sm">Nome non in elenco
          <input className="field field-sm mt-1" maxLength={120} value={extra.name} disabled={busy}
            onChange={e => setExtra(v => ({ ...v, name: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addExtra(); } }}/></label>
        <Button type="button" size="sm" variant="outline" disabled={busy || !extra.name.trim()} onClick={addExtra}><Plus size={14}/><span className="text-xs">Aggiungi</span></Button>
      </fieldset>
      {conflict && <div role="alert" className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
        <p className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0"/> {message}</p>
        <Button type="button" variant="outline" onClick={adoptCurrent}>Sostituisci comunque con i miei dettagli</Button>
      </div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !changed.length}><Save size={16}/> Salva i dettagli</Button>
        {changed.length > 0 && <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(initial)}>Annulla</Button>}
      </div>
      {!conflict && message && <p role="status" className="text-sm [overflow-wrap:anywhere]">{message}</p>}
    </form>
  </details>;
}
