import { getDb } from "./db";
import {
  validatedTaskStructuralCheckpoint,
  type TaskStructuralCheckpoint,
} from "../domain/task-structural-checkpoint";

export function taskStructuralCheckpointKey(activityId: string): string {
  return "task-structure:v1:" + activityId;
}

/** Local-only, never sent to ZIP or sync. An explicit UI action starts the read. */
export async function loadTaskStructuralCheckpoint(
  bookId: string, activityId: string,
): Promise<TaskStructuralCheckpoint | null> {
  if (!bookId || !activityId) return null;
  const db = await getDb();
  const value = await db.get("meta", taskStructuralCheckpointKey(activityId));
  return validatedTaskStructuralCheckpoint(value, bookId, activityId);
}
