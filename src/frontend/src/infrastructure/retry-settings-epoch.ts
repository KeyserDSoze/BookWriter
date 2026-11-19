import { DEFAULT_SETTINGS, type AppSettings } from "@engine/domain/types";
import { sameRetrySettings } from "@engine/core/retry-policy";

export const RETRY_SETTINGS_EPOCH_KEY = "retry-settings-epoch:v1";

/** Use the same IndexedDB transaction as the settings write. A subsequent undo
 * creates another epoch; it cannot re-authorize a wait under the old one. */
export async function rotateRetrySettingsEpoch(
  meta: { put(value: string, key: string): Promise<unknown> }, previous: AppSettings | undefined, next: AppSettings,
): Promise<void> {
  if (!sameRetrySettings(previous ?? DEFAULT_SETTINGS, next)) await meta.put(crypto.randomUUID(), RETRY_SETTINGS_EPOCH_KEY);
}
