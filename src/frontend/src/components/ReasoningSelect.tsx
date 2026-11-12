import { REASONING_LEVELS, REASONING_LEVEL_LABEL, describeReasoningSupport, reasoningLevelSupported, type ReasoningSupport } from "../domain/model-reasoning";
import type { TaskReasoning } from "../domain/types";

type Level = (typeof REASONING_LEVELS)[number];

/** Reasoning dropdown whose choices follow what the routed model declares. */
export function ReasoningSelect({ id, ariaLabel, value, onChange, support, inheritLabel, disabled, emphasizeLevels, hideAutomatic }: {
  id?: string; ariaLabel?: string; value: TaskReasoning | undefined;
  onChange: (value: TaskReasoning | undefined) => void;
  support: ReasoningSupport; inheritLabel: string; disabled?: boolean;
  /** Add speed hints for the extremes (task page). */
  emphasizeLevels?: boolean;
  /** Endpoint level: the empty choice already means «do not send». */
  hideAutomatic?: boolean;
}) {
  const unsupportedChoice = value !== undefined && value !== "automatic" && !reasoningLevelSupported(support, value);
  const hint = (level: Level) => !emphasizeLevels ? "" :
    level === "low" ? " — rapido" : level === "xhigh" ? " — molto lento" : "";
  const defaultText = support.status === "options" && support.default
    ? ` (usa il predefinito del modello: ${REASONING_LEVEL_LABEL[support.default]})` : "";
  return <select id={id} aria-label={ariaLabel} className="field" disabled={disabled} value={value ?? ""}
    onChange={e => onChange(e.target.value === "" ? undefined : e.target.value as TaskReasoning)}>
    <option value="">{inheritLabel}</option>
    {!hideAutomatic && <option value="automatic">Automatico: non inviare il parametro{defaultText}</option>}
    {REASONING_LEVELS.filter(level => reasoningLevelSupported(support, level)).map(level =>
      <option key={level} value={level}>{REASONING_LEVEL_LABEL[level]}{hint(level)}</option>)}
    {unsupportedChoice &&
      <option value={value}>{REASONING_LEVEL_LABEL[value as Level]} (non supportato dal modello)</option>}
  </select>;
}

/** What the routed model supports, and a warning when the stored choice is not among it. */
export function ReasoningHint({ value, support, modelId }: {
  value: TaskReasoning | undefined; support: ReasoningSupport; modelId: string;
}) {
  const unsupportedChoice = value !== undefined && value !== "automatic" && !reasoningLevelSupported(support, value);
  return <p className={`mt-1 text-xs ${unsupportedChoice ? "text-amber-700 dark:text-amber-300" : "muted"}`}>
    {unsupportedChoice
      ? `Il livello scelto non è tra quelli di ${modelId.trim() || "il modello"}: non verrà inviato (si userà il predefinito del modello). `
      : ""}
    {describeReasoningSupport(support, modelId)}
  </p>;
}
