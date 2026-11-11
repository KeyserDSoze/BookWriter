import type { AppSettings, EndpointProfile } from "../domain/types";

/** The caller holds the endpoint object from the exact click. App settings
 * updates always replace affected profile objects, including manual model
 * edits and a saved/encrypted key. A matching ID alone is never enough:
 * external /models responses cannot overwrite newer manual configuration.
 *
 * Draft key strings are compared only in transient memory, never persisted,
 * fingerprinted, logged or sent to any other endpoint.
 */
export function isCurrentModelInventoryRequest(
  originalEndpoint: EndpointProfile,
  settings: AppSettings,
  originalDraft: string,
  currentDraft: string,
  attempt: number,
  latestAttempt: number | undefined,
): boolean {
  return Number.isSafeInteger(attempt) && attempt > 0 &&
    latestAttempt === attempt &&
    originalDraft === currentDraft &&
    settings.endpoints.some(profile => profile === originalEndpoint);
}
