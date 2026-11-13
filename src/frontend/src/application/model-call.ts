import type { Activity, AppSettings, BookProject, EndpointProfile, TaskKind, TaskReasoning } from "../domain/types";
import { callModel, type ModelAnswer } from "../infrastructure/ai";
import { endpointStreamMode } from "../infrastructure/ai-stream";
import type { AiStreamDelta } from "../infrastructure/ai-stream";
import type { AiTransportStats, LmStudioPhase } from "../infrastructure/lmstudio-native";
import { addAiDelta, markAiHeader, markAiTransport, markNativePhase, saveAiTrace, startLiveAi,
} from "../infrastructure/ai-observability";
import { keepObservedUsageOnRejectedReply } from "../infrastructure/ai-provider-error";
import { listActivities, saveActivity } from "../infrastructure/db";
import { preflightBookAiBudget, snapshotPriceRate } from "../domain/ai-budget";
import { assertPromptFitsLoadedContext } from "./context-guard";
import type { WriterGuard } from "./writer-guard";

export interface LaunchInput {
  book: BookProject; settings: AppSettings; runId: string; guard: WriterGuard; signal: AbortSignal;
  kind: TaskKind; title: string; systemPrompt: string; userPrompt: string;
  started: Activity;
  assignment: { endpointId: string; modelId: string };
  configuredEndpoint?: EndpointProfile;
  requestedEffort?: TaskReasoning;
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
  await guard.assertActive(); // Do not charge credits without verified ownership.
  const preflight = preflightBookAiBudget(
    book, settings, await listActivities(book.id), i.kind, i.systemPrompt, i.userPrompt, i.runId,
  );
  await guard.assertActive();
  if (signal.aborted) throw new DOMException("Interrotto prima della chiamata AI.", "AbortError");
  if (i.configuredEndpoint)
    await assertPromptFitsLoadedContext(i.configuredEndpoint, assignment.modelId, i.title,
      i.systemPrompt, i.userPrompt, preflight?.reservedOutputTokens, signal);
  // Store the author's validated price BEFORE the provider call.
  // The quote belongs to this attempt even if its output is rejected.
  const quote = snapshotPriceRate(settings, assignment.endpointId, assignment.modelId);
  if (quote) started.priceRateSnapshot = quote;
  // Persist the request attempt BEFORE network fetch: an interrupted browser
  // must not misrepresent a possibly billed call as a free operation.
  if (settings.inspectAiRequests) {
    // Explicitly local, sensitive opt-in. Never stored in Activity
    // or exported to ZIP, GitHub or sync.
    await saveAiTrace({
      activityId: started.id, bookId: book.id, createdAt: started.createdAt,
      endpointId: assignment.endpointId, modelId: assignment.modelId,
      systemPrompt: i.systemPrompt, userPrompt: i.userPrompt, truncated: false,
    });
  }
  started.aiRequested = true;
  await saveActivity(started);
  if (i.live) startLiveFor(i);
  const inspectStream = settings.inspectAiRequests === true ||
    (i.configuredEndpoint !== undefined && endpointStreamMode(i.configuredEndpoint) === "sse") ||
    i.configuredEndpoint?.apiProtocol === "lmstudio_native";
  const promise = callModel(i.kind, i.systemPrompt, i.userPrompt, settings, book, signal,
    preflight || inspectStream ? {
      ...(preflight ? { maxOutputTokens: preflight.reservedOutputTokens } : {}),
      ...(inspectStream ? {
        onHeaders: () => markAiHeader(started.id),
        onProgress: (delta: AiStreamDelta) => addAiDelta(started.id, delta),
        onTransport: (stats: AiTransportStats) => markAiTransport(started.id, stats),
        onPhase: (phase: LmStudioPhase) => markNativePhase(started.id, phase),
      } : {}),
    } : undefined);
  return { promise };
}

export function startLiveFor(i: Pick<LaunchInput, "settings" | "started" | "title" | "assignment" |
  "requestedEffort" | "configuredEndpoint" | "book">): void {
  startLiveAi({
    activityId: i.started.id, bookId: i.book.id, title: i.title,
    endpointId: i.assignment.endpointId, modelId: i.assignment.modelId,
    inspect: i.settings.inspectAiRequests === true,
    ...(i.requestedEffort === undefined ? {} : { requestedReasoning: i.requestedEffort }),
    streamDeadlineSeconds: i.configuredEndpoint?.streamTimeoutSeconds ?? 600,
  });
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
      await saveActivity(started);
    }
  }
}
