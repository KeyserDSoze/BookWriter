import { useEffect, useRef, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { BookProject } from "../../domain/types";
import { memoryLabel, memoryValue, type MemoryFolder } from "../../domain/book-edits";
import { editBase, ElementChangedError, saveMemoryEdit } from "../../application/book-editing";
import { Button } from "../ui/button";
import { Badge } from "../ui/primitives";
import { EditHistory, PendingEditActions } from "./EditKit";

const errorText = (error: unknown) => error instanceof ElementChangedError
  ? "Questa parte della memoria è cambiata nel frattempo (autopilot o altra scheda): controlla la versione attuale prima di salvare."
  : error instanceof Error ? error.message : "Modifica non salvata.";

/** One part of the narrative memory — the current state, the memory chronology or one entry — editable by hand.
 * Saving only changes what the next scenes will be written from; it never rewrites prose or starts a review. */
export function MemoryPartEditor({ book, id, onRefresh, onStart, rows = 4, removable, hint }: {
  book: BookProject; id: string; onRefresh: () => Promise<void>; onStart: (bookId: string) => void;
  rows?: number; removable?: boolean; hint?: string;
}) {
  const label = memoryLabel(id);
  const target = { kind: "memory" as const, id };
  const saved = memoryValue(book, id) ?? "";
  const [base, setBase] = useState(() => editBase(book, target, label));
  const [initial, setInitial] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = draft !== initial;
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  // Without unsaved changes the editor follows the saved text (an AI edit, a restore, the autopilot…).
  useEffect(() => {
    if (dirtyRef.current) return;
    setBase(editBase(book, target, label)); setInitial(saved); setDraft(saved);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(value: string | null, success: string) {
    setBusy(true); setMessage("");
    try {
      await saveMemoryEdit(book.id, id, base, value);
      await onRefresh();
      if (!mounted.current) return;
      setConflict(false); setMessage(success);
      if (value !== null) setInitial(value);
    } catch (error) {
      await onRefresh().catch(() => undefined);
      if (!mounted.current) return;
      setConflict(error instanceof ElementChangedError); setMessage(errorText(error));
    } finally { if (mounted.current) setBusy(false); }
  }
  function remove() {
    if (!window.confirm(`Eliminare «${label}» dalla memoria narrativa? Il testo delle scene non cambia; potrai ripristinarla dalla cronologia.`)) return;
    void run(null, "Voce eliminata dalla memoria. Nessuna review avviata.");
  }
  return <div className="space-y-2" aria-label={"Memoria: " + label}>
    <form className="space-y-2" aria-label={"Modifica «" + label + "»"} onSubmit={e => { e.preventDefault(); if (dirty) void run(draft, "Memoria salvata. Nessuna review avviata: decidi tu se e quando controllarla."); }}>
      <label className="block text-sm"><span className="sr-only">{label}</span>
        <textarea className="field" rows={rows} maxLength={20_000} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)}/></label>
      {hint && <p className="muted text-xs">{hint}</p>}
      {conflict && <Button type="button" variant="outline" onClick={() => { setBase(editBase(book, target, label)); setConflict(false); setMessage("Ora il salvataggio sostituirà la versione attuale con la tua."); }}>
        Sostituisci comunque con la mia versione</Button>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !dirty}><Save size={15}/> Salva senza review</Button>
        {dirty && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setDraft(initial)}>Annulla modifiche</Button>}
        {dirty && <Badge tone="amber">Non salvata</Badge>}
        {removable && <Button type="button" size="sm" variant="ghost" className="ml-auto text-rose-700 dark:text-rose-300" disabled={busy} onClick={remove}><Trash2 size={15}/> Elimina</Button>}
      </div>
      {message && <p role="status" className="text-sm [overflow-wrap:anywhere]">{message}</p>}
    </form>
    <PendingEditActions book={book} target={target} label={label} onRefresh={onRefresh} onStart={onStart}/>
    <EditHistory book={book} target={target} label={label} onRefresh={onRefresh}/>
  </div>;
}

/** A new entry in one memory section (characters, locations, factions, items, secrets). */
export function NewMemoryEntryForm({ book, folder, title, onRefresh }: { book: BookProject; folder: MemoryFolder; title: string; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit() {
    const entry = name.trim();
    setBusy(true); setMessage("");
    try {
      if (!entry || entry.includes("\n")) throw new Error("Scrivi il nome della voce.");
      if (memoryValue(book, folder + ":" + entry) !== undefined) throw new Error("Esiste già una voce con questo nome: modificala.");
      await saveMemoryEdit(book.id, folder + ":" + entry, undefined, text);
      await onRefresh();
      if (!mounted.current) return;
      setName(""); setText(""); setMessage("Voce aggiunta alla memoria.");
    } catch (error) {
      await onRefresh().catch(() => undefined);
      if (mounted.current) setMessage(errorText(error));
    } finally { if (mounted.current) setBusy(false); }
  }
  return <form aria-label={"Nuova voce: " + title} className="space-y-2 rounded-xl border border-emerald-600/50 p-3" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <label className="block text-sm">Nome<input className="field mt-1" maxLength={120} value={name} disabled={busy} onChange={e => setName(e.target.value)}/></label>
    <label className="block text-sm">Cosa si sa<textarea className="field mt-1" rows={3} maxLength={20_000} value={text} disabled={busy} onChange={e => setText(e.target.value)}/></label>
    <Button type="submit" size="sm" disabled={busy || !name.trim() || !text.trim()}><Plus size={15}/> Aggiungi la voce</Button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}
