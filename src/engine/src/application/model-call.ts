import type { Activity, AppSettings, BookProject, EndpointProfile, TaskKind, TaskReasoning } from "../domain/types";
import { callModel, type ModelAnswer } from "../infrastructure/ai";
import type { AiStreamDelta } from "../infrastructure/ai-stream";
import type { AiTransportStats, LmStudioPhase } from "../infrastructure/lmstudio-native";
import { addAiDelta, aiInspectionGeneration, currentTaskAi, finishLiveAi, markAiHeader, markAiTools, markAiTransport, markNativePhase,
  pruneAiTraces, receiveAiResponse, saveAiTrace, startLiveAi,
} from "../infrastructure/ai-observability";
import { aiTracePolicy } from "../domain/ai-trace-policy";
import { keepObservedUsageOnRejectedReply } from "../infrastructure/ai-provider-error";
import { listActivities, saveActivity } from "../core/store";
import { preflightBookAiBudget, snapshotPriceRate } from "../domain/ai-budget";
import { assertPromptFitsLoadedContext, assertPromptWithinDeclaredInput } from "./context-guard";
import { declaredModelTokenLimits, effectiveOutputTokens } from "../domain/model-token-limits";
import type { WriterGuard } from "./writer-guard";
import { SUBMIT_TOOL_NOTE, hasRequiredFields, toolOutputAvailable, type ToolSchema } from "../domain/structured-output";

export interface LaunchInput {
  book: BookProject; settings: AppSettings; runId: string; guard: WriterGuard; signal: AbortSignal;
  kind: TaskKind; title: string; systemPrompt: string; userPrompt: string;
  started: Activity;
  assignment: { endpointId: string; modelId: string };
  configuredEndpoint?: EndpointProfile;
  requestedEffort?: TaskReasoning;
  /** JSON schema of the result: a model with the tools role delivers it as function arguments. */
  expectsJson?: ToolSchema;
  /** The sequential path stores the attempt before the checks (an audit even if they reject it);
   * a parallel look-ahead stores it only once the request is certain to be sent. */
  persisted: boolean;
  /** Only the call being consumed drives the live panel. */
  live: boolean;
}

/** Everything between "attempt recorded" and "provider replied", shared by the sequential
 * path and the parallel reviewers. The returned promise is NOT awaited here. */
export async function launchModelCall(i: LaunchInput): Promise<{ promise: Promise<ModelAnswer> }> {
  const { book, settings, started, guard, signal, assignment } = i;
  const policy = aiTracePolicy(settings);
  // «Delete everything» during the call must stop this request from saving anything.
  const inspectionGeneration=aiInspectionGeneration();
  const inspectionCurrent=()=>aiInspectionGeneration()===inspectionGeneration;
  await guard.assertActive(); // Do not charge credits without verified ownership.
  // The function definition is sent with the prompt: it counts toward budget and declared input limits.
  const toolText = i.configuredEndpoint && hasRequiredFields(i.expectsJson) &&
    toolOutputAvailable(i.configuredEndpoint, assignment.modelId) ? SUBMIT_TOOL_NOTE + JSON.stringify(i.expectsJson) : "";
  const sizedUserPrompt = i.userPrompt + toolText;
  const preflight = preflightBookAiBudget(
    book, settings, await listActivities(book.id), i.kind, i.systemPrompt, sizedUserPrompt, i.runId,
  );
  await guard.assertActive();
  if (signal.aborted) throw new DOMException("Interrotto prima della chiamata AI.", "AbortError");
  const outputCap = effectiveOutputTokens(
    i.configuredEndpoint ? declaredModelTokenLimits(i.configuredEndpoint, assignment.modelId) : {},
    preflight?.reservedOutputTokens);
  if (i.configuredEndpoint) {
    assertPromptWithinDeclaredInput(i.configuredEndpoint, assignment.modelId, i.title, i.systemPrompt, sizedUserPrompt);
    await assertPromptFitsLoadedContext(i.configuredEndpoint, assignment.modelId, i.title,
      i.systemPrompt, sizedUserPrompt, outputCap, signal);
  }
  // Store the author's validated price BEFORE the provider call.
  // The quote belongs to this attempt even if its output is rejected.
  const quote = snapshotPriceRate(settings, assignment.endpointId, assignment.modelId);
  if (quote) started.priceRateSnapshot = quote;
  // Persist the request attempt BEFORE network fetch: an interrupted browser
  // must not misrepresent a possibly billed call as a free operation.
  if (inspectionCurrent()) {
    // Local and sensitive: temporary by default (see aiTracePolicy). Never stored in
    // Activity or ZIP. Best effort: a full disk must never stop a task.
    await saveAiTrace({
      activityId: started.id, bookId: book.id, createdAt: started.createdAt,
      endpointId: assignment.endpointId, modelId: assignment.modelId,
      systemPrompt: i.systemPrompt, userPrompt: i.userPrompt, truncated: false,
      kept: policy.keepForever,
    },inspectionCurrent).catch(()=>undefined);
  }
  started.aiRequested = true;
  await saveActivity(started);
  // Revocation/ownership may change while trace and attempt are being stored.
  // Never let those awaits open a path from a cancelled retry to the network.
  await guard.assertActive();
  if (signal.aborted) throw new DOMException("Interrotto prima della chiamata AI.", "AbortError");
  startLiveFor(i,i.live);
  const provider = callModel(i.kind, i.systemPrompt, i.userPrompt, settings, book, signal, {
    beforeRequest: () => guard.assertActive(),
    ...(outputCap === undefined ? {} : { maxOutputTokens: outputCap }),
    ...(i.expectsJson ? { structuredJson: i.expectsJson } : {}),
    onHeaders: () => markAiHeader(started.id),
    onProgress: (delta: AiStreamDelta) => addAiDelta(started.id, delta),
    onTransport: (stats: AiTransportStats) => markAiTransport(started.id, stats),
    onTools: (requested: boolean) => markAiTools(started.id, requested),
    onPhase: (phase: LmStudioPhase) => markNativePhase(started.id, phase),
  });
  const retainReply=async(response?:string)=>{
    if(!inspectionCurrent())return;
    const request=currentTaskAi(book.id,started.id);
    // A failed/cancelled request can still have a useful partial reply. Keep it
    // private, never in Activity.output, and never mask the provider error/usage.
    await saveAiTrace({activityId:started.id,bookId:book.id,createdAt:started.createdAt,
      endpointId:assignment.endpointId,modelId:assignment.modelId,
      systemPrompt:i.systemPrompt,userPrompt:i.userPrompt,
      response:response??request?.textPreview,reasoning:request?.reasoningPreview,
      truncated:!!request&&(request.textCharacters>request.textPreview.length ||
        request.reasoningCharacters>request.reasoningPreview.length)&&request.previewClearedAt===undefined,
      kept:policy.keepForever,
    },inspectionCurrent).catch(()=>undefined);
    // Old temporary conversations go away as soon as a task is settled.
    await pruneAiTraces(policy).catch(()=>undefined);
  };
  const promise=provider.then(async answer=>{
    receiveAiResponse(started.id,answer.text);
    if(answer.delivery!==undefined)markAiTools(started.id,true,answer.delivery==="function");
    await retainReply(answer.text);
    return answer;
  },async(error:unknown)=>{
    await retainReply();
    throw error;
  });
  return { promise };
}

export function startLiveFor(i: Pick<LaunchInput, "started" | "title" | "assignment" |
  "requestedEffort" | "configuredEndpoint" | "book">,foreground=true): void {
  startLiveAi({
    activityId: i.started.id, bookId: i.book.id, title: i.title,
    endpointId: i.assignment.endpointId, modelId: i.assignment.modelId,
    ...(i.requestedEffort === undefined ? {} : { requestedReasoning: i.requestedEffort }),
    streamDeadlineSeconds: i.configuredEndpoint?.streamTimeoutSeconds ?? 600,
  },foreground);
}

export interface PooledCall {
  key: string; system: string; user: string;
  started: Activity; promise: Promise<ModelAnswer>; abort: AbortController;
}

/** Look-ahead reviewer calls, consumed strictly in order by the sequential commit loop. */
export class ReviewCallPool {
  private readonly entries = new Map<string, PooledCall>();
  private readonly retired: PooledCall[] = [];

  has(key: string): boolean { return this.entries.has(key); }
  get size(): number { return this.entries.size; }

  add(entry: PooledCall): void {
    // A rejection nobody awaits yet must not surface as an unhandled rejection.
    entry.promise.catch(() => undefined);
    this.entries.set(entry.key, entry);
  }

  /** Returns the call only if it was made with exactly the prompts now needed. */
  take(key: string, system: string, user: string): PooledCall | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.system === system && entry.user === user) return entry;
    entry.abort.abort();
    this.retired.push(entry);
    return undefined;
  }

  /** Never leave a possibly billed look-ahead call as "running": record it as not applied. */
  async drain(): Promise<void> {
    const all = [...this.entries.values(), ...this.retired];
    this.entries.clear();
    this.retired.length = 0;
    for (const entry of all) {
      entry.abort.abort();
      const settled = await entry.promise.then(answer => ({ answer }), (error: unknown) => ({ error }));
      const { started } = entry;
      if ("answer" in settled) {
        started.endpointId = settled.answer.endpointId;
        started.modelId = settled.answer.modelId;
        started.inputTokens = settled.answer.inputTokens;
        started.outputTokens = settled.answer.outputTokens;
        started.cachedInputTokens = settled.answer.cachedInputTokens;
      } else keepObservedUsageOnRejectedReply(started, settled.error);
      started.status = "cancelled";
      started.error = "Revisione in parallelo non applicata: la sessione si è fermata o il testo è cambiato prima di usarla.";
      started.endedAt = new Date().toISOString();
      finishLiveAi(started.id,"interrotta");
      await saveActivity(started);
    }
  }
}
