import type { BookProject } from "../domain/types";
const VOLATILE = new Set(["updatedAt", "status", "previousError", "remote", "webResearch", "webResearchLog",
  "changeMode", "aiBudget", "modelRoutes", "taskReasoningEfforts", "authorInterventions", "edits", "manualReviews"]);
export function narrativeStateJson(book: BookProject): string {
  return JSON.stringify(book, function (this: unknown, key: string, value: unknown) {
    return this === book && VOLATILE.has(key) ? undefined : value;
  });
}
