import { useState } from "react";
import type { EndpointProfile } from "../../domain/types";
import { MAX_MODEL_TOKENS, MIN_MODEL_TOKENS, declaredModelTokenLimits, isModelTokenCount, withModelTokenLimits } from "../../domain/model-token-limits";

type Field = "inputTokens" | "outputTokens";

/** Per-model maximum prompt and answer tokens, typed by the author. Empty = no limit declared. */
export function ModelTokenLimitsTable({ endpoint, models, onChange }: {
  endpoint: EndpointProfile; models: string[];
  onChange: (next: EndpointProfile["modelTokenLimits"]) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!models.length) return <p className="muted text-xs">Aggiungi o leggi i modelli dell'endpoint per impostarne i limiti.</p>;

  function edit(model: string, field: Field, text: string) {
    setDrafts(current => ({ ...current, [`${model}\n${field}`]: text }));
    const saved = declaredModelTokenLimits(endpoint, model);
    const trimmed = text.trim();
    if (trimmed === "") return onChange(withModelTokenLimits(endpoint, model, { ...saved, [field]: undefined }).modelTokenLimits);
    const value = Number(trimmed);
    if (isModelTokenCount(value)) onChange(withModelTokenLimits(endpoint, model, { ...saved, [field]: value }).modelTokenLimits);
  }

  return <div className="overflow-x-auto">
    <table className="w-full min-w-[30rem] text-left text-xs">
      <thead><tr className="muted">
        <th className="py-1 pr-2 font-semibold">Modello</th>
        <th className="px-1 font-semibold">Token di input massimi</th>
        <th className="px-1 font-semibold">Token di output massimi</th>
      </tr></thead>
      <tbody>{models.map(model => {
        const saved = declaredModelTokenLimits(endpoint, model);
        return <tr key={model} className="border-t border-slate-200 dark:border-slate-800">
          <td className="py-1 pr-2 font-mono break-all">{model}</td>
          {([["inputTokens", "Token di input massimi"], ["outputTokens", "Token di output massimi"]] as const).map(([field, label]) => {
            const draft = drafts[`${model}\n${field}`];
            const value = draft ?? (saved[field] === undefined ? "" : String(saved[field]));
            const invalid = value.trim() !== "" && !isModelTokenCount(Number(value));
            return <td key={field} className="px-1 py-1">
              <input className="field field-sm w-28" type="number" inputMode="numeric" min={MIN_MODEL_TOKENS} max={MAX_MODEL_TOKENS} step={256}
                aria-label={`${label}: ${model}`} aria-invalid={invalid} value={value} placeholder="nessun limite"
                onChange={e => edit(model, field, e.target.value)} />
              {invalid && <span role="alert" className="mt-0.5 block text-[11px] text-red-600 dark:text-red-400">Da {MIN_MODEL_TOKENS} a {MAX_MODEL_TOKENS.toLocaleString("it-IT")}: non salvato.</span>}
            </td>;
          })}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
