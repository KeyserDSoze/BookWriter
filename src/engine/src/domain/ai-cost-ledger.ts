import type { Activity, AppSettings } from "./types";
import type { AiCostAssessment } from "./ai-budget";
import { assessAiCostAttempt, isBillableAttempt } from "./ai-budget";

/** A local reconciliation export, never a provider invoice or real credit balance. */
const COLUMNS = [
  "attivita_id", "creata_utc", "terminata_utc", "stato_attivita",
  "endpoint_id", "modello_id", "token_input_osservati", "token_input_in_cache_osservati",
  "token_output_osservati",
  "copertura_usage", "origine_tariffa", "prezzo_input_eur_milione",
  "prezzo_output_eur_milione", "prezzo_input_cache_eur_milione",
  "costo_stimato_eur", "fattura_provider_eur",
  "stato_fattura",
] as const;

/** Imported Activity route IDs are untrusted spreadsheet input. */
function csvField(value: string | number | undefined): string {
  const cleaned = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ");
  const protectedText = /^[\s]*[=+\-@]/u.test(cleaned) ? "'" + cleaned : cleaned;
  return '"' + protectedText.replaceAll('"', '""') + '"';
}

/** Minimal, local task-level view: no prose, prompt, body or raw provider error. */
export interface AiCostHistoryRow {
  id: string;
  createdAt: string;
  status: Activity["status"];
  phase: Activity["phase"];
  taskTitle: string;
  endpointId?: string;
  modelId?: string;
  endedAt?: string;
  assessment: AiCostAssessment;
}

/** Shared source for CSV and visible history, sorted by creation date ascending. */
export function listBookAiCostHistory(
  bookId: string, activities: readonly Activity[], settings: AppSettings,
): AiCostHistoryRow[] {
  return activities.filter(activity =>
    activity.bookId === bookId && isBillableAttempt(activity))
    .map(activity => ({
      id: activity.id,
      createdAt: activity.createdAt,
      status: activity.status,
      phase: activity.phase,
      taskTitle: activity.title,
      endpointId: activity.endpointId,
      modelId: activity.modelId,
      endedAt: activity.endedAt,
      assessment: assessAiCostAttempt(activity, settings),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * Semicolon-delimited UTF-8 CSV for Italian spreadsheet locales.
 * Only machine-readable activity metadata is exported; no prompt, prose,
 * summary, title, provider error, key or secret is included.
 * The provider invoice column is deliberately empty until actual trusted
 * billing evidence exists: an estimated price is NEVER an invoice.
 */
export function buildAiCostLedgerCsv(
  bookId: string, activities: readonly Activity[], settings: AppSettings,
): string {
  const data = listBookAiCostHistory(bookId, activities, settings).map(row => {
    const estimate = row.assessment;
    const fields: Array<string | number | undefined> = [
      row.id, row.createdAt, row.endedAt, row.status,
      row.endpointId, row.modelId,
      estimate.inputTokens, estimate.cachedInputTokens, estimate.outputTokens, estimate.usageCoverage,
      estimate.rateOrigin, estimate.rate?.inputEurPerMillion,
      estimate.rate?.outputEurPerMillion, estimate.rate?.cachedInputEurPerMillion,
      estimate.estimatedEur,
      undefined, "non_disponibile",
    ];
    return fields.map(csvField).join(";");
  });
  return "\uFEFF" + COLUMNS.join(";") + "\r\n" +
    (data.length ? data.join("\r\n") + "\r\n" : "");
}
