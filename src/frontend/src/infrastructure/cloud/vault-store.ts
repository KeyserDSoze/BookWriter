import type { PassphraseEnvelope } from "../../domain/cloud-profile";
import { getDb } from "../db";

/** Keeps the DERIVED key (non-extractable CryptoKey, same protection as the device
 * key) so later pushes need no passphrase. Optional: the author may decline. The
 * passphrase itself is never stored. */
interface RememberedVaultKey { key: CryptoKey; salt: string; iterations: number }
const keyOf = (scope: string) => "cloud-vault-key:v1:" + scope;

export async function rememberVaultKey(scope: string, key: CryptoKey, envelope: PassphraseEnvelope): Promise<void> {
  const value: RememberedVaultKey = { key, salt: envelope.kdf.salt, iterations: envelope.kdf.iterations };
  await (await getDb()).put("meta", value, keyOf(scope));
}
/** Returns the key only when it was derived with exactly this envelope's salt. */
export async function loadRememberedVaultKey(scope: string, envelope: PassphraseEnvelope): Promise<CryptoKey | null> {
  const value = await (await getDb()).get("meta", keyOf(scope)) as RememberedVaultKey | undefined;
  return value && value.salt === envelope.kdf.salt && value.iterations === envelope.kdf.iterations &&
    value.key?.type === "secret" ? value.key : null;
}
export async function forgetVaultKey(scope: string): Promise<void> {
  await (await getDb()).delete("meta", keyOf(scope));
}
