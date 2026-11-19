import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { BookProject } from "@engine/domain/types";
import type { ChangeTarget } from "@engine/domain/narrative-change";
import { MAX_CHANGE_INSTRUCTION, requestNarrativeChange } from "../../application/narrative-change";
import { Button } from "../ui/button";

/** Natural-language change request for an entity, an event or a scene. */
export function ChangePromptBox({ book, target, label, examples, onRefresh, onStart }: {
  book: BookProject; target: ChangeTarget; label: string; examples: string[];
  onRefresh: () => Promise<void>; onStart: (bookId: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setText(""); setMessage(""); }, [target.id]);
  const blocked = book.status === "running" ? "L'autopilot è in esecuzione: mettilo in pausa per chiedere una modifica." :
    book.revision ? "C'è già una revisione o una modifica in corso." : "";
  const confirm = book.changeMode === "confirm";
  async function submit() {
    setBusy(true); setMessage("");
    try {
      await requestNarrativeChange(book.id, target, text, book.updatedAt);
      await onRefresh();
      if (!mounted.current) return;
      setText("");
      setMessage(confirm ? "Modifica registrata: l'autopilot analizza l'impatto e ti mostrerà il piano prima di riscrivere." :
        "Modifica avviata: l'autopilot analizza l'impatto, riscrive solo le scene necessarie e le fa rivedere.");
      onStart(book.id);
    } catch (error) {
      await onRefresh().catch(() => undefined);
      if (mounted.current) setMessage(error instanceof Error ? error.message : "Modifica non registrata.");
    } finally { if (mounted.current) setBusy(false); }
  }
  return <form className="space-y-2 rounded-xl border border-violet-500/40 bg-violet-500/5 p-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label className="block text-sm font-semibold">
      <span className="flex items-center gap-1.5"><Sparkles size={15} className="text-violet-600 dark:text-violet-300"/> Modifica con un prompt</span>
      <textarea aria-label={"Descrivi la modifica a «" + label + "»"} className="field mt-1 font-normal" rows={3} maxLength={MAX_CHANGE_INSTRUCTION}
        disabled={busy || !!blocked} value={text} placeholder={examples[0]} onChange={e => setText(e.target.value)}/>
    </label>
    {examples.length > 1 && !text && <div className="flex flex-wrap gap-1.5" aria-label="Esempi di richiesta">
      {examples.slice(1).map(example => <button key={example} type="button" disabled={busy || !!blocked}
        className="rounded-full border border-slate-300 px-2.5 py-1 text-left hover:border-violet-500 dark:border-slate-600 max-sm:min-h-11"
        onClick={() => setText(example)}><span className="text-xs">{example}</span></button>)}
    </div>}
    <p className="muted text-xs">{confirm
      ? "Modalità con conferma: dopo l'analisi vedrai scene dirette, indirette e impatto globale, e deciderai tu."
      : "Modalità automatica: l'analisi d'impatto sceglie le scene da riscrivere; le versioni precedenti restano per il ripristino."} Ogni richiesta usa chiamate AI.</p>
    {blocked && <p className="text-xs text-amber-700 dark:text-amber-300">{blocked}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={busy || !!blocked || text.trim().length < 8}><Sparkles size={16}/> {confirm ? "Analizza la modifica" : "Applica la modifica"}</Button>
      {message && <p role="status" className="text-sm [overflow-wrap:anywhere]">{message}</p>}
    </div>
  </form>;
}
