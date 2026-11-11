import type { AppSettings, EndpointProfile, ModelCapability, ModelRoute, AuxiliaryModelCapability } from "./types";

/** Only advisory author labels, never derived from model ID or GET /models. */
export const MODEL_CAPABILITIES = ["chat", "tools", "embedding", "voice"] as const;
export const AUXILIARY_MODEL_CAPABILITIES = ["tools", "embedding", "voice"] as const;
export const MODEL_CAPABILITY_LABELS: Record<ModelCapability, string> = {
  chat: "Chat / scrittura",
  tools: "Tool calling",
  embedding: "Embedding",
  voice: "Voce",
};

export function declaredModelCapabilities(endpoint: EndpointProfile, modelId: string): ModelCapability[] {
  const raw = endpoint.modelCapabilities?.[modelId];
  return Array.isArray(raw) ? raw : [];
}

/** Functional update: do not mutate the endpoint or its current record. */
export function withModelCapability(
  endpoint: EndpointProfile, modelId: string, capability: ModelCapability, enabled: boolean,
): EndpointProfile {
  const tags: Record<string, ModelCapability[]> = { ...endpoint.modelCapabilities };
  const current = declaredModelCapabilities(endpoint, modelId);
  const next = enabled
    ? MODEL_CAPABILITIES.filter(tag => tag === capability || current.includes(tag))
    : current.filter(tag => tag !== capability);
  if (next.length) tags[modelId] = [...next];
  else delete tags[modelId];
  return { ...endpoint, modelCapabilities: Object.keys(tags).length ? tags : undefined };
}

export function sameModelRoute(a: ModelRoute | undefined, b: ModelRoute): boolean {
  return a?.endpointId === b.endpointId && a?.modelId === b.modelId;
}

function assertModelTagRecord(endpoint: EndpointProfile): void {
  const tags: unknown = endpoint.modelCapabilities;
  if (tags === undefined) return;
  if (!tags || typeof tags !== "object" || Array.isArray(tags))
    throw new Error("Tag dei modelli non validi: correggi la configurazione.");
  const entries = Object.entries(tags);
  if (entries.length > 2_000) throw new Error("Troppi tag dei modelli.");
  for (const [id, roles] of entries) {
    if (!id || id.length > 256 || id !== id.trim() ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(id) ||
      ["__proto__", "constructor", "prototype"].includes(id) ||
      !Array.isArray(roles) || roles.length < 1 || roles.length > MODEL_CAPABILITIES.length ||
      roles.some(role => !MODEL_CAPABILITIES.includes(role as ModelCapability)) ||
      new Set(roles).size !== roles.length)
      throw new Error("Tag dei modelli non validi: correggi la configurazione.");
  }
}

/** Chat remains the only functional model role in the existing writing autopilot.
 * Legacy models without declared tags retain their previous behavior.
 */
export function assertChatModelCapability(endpoint: EndpointProfile, modelId: string): void {
  assertModelTagRecord(endpoint);
  if (Object.prototype.hasOwnProperty.call(endpoint.modelCapabilities ?? {}, modelId) &&
      !declaredModelCapabilities(endpoint, modelId).includes("chat"))
    throw new Error("Il modello selezionato non è contrassegnato per Chat / scrittura. Verifica i tag e il router nelle Impostazioni.");
}

/** Verify all configuration before Save or outbound requests; auxiliary defaults
 * are metadata only and must not be interpreted as callable APIs. */
export function assertModelCapabilitySettings(settings: AppSettings): void {
  for (const endpoint of settings.endpoints) assertModelTagRecord(endpoint);
  const routes: unknown = settings.capabilityRoutes;
  if (routes !== undefined) {
    if (!routes || typeof routes !== "object" || Array.isArray(routes))
      throw new Error("Predefiniti dei modelli non validi.");
    for (const [role, route] of Object.entries(routes)) {
      if (!AUXILIARY_MODEL_CAPABILITIES.includes(role as AuxiliaryModelCapability) ||
          !route || typeof route !== "object" || Array.isArray(route))
        throw new Error("Predefiniti dei modelli non validi.");
      const candidate = route as ModelRoute;
      const endpoint = settings.endpoints.find(e => e.id === candidate.endpointId);
      if (!endpoint || !candidate.modelId ||
          !declaredModelCapabilities(endpoint, candidate.modelId).includes(role as ModelCapability))
        throw new Error("Un modello predefinito non possiede il tag richiesto. Verifica le assegnazioni.");
    }
  }
  const defaultChat = settings.endpoints.find(e => e.id === settings.defaultRoute.endpointId);
  if (defaultChat && settings.defaultRoute.modelId)
    assertChatModelCapability(defaultChat, settings.defaultRoute.modelId);
}
