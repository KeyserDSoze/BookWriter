import type { BookProject } from "./types";
import {
  acceptedRepairs, assertEditorialReviewCoverage, assertSavedEditorialFreezeJudgmentIntegrity,
  assertSavedEditorialJudgmentIntegrity, repairPrompt,
} from "./editorial-board";

/** The same local gate used by the autopilot. Only a genuinely invalid,
 * unfinished active checkpoint can be rescued; a healthy review must resume.
 */
export function editorialRecoveryProblem(book: BookProject): string | undefined {
  const cycle = book.editorialCycle;
  if (book.phase !== "chapterReview" || !cycle ||
      !["review", "adjudicate", "repair", "summary"].includes(cycle.stage)) return;
  try {
    if (cycle.stage === "repair") {
      if (!cycle.judgment || cycle.judgment.verdict !== "repair")
        throw new Error("Checkpoint di remediation senza giudizio di correzione valido.");
      if (!Number.isSafeInteger(cycle.repairCursor) || cycle.repairCursor < 0)
        throw new Error("Checkpoint di remediation con cursore non valido.");
      assertSavedEditorialJudgmentIntegrity(cycle);
      const scenes = [...new Set(acceptedRepairs(cycle).map(fix => fix.sceneId))];
      const nextSceneId = scenes[cycle.repairCursor];
      if (!nextSceneId)
        throw new Error("Checkpoint di remediation senza prossima scena valida.");
      // Reports must match the source prose BEFORE the first rewrite. Later
      // the rewritten scenes intentionally have different text stamps: only
      // the same live repairPrompt guard used by the runner can decide
      // whether the next pending correction is still safe to apply.
      if (cycle.repairCursor === 0)
        assertEditorialReviewCoverage(book, cycle, true);
      repairPrompt(book, cycle, nextSceneId);
    } else if (cycle.stage === "summary" && cycle.forcedClose) {
      // Closed by an explicit author/director decision: there is no verification round to re-check.
      return;
    } else {
      assertEditorialReviewCoverage(book, cycle, cycle.stage !== "review");
      if (cycle.stage === "summary")
        assertSavedEditorialFreezeJudgmentIntegrity(book, cycle);
    }
    return;
  } catch (error) {
    return error instanceof Error ? error.message : "Checkpoint editoriale non valido.";
  }
}
