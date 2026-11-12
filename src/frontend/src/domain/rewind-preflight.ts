import type { Activity, BookProject } from "./types";

export type RewindPreflightBook = Pick<
  BookProject, "id" | "chapters" | "editorialReviewSceneIds" | "status"
>;

export type RewindPreflight =
  | { kind: "unavailable"; reason: "missing_task" | "wrong_book" |
      "duplicate_task" | "invalid_task_time" }
  | {
      kind: "ready";
      taskId: string;
      /** Chronological observations, NOT a dependency graph or historical snapshot. */
      laterTaskCount: number;
      laterTaskSample: Array<Pick<Activity, "id" | "title" | "phase" | "status">>;
      sameTimeCount: number;
      invalidTimeCount: number;
      runningTaskCount: number;
      /** Counts from the CURRENT book only, never as-of the selected task. */
      currentChapterCount: number;
      currentFrozenChapterCount: number;
      currentCanonSceneCount: number;
      currentPendingReviewCount: number;
    };

const MAX_SAMPLE = 5;

/** Require explicit timezone and valid civil date; Date.parse alone rolls over Feb 30. */
function parseTaskTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = match[8]!;
  const localUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(localUtc);
  if (year < 1000 || !Number.isFinite(localUtc) ||
      date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second)
    return undefined;
  if (offset !== "Z") {
    const hours = Number(offset.slice(1, 3));
    const minutes = Number(offset.slice(4, 6));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0))
      return undefined;
  }
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : undefined;
}

/**
 * Read-only, conservative preflight: timestamps cannot prove causal dependence.
 * Never accesses prose, output, prompts, reasoning or local traces.
 */
export function analyzeRewindPreflight(
  book: RewindPreflightBook,
  activities: readonly Activity[],
  selectedId: string,
): RewindPreflight {
  const selected = activities.filter(activity => activity.id === selectedId);
  if (!selected.length || !selectedId) return { kind: "unavailable", reason: "missing_task" };
  if (selected.length !== 1) return { kind: "unavailable", reason: "duplicate_task" };
  const target = selected[0]!;
  if (target.bookId !== book.id) return { kind: "unavailable", reason: "wrong_book" };
  const selectedTime = parseTaskTimestamp(target.createdAt);
  if (selectedTime === undefined)
    return { kind: "unavailable", reason: "invalid_task_time" };

  let sameTimeCount = 0;
  let invalidTimeCount = 0;
  let runningTaskCount = 0;
  const later: Array<{ activity: Activity; time: number }> = [];
  for (const activity of activities) {
    if (activity.bookId !== book.id || activity.id === selectedId) continue;
    if (activity.status === "running") runningTaskCount++;
    const time = parseTaskTimestamp(activity.createdAt);
    if (time === undefined) invalidTimeCount++;
    else if (time === selectedTime) sameTimeCount++;
    else if (time > selectedTime) later.push({ activity, time });
  }
  later.sort((a, b) => a.time - b.time || a.activity.id.localeCompare(b.activity.id));
  const canonSceneIds = new Set<string>();
  let currentFrozenChapterCount = 0;
  for (const chapter of book.chapters) {
    if (typeof chapter.frozenAt === "string" && chapter.frozenAt.trim())
      currentFrozenChapterCount++;
    for (const scene of chapter.scenes)
      if (scene.status === "canon") canonSceneIds.add(scene.id);
  }
  const pending = new Set(book.editorialReviewSceneIds ?? []);
  return {
    kind: "ready",
    taskId: selectedId,
    laterTaskCount: later.length,
    laterTaskSample: later.slice(0, MAX_SAMPLE).map(({ activity }) => ({
      id: activity.id, title: activity.title, phase: activity.phase,
      status: activity.status,
    })),
    sameTimeCount,
    invalidTimeCount,
    runningTaskCount,
    currentChapterCount: book.chapters.length,
    currentFrozenChapterCount,
    currentCanonSceneCount: canonSceneIds.size,
    currentPendingReviewCount: pending.size,
  };
}
