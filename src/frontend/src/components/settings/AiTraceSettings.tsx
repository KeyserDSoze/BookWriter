import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import type { AppSettings } from "@engine/domain/types";
import {
  AI_TRACE_AGE_PRESETS, AI_TRACE_MAX_TASKS, AI_TRACE_MIN_TASKS, aiTracePolicy,
} from "@engine/domain/ai-trace-policy";

import { summarizeAiTraces, type AiTraceInventory } from "../../infrastructure/ai-trace-store";

type Patch = Pick<AppSettings, "keepAiConversations" | "syncAiConversationsToGitHub" | "aiTraceRetention">;

/** What happens to the prompt and reply of each AI task. Watching the text while it
 * arrives needs no setting at all: this is only about reading it again later. */
export function AiTraceSettings({ settings, onChange, onClear }: {
  settings: AppSettings;
  onChange: (patch: Partial<Patch>) => Promise<void> | void;
  onClear: () => Promise<number>;
}) {
  const policy = aiTracePolicy(settings);
  const [inventory, setInventory] = useState<AiTraceInventory | null>(null);
  const [tasksDraft, setTasksDraft] = useState(String(policy.maxTasks));
  const refresh = useCallback(() => { void summarizeAiTraces().then(setInventory).catch(() => setInventory(null)); }, []);
  useEffect(refresh, [refresh]);
  // The count is read again only AFTER the change was saved and old conversations were pruned.
  const change = (patch: Partial<Patch>) => { void Promise.resolve(onChange(patch)).then(refresh); };
  useEffect(() => { setTasksDraft(String(policy.maxTasks)); }, [policy.maxTasks]);

  const retention = (changes: Partial<{ maxTasks: number; maxMinutes: number }>) =>
    change({ aiTraceRetention: { maxTasks: policy.maxTasks, maxMinutes: policy.maxMinutes, ...changes } });
  const commitTasks = (text: string) => {
    const value = Number(text);
    if (Number.isInteger(value) && value >= AI_TRACE_MIN_TASKS && value <= AI_TRACE_MAX_TASKS) retention({ maxTasks: value });
  };
  const ageKnown = AI_TRACE_AGE_PRESETS.some(preset => preset.minutes === policy.maxMinutes);

  return <div className="space-y-4 text-sm">
    <p role="note" className="rounded-lg border border-emerald-600/40 p-3">
      <b>Il testo che il modello sta scrivendo si vede sempre</b>, mentre arriva: nella Dashboard, nel riquadro in basso a destra
      e in Attività. Non serve attivare niente. Qui scegli solo <b>per quanto tempo restano consultabili</b> richiesta e risposta
      di ogni task, per rileggerle dopo.
    </p>

    <fieldset className="space-y-3 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
      <legend className="px-1 font-semibold">Conservazione temporanea (predefinita)</legend>
      <p className="muted text-xs">Richiesta e risposta di ogni task si salvano nel browser e si cancellano da sole: restano gli ultimi task e nulla di più vecchio del tempo scelto. Vale il limite che scatta per primo.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="mb-1 block font-semibold">Tieni gli ultimi (task)</span>
          <input className="field" type="number" inputMode="numeric" min={AI_TRACE_MIN_TASKS} max={AI_TRACE_MAX_TASKS} step={1}
            value={tasksDraft}
            onChange={event => { setTasksDraft(event.target.value); commitTasks(event.target.value); }}
            onBlur={() => setTasksDraft(String(policy.maxTasks))} />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block font-semibold">Cancella quelli più vecchi di</span>
          <select className="field" value={policy.maxMinutes} onChange={event => retention({ maxMinutes: Number(event.target.value) })}>
            {!ageKnown && <option value={policy.maxMinutes}>{policy.maxMinutes} minuti</option>}
            {AI_TRACE_AGE_PRESETS.map(preset => <option key={preset.minutes} value={preset.minutes}>{preset.label}</option>)}
          </select>
        </label>
      </div>
    </fieldset>

    <fieldset className="space-y-3 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
      <legend className="px-1 font-semibold">Conservazione senza scadenza (facoltativa)</legend>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 size-5" checked={policy.keepForever}
          onChange={event => change(event.target.checked
            ? { keepAiConversations: true }
            : { keepAiConversations: false, syncAiConversationsToGitHub: false })} />
        <span><b>Conserva richieste e risposte senza scadenza</b>: non si cancellano più da sole. Valgono dai prossimi task e restano nel
          browser finché non le cancelli tu. Contengono il testo del romanzo e i segreti narrativi; non finiscono mai nei backup ZIP.</span>
      </label>
      <label className={"flex items-start gap-3" + (policy.keepForever ? "" : " opacity-60")}>
        <input type="checkbox" className="mt-1 size-5" disabled={!policy.keepForever} checked={policy.sendToGitHub}
          onChange={event => {
            if (event.target.checked && !window.confirm(
              "Le conversazioni conservate verranno scritte nella repository GitHub di ogni libro, insieme al libro: " +
              "prompt, testo del romanzo e segreti narrativi. Anche cancellandole dopo, restano nella cronologia di Git. " +
              "Usa solo repository private. Confermi?")) return;
            change({ syncAiConversationsToGitHub: event.target.checked });
          }} />
        <span><b>Scrivi le conversazioni conservate anche su GitHub, insieme al libro</b>: a ogni sincronizzazione la repository del libro
          riceve le conversazioni di quel libro (le più recenti per prime, fino a 6 MiB per sincronizzazione). Usa solo repository private.
          Si può attivare solo dopo aver scelto la conservazione senza scadenza.</span>
      </label>
    </fieldset>

    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={() => void (async () => {
        if (!window.confirm("Eliminare definitivamente tutte le richieste e risposte AI salvate in questo browser, temporanee e conservate? Le copie già scritte su GitHub non vengono toccate.")) return;
        await onClear();
        refresh();
      })()}>Cancella tutte le conversazioni salvate in questo browser</Button>
      <span className="muted text-xs" aria-live="polite">
        {inventory ? `Salvate ora: ${inventory.temporary} temporanee, ${inventory.kept} senza scadenza.` : "Conteggio non disponibile."}
      </span>
    </div>
    <p className="muted text-xs">Le preferenze si salvano subito e valgono solo su questo dispositivo. Il reasoning compare solo se il modello lo trasmette.</p>
  </div>;
}
