import type { BookProject } from "./types";
import { captureCanonProse } from "./task-prose-checkpoint";

export const MIN_PROSE_LIMIT_MIB = 1;
export const MAX_PROSE_LIMIT_MIB = 1024;
export const PROSE_MIB = 1024 * 1024;

export function validProseLimitMiB(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= MIN_PROSE_LIMIT_MIB && value <= MAX_PROSE_LIMIT_MIB;
}

/**
 * Encoded JSON payload bytes are only an approximate storage figure:
 * IndexedDB's structured-clone, key and index overhead are not included.
 */
export function estimateProsePayloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** A preview if the current canonical prose were copied before AND after.
 * It is not an upper bound for AI-generated future prose. */
export function estimateNextProsePairBytes(book: BookProject): number {
  const snapshot = captureCanonProse(book);
  return estimateProsePayloadBytes({
    schemaVersion: 1, bookId: book.id, activityId: "estimate",
    before: snapshot, after: snapshot,
  });
}

export interface TaskProseUsageLedger {
  schemaVersion: 1;
  bookId: string;
  estimatedBytes: number;
  records: number;
}
export function validTaskProseUsageLedger(
  value: unknown, bookId: string,
): value is TaskProseUsageLedger {
  if (!value || typeof value !== "object") return false;
  const ledger = value as Record<string, unknown>;
  return ledger.schemaVersion === 1 && ledger.bookId === bookId &&
    Number.isSafeInteger(ledger.estimatedBytes) && (ledger.estimatedBytes as number) >= 0 &&
    Number.isSafeInteger(ledger.records) && (ledger.records as number) >= 0;
}

export class TaskProseQuotaExceeded extends Error {
  constructor(public readonly estimatedTotalBytes: number, public readonly limitMiB: number) {
    super("Limite locale delle copie di prosa superato: il task non è stato applicato. " +
      "Rivedi il limite oppure elimina copie storiche manualmente in Attività.");
    this.name = "TaskProseQuotaExceeded";
  }
}
