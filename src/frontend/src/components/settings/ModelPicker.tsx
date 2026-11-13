import { useState } from "react";

const MANUAL = "__manual__";

/** Model chooser: a dropdown fed by the endpoint catalog; a text field only when there is no
 * catalog yet or the author asks to type an ID the provider does not list. */
export function ModelPicker({ value, models, onChange, ariaLabel, emptyLabel, disabled, commitOnBlur, resetKey }: {
  value: string; models: readonly string[]; onChange: (value: string) => void; ariaLabel: string;
  /** Label of the «not set» choice; omit when a model is mandatory. */
  emptyLabel?: string; disabled?: boolean;
  /** Text field only: write when the field loses focus (each change is a locked write). */
  commitOnBlur?: boolean; resetKey?: string;
}) {
  const [manual, setManual] = useState(false);
  if (models.length === 0 || manual) {
    return <div className="flex min-w-0 items-center gap-1">
      {commitOnBlur
        ? <input key={resetKey} className="field field-sm" aria-label={ariaLabel} disabled={disabled}
            defaultValue={value} placeholder={emptyLabel ?? "ID modello"}
            onBlur={e => { if (e.target.value !== value) onChange(e.target.value); }} />
        : <input className="field field-sm" aria-label={ariaLabel} disabled={disabled} value={value}
            placeholder={emptyLabel ?? "ID modello"} onChange={e => onChange(e.target.value)} />}
      {manual && models.length > 0 && <button type="button" className="shrink-0 rounded border px-2 py-1 text-xs"
        title="Torna all'elenco dei modelli" aria-label={`Torna all'elenco: ${ariaLabel}`}
        onClick={() => setManual(false)}>Elenco</button>}
    </div>;
  }
  const listed = models.includes(value);
  return <select className="field field-sm" aria-label={ariaLabel} disabled={disabled} value={value}
    onChange={e => e.target.value === MANUAL ? setManual(true) : onChange(e.target.value)}>
    {emptyLabel !== undefined ? <option value="">{emptyLabel}</option>
      : value === "" && <option value="">Scegli un modello</option>}
    {models.map(model => <option key={model} value={model}>{model}</option>)}
    {value !== "" && !listed && <option value={value}>{value} (non in elenco)</option>}
    <option value={MANUAL}>Altro… (scrivi a mano)</option>
  </select>;
}
