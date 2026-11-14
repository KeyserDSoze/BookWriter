import { cloudSettingsSignature } from "../../domain/cloud-profile";
import type { AppSettings } from "../../domain/types";

/** Marks the cloud profile as having local changes. It runs INSIDE the same
 * IndexedDB transaction that stores the settings, so an edit can never be saved
 * without the marker. It must not import db.ts (db.ts imports this module). */
export const CLOUD_LINK_KEY = "cloud-link:v1";
interface MetaStore { get(key: string): Promise<unknown>; put(value: unknown, key: string): Promise<unknown> }

export async function markCloudProfileDirty(
  meta: MetaStore, previous: AppSettings | undefined, next: AppSettings,
): Promise<void> {
  const link = await meta.get(CLOUD_LINK_KEY) as { dirtyProfile?: boolean } | undefined;
  if (!link || link.dirtyProfile) return;
  if (previous && cloudSettingsSignature(previous) === cloudSettingsSignature(next)) return;
  await meta.put({ ...link, dirtyProfile: true }, CLOUD_LINK_KEY);
}
