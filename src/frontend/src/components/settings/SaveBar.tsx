import { CheckCircle2 } from "lucide-react";
import { Button } from "../ui/button";

/** Always-visible save state: the author never has to scroll to find out whether edits are stored. */
export function SaveBar({ dirty, savedAt, onSave, onDiscard }: {
  dirty: boolean; savedAt?: string; onSave: () => void; onDiscard: () => void;
}) {
  return <div aria-live="polite"
    className={`sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 shadow-sm backdrop-blur ${
      dirty ? "border-amber-500 bg-amber-50/95 dark:bg-amber-950/80" : "border-emerald-600/40 bg-white/95 dark:bg-slate-900/90"}`}>
    <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${dirty ? "bg-amber-500" : "bg-emerald-500"}`} />
    <span className="text-sm font-semibold">{dirty ? "Modifiche non salvate" : "Tutto salvato"}</span>
    <span className="muted hidden text-xs sm:inline">
      {dirty ? "Valgono solo dopo il salvataggio." : savedAt ? `Ultimo salvataggio alle ${savedAt}.` : "Coincide con quanto conservato nel browser."}
    </span>
    <div className="ml-auto flex flex-wrap gap-2">
      {dirty && <Button variant="outline" onClick={onDiscard}>Annulla modifiche</Button>}
      <Button onClick={onSave}><CheckCircle2 size={17} /> Salva impostazioni</Button>
    </div>
  </div>;
}
