import type { Activity, AppSettings } from "../domain/types";
import { buildAiCostLedgerCsv } from "../domain/ai-cost-ledger";

export function exportAiCostLedgerCsv(
  bookId: string, activities: readonly Activity[], settings: AppSettings,
): void {
  const csv = buildAiCostLedgerCsv(bookId, activities, settings);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  // Never let a value from an imported book become a path or spreadsheet formula.
  const safeId = bookId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "libro";
  anchor.download = "bookwriter-ledger-" + safeId + ".csv";
  anchor.href = url;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
