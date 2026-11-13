import type { Activity } from "../domain/types";
import { cachedTokensFromUsage, validTokenCount } from "../domain/ai-usage";

/** Valid HTTP 2xx + decoded JSON but unusable message content. Only public
 * route identifiers and sanitized provider token counts survive. Never store
 * response bodies, prompt text, remote error strings or API credentials. */
export class ProviderContentError extends Error {
  readonly endpointId: string;
  readonly modelId: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;

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
    this.cachedInputTokens = cachedTokensFromUsage(usage);
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
/** The model stopped on its length/context limit: the text is cut mid-way and must never become canon. */
export class TruncatedProviderContentError extends ProviderContentError {
  constructor(
    endpointId: string, modelId: string,
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown },
  ) {
    super("Risposta troncata: il modello si è fermato per limite di lunghezza o di contesto. Nessun testo applicato. Aumenta la lunghezza del contesto del modello (LM Studio), abbassa il thinking o riduci il capitolo.",
      endpointId, modelId, usage);
    this.name = "TruncatedProviderContentError";
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
  activity.cachedInputTokens = error.cachedInputTokens;
}
