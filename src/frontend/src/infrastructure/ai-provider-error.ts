import type { Activity } from "../domain/types";
import { validTokenCount } from "../domain/ai-usage";

/** Valid HTTP 2xx + decoded JSON but unusable message content. Only public
 * route identifiers and sanitized provider token counts survive. Never store
 * response bodies, prompt text, remote error strings or API credentials. */
export class ProviderContentError extends Error {
  readonly endpointId: string;
  readonly modelId: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;

  constructor(
    message: string, endpointId: string, modelId: string,
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown },
  ) {
    super(message);
    this.name = "ProviderContentError";
    this.endpointId = endpointId;
    this.modelId = modelId;
    this.inputTokens = validTokenCount(usage?.prompt_tokens);
    this.outputTokens = validTokenCount(usage?.completion_tokens);
  }
}
export class EmptyProviderContentError extends ProviderContentError {
  constructor(
    endpointId: string, modelId: string,
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown },
  ) {
    super("Il provider AI ha risposto senza testo utilizzabile.", endpointId, modelId, usage);
    this.name = "EmptyProviderContentError";
  }
}
export class MalformedProviderContentError extends ProviderContentError {
  constructor(
    endpointId: string, modelId: string,
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown },
  ) {
    super("Il provider AI ha restituito contenuto non testuale o malformato.",
      endpointId, modelId, usage);
    this.name = "MalformedProviderContentError";
  }
}

/** Call only on a persisted provider attempt's failure path. An unusable
 * completion never creates a successful editorial report or scene draft. */
export function keepObservedUsageOnRejectedReply(activity: Activity, error: unknown): void {
  if (!(error instanceof ProviderContentError)) return;
  activity.endpointId = error.endpointId;
  activity.modelId = error.modelId;
  activity.inputTokens = error.inputTokens;
  activity.outputTokens = error.outputTokens;
}
