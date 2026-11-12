import type { Activity, BookProject } from "./types";

/** Sensitive local opt-in, entirely separate from the canonical prose snapshots. */
export const TASK_BOOK_PAIR_LIMIT_BYTES = 32 * 1024 * 1024;
export const TASK_BOOK_TOTAL_LIMIT_BYTES = 128 * 1024 * 1024;

export interface TaskBookCheckpoint {
  schemaVersion: 1;
  bookId: string;
  activityId: string;
  before: BookProject;
  after: BookProject;
}
export interface TaskBookUsage {
  schemaVersion: 1;
  bookId: string;
  estimatedBytes: number;
  records: number;
}
export interface TaskBookCheckpointSummary {
  bookId: string;
  activityId: string;
  revisionBefore: string;
  revisionAfter: string;
  chaptersBefore: number;
  chaptersAfter: number;
  scenesBefore: number;
  scenesAfter: number;
  frozenBefore: number;
  frozenAfter: number;
}

/** Clone the entire narrative and author-decision state, including draft scenes,
 * freeze markers and private memory. GitHub remote write-capability and sync
 * identifiers are not part of narrative history and must not be inherited. */
export function narrativeBookCopy(book: BookProject): BookProject {
  const value = structuredClone(book);
  delete value.remote;
  return value;
}

export function createTaskBookCheckpoint(
  before: BookProject, after: BookProject, activity: Activity,
): TaskBookCheckpoint {
  if (!activity.id || !after.id || before.id !== after.id ||
      activity.bookId !== after.id || activity.status !== "succeeded" ||
      !before.updatedAt || !after.updatedAt)
    throw new Error("Identità checkpoint narrativo incoerente.");
  return {
    schemaVersion: 1, bookId: after.id, activityId: activity.id,
    before: narrativeBookCopy(before), after: narrativeBookCopy(after),
  };
}

export function estimatedTaskBookBytes(checkpoint: TaskBookCheckpoint): number {
  // Estimated JSON UTF-8 bytes. NOT physical IndexedDB storage usage.
  return new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength;
}

export class TaskBookStorageLimitExceeded extends Error {
  constructor(
    readonly actualBytes: number, readonly limitBytes: number,
  ) {
    super("Checkpoint narrativo integrale oltre il limite locale: " +
      "il task non è stato applicato. Revoca il consenso o riduci il libro; " +
      "nessuna copia è stata troncata o eliminata automaticamente.");
    this.name = "TaskBookStorageLimitExceeded";
  }
}
export function validTaskBookUsage(value: unknown, bookId: string): value is TaskBookUsage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.schemaVersion === 1 && v.bookId === bookId &&
    Number.isSafeInteger(v.estimatedBytes) && (v.estimatedBytes as number) >= 0 &&
    (v.estimatedBytes as number) <= TASK_BOOK_TOTAL_LIMIT_BYTES &&
    Number.isSafeInteger(v.records) && (v.records as number) >= 0;
}
export function summarizeTaskBookCheckpoint(
  value: unknown, bookId: string, activityId: string,
): TaskBookCheckpointSummary | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Partial<TaskBookCheckpoint>;
  if (c.schemaVersion !== 1 || c.bookId !== bookId || c.activityId !== activityId ||
      !c.before || !c.after ||
      c.before.id !== bookId || c.after.id !== bookId ||
      typeof c.before.updatedAt !== "string" ||
      typeof c.after.updatedAt !== "string" ||
      !Array.isArray(c.before.chapters) || !Array.isArray(c.after.chapters) ||
      c.before.remote !== undefined || c.after.remote !== undefined ||
      c.before.chapters.some(ch => !ch || !Array.isArray(ch.scenes)) ||
      c.after.chapters.some(ch => !ch || !Array.isArray(ch.scenes)))return null;
  const before = c.before, after = c.after;
  return {
    bookId, activityId,
    revisionBefore: before.updatedAt, revisionAfter: after.updatedAt,
    chaptersBefore: before.chapters.length, chaptersAfter: after.chapters.length,
    scenesBefore: before.chapters.reduce((n,ch)=>n+ch.scenes.length,0),
    scenesAfter: after.chapters.reduce((n,ch)=>n+ch.scenes.length,0),
    frozenBefore: before.chapters.filter(ch=>!!ch.frozenAt).length,
    frozenAfter: after.chapters.filter(ch=>!!ch.frozenAt).length,
  };
}
