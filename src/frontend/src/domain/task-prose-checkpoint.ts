import type { Activity, BookProject } from "./types";

/** Local, opt-in manuscript copies: only text of canon scenes, never full book state. */
export interface CanonProseScene {
  chapterId: string;
  sceneId: string;
  text: string;
}
export interface CanonProseSnapshot {
  revision: string;
  scenes: CanonProseScene[];
}
export interface TaskProseCheckpoint {
  schemaVersion: 1;
  bookId: string;
  activityId: string;
  before: CanonProseSnapshot;
  after: CanonProseSnapshot;
}

export function captureCanonProse(book: BookProject): CanonProseSnapshot {
  return {
    revision: book.updatedAt,
    scenes: book.chapters.flatMap(ch => ch.scenes
      .filter(scene => scene.status === "canon")
      .map(scene => ({ chapterId: ch.id, sceneId: scene.id, text: scene.text }))),
  };
}
export function createTaskProseCheckpoint(
  before: BookProject, after: BookProject, activity: Activity,
): TaskProseCheckpoint {
  if (!activity.id || before.id !== after.id || activity.bookId !== after.id ||
      activity.status !== "succeeded") throw new Error(
    "Copia di prosa non valida: libro o task non corrispondente.",
  );
  return { schemaVersion: 1, bookId: after.id, activityId: activity.id,
    before: captureCanonProse(before), after: captureCanonProse(after) };
}

export interface CanonProseDiff {
  beforeCount: number;
  afterCount: number;
  added: Array<{ chapterId: string; sceneId: string }>;
  removed: Array<{ chapterId: string; sceneId: string }>;
  modified: Array<{ chapterId: string; sceneId: string }>;
}
function key(scene: CanonProseScene): string {
  return JSON.stringify([scene.chapterId, scene.sceneId]);
}
function ids(scene: CanonProseScene): { chapterId: string; sceneId: string } {
  return { chapterId: scene.chapterId, sceneId: scene.sceneId };
}
/** Exact text equality only; does not calculate or authorize an editorial merge. */
export function compareCanonProse(checkpoint: TaskProseCheckpoint): CanonProseDiff {
  const before = new Map(checkpoint.before.scenes.map(scene => [key(scene), scene]));
  const after = new Map(checkpoint.after.scenes.map(scene => [key(scene), scene]));
  const added: CanonProseDiff["added"] = [];
  const removed: CanonProseDiff["removed"] = [];
  const modified: CanonProseDiff["modified"] = [];
  for (const scene of checkpoint.after.scenes) {
    const previous = before.get(key(scene));
    if (!previous) added.push(ids(scene));
    else if (previous.text !== scene.text) modified.push(ids(scene));
  }
  for (const scene of checkpoint.before.scenes)
    if (!after.has(key(scene))) removed.push(ids(scene));
  return { beforeCount: checkpoint.before.scenes.length,
    afterCount: checkpoint.after.scenes.length, added, removed, modified };
}

function validSnapshot(value: unknown): value is CanonProseSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.revision !== "string" || !Array.isArray(snapshot.scenes) ||
      snapshot.scenes.length > 100000) return false;
  const seen = new Set<string>();
  return snapshot.scenes.every((value: unknown) => {
    if (!value || typeof value !== "object") return false;
    const scene = value as Record<string, unknown>;
    if (typeof scene.chapterId !== "string" || !scene.chapterId ||
        scene.chapterId.length > 500 || typeof scene.sceneId !== "string" ||
        !scene.sceneId || scene.sceneId.length > 500 ||
        typeof scene.text !== "string") return false;
    const id = JSON.stringify([scene.chapterId, scene.sceneId]);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
export function validatedTaskProseCheckpoint(
  value: unknown, bookId: string, activityId: string,
): TaskProseCheckpoint | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || item.bookId !== bookId ||
      item.activityId !== activityId || !validSnapshot(item.before) ||
      !validSnapshot(item.after)) return null;
  return value as TaskProseCheckpoint;
}
