import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import type { BookProject, Chapter } from "@engine/domain/types";
import type { StructureOperation } from "@engine/domain/book-editing";
import { editBase, ElementChangedError, saveChapterEdit, saveStructureEdit } from "../../application/book-editing";
import { Button } from "../ui/button";
import { Badge } from "../ui/primitives";

type Details = { title: string; purpose: string; summary: string };
const detailsOf = (chapter: Chapter): Details => ({ title: chapter.title, purpose: chapter.purpose, summary: chapter.summary ?? "" });
const structureTarget = { kind: "structure" as const, id: "book" };

/** Title, purpose and summary of a chapter, and the order of chapters and scenes. */
export function ChapterEditor({ book, chapter, onRefresh, onSelectChapter }: {
  book: BookProject; chapter: Chapter; onRefresh: () => Promise<void>; onSelectChapter: (id: string) => void;
}) {
  const label = `Capitolo ${chapter.number} — ${chapter.title}`;
  const [base, setBase] = useState(() => editBase(book, { kind: "chapter", id: chapter.id }, label));
  const [initial, setInitial] = useState<Details>(() => detailsOf(chapter));
  const [draft, setDraft] = useState<Details>(() => detailsOf(chapter));
  const [newScene, setNewScene] = useState({ title: "", objective: "", position: String(chapter.scenes.length) });
  const [newChapter, setNewChapter] = useState({ title: "", purpose: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const changed = (Object.keys(draft) as Array<keyof Details>).filter(key => draft[key] !== initial[key]);
  const dirty = useRef(false);
  dirty.current = changed.length > 0;
  const savedKey = JSON.stringify(detailsOf(chapter));
  useEffect(() => {
    if (dirty.current) return;
    setBase(editBase(book, { kind: "chapter", id: chapter.id }, label)); setInitial(detailsOf(chapter)); setDraft(detailsOf(chapter));
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const ordered = [...book.chapters].sort((a, b) => a.number - b.number);
  const index = ordered.findIndex(c => c.id === chapter.id);
  const structureLocked = book.revision ? "Una revisione o una modifica via prompt è in corso: la struttura si cambia quando finisce." : "";

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await action(); await onRefresh(); if (mounted.current) setMessage(success); }
    catch (error) {
      await onRefresh().catch(() => undefined);
      if (mounted.current) setMessage(error instanceof ElementChangedError ? "La struttura del libro è cambiata nel frattempo: controlla e riprova." :
        error instanceof Error ? error.message : "Modifica non salvata.");
    } finally { if (mounted.current) setBusy(false); }
  }
  const structure = (operation: StructureOperation, success: string) =>
    run(() => saveStructureEdit(book.id, editBase(book, structureTarget, "Struttura del libro"), operation), success + " Nessuna review avviata.");
  async function saveDetails() {
    const patch = Object.fromEntries(changed.map(key => [key, draft[key]]));
    await run(async () => { await saveChapterEdit(book.id, chapter.id, base, patch); }, "Capitolo salvato. Nessuna review avviata.");
  }
  function removeScene(id: string, title: string) {
    if (!window.confirm(`Eliminare la scena «${title}»? Potrai ripristinarla dalla cronologia della struttura.`)) return;
    void structure({ op: "deleteScene", sceneId: id }, "Scena eliminata.");
  }
  function removeChapter() {
    if (!window.confirm(`Eliminare il capitolo ${chapter.number} «${chapter.title}» con le sue ${chapter.scenes.length} scene? Potrai ripristinarlo dalla cronologia della struttura.`)) return;
    const fallback = ordered[index - 1] ?? ordered[index + 1];
    void structure({ op: "deleteChapter", chapterId: chapter.id }, "Capitolo eliminato.").then(() => { if (fallback) onSelectChapter(fallback.id); });
  }
  const field = (key: keyof Details) => ({ value: draft[key], disabled: busy, onChange: (e: { target: { value: string } }) => setDraft(d => ({ ...d, [key]: e.target.value })) });
  return <div className="space-y-4">
    <form aria-label={"Dati del capitolo " + chapter.number} className="space-y-3 rounded-xl border border-slate-300 p-3 dark:border-slate-700" onSubmit={e => { e.preventDefault(); void saveDetails(); }}>
      <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">Titolo, scopo e riassunto</h4>{changed.length > 0 && <Badge tone="amber">Non salvato</Badge>}</div>
      <label className="block text-sm">Titolo del capitolo<input className="field mt-1" maxLength={300} {...field("title")}/></label>
      <label className="block text-sm">Scopo narrativo<textarea className="field mt-1" rows={2} maxLength={20_000} {...field("purpose")}/></label>
      <label className="block text-sm">Riassunto
        {chapter.summaryStale && draft.summary === initial.summary && <span className="ml-2"><Badge tone="amber">Non aggiornato alle scene</Badge></span>}
        <textarea className="field mt-1" rows={3} maxLength={6000} {...field("summary")}/></label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !changed.length}><Save size={16}/> Salva senza review</Button>
        {changed.length > 0 && <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(initial)}>Annulla modifiche</Button>}
      </div>
    </form>

    <section aria-label={"Struttura del capitolo " + chapter.number} className="space-y-3 rounded-xl border border-slate-300 p-3 dark:border-slate-700">
      <h4 className="font-semibold">Scene e ordine</h4>
      {structureLocked && <p className="text-xs text-amber-700 dark:text-amber-300">{structureLocked}</p>}
      <ol className="space-y-1.5">
        {chapter.scenes.map((scene, i) => <li key={scene.id} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 p-2 dark:border-slate-700">
          <span className="muted w-6 text-right text-sm font-semibold">{scene.number}.</span>
          <span className="min-w-0 flex-1 truncate text-sm">{scene.title}</span>
          <Button type="button" size="icon" variant="ghost" aria-label={`Sposta su la scena ${scene.number}`} disabled={busy || !!structureLocked || i === 0}
            onClick={() => void structure({ op: "moveScene", sceneId: scene.id, chapterId: chapter.id, index: i - 1 }, "Scena spostata.")}><ArrowUp size={16}/></Button>
          <Button type="button" size="icon" variant="ghost" aria-label={`Sposta giù la scena ${scene.number}`} disabled={busy || !!structureLocked || i === chapter.scenes.length - 1}
            onClick={() => void structure({ op: "moveScene", sceneId: scene.id, chapterId: chapter.id, index: i + 1 }, "Scena spostata.")}><ArrowDown size={16}/></Button>
          {ordered.length > 1 && <select aria-label={`Sposta la scena ${scene.number} in un altro capitolo`} className="field field-sm w-auto max-w-[11rem]" disabled={busy || !!structureLocked} value=""
            onChange={e => { if (e.target.value) void structure({ op: "moveScene", sceneId: scene.id, chapterId: e.target.value, index: 10_000 }, "Scena spostata in un altro capitolo."); }}>
            <option value="">Sposta in…</option>
            {ordered.filter(c => c.id !== chapter.id).map(c => <option key={c.id} value={c.id}>Cap. {c.number} — {c.title}</option>)}
          </select>}
          <Button type="button" size="icon" variant="ghost" aria-label={`Elimina la scena ${scene.number}`} disabled={busy || !!structureLocked}
            onClick={() => removeScene(scene.id, scene.title)}><Trash2 size={16}/></Button>
        </li>)}
      </ol>
      <form className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]" aria-label="Nuova scena" onSubmit={e => {
        e.preventDefault();
        void structure({ op: "addScene", chapterId: chapter.id, index: Number(newScene.position), title: newScene.title, objective: newScene.objective }, "Scena aggiunta.")
          .then(() => { if (mounted.current) setNewScene({ title: "", objective: "", position: String(chapter.scenes.length + 1) }); });
      }}>
        <label className="text-sm">Nuova scena<input className="field mt-1" maxLength={300} placeholder="Titolo" value={newScene.title} disabled={busy || !!structureLocked}
          onChange={e => setNewScene(s => ({ ...s, title: e.target.value }))}/></label>
        <label className="text-sm">Obiettivo<input className="field mt-1" maxLength={2000} placeholder="Cosa deve accadere" value={newScene.objective} disabled={busy || !!structureLocked}
          onChange={e => setNewScene(s => ({ ...s, objective: e.target.value }))}/></label>
        <label className="text-sm">Posizione<select className="field mt-1" value={newScene.position} disabled={busy || !!structureLocked} onChange={e => setNewScene(s => ({ ...s, position: e.target.value }))}>
          {chapter.scenes.map((s, i) => <option key={s.id} value={i}>Prima di {s.number}. {s.title.slice(0, 30)}</option>)}
          <option value={chapter.scenes.length}>In fondo</option></select></label>
        <Button type="submit" className="self-end" disabled={busy || !!structureLocked || !newScene.title.trim()}><Plus size={16}/> Aggiungi</Button>
      </form>
      <p className="muted text-xs">Una scena nuova è «da scrivere»: puoi scriverla tu oppure lasciarla all'autopilot. Spostare o eliminare scene di un capitolo già revisionato lo segna come modificato dopo la revisione.</p>
    </section>

    <section aria-label="Capitoli" className="space-y-3 rounded-xl border border-slate-300 p-3 dark:border-slate-700">
      <h4 className="font-semibold">Posizione del capitolo</h4>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy || !!structureLocked || index <= 0}
          onClick={() => void structure({ op: "moveChapter", chapterId: chapter.id, index: index - 1 }, "Capitolo spostato.")}><ArrowUp size={16}/> Sposta prima</Button>
        <Button type="button" variant="outline" disabled={busy || !!structureLocked || index >= ordered.length - 1}
          onClick={() => void structure({ op: "moveChapter", chapterId: chapter.id, index: index + 1 }, "Capitolo spostato.")}><ArrowDown size={16}/> Sposta dopo</Button>
        <Button type="button" variant="destructive" disabled={busy || !!structureLocked || ordered.length <= 1} onClick={removeChapter}><Trash2 size={16}/> Elimina capitolo</Button>
      </div>
      <form className="grid gap-2 md:grid-cols-[1fr_1fr_auto]" aria-label="Nuovo capitolo" onSubmit={e => {
        e.preventDefault();
        void structure({ op: "addChapter", index: index + 1, title: newChapter.title, purpose: newChapter.purpose }, "Capitolo aggiunto dopo questo.")
          .then(() => { if (mounted.current) setNewChapter({ title: "", purpose: "" }); });
      }}>
        <label className="text-sm">Nuovo capitolo dopo questo<input className="field mt-1" maxLength={300} placeholder="Titolo" value={newChapter.title} disabled={busy || !!structureLocked}
          onChange={e => setNewChapter(c => ({ ...c, title: e.target.value }))}/></label>
        <label className="text-sm">Scopo<input className="field mt-1" maxLength={2000} placeholder="A cosa serve nella storia" value={newChapter.purpose} disabled={busy || !!structureLocked}
          onChange={e => setNewChapter(c => ({ ...c, purpose: e.target.value }))}/></label>
        <Button type="submit" className="self-end" disabled={busy || !!structureLocked || !newChapter.title.trim()}><Plus size={16}/> Aggiungi capitolo</Button>
      </form>
    </section>
    {message && <p role="status" className="text-sm [overflow-wrap:anywhere]">{message}</p>}
  </div>;
}
