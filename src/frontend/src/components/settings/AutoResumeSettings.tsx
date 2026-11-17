import { useState } from "react";
import { Clock3, Smartphone } from "lucide-react";
import { AUTO_RESUME_WINDOW_MS, autoResumeEnabled, setAutoResumeEnabled } from "../../application/auto-resume";
import { Switch } from "../ui/primitives";

/** Per-device behaviour of the autopilot when the page goes away. Never part of a book, never synced. */
export function AutoResumeSettings() {
  const [on, setOn] = useState(autoResumeEnabled);
  const minutes = AUTO_RESUME_WINDOW_MS / 60_000;
  return <div className="space-y-4">
    <Switch checked={on} label="Riprendi da solo dopo un ricaricamento"
      onChange={value => { setAutoResumeEnabled(value); setOn(value); }}
      description={`Se ricarichi la pagina (F5) mentre l'autopilot lavora, riparte dall'ultimo checkpoint, purché fosse al lavoro da meno di ${minutes} minuti. Aprire l'app da un link o da una nuova scheda non lo fa ripartire. Budget e blocchi di scrittura valgono come per «Riprendi».`}/>
    <section className="space-y-2 rounded-xl border border-slate-300 p-3 text-sm dark:border-slate-700" aria-label="Cosa succede a pagina chiusa">
      <h3 className="flex items-center gap-2 font-semibold"><Clock3 size={16}/> Cosa può fare l'autopilot quando la pagina non è in primo piano</h3>
      <ul className="muted list-disc space-y-1.5 pl-5">
        <li>Lavora finché la pagina (o l'app installata) resta aperta: il browser non permette di continuare a pagina chiusa, né da scheda né da app installata.</li>
        <li>Un ricaricamento, un crash o la chiusura interrompono la chiamata AI in corso: può essere addebitata e il suo testo va perso. Quello già salvato resta e si riparte dall'ultimo checkpoint.</li>
        <li className="flex gap-1.5 list-none -ml-5"><Smartphone size={15} className="mt-0.5 shrink-0"/><span>Sul telefono il sistema può sospendere la pagina quando passi a un'altra app: tienila in primo piano (lo schermo resta acceso finché l'autopilot lavora). Su computer può restare in secondo piano, ma non chiuderla.</span></li>
      </ul>
    </section>
  </div>;
}
