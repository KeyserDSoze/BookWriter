import type { EndpointProfile } from "../domain/types";
import { PromptExceedsContextError } from "./context-guard";

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

/** Pointless to repeat: the same request would fail the same way (credentials, setup, oversized prompt). */
const NEVER_RETRY = /HTTP (401|403|404)\b|Seleziona il modello|non configurato|non valido|chiave API|API key/i;
export function isAutoRetryable(error: unknown): boolean {
  if (error instanceof PromptExceedsContextError) return false;
  return !(error instanceof Error && NEVER_RETRY.test(error.message));
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
