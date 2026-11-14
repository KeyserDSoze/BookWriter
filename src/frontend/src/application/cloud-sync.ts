import {
  CLOUD_LIBRARY_FILE, CLOUD_PROFILE_FILE, MAX_CLOUD_FILE_BYTES, cloudSettingsSignature, mergeLibrary,
  parseCloudLibrary, parseCloudProfile, projectSettings, removeLibraryEntry, summarizeBook,
  type CloudLibrary, type CloudProfile, type CloudSettings, type VaultEnvelope, type VaultSecrets,
} from "../domain/cloud-profile";
import type { AppSettings, BookProject, EndpointProfile } from "../domain/types";
import { decryptLocal, encryptLocal } from "../infrastructure/crypto";
import { getDb, loadSettings } from "../infrastructure/db";
import { CloudError, type CloudSession } from "../infrastructure/cloud/types";
import { getCloudDevice, getCloudLink, updateCloudLink } from "../infrastructure/cloud/cloud-state";
import {
  assertPassphrase, deriveVaultKey, kdfOf, newVaultKdf, openWithKey, sealAccount, sealWithKey,
  VaultLockedError, VaultPassphraseError,
} from "../infrastructure/cloud/vault";
import { loadRememberedVaultKey, rememberVaultKey } from "../infrastructure/cloud/vault-store";
import { verifyEndpointSettings } from "./endpoint-settings-save";

export const CLOUD_LOCK = "bookwriter:cloud-sync";

/** Cloud operations never overlap inside one browser. Without Web Locks they refuse
 * to run: two tabs could otherwise push the profile over each other. */
export async function withCloudLock<T>(action: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request)
    throw new Error("Web Locks non disponibile: la sincronizzazione cloud è disattivata per evitare scritture concorrenti tra schede.");
  return locks.request(CLOUD_LOCK, { ifAvailable: true }, async lock => {
    if (!lock) throw new CloudError("conflict", "Una sincronizzazione cloud è già in corso in un'altra scheda.");
    return action();
  });
}

const vaultScope = (session: CloudSession) => session.provider + ":" + session.accountId;

export interface CloudInspection {
  profile: {
    exists: boolean; invalid?: string; revision?: number; updatedAt?: string;
    deviceName?: string; sameDevice?: boolean; vaultMode?: "passphrase" | "account" | null;
  };
  library: { exists: boolean; invalid?: string; revision?: number; books?: number };
}

export async function inspectCloud(session: CloudSession, signal?: AbortSignal): Promise<CloudInspection> {
  const device = await getCloudDevice();
  const [profileFile, libraryFile] = await Promise.all([
    session.store.read(CLOUD_PROFILE_FILE, signal), session.store.read(CLOUD_LIBRARY_FILE, signal),
  ]);
  const result: CloudInspection = { profile: { exists: !!profileFile }, library: { exists: !!libraryFile } };
  if (profileFile) {
    const parsed = parseCloudProfile(profileFile.text);
    if (parsed.ok) result.profile = {
      exists: true, revision: parsed.value.revision, updatedAt: parsed.value.updatedAt,
      deviceName: parsed.value.deviceName, sameDevice: parsed.value.deviceId === device.id,
      vaultMode: parsed.value.vault?.mode ?? null,
    };
    else result.profile = { exists: true, invalid: parsed.reason };
  }
  if (libraryFile) {
    const parsed = parseCloudLibrary(libraryFile.text);
    result.library = parsed.ok
      ? { exists: true, revision: parsed.value.revision, books: parsed.value.books.filter(book => !book.removed).length }
      : { exists: true, invalid: parsed.reason };
  }
  return result;
}

export interface VaultAccess { passphrase?: string; remember?: boolean }
interface OpenedVault { secrets: VaultSecrets | null; key?: CryptoKey }

async function openVault(session: CloudSession, vault: VaultEnvelope | null, access: VaultAccess): Promise<OpenedVault> {
  if (!vault) return { secrets: null };
  if (vault.mode === "account") return { secrets: vault.secrets };
  let key = access.passphrase ? await deriveVaultKey(access.passphrase, kdfOf(vault))
    : await loadRememberedVaultKey(vaultScope(session), vault);
  if (!key) throw new VaultLockedError();
  const secrets = await openWithKey(vault, key);
  if (access.passphrase && access.remember) await rememberVaultKey(vaultScope(session), key, vault);
  return { secrets, key };
}

async function appliedSettings(
  local: AppSettings, cloud: CloudSettings, secrets: VaultSecrets | null,
): Promise<AppSettings> {
  const endpoints: EndpointProfile[] = await Promise.all(cloud.endpoints.map(async endpoint => {
    const before = local.endpoints.find(candidate => candidate.id === endpoint.id);
    const apiKey = secrets?.endpointKeys[endpoint.id];
    return {
      ...endpoint,
      // Cloud settings are authoritative; a secret the cloud does not carry is kept, never erased.
      secret: endpoint.authMode === "none" ? null : apiKey ? await encryptLocal(apiKey) : before?.secret ?? null,
      ...(before?.modelReasoning ? { modelReasoning: before.modelReasoning } : {}),
    };
  }));
  return {
    ...local, endpoints,
    defaultRoute: cloud.defaultRoute, taskRoutes: cloud.taskRoutes as AppSettings["taskRoutes"],
    taskReasoningEfforts: cloud.taskReasoningEfforts, capabilityRoutes: cloud.capabilityRoutes,
    aiPriceRates: cloud.aiPriceRates,
    githubToken: secrets?.githubToken ? await encryptLocal(secrets.githubToken) : local.githubToken ?? null,
  };
}

function parseProfileOrThrow(text: string): CloudProfile {
  const parsed = parseCloudProfile(text);
  if (!parsed.ok) throw new CloudError("invalid", parsed.reason);
  return parsed.value;
}

export type PullOutcome =
  | { status: "none" }
  | { status: "applied"; revision: number; apiKeys: number; githubToken: boolean; deviceName: string };

/** Replaces the synchronised settings of THIS device with the cloud profile. */
export async function pullProfile(
  session: CloudSession, access: VaultAccess = {}, signal?: AbortSignal,
): Promise<PullOutcome> {
  return withCloudLock(async () => {
    const file = await session.store.read(CLOUD_PROFILE_FILE, signal);
    if (!file) return { status: "none" };
    const profile = parseProfileOrThrow(file.text);
    const { secrets } = await openVault(session, profile.vault, access);
    const local = await loadSettings();
    const expected = cloudSettingsSignature(local);
    const next = await appliedSettings(local, profile.settings, secrets);
    verifyEndpointSettings(next);
    const db = await getDb();
    const tx = db.transaction(["settings", "meta"], "readwrite");
    void tx.done.catch(() => undefined);
    const current = await tx.objectStore("settings").get("global") as AppSettings | undefined;
    if (current && cloudSettingsSignature(current) !== expected) {
      tx.abort();
      throw new CloudError("conflict", "Le impostazioni locali sono cambiate durante l'aggiornamento: nessuna modifica applicata. Riprova.");
    }
    void tx.objectStore("settings").put(next, "global");
    await tx.done;
    await updateCloudLink(link => ({
      ...link, profileRevision: profile.revision, dirtyProfile: false,
      vaultMode: profile.vault?.mode, lastProfileSyncAt: new Date().toISOString(),
    }));
    return {
      status: "applied", revision: profile.revision, deviceName: profile.deviceName,
      apiKeys: Object.keys(secrets?.endpointKeys ?? {}).length, githubToken: !!secrets?.githubToken,
    };
  });
}

export interface PushRequest {
  protection: "passphrase" | "account";
  passphrase?: string; remember?: boolean;
  /** Create a new vault key (first upload, changed passphrase or switched protection). */
  rotate?: boolean;
  /** Replace a cloud profile that another device changed, or that cannot be read. */
  overwrite?: boolean;
}
export type PushOutcome =
  | { status: "pushed"; revision: number }
  | { status: "conflict"; remoteRevision: number; remoteDevice: string; remoteUpdatedAt: string }
  | { status: "passphrase_required" };

async function localSecrets(settings: AppSettings): Promise<VaultSecrets> {
  const endpointKeys: Record<string, string> = {};
  for (const endpoint of settings.endpoints)
    if (endpoint.authMode !== "none" && endpoint.secret) endpointKeys[endpoint.id] = await decryptLocal(endpoint.secret);
  return { githubToken: settings.githubToken ? await decryptLocal(settings.githubToken) : null, endpointKeys };
}

/** Uploads this device's settings and secrets. Another device's newer profile is never overwritten silently. */
export async function pushProfile(
  session: CloudSession, request: PushRequest, signal?: AbortSignal,
): Promise<PushOutcome> {
  return withCloudLock(async () => {
    const [device, link, settings] = [await getCloudDevice(), await getCloudLink(), await loadSettings()];
    if (!link || link.accountId !== session.accountId || link.provider !== session.provider)
      throw new CloudError("config", "Questo dispositivo non è collegato all'account cloud in uso.");
    const expected = cloudSettingsSignature(settings);
    const secrets = await localSecrets(settings);
    const hasSecrets = !!secrets.githubToken || Object.keys(secrets.endpointKeys).length > 0;

    const file = await session.store.read(CLOUD_PROFILE_FILE, signal);
    let remote: CloudProfile | null = null;
    if (file) {
      const parsed = parseCloudProfile(file.text);
      if (parsed.ok) remote = parsed.value;
      else if (!request.overwrite) throw new CloudError("invalid", parsed.reason + " Puoi sostituirlo con il profilo di questo dispositivo.");
    }
    if (remote && !request.overwrite && remote.revision !== link.profileRevision)
      return { status: "conflict", remoteRevision: remote.revision, remoteDevice: remote.deviceName, remoteUpdatedAt: remote.updatedAt };

    let vault: VaultEnvelope | null = null;
    let key: CryptoKey | undefined, passphraseEnvelope: Extract<VaultEnvelope, { mode: "passphrase" }> | undefined;
    if (hasSecrets && request.protection === "account") vault = sealAccount(secrets);
    else if (hasSecrets) {
      const existing = remote?.vault?.mode === "passphrase" && !request.rotate ? remote.vault : undefined;
      if (existing) {
        // Reuse the existing salt so keys remembered on other devices stay valid.
        key = request.passphrase ? await deriveVaultKey(request.passphrase, kdfOf(existing))
          : await loadRememberedVaultKey(vaultScope(session), existing) ?? undefined;
        if (!key) return { status: "passphrase_required" };
        await openWithKey(existing, key); // a wrong passphrase must not silently re-key the vault
        passphraseEnvelope = await sealWithKey(secrets, key, kdfOf(existing));
      } else {
        if (!request.passphrase) return { status: "passphrase_required" };
        assertPassphrase(request.passphrase);
        const kdf = newVaultKdf();
        key = await deriveVaultKey(request.passphrase, kdf);
        passphraseEnvelope = await sealWithKey(secrets, key, kdf);
      }
      vault = passphraseEnvelope;
    }

    const profile: CloudProfile = {
      schemaVersion: 1, kind: "profile", revision: (remote?.revision ?? link.profileRevision) + 1,
      updatedAt: new Date().toISOString(), deviceId: device.id, deviceName: device.name,
      settings: projectSettings(settings), vault,
    };
    if (remote && request.overwrite) profile.revision = Math.max(remote.revision, link.profileRevision) + 1;
    const text = JSON.stringify(profile);
    if (text.length > MAX_CLOUD_FILE_BYTES) throw new CloudError("invalid", "Il profilo supera 1 MiB: riduci i cataloghi modelli.");
    // Our own file must be accepted by every other device: refuse to upload what we could not read back.
    if (!parseCloudProfile(text).ok)
      throw new CloudError("invalid", "Le impostazioni di questo dispositivo hanno valori fuori limite e non si possono sincronizzare.");

    try { await session.store.write(CLOUD_PROFILE_FILE, text, file?.version ?? null, signal); }
    catch (error) {
      if (!(error instanceof CloudError) || error.kind !== "conflict") throw error;
      const latest = await session.store.read(CLOUD_PROFILE_FILE, signal);
      const parsed = latest ? parseCloudProfile(latest.text) : null;
      return parsed?.ok
        ? { status: "conflict", remoteRevision: parsed.value.revision, remoteDevice: parsed.value.deviceName, remoteUpdatedAt: parsed.value.updatedAt }
        : { status: "conflict", remoteRevision: 0, remoteDevice: "altro dispositivo", remoteUpdatedAt: new Date().toISOString() };
    }
    // Read back: a device that wrote between our check and our write would have replaced it.
    const check = await session.store.read(CLOUD_PROFILE_FILE, signal);
    const verified = check ? parseCloudProfile(check.text) : null;
    if (!verified?.ok || verified.value.revision !== profile.revision || verified.value.deviceId !== device.id)
      return { status: "conflict", remoteRevision: verified?.ok ? verified.value.revision : 0,
        remoteDevice: verified?.ok ? verified.value.deviceName : "altro dispositivo", remoteUpdatedAt: new Date().toISOString() };

    const unchanged = cloudSettingsSignature(await loadSettings()) === expected;
    await updateCloudLink(current => ({
      ...current, profileRevision: profile.revision, dirtyProfile: unchanged ? false : current.dirtyProfile,
      vaultMode: vault?.mode, lastProfileSyncAt: profile.updatedAt,
    }));
    if (key && request.remember && passphraseEnvelope) await rememberVaultKey(vaultScope(session), key, passphraseEnvelope);
    return { status: "pushed", revision: profile.revision };
  });
}

export interface LibrarySyncResult { library: CloudLibrary | null; written: boolean; changed: number }

async function readLibrary(session: CloudSession, signal?: AbortSignal) {
  const file = await session.store.read(CLOUD_LIBRARY_FILE, signal);
  if (!file) return { library: null, version: null };
  const parsed = parseCloudLibrary(file.text);
  if (!parsed.ok) throw new CloudError("invalid", parsed.reason);
  return { library: parsed.value, version: file.version };
}

/** Only the index is written: titles, status, progress and repository coordinates.
 * Never brief, memory, secrets or prose. A book another device advanced is not regressed. */
export async function syncLibrary(
  session: CloudSession, books: BookProject[], signal?: AbortSignal,
): Promise<LibrarySyncResult> {
  return withCloudLock(async () => {
    const device = await getCloudDevice();
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = new Date().toISOString();
      const { library, version } = await readLibrary(session, signal);
      const merge = mergeLibrary(library, books.map(book => summarizeBook(book, device, now)), now);
      if (!merge.changedBookIds.length) return { library, written: false, changed: 0 };
      try { await session.store.write(CLOUD_LIBRARY_FILE, JSON.stringify(merge.library), version, signal); }
      catch (error) { if (error instanceof CloudError && error.kind === "conflict") continue; throw error; }
      const { library: stored } = await readLibrary(session, signal);
      const mine = (id: string) => stored?.books.find(entry => entry.bookId === id)?.deviceId === device.id;
      if (!merge.changedBookIds.every(mine)) continue; // another device wrote in between: merge again
      await updateCloudLink(link => ({ ...link, lastLibrarySyncAt: now }));
      return { library: stored, written: true, changed: merge.changedBookIds.length };
    }
    throw new CloudError("conflict", "La libreria cloud cambia continuamente da altri dispositivi: riprova tra poco.");
  });
}

export async function loadCloudLibrary(session: CloudSession, signal?: AbortSignal): Promise<CloudLibrary | null> {
  return (await readLibrary(session, signal)).library;
}

export async function removeFromCloudLibrary(
  session: CloudSession, bookId: string, signal?: AbortSignal,
): Promise<CloudLibrary | null> {
  return withCloudLock(async () => {
    const device = await getCloudDevice();
    for (let attempt = 0; attempt < 3; attempt++) {
      const { library, version } = await readLibrary(session, signal);
      if (!library) return null;
      const next = removeLibraryEntry(library, bookId, device, new Date().toISOString());
      if (next === library) return library;
      try { await session.store.write(CLOUD_LIBRARY_FILE, JSON.stringify(next), version, signal); return next; }
      catch (error) { if (error instanceof CloudError && error.kind === "conflict") continue; throw error; }
    }
    throw new CloudError("conflict", "La libreria cloud cambia continuamente da altri dispositivi: riprova tra poco.");
  });
}

export { VaultLockedError, VaultPassphraseError };
