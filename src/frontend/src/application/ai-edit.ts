import type { Activity, BookProject } from "../domain/types";
import { routeFor } from "../domain/types";
import { currentStamp as currentStampOf } from "../domain/book-edits";
import { aiEditCalls, aiEditSystem, applyAiEditChange, type AiEditChange, type AiEditProposal, type AiEditRequest } from "../domain/ai-edit";
import { taskReasoningChoice } from "../domain/task-reasoning";
import { keepObservedUsageOnRejectedReply } from "../infrastructure/ai-provider-error";
import { finishLiveAi } from "../infrastructure/ai-observability";
import { getBook, loadSettings, saveActivity } from "../infrastructure/db";
import { launchModelCall } from "./model-call";
import { applyAiEdit } from "./book-editing";
import type { WriterGuard } from "./writer-guard";

const aborted = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/** Ask the AI for a new version of one element. Each call is audited and budget-checked
 * like the autopilot's; the book is NOT changed: the author accepts or discards each
 * change after the comparison. Allowed while the autopilot runs, except with an
 * active AI budget (two concurrent calls could pass the same preflight). */
export async function proposeAiEdit(bookId: string, request: AiEditRequest, instruction: string, controller: AbortController,
  onProgress?: (done: number, total: number) => void): Promise<AiEditProposal> {
  const book = await getBook(bookId);
  if (!book) throw new Error("Libro non trovato.");
  if (book.aiBudget?.enabled && book.status === "running")
    throw new Error("Con un budget AI attivo metti in pausa l'autopilot prima di chiedere una modifica all'AI.");
  const calls = aiEditCalls(book, request, instruction);
  const settings = await loadSettings();
  const runId = crypto.randomUUID();
  const guard: WriterGuard = { assertActive: async () => { if (controller.signal.aborted) throw new DOMException("Interrotto.", "AbortError"); }, failure: () => undefined };
  const system = aiEditSystem(book);
  const assignment = routeFor("revision", settings, book);
  const configuredEndpoint = settings.endpoints.find(e => e.id === assignment.endpointId);
  const requestedEffort = configuredEndpoint ? taskReasoningChoice("revision", settings, book, configuredEndpoint, assignment.modelId) : undefined;
  const clean = instruction.normalize("NFC").trim();
  const proposal: AiEditProposal = { id: crypto.randomUUID(), request, instruction: clean, createdAt: new Date().toISOString(),
    label: calls.length === 1 ? calls[0]!.label : `${calls.length} scene del capitolo`, changes: [], notes: [] };
  for (const [index, call] of calls.entries()) {
    onProgress?.(index, calls.length);
    const current = await getBook(bookId);
    if (!current) throw new Error("Libro non trovato.");
    const started: Activity = {
      id: crypto.randomUUID(), bookId, runId, phase: current.phase, title: "Modifica AI proposta: " + call.label,
      reason: "Richiesta dell'autore («Modifica solo questo»): «" + clean.slice(0, 200) + "»",
      nextStep: "Confronto prima/dopo: l'autore decide se applicarla. Nessuna review automatica.",
      status: "running", createdAt: new Date().toISOString(), endpointId: assignment.endpointId, modelId: assignment.modelId, aiRequested: false,
      ...(requestedEffort === undefined ? {} : { requestedReasoningEffort: requestedEffort }),
    };
    await saveActivity(started);
    try {
      const { promise } = await launchModelCall({ book: current, settings, runId, guard, signal: controller.signal, kind: "revision", title: started.title,
        systemPrompt: system, userPrompt: call.prompt, started, assignment, configuredEndpoint, persisted: true,
        live: current.status !== "running", ...(requestedEffort === undefined ? {} : { requestedEffort }) });
      const answer = await promise;
      started.endpointId = answer.endpointId; started.modelId = answer.modelId;
      started.inputTokens = answer.inputTokens; started.outputTokens = answer.outputTokens; started.cachedInputTokens = answer.cachedInputTokens;
      const latest = (await getBook(bookId)) ?? current;
      // Built and validated on the content of NOW; accepting is refused if it changes again.
      const parsed = call.parse(answer.text, latest);
      started.status = "succeeded"; started.endedAt = new Date().toISOString(); started.output = answer.text;
      started.summary = parsed ? "Proposta pronta: " + call.label : "Nessuna modifica necessaria: " + call.label;
      await saveActivity(started);
      finishLiveAi(started.id, "completata");
      if (parsed) proposal.changes.push({ key: call.key, target: call.target, label: call.label, baseStamp: currentStampOf(latest, call.target),
        before: parsed.before, after: parsed.after, patch: parsed.patch, status: "proposed", activityId: started.id });
      else proposal.notes.push(call.label + ": nessuna modifica necessaria.");
    } catch (error) {
      keepObservedUsageOnRejectedReply(started, error);
      const stop = aborted(error) || controller.signal.aborted;
      started.status = stop ? "cancelled" : "failed";
      started.error = (error instanceof Error ? error.message : "Proposta non riuscita.").slice(0, 2000);
      started.endedAt = new Date().toISOString();
      await saveActivity(started);
      finishLiveAi(started.id, stop ? "interrotta" : "rifiutata", started.error);
      if (stop || calls.length === 1) throw error;
      proposal.notes.push(call.label + ": " + started.error.slice(0, 300));
    }
  }
  onProgress?.(calls.length, calls.length);
  return proposal;
}

/** Apply one change the author accepted. Refused if the element changed meanwhile. */
export async function acceptAiEditChange(bookId: string, proposal: AiEditProposal, change: AiEditChange): Promise<BookProject> {
  if (change.status !== "proposed") throw new Error("Questa proposta è già stata decisa.");
  const { book } = await applyAiEdit(bookId, { target: change.target, stamp: change.baseStamp, label: change.label },
    proposal.instruction, change.activityId, (current, ctx) => applyAiEditChange(current, change, ctx));
  return book;
}
