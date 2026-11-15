import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ListChecks, Save, Wand2 } from "lucide-react";
import type { BookProject, Chapter, Scene } from "../../domain/types";
import { editBase, ElementChangedError, saveSceneEdit, type EditBase } from "../../application/book-editing";
import { Button } from "../ui/button";
import { Badge } from "../ui/primitives";
import { AiEditPanel } from "./EditKit";

const words = (text: string) => text.match(/\S+/g)?.length ?? 0;
type Draft = { title: string; objective: string; text: string; summary: string };
const draftOf = (scene: Scene): Draft => ({ title: scene.title, objective: scene.objective, text: scene.text, summary: scene.summary ?? "" });

/** Manual scene editor. Saving never starts a review; a selection can be rewritten by the AI. */
export function SceneEditor({ book, chapter, scene, onRefresh, onClose, onOpenReviews }: {
  book: BookProject; chapter: Chapter; scene: Scene; onRefresh: () => Promise<void>; onClose: () => void; onOpenReviews?: () => void;
}) {
  const label = `Cap. ${chapter.number} · ${scene.number}. ${scene.title}`;
  const target = { kind: "scene" as const, id: scene.id };
  const [base, setBase] = useState<EditBase>(() => editBase(book, target, label));
  const [initial, setInitial] = useState<Draft>(() => draftOf(scene));
  const [draft, setDraft] = useState<Draft>(() => draftOf(scene));
  const [selection, setSelection] = useState<{ start: number; end: number }>();
  const [aiOpen, setAiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const changed = (Object.keys(draft) as Array<keyof Draft>).filter(key => draft[key] !== initial[key]);
  const dirty = useRef(false);
  dirty.current = changed.length > 0;
  // Without unsaved changes the editor follows the saved scene (an AI edit, a restore…).
  const savedKey = JSON.stringify(draftOf(scene));
  useEffect(() => {
    if (dirty.current) return;
    setBase(editBase(book, target, label)); setInitial(draftOf(scene)); setDraft(draftOf(scene));
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!changed.length || busy) return;
    setBusy(true); setMessage(""); setSaved(false);
    try {
      const patch = Object.fromEntries(changed.map(key => [key, draft[key]]));
      const { book: updated } = await saveSceneEdit(book.id, scene.id, base, patch);
      await onRefresh();
      if (!mounted.current) return;
      const now = updated.chapters.flatMap(c => c.scenes).find(s => s.id === scene.id)!;
      setBase(editBase(updated, target, label)); setInitial(draftOf(now)); setDraft(draftOf(now)); setConflict(false); setSaved(true);
      setMessage("Modifica salvata. Nessuna review è partita: decidi tu se e quando controllarla.");
    } catch (error) {
      await onRefresh().catch(() => undefined);
      if (!mounted.current) return;
      setConflict(error instanceof ElementChangedError);
      setMessage(error instanceof Error ? error.message : "Modifica non salvata.");
    } finally { if (mounted.current) setBusy(false); }
  }
  /** Explicit consent to replace a version changed meanwhile: the draft stays as typed. */
  function adoptCurrent() {
    const now = book.chapters.flatMap(c => c.scenes).find(s => s.id === scene.id);
    if (!now) return;
    setBase(editBase(book, target, label)); setInitial(draftOf(now)); setConflict(false);
    setMessage("Ora il salvataggio sostituirà la versione attuale con la tua.");
  }
  function discard() {
    if (changed.length && !window.confirm("Chiudere senza salvare? Le modifiche non salvate andranno perse.")) return;
    onClose();
  }
  const field = (key: keyof Draft) => ({ value: draft[key], disabled: busy, onChange: (e: { target: { value: string } }) => { setDraft(d => ({ ...d, [key]: e.target.value })); setSaved(false); } });
  const selected = selection && selection.end > selection.start ? draft.text.slice(selection.start, selection.end) : "";
  const selectionMatchesSaved = draft.text === initial.text && !changed.length;
  return <form aria-label={"Modifica di " + label} className="space-y-3 rounded-xl border border-emerald-600/50 bg-emerald-500/5 p-3"
    onSubmit={e => { e.preventDefault(); void save(); }}
    onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } }}>
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm font-semibold">Modifica manuale</p>
      {scene.status === "planned" && <Badge>Da scrivere: se la scrivi tu diventa parte del libro</Badge>}
      {chapter.frozenAt && <Badge tone="amber">Capitolo già revisionato</Badge>}
      {changed.length > 0 && <Badge tone="amber">Non salvata</Badge>}
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block text-sm">Titolo della scena<input className="field mt-1" maxLength={300} {...field("title")}/></label>
      <label className="block text-sm">Obiettivo narrativo<input className="field mt-1" maxLength={20_000} {...field("objective")}/></label>
    </div>
    <label className="block text-sm">Testo della scena
      <textarea className="field mt-1 min-h-72 resize-y" rows={16} {...field("text")}
        // Inline: the global `textarea { font: inherit }` rule beats utility classes.
        style={{ font: "1.02rem/1.75rem ui-serif, Georgia, Cambria, 'Times New Roman', serif" }}
        onSelect={e => { const t = e.currentTarget; setSelection({ start: t.selectionStart, end: t.selectionEnd }); }}/></label>
    <p className="muted text-xs">{words(draft.text).toLocaleString("it-IT")} parole · Ctrl+S per salvare{selected ? ` · selezionati ${selected.length.toLocaleString("it-IT")} caratteri` : " · seleziona un passaggio per farlo riscrivere all'AI"}</p>
    <label className="block text-sm">Riassunto della scena
      {scene.summaryStale && draft.summary === initial.summary && <span className="ml-2"><Badge tone="amber">Non aggiornato al testo</Badge></span>}
      <textarea className="field mt-1" rows={2} maxLength={6000} {...field("summary")}/></label>
    {conflict && <div role="alert" className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <p className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0"/> {message}</p>
      <Button type="button" variant="outline" onClick={adoptCurrent}>Sostituisci comunque con la mia versione</Button>
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={busy || !changed.length}><Save size={16}/> Salva senza review</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={discard}>{changed.length ? "Annulla" : "Chiudi"}</Button>
      {scene.text.trim() && <Button type="button" variant="ghost" disabled={busy || !selected || !selectionMatchesSaved} aria-expanded={aiOpen}
        title={!selectionMatchesSaved ? "Salva prima le modifiche, poi seleziona il passaggio" : undefined}
        onClick={() => setAiOpen(v => !v)}><Wand2 size={16}/> Riscrivi la selezione con l'AI</Button>}
      {saved && onOpenReviews && <Button type="button" variant="ghost" onClick={onOpenReviews}><ListChecks size={16}/> Scegli se e come rivederla</Button>}
    </div>
    {!conflict && message && <p role="status" className="text-sm [overflow-wrap:anywhere]">{message}</p>}
    {aiOpen && selected && selectionMatchesSaved && <div className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-3">
      <p className="mb-2 text-sm"><span className="font-semibold">Passaggio selezionato:</span> <span className="muted font-serif">«{selected.length > 220 ? selected.slice(0, 220) + "…" : selected}»</span></p>
      <AiEditPanel book={book} request={{ kind: "scene", id: scene.id, selection: selection! }} label="la selezione"
        examples={["Rendi questo passaggio più teso, senza cambiare cosa accade.", "Mostra l'emozione con i gesti invece di dirla.", "Accorcia mantenendo le informazioni."]}
        onRefresh={onRefresh} onApplied={() => { setAiOpen(false); setSelection(undefined);
          setMessage("Passaggio riscritto con l'AI e salvato come modifica AI, senza review."); }}/>
    </div>}
  </form>;
}
