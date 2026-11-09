import type { Activity } from "../domain/types";
import { validTokenCount } from "../domain/ai-usage";

/** Only the model/endpoint and provider-reported nonnegative integer counts
 * survive a successful HTTP+JSON response that contains no usable text.
 * Never put remote content, auth headers or credentials on this error. */
export class EmptyProviderContentError extends Error {
  readonly endpointId: string;
  readonly modelId: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;

  constructor(
    endpointId: string, modelId: string,
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown },
  ) {
    super("Il provider AI ha risposto senza testo utilizzabile.");
    this.name = "EmptyProviderContentError";
    this.endpointId = endpointId;
    this.modelId = modelId;
    this.inputTokens = validTokenCount(usage?.prompt_tokens);
    this.outputTokens = validTokenCount(usage?.completion_tokens);
  }
}

/** Call only on the persisted Activity's failure path: an empty completion
 * must never become a successful editorial report or a proposed scene. */
export function keepObservedUsageOnEmptyReply(activity: Activity, error: unknown): void {
  if (!(error instanceof EmptyProviderContentError)) return;
  activity.endpointId = error.endpointId;
  activity.modelId = error.modelId;
  activity.inputTokens = error.inputTokens;
  activity.outputTokens = error.outputTokens;
}
