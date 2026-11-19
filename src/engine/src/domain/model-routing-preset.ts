import type { AppSettings, TaskKind } from "./types";

/** Checking work (twelve reviewers per chapter segment, readers, summaries, memory updates) is by far
 * the largest share of calls: a small fast model there makes a slow machine practical, while writing,
 * planning and the editorial director keep the main model. */
export const FAST_CHECK_TASKS: readonly TaskKind[] = ["chapterAudit", "chapterReaders", "summarize", "consolidate"];

export function applyFastCheckRoutes(settings: AppSettings, modelId: string): Pick<AppSettings, "taskRoutes"> {
  const taskRoutes = { ...settings.taskRoutes };
  for (const kind of FAST_CHECK_TASKS)
    taskRoutes[kind] = { endpointId: settings.defaultRoute.endpointId, modelId };
  return { taskRoutes };
}

export function clearFastCheckRoutes(settings: AppSettings): Pick<AppSettings, "taskRoutes"> {
  const taskRoutes = { ...settings.taskRoutes };
  for (const kind of FAST_CHECK_TASKS) delete taskRoutes[kind];
  return { taskRoutes };
}
