import { useState } from "react";
import type { AiPriceRate } from "../../domain/types";
import { isPriceRate } from "../../domain/ai-budget";

type Draft = { input: string; output: string; cached: string; sig: string };
const sigOf = (rate?: AiPriceRate) => rate ? JSON.stringify(rate) : "none";

/**
 * Per-model price per 1M tokens (input, output, cached input) for ONE endpoint.
 * Prices are typed by the author; nothing is prefilled. The cost of a request is
 * computed from the usage the provider reports back, never from these numbers alone.
 */
export function ModelPriceTable({ endpointId, models, rates, onChange }: {
  endpointId: string; models: string[]; rates: AiPriceRate[];
  onChange: (next: AiPriceRate[]) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  if (!models.length) return <p className="muted text-xs">
    Aggiungi o leggi i modelli dell'endpoint per impostarne i prezzi.</p>;

  function edit(model: string, field: "input" | "output" | "cached", value: string) {
    const saved = rates.find(r => r.endpointId === endpointId && r.modelId === model);
    const current = drafts[model] && drafts[model]!.sig === sigOf(saved) ? drafts[model]! : {
      input: saved ? String(saved.inputEurPerMillion) : "",
      output: saved ? String(saved.outputEurPerMillion) : "",
      cached: saved?.cachedInputEurPerMillion !== undefined ? String(saved.cachedInputEurPerMillion) : "",
      sig: sigOf(saved),
    };
    const next = { ...current, [field]: value };
    const candidate: AiPriceRate = {
      endpointId, modelId: model,
      inputEurPerMillion: Number(next.input), outputEurPerMillion: Number(next.output),
      ...(next.cached.trim() ? { cachedInputEurPerMillion: Number(next.cached) } : {}),
    };
    const valid = next.input.trim() !== "" && next.output.trim() !== "" && isPriceRate(candidate);
    const others = rates.filter(r => r.endpointId !== endpointId || r.modelId !== model);
    setDrafts({ ...drafts, [model]: { ...next, sig: sigOf(valid ? candidate : undefined) } });
    onChange(valid ? [...others, candidate] : others);
  }

  return <div className="overflow-x-auto">
    <table className="w-full min-w-[34rem] text-left text-xs">
      <thead><tr className="muted">
        <th className="py-1 pr-2 font-semibold">Modello</th>
        <th className="px-1 font-semibold">Input €/1M</th>
        <th className="px-1 font-semibold">Output €/1M</th>
        <th className="px-1 font-semibold">Input in cache €/1M</th>
        <th className="px-1 font-semibold">Stato</th>
      </tr></thead>
      <tbody>{models.map(model => {
        const saved = rates.find(r => r.endpointId === endpointId && r.modelId === model);
        const d = drafts[model] && drafts[model]!.sig === sigOf(saved) ? drafts[model]! : undefined;
        const input = d?.input ?? (saved ? String(saved.inputEurPerMillion) : "");
        const output = d?.output ?? (saved ? String(saved.outputEurPerMillion) : "");
        const cached = d?.cached ?? (saved?.cachedInputEurPerMillion !== undefined ? String(saved.cachedInputEurPerMillion) : "");
        return <tr key={model} className="border-t border-slate-200 dark:border-slate-800">
          <td className="py-1 pr-2 font-mono break-all">{model}</td>
          {([["input", input, "Prezzo input per milione"],
             ["output", output, "Prezzo output per milione"],
             ["cached", cached, "Prezzo input in cache per milione"]] as const).map(([field, value, label]) =>
            <td key={field} className="px-1 py-1">
              <input className="field field-sm w-24" type="number" min="0" step="0.0001"
                aria-label={`${label}: ${model}`} value={value}
                placeholder={field === "cached" ? "come input" : ""}
                onChange={e => edit(model, field, e.target.value)} />
            </td>)}
          <td className="px-1">{saved ? "tariffa impostata"
            : <span className="text-amber-700 dark:text-amber-300">manca (servono input e output)</span>}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
