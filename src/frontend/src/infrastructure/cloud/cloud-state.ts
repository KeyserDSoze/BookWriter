import { z } from "zod";
import { cleanDeviceName, type CloudDevice } from "@engine/domain/cloud-profile";
import type { EncryptedSecret } from "@engine/domain/types";
import { decryptLocal, encryptLocal } from "../crypto";
import { getDb } from "../db";
import { CLOUD_LINK_KEY } from "./cloud-dirty";
import type { CloudProvider } from "./types";

/** Local bookkeeping of the cloud link. Everything here lives in the IndexedDB
 * `meta` store of THIS browser and is never exported to ZIP, GitHub or the cloud
 * itself. Access tokens are never stored; only a Microsoft refresh token, encrypted
 * with the device key and valid for at most 24 hours. */
const DEVICE_KEY = "cloud-device:v1";
const CONFIG_KEY = "cloud-config:v1";
const SESSION_KEY = "cloud-session:v1";
export const MICROSOFT_REFRESH_LIFETIME_MS = 24 * 60 * 60 * 1000;

const deviceSchema = z.object({ id: z.string().uuid(), name: z.string().min(1).max(80) }).strict();
export async function getCloudDevice(): Promise<CloudDevice> {
  const db = await getDb();
  const stored = deviceSchema.safeParse(await db.get("meta", DEVICE_KEY));
  if (stored.success) return stored.data;
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const device: CloudDevice = { id: crypto.randomUUID(), name: cleanDeviceName(platform || "Dispositivo") };
  const tx = db.transaction("meta", "readwrite");
  // Two tabs opening together must end up with the same device id.
  const winner = deviceSchema.safeParse(await tx.store.get(DEVICE_KEY));
  if (winner.success) { await tx.done; return winner.data; }
  await tx.store.put(device, DEVICE_KEY);
  await tx.done;
  return device;
}
export async function renameCloudDevice(name: string): Promise<CloudDevice> {
  const device = { ...await getCloudDevice(), name: cleanDeviceName(name) };
  await (await getDb()).put("meta", device, DEVICE_KEY);
  return device;
}

export interface CloudConfig { googleClientId: string; microsoftClientId: string; microsoftTenant: string }
const configSchema = z.object({
  googleClientId: z.string().max(200).optional(), microsoftClientId: z.string().max(100).optional(),
  microsoftTenant: z.string().max(100).optional(),
}).strict();
/** Client IDs are public identifiers (they appear in every sign-in URL), not secrets.
 * The production build receives them from repository variables; an author can also
 * type them in the settings, which then take precedence on this device. */
export function buildTimeCloudConfig(): Partial<CloudConfig> {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  const clean = (value: string | undefined) => value?.trim() || undefined;
  return {
    googleClientId: clean(env.VITE_GOOGLE_CLIENT_ID), microsoftClientId: clean(env.VITE_MICROSOFT_CLIENT_ID),
    microsoftTenant: clean(env.VITE_MICROSOFT_TENANT),
  };
}
export async function loadCloudOverrides(): Promise<Partial<CloudConfig>> {
  const parsed = configSchema.safeParse(await (await getDb()).get("meta", CONFIG_KEY));
  return parsed.success ? parsed.data : {};
}
export async function loadCloudConfig(): Promise<CloudConfig> {
  const built = buildTimeCloudConfig(), local = await loadCloudOverrides();
  return {
    googleClientId: local.googleClientId || built.googleClientId || "",
    microsoftClientId: local.microsoftClientId || built.microsoftClientId || "",
    microsoftTenant: local.microsoftTenant || built.microsoftTenant || "common",
  };
}
export async function saveCloudOverrides(values: Partial<CloudConfig>): Promise<void> {
  const clean: Partial<CloudConfig> = {};
  for (const key of ["googleClientId", "microsoftClientId", "microsoftTenant"] as const) {
    const value = values[key]?.trim();
    if (value) clean[key] = value;
  }
  await (await getDb()).put("meta", configSchema.parse(clean), CONFIG_KEY);
}

const iso = z.string().max(40);
export const cloudLinkSchema = z.object({
  provider: z.enum(["google", "microsoft"]),
  accountId: z.string().min(1).max(300), accountLabel: z.string().min(1).max(320),
  /** Revision of the cloud profile this device last pulled or pushed (0 = never). */
  profileRevision: z.number().int().min(0),
  /** This device changed synchronised settings after the last pull/push. */
  dirtyProfile: z.boolean(),
  vaultMode: z.enum(["passphrase", "account"]).optional(),
  linkedAt: iso, lastProfileSyncAt: iso.optional(), lastLibrarySyncAt: iso.optional(),
  /** Keep the library index and a pending profile up to date while the page is open. */
  autoSync: z.boolean(),
}).strict();
export type CloudLink = z.infer<typeof cloudLinkSchema>;

export async function getCloudLink(): Promise<CloudLink | null> {
  const parsed = cloudLinkSchema.safeParse(await (await getDb()).get("meta", CLOUD_LINK_KEY));
  return parsed.success ? parsed.data : null;
}
/** Read-modify-write in one transaction, so a concurrent dirty marker is never lost. */
export async function updateCloudLink(change: (link: CloudLink) => CloudLink): Promise<CloudLink | null> {
  const db = await getDb();
  const tx = db.transaction("meta", "readwrite");
  const parsed = cloudLinkSchema.safeParse(await tx.store.get(CLOUD_LINK_KEY));
  if (!parsed.success) { await tx.done; return null; }
  const next = cloudLinkSchema.parse(change(parsed.data));
  await tx.store.put(next, CLOUD_LINK_KEY);
  await tx.done;
  return next;
}
export async function createCloudLink(
  provider: CloudProvider, accountId: string, accountLabel: string,
): Promise<CloudLink> {
  const link: CloudLink = {
    provider, accountId, accountLabel, profileRevision: 0, dirtyProfile: false,
    linkedAt: new Date().toISOString(), autoSync: true,
  };
  await (await getDb()).put("meta", cloudLinkSchema.parse(link), CLOUD_LINK_KEY);
  return link;
}
export async function clearCloudLink(): Promise<void> {
  const db = await getDb();
  await db.delete("meta", CLOUD_LINK_KEY);
  await db.delete("meta", SESSION_KEY);
}

const sessionSchema = z.object({
  provider: z.literal("microsoft"), accountId: z.string().max(300), accountLabel: z.string().max(320),
  refreshToken: z.object({ iv: z.string(), data: z.string() }).strict(), savedAt: iso,
}).strict();
export interface StoredMicrosoftSession { accountId: string; accountLabel: string; refreshToken: string; savedAt: string }
export async function saveMicrosoftSession(
  accountId: string, accountLabel: string, refreshToken: string,
  /** Refresh-token rotation keeps the original expiry: pass the first sign-in time. */
  savedAt = new Date().toISOString(),
): Promise<void> {
  const secret: EncryptedSecret = await encryptLocal(refreshToken);
  await (await getDb()).put("meta", sessionSchema.parse(
    { provider: "microsoft", accountId, accountLabel, refreshToken: secret, savedAt }), SESSION_KEY);
}
export async function loadMicrosoftSession(): Promise<StoredMicrosoftSession | null> {
  const parsed = sessionSchema.safeParse(await (await getDb()).get("meta", SESSION_KEY));
  if (!parsed.success) return null;
  if (Date.now() - Date.parse(parsed.data.savedAt) > MICROSOFT_REFRESH_LIFETIME_MS) return null;
  try {
    return { accountId: parsed.data.accountId, accountLabel: parsed.data.accountLabel,
      refreshToken: await decryptLocal(parsed.data.refreshToken), savedAt: parsed.data.savedAt };
  } catch { return null; }
}
export async function clearMicrosoftSession(): Promise<void> {
  await (await getDb()).delete("meta", SESSION_KEY);
}
