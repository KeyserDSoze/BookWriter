import type { Activity, BookProject } from "../domain/types";
import { routeFor } from "../domain/types";
import { preflightBookAiBudget, snapshotPriceRate } from "../domain/ai-budget";
import {
  assertDraftMatchesReview, buildSceneMergePrompt,
  validateSceneProposal, type SceneMergeDraft,
} from "../domain/scene-merge";
import type { ConflictReview } from "../infrastructure/conflict-recovery";
import { callModel } from "../infrastructure/ai";
import { keepObservedUsageOnRejectedReply } from "../infrastructure/ai-provider-error";
import { confirmGitHubHead, RemoteConflict } from "../infrastructure/github-sync";
import { getBook, getDb, listActivities, loadSettings, saveActivity } from "../infrastructure/db";
import { withWriterGuard } from "./writer-guard";

export async function listSceneMergeDrafts(
  review: ConflictReview, chapterId: string, sceneId: string,
): Promise<SceneMergeDraft[]> {
  const db = await getDb();
  const all = await db.getAll("mergeDrafts") as SceneMergeDraft[];
  return all.filter(d => d.bookId === review.bookId &&
    d.chapterId === chapterId && d.sceneId === sceneId &&
    d.localRevision === review.localUpdatedAt && d.remoteHead === review.headSha)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function getSceneMergeDraft(id: string): Promise<SceneMergeDraft | undefined> {
  return (await (await getDb()).get("mergeDrafts", id)) as SceneMergeDraft | undefined;
}
async function assertReviewFresh(review: ConflictReview): Promise<BookProject> {
  const local = await getBook(review.bookId);
  if (!local?.remote || local.status === "running" ||
      local.updatedAt !== review.localUpdatedAt ||
      local.remote.owner !== review.local.remote?.owner ||
      local.remote.repository !== review.local.remote?.repository ||
      local.remote.branch !== review.local.remote?.branch ||
      local.remote.lastSyncedCommit !== review.localSyncedCommit)
    throw new RemoteConflict("Il libro o la repository sono cambiati. Ricarica il confronto prima di generare la bozza.");
  return local;
}
async function persistDraft(review: ConflictReview, draft: SceneMergeDraft, attempted?: Activity): Promise<SceneMergeDraft> {
  assertDraftMatchesReview(draft, review);
  validateSceneProposal(draft.proposedText);
  const book = await assertReviewFresh(review);
  if (!book.remote) throw new RemoteConflict("Repository non più collegata.");
  await confirmGitHubHead(book.remote, review.headSha);
  const db = await getDb();
  const tx = db.transaction(["books", "mergeDrafts", "activities"], "readwrite");
  const actual = await tx.objectStore("books").get(review.bookId) as BookProject | undefined;
  if (!actual?.remote || actual.status === "running" ||
      actual.updatedAt !== review.localUpdatedAt ||
      actual.remote.lastSyncedCommit !== review.localSyncedCommit) {
    await tx.done;
    throw new RemoteConflict("Il libro locale è cambiato. Proposta non salvata.");
  }
  await tx.objectStore("mergeDrafts").put(draft, draft.id);
  const now = new Date().toISOString();
  const audit: Activity = {
    id: attempted?.id ?? crypto.randomUUID(), bookId: review.bookId,
    runId: attempted?.runId ?? crypto.randomUUID(),
    phase: "revision", status: "succeeded",
    title: draft.source === "ai" ? "Bozza AI di fusione scena" : "Bozza manuale di fusione scena",
    reason: "Confronto di due versioni della stessa scena, senza consolidamento automatico.",
    nextStep: "Apri Archivio, confronta la bozza e approva o rifiuta la proposta.",
    summary: "Bozza " + draft.id.slice(0, 8) + " salvata solo localmente; nessuna modifica al canon.",
    modelId: draft.modelId, endpointId: draft.endpointId,
    inputTokens: draft.inputTokens, outputTokens: draft.outputTokens,
    // The succeeded audit overwrites the pre-fetch Activity with the SAME ID.
    // Preserve its verified historical quote: otherwise successful AI merges
    // silently become legacy rows repriced with today's Settings tariff.
    ...(draft.source === "ai" && attempted?.priceRateSnapshot
      ? { priceRateSnapshot: { ...attempted.priceRateSnapshot } } : {}),
    aiRequested: draft.source === "ai" ? attempted?.aiRequested : false,
    createdAt: attempted?.createdAt ?? now, endedAt: now,
  };
  await tx.objectStore("activities").put(audit, audit.id);
  await tx.done;
  return draft;
}

/** A proposal always remains a non-canon draft, even when the model succeeds. */
export async function generateSceneMergeDraft(
  review: ConflictReview, chapterId: string, sceneId: string,
  instruction: string, controller: AbortController,
): Promise<SceneMergeDraft> {
  const prompt = buildSceneMergePrompt(review, chapterId, sceneId, instruction);
  await assertReviewFresh(review);
  return withWriterGuard(review.bookId, crypto.randomUUID(), controller, async guard => {
    await guard.assertActive();
    const current = await assertReviewFresh(review);
    if (!current.remote) throw new RemoteConflict("Repository non configurata.");
    await confirmGitHubHead(current.remote, review.headSha);
    const settings = await loadSettings();
    const preflight = preflightBookAiBudget(
      current, settings, await listActivities(current.id), "merge", prompt.system, prompt.prompt,
    );
    await guard.assertActive();
    if (controller.signal.aborted) throw new DOMException("Interrotto prima del provider.", "AbortError");
    const route = routeFor("merge", settings, current);
    const quote = snapshotPriceRate(settings, route.endpointId, route.modelId);
    const attempted: Activity = {
      id: crypto.randomUUID(), bookId: review.bookId, runId: crypto.randomUUID(),
      phase: "revision", title: "Bozza AI di fusione scena",
      status: "running", reason: "Confronto facoltativo di due versioni della scena.",
      nextStep: "Valuta la proposta prima dell'applicazione al canon.",
      endpointId: route.endpointId, modelId: route.modelId, aiRequested: true,
      ...(quote ? { priceRateSnapshot: quote } : {}),
      createdAt: new Date().toISOString(),
    };
    // Persist a potentially billable call before network I/O, even on timeout.
    await saveActivity(attempted);
    try {
      const response = await callModel("merge", prompt.system, prompt.prompt,
        settings, current, controller.signal,
        preflight ? { maxOutputTokens: preflight.reservedOutputTokens } : undefined);
      // A valid provider usage report belongs to the request Activity even if
      // the proposed scene cannot become a draft or the lease is lost.
      attempted.endpointId = response.endpointId;
      attempted.modelId = response.modelId;
      attempted.inputTokens = response.inputTokens;
      attempted.outputTokens = response.outputTokens;
      await guard.assertActive();
      const text = validateSceneProposal(response.text);
      const original = review.local.chapters.find(ch => ch.id === chapterId)?.scenes.find(s => s.id === sceneId);
      const remote = review.remote.chapters.find(ch => ch.id === chapterId)?.scenes.find(s => s.id === sceneId);
      if (!original || !remote) throw new Error("Scena non trovata durante la generazione.");
      const draft: SceneMergeDraft = {
        id: crypto.randomUUID(), bookId: review.bookId,
        chapterId, sceneId,
        localRevision: review.localUpdatedAt, remoteHead: review.headSha,
        localText: original.text, remoteText: remote.text, proposedText: text,
        instruction, status: "proposed", source: "ai",
        createdAt: new Date().toISOString(),
        endpointId: response.endpointId, modelId: response.modelId,
        inputTokens: response.inputTokens, outputTokens: response.outputTokens,
      };
      await guard.assertActive();
      return await persistDraft(review, draft, attempted);
    } catch (error) {
      keepObservedUsageOnRejectedReply(attempted, error);
      await saveActivity({
        ...attempted, status: controller.signal.aborted ? "cancelled" : "failed",
        endedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Risposta non confermata del provider.",
      });
      throw error;
    }
  });
}

export async function saveManualSceneMergeDraft(
  review: ConflictReview, chapterId: string, sceneId: string, text: string,
): Promise<SceneMergeDraft> {
  // Manual drafts must still serialize with any active AI/autosync editing.
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks non disponibile per il salvataggio delle bozze.");
  return locks.request("bookwriter:writer:" + review.bookId, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Un'altra scheda sta scrivendo il libro.");
    const original = review.local.chapters.find(ch => ch.id === chapterId)?.scenes.find(s => s.id === sceneId);
    const remote = review.remote.chapters.find(ch => ch.id === chapterId)?.scenes.find(s => s.id === sceneId);
    if (!original || !remote) throw new Error("La scena richiede entrambe le versioni.");
    return persistDraft(review, {
      id: crypto.randomUUID(), bookId: review.bookId, chapterId, sceneId,
      localRevision: review.localUpdatedAt, remoteHead: review.headSha,
      localText: original.text, remoteText: remote.text,
      proposedText: validateSceneProposal(text), instruction: "",
      status: "proposed", source: "manual", createdAt: new Date().toISOString(),
    });
  });
}
export async function rejectSceneMergeDraft(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("mergeDrafts", "readwrite");
  const draft = await tx.store.get(id) as SceneMergeDraft | undefined;
  if (!draft || draft.status !== "proposed") {
    await tx.done; throw new Error("Bozza assente o già conclusa.");
  }
  await tx.store.put({ ...draft, status: "rejected" }, id);
  await tx.done;
}
