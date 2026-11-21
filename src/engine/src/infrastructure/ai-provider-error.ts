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
    afterReasoning = false,
  ) {
    super(afterReasoning
      ? "Il modello ha terminato dopo il ragionamento senza scrivere la risposta: nessun testo applicato. Se si ripete, abbassa il thinking per questo compito."
      : "Il provider AI ha risposto senza testo utilizzabile.", endpointId, modelId, usage);
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
/** The forced submit function was called with `{}`: no result, but a new attempt usually delivers it. */
export class EmptyToolCallError extends ProviderContentError {
  constructor(
    endpointId: string, modelId: string,
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown },
  ) {
    super("Il modello ha chiamato la funzione di consegna con argomenti vuoti (\"{}\"): nessun risultato. Nessuna modifica applicata. Se si ripete, imposta «Output strutturato» su Disattivato per questo endpoint o togli il tag «tools» a questo modello.",
      endpointId, modelId, usage);
    this.name = "EmptyToolCallError";
  }
}
/** The model stopped on its length/context limit: the text is cut mid-way and must never become canon. */
export class TruncatedProviderContentError extends ProviderContentError {
  constructor(
    endpointId: string, modelId: string,
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown },
    duringReasoning = false,
  ) {
    super(duringReasoning
      ? "Il modello ha esaurito il limite di output o di contesto mentre ragionava, prima di scrivere la risposta: nessun testo applicato. Il ragionamento consuma lo stesso limite della risposta: abbassa il thinking per questo compito, alza i token di output del modello nelle Impostazioni e il «Max output» sulla piattaforma, oppure aumenta il contesto (LM Studio)."
      : "Risposta troncata: il modello si è fermato per limite di lunghezza o di contesto. Nessun testo applicato. Con un modello che ragiona, il ragionamento consuma lo stesso limite di output della risposta: alza il «Max output» sulla piattaforma e i token di output del modello nelle Impostazioni, abbassa il thinking, oppure aumenta il contesto (LM Studio) o riduci il capitolo.",
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
