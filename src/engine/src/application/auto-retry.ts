import type { EndpointProfile } from "../domain/types";
import { PromptExceedsContextError } from "./context-guard";
import { ProviderHeaderTimeoutError } from "../infrastructure/ai-header-timeout";
import { ProviderResponseReadError } from "../infrastructure/ai-completion-response";
import { EmptyProviderContentError, EmptyToolCallError, MalformedProviderContentError, TruncatedProviderContentError } from "../infrastructure/ai-provider-error";
import { ReplyRejectedError } from "./reply-rejected";

export const DEFAULT_AUTO_RETRIES = 2;
export const MAX_AUTO_RETRIES = 5;
/** Pause before a retry on an endpoint with a key (rate limits, overload). Mutable only for tests. */
export const AUTO_RETRY_BACKOFF = { baseMs: 5000 };

/** Opt-in per endpoint. The legacy `localAutoRetry` flag keeps meaning "on" for keyless local endpoints. */
export function endpointAutoRetry(endpoint: EndpointProfile | undefined): { enabled: boolean; max: number } {
  if (!endpoint) return { enabled: false, max: 0 };
  const enabled = endpoint.autoRetry ?? (endpoint.localAutoRetry === true && endpoint.authMode === "none");
  const wanted = endpoint.autoRetryMax;
  const max = Number.isSafeInteger(wanted) && wanted! >= 1 ? Math.min(wanted!, MAX_AUTO_RETRIES) : DEFAULT_AUTO_RETRIES;
  return { enabled, max };
}

const TRANSIENT_PROVIDER = /HTTP (408|429|5\d\d)\b|Impossibile contattare l'endpoint AI/i;
/** The model hit its own length/context ceiling: the same request ends the same way and is billed again. */
const DETERMINISTIC_LIMIT = /troppo grande|superato il limite|esaurito il limite|limite di lunghezza|Risposta troncata/i;
/** Fail closed: only known transient provider/transport failures and corrective rejections repeat.
 * A new, unclassified error (storage, CAS, authority, lease, budget, setup, editorial block) is never
 * permission to spend again. */
export function isAutoRetryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (error instanceof PromptExceedsContextError || error instanceof TruncatedProviderContentError) return false;
  if (error instanceof ReplyRejectedError || error instanceof ProviderHeaderTimeoutError) return true;
  if (!(error instanceof Error)) return false;
  if (DETERMINISTIC_LIMIT.test(error.message)) return false;
  if (error instanceof ProviderResponseReadError || error instanceof EmptyProviderContentError ||
      error instanceof MalformedProviderContentError || error instanceof EmptyToolCallError) return true;
  return TRANSIENT_PROVIDER.test(error.message);
}

/** Wait that ends early (without throwing) when the session is aborted. */
export function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}
