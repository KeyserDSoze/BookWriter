import type { EndpointProfile } from "../domain/types";
import { fetchLmStudioContext } from "../infrastructure/lmstudio-models";

/** Italian prose is ~3.5 characters per token for common tokenizers; 3.4 errs on the safe side. */
const CHARS_PER_TOKEN = 3.4;
/** Room reserved for the answer when no output cap is configured (answer plus some reasoning). */
const MIN_RESERVED_OUTPUT = 768;

export function estimatePromptTokens(system: string, prompt: string): number {
  return Math.ceil((system.length + prompt.length) / CHARS_PER_TOKEN);
}

export interface ContextVerdict { fits: boolean; promptTokens: number; contextTokens: number; maxTokens?: number }

export function judgePromptAgainstContext(
  system: string, prompt: string, maxOutputTokens: number | undefined,
  contextTokens: number, maxTokens?: number,
): ContextVerdict {
  const promptTokens = estimatePromptTokens(system, prompt);
  const needed = promptTokens + Math.max(maxOutputTokens ?? 0, MIN_RESERVED_OUTPUT);
  return { fits: needed <= contextTokens, promptTokens, contextTokens, ...(maxTokens === undefined ? {} : { maxTokens }) };
}

export class PromptExceedsContextError extends Error {
  constructor(message: string) { super(message); this.name = "PromptExceedsContextError"; }
}

/** Free LM Studio endpoints only: a prompt that cannot fit the loaded context would be cut or
 * rejected by the server after minutes of prefill. Unknown context (other servers, model not
 * loaded yet, server unreachable) means no guard. Throws before any request is billed or sent. */
export async function assertPromptFitsLoadedContext(
  endpoint: EndpointProfile, modelId: string, title: string,
  system: string, prompt: string, maxOutputTokens: number | undefined, signal: AbortSignal,
): Promise<void> {
  if (endpoint.authMode !== "none") return;
  const info = await fetchLmStudioContext(endpoint.baseUrl, modelId, signal);
  if (!info?.loaded) return;
  const verdict = judgePromptAgainstContext(system, prompt, maxOutputTokens, info.loaded, info.max);
  if (verdict.fits) return;
  const raise = info.max && info.max > info.loaded
    ? ` Aumenta «Context Length» del modello in LM Studio (supporta fino a ${info.max} token).`
    : " Riduci il capitolo o la scena.";
  throw new PromptExceedsContextError(`Il prompt di «${title}» (circa ${verdict.promptTokens} token) più lo spazio per la risposta supera il contesto caricato in LM Studio (${info.loaded} token): il server lo taglierebbe o lo rifiuterebbe.${raise} Nessuna richiesta è stata inviata.`);
}
