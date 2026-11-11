import type { Activity, AppSettings } from "./types";
import { assessAiCostAttempt, isBillableAttempt } from "./ai-budget";

/** A local reconciliation export, never a provider invoice or real credit balance. */
const COLUMNS = [
  "attivita_id", "creata_utc", "terminata_utc", "stato_attivita",
  "endpoint_id", "modello_id", "token_input_osservati", "token_output_osservati",
  "copertura_usage", "origine_tariffa", "prezzo_input_eur_milione",
  "prezzo_output_eur_milione", "costo_stimato_eur", "fattura_provider_eur",
  "stato_fattura",
] as const;

/** Imported Activity route IDs are untrusted spreadsheet input. */
function csvField(value: string | number | undefined): string {
  const cleaned = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ");
  const protectedText = /^[\s]*[=+\-@]/u.test(cleaned) ? "'" + cleaned : cleaned;
  return '"' + protectedText.replaceAll('"', '""') + '"';
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
  const rows = activities.filter(activity =>
    activity.bookId === bookId && isBillableAttempt(activity))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const data = rows.map(activity => {
    const estimate = assessAiCostAttempt(activity, settings);
    const fields: Array<string | number | undefined> = [
      activity.id, activity.createdAt, activity.endedAt, activity.status,
      activity.endpointId, activity.modelId,
      estimate.inputTokens, estimate.outputTokens, estimate.usageCoverage,
      estimate.rateOrigin, estimate.rate?.inputEurPerMillion,
      estimate.rate?.outputEurPerMillion, estimate.estimatedEur,
      undefined, "non_disponibile",
    ];
    return fields.map(csvField).join(";");
  });
  return "\uFEFF" + COLUMNS.join(";") + "\r\n" +
    (data.length ? data.join("\r\n") + "\r\n" : "");
}
