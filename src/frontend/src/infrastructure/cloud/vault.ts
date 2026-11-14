import {
  vaultSecretsSchema, VAULT_MAX_PBKDF2_ITERATIONS, VAULT_MIN_PBKDF2_ITERATIONS,
  type PassphraseEnvelope, type VaultEnvelope, type VaultSecrets,
} from "../../domain/cloud-profile";

/** Credential vault of the cloud profile (GitHub PAT, AI API keys).
 *  - "passphrase": AES-GCM-256 under a PBKDF2-SHA256 key. The cloud account
 *    holder, the provider and any other app see only ciphertext (E2EE).
 *  - "account": readable by whoever enters the cloud account. Convenience, NOT E2EE.
 * Nothing in this module touches the network or IndexedDB. */
export const VAULT_PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 12;
const AAD = new TextEncoder().encode("bookwriter-cloud-vault/v1");

export class VaultPassphraseError extends Error {
  constructor() {
    super("Passphrase errata oppure vault alterato: nessuna credenziale è stata letta.");
    this.name = "VaultPassphraseError";
  }
}
export class VaultLockedError extends Error {
  constructor() {
    super("Il vault cloud è protetto da passphrase: inserisci la passphrase per sbloccarlo.");
    this.name = "VaultLockedError";
  }
}

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
export function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

export function assertPassphrase(passphrase: string): void {
  if ([...passphrase.trim()].length < MIN_PASSPHRASE_LENGTH)
    throw new Error(`La passphrase deve avere almeno ${MIN_PASSPHRASE_LENGTH} caratteri.`);
}

export interface VaultKdf { iterations: number; salt: Uint8Array }
export function newVaultKdf(): VaultKdf {
  return { iterations: VAULT_PBKDF2_ITERATIONS, salt: crypto.getRandomValues(new Uint8Array(16)) };
}
export function kdfOf(envelope: PassphraseEnvelope): VaultKdf {
  return { iterations: envelope.kdf.iterations, salt: fromBase64(envelope.kdf.salt) };
}

/** Non-extractable: the derived key can be kept on this device but never read out. */
export async function deriveVaultKey(passphrase: string, kdf: VaultKdf): Promise<CryptoKey> {
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < VAULT_MIN_PBKDF2_ITERATIONS ||
      kdf.iterations > VAULT_MAX_PBKDF2_ITERATIONS)
    throw new Error("Parametri di derivazione della chiave non validi.");
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: kdf.salt as BufferSource, iterations: kdf.iterations },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealWithKey(
  secrets: VaultSecrets, key: CryptoKey, kdf: VaultKdf,
): Promise<PassphraseEnvelope> {
  vaultSecretsSchema.parse(secrets);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AAD }, key, new TextEncoder().encode(JSON.stringify(secrets))));
  return {
    mode: "passphrase", version: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: kdf.iterations, salt: toBase64(kdf.salt) },
    iv: toBase64(iv), data: toBase64(encrypted),
  };
}

export async function openWithKey(envelope: PassphraseEnvelope, key: CryptoKey): Promise<VaultSecrets> {
  let plain: string;
  try {
    plain = new TextDecoder().decode(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.iv) as BufferSource, additionalData: AAD },
      key, fromBase64(envelope.data) as BufferSource));
  } catch { throw new VaultPassphraseError(); }
  let raw: unknown;
  try { raw = JSON.parse(plain); } catch { throw new VaultPassphraseError(); }
  const parsed = vaultSecretsSchema.safeParse(raw);
  if (!parsed.success) throw new VaultPassphraseError();
  return parsed.data;
}

export function sealAccount(secrets: VaultSecrets): VaultEnvelope {
  return { mode: "account", version: 1, secrets: vaultSecretsSchema.parse(secrets) };
}
