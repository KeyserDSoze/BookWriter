import type { Activity, BookProject, Scene } from "./types";

/**
 * Versioned structural witnesses for one committed task. These snapshots
 * deliberately exclude the manuscript text, summaries, titles and memory.
 * They CANNOT be used to restore an earlier book.
 */
export interface BookStructuralSnapshot {
  revision: string;
  phase: BookProject["phase"];
  status: BookProject["status"];
  chapters: Array<{
    id: string;
    frozen: boolean;
    scenes: Array<{ id: string; status: Scene["status"] }>;
  }>;
}

export interface TaskStructuralCheckpoint {
  schemaVersion: 1;
  bookId: string;
  activityId: string;
  before: BookStructuralSnapshot;
  after: BookStructuralSnapshot;
}

export function captureBookStructure(book: BookProject): BookStructuralSnapshot {
  return {
    revision: book.updatedAt,
    phase: book.phase,
    status: book.status,
    chapters: book.chapters.map(chapter => ({
      id: chapter.id,
      frozen: Boolean(chapter.frozenAt),
      scenes: chapter.scenes.map(scene => ({ id: scene.id, status: scene.status })),
    })),
  };
}

export function createTaskStructuralCheckpoint(
  before: BookProject, after: BookProject,
  activity: Activity,
): TaskStructuralCheckpoint {
  if (before.id !== after.id || activity.bookId !== after.id ||
      activity.status !== "succeeded" || !activity.id)
    throw new Error("Checkpoint strutturale non valido: libro o task non corrispondente.");
  return {
    schemaVersion: 1, bookId: after.id, activityId: activity.id,
    before: captureBookStructure(before), after: captureBookStructure(after),
  };
}

export interface BookStructuralChanges {
  chaptersBefore: number;
  chaptersAfter: number;
  chaptersAdded: number;
  chaptersRemoved: number;
  chaptersFrozen: number;
  chaptersUnfrozen: number;
  scenesAdded: number;
  scenesRemoved: number;
  sceneStatusesChanged: number;
  phaseChanged: boolean;
}

function mapScenes(snapshot: BookStructuralSnapshot): Map<string, Scene["status"]> {
  const out = new Map<string, Scene["status"]>();
  for (const chapter of snapshot.chapters)
    for (const scene of chapter.scenes)
      out.set(JSON.stringify([chapter.id, scene.id]), scene.status);
  return out;
}

/** Structural differences only: no text comparison, canonicality approval or rewind. */
export function compareBookStructure(
  checkpoint: TaskStructuralCheckpoint,
): BookStructuralChanges {
  const oldChapters = new Map(checkpoint.before.chapters.map(ch => [ch.id, ch]));
  const newChapters = new Map(checkpoint.after.chapters.map(ch => [ch.id, ch]));
  let chaptersAdded = 0, chaptersRemoved = 0;
  let chaptersFrozen = 0, chaptersUnfrozen = 0;
  for (const chapter of checkpoint.after.chapters) {
    const old = oldChapters.get(chapter.id);
    if (!old) chaptersAdded++;
    else if (old.frozen !== chapter.frozen) {
      if (chapter.frozen) chaptersFrozen++;
      else chaptersUnfrozen++;
    }
  }
  for (const chapter of checkpoint.before.chapters)
    if (!newChapters.has(chapter.id)) chaptersRemoved++;
  const oldScenes = mapScenes(checkpoint.before);
  const newScenes = mapScenes(checkpoint.after);
  let scenesAdded = 0, scenesRemoved = 0, sceneStatusesChanged = 0;
  for (const [key, value] of newScenes) {
    if (!oldScenes.has(key)) scenesAdded++;
    else if (oldScenes.get(key) !== value) sceneStatusesChanged++;
  }
  for (const key of oldScenes.keys())
    if (!newScenes.has(key)) scenesRemoved++;
  return {
    chaptersBefore: checkpoint.before.chapters.length,
    chaptersAfter: checkpoint.after.chapters.length,
    chaptersAdded, chaptersRemoved, chaptersFrozen, chaptersUnfrozen,
    scenesAdded, scenesRemoved, sceneStatusesChanged,
    phaseChanged: checkpoint.before.phase !== checkpoint.after.phase,
  };
}

const VALID_STATUSES = new Set(["planned", "draft", "canon"]);
function isSnapshot(value: unknown): value is BookStructuralSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  if (typeof s.revision !== "string" || typeof s.phase !== "string" ||
      typeof s.status !== "string" || !Array.isArray(s.chapters) ||
      s.chapters.length > 1000) return false;
  return s.chapters.every((chapter: unknown) => {
    if (!chapter || typeof chapter !== "object") return false;
    const ch = chapter as Record<string, unknown>;
    return typeof ch.id === "string" && ch.id.length <= 500 &&
      typeof ch.frozen === "boolean" && Array.isArray(ch.scenes) &&
      ch.scenes.length <= 10000 && ch.scenes.every((scene: unknown) => {
        if (!scene || typeof scene !== "object") return false;
        const candidate = scene as Record<string, unknown>;
        return typeof candidate.id === "string" && candidate.id.length <= 500 &&
          VALID_STATUSES.has(candidate.status as string);
      });
  });
}

/** Refuse forged, wrong-book, legacy or damaged records. */
export function validatedTaskStructuralCheckpoint(
  value: unknown, bookId: string, activityId: string,
): TaskStructuralCheckpoint | null {
  if (!value || typeof value !== "object") return null;
  const checkpoint = value as Record<string, unknown>;
  if (checkpoint.schemaVersion !== 1 || checkpoint.bookId !== bookId ||
      checkpoint.activityId !== activityId || !isSnapshot(checkpoint.before) ||
      !isSnapshot(checkpoint.after)) return null;
  return value as TaskStructuralCheckpoint;
}
