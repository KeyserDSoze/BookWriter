import type { ModelReasoningInfo, ReasoningLevel } from "../domain/types";
import { REASONING_LEVELS } from "../domain/model-reasoning";
import { normalizeEndpoint } from "./ai";

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 600_000;
const MAX_MODELS = 500;

const isLevel = (value: unknown): value is ReasoningLevel =>
  typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value);

/** Pure parser of LM Studio GET /api/v1/models. The reply is untrusted data. */
export function parseLmStudioReasoningCatalog(payload: unknown): Record<string, ModelReasoningInfo | null> | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) return undefined;
  const result: Record<string, ModelReasoningInfo | null> = {};
  for (const item of models.slice(0, MAX_MODELS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const model = item as { type?: unknown; key?: unknown; capabilities?: unknown };
    if (model.type !== "llm" || typeof model.key !== "string") continue;
    const key = model.key.trim();
    if (!key || key.length > 200 || key === "__proto__") continue;
    // No capabilities block = the server did not say anything: leave it unknown.
    if (!model.capabilities || typeof model.capabilities !== "object" || Array.isArray(model.capabilities)) continue;
    const reasoning = (model.capabilities as { reasoning?: unknown }).reasoning;
    const raw = reasoning && typeof reasoning === "object" && !Array.isArray(reasoning)
      ? reasoning as { allowed_options?: unknown; default?: unknown } : undefined;
    const options = raw && Array.isArray(raw.allowed_options)
      ? REASONING_LEVELS.filter(level => (raw.allowed_options as unknown[]).includes(level)) : [];
    result[key] = options.length
      ? { options, ...(isLevel(raw?.default) && options.includes(raw.default) ? { default: raw.default } : {}) }
      : null;
  }
  return Object.keys(result).length ? result : undefined;
}

/** Explicit, loopback-only read of the thinking levels each LM Studio model declares.
 * Returns undefined when the server is not LM Studio, unreachable or malformed: the
 * caller keeps the previous knowledge. No credentials, no redirects, bounded size. */
export async function fetchLmStudioReasoningCatalog(
  endpointUrl: string, signal?: AbortSignal,
): Promise<Record<string, ModelReasoningInfo | null> | undefined> {
  let target: string;
  try {
    const url = new URL(normalizeEndpoint(endpointUrl));
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) return undefined;
    target = `${url.origin}/api/v1/models`;
  } catch { return undefined; }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      method: "GET", mode: "cors", credentials: "omit", redirect: "error",
      referrerPolicy: "no-referrer", cache: "no-store", signal: controller.signal,
    });
    if (!response.ok || !response.body) return undefined;
    if (!/json/i.test(response.headers.get("content-type") ?? "")) { void response.body.cancel().catch(() => {}); return undefined; }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) { void reader.cancel().catch(() => {}); return undefined; }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseLmStudioReasoningCatalog(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { return undefined; }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
