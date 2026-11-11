import type { EncryptedSecret } from "../domain/types";
import { getDb } from "./db";

const KEY_ID = "device-encryption-key";

async function deviceKey(): Promise<CryptoKey> {
  const db = await getDb();
  const existing = (await db.get("meta", KEY_ID)) as CryptoKey | undefined;
  if (existing) return existing;

  // Generate OUTSIDE IndexedDB transactions: WebCrypto can take long enough
  // for an empty transaction to auto-commit. Competing tabs may each generate
  // candidates, but only one may win the durable read-if-absent below.
  const candidate = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
  const tx = db.transaction("meta", "readwrite");
  // IDB readwrite transactions on the same store are serialized across tabs.
  // Check again inside the very transaction that may write the candidate.
  const winner = (await tx.store.get(KEY_ID)) as CryptoKey | undefined;
  if (winner) {
    await tx.done;
    return winner;
  }
  await tx.store.add(candidate, KEY_ID); // Never overwrite an existing key.
  await tx.done; // No caller may encrypt until the chosen key is durable.
  return candidate;
}

function base64(bytes: Uint8Array): string {
  let result = "";
  for (const b of bytes) result += String.fromCharCode(b);
  return btoa(result);
}
function unbase64(input: string): Uint8Array {
  return Uint8Array.from(atob(input), x => x.charCodeAt(0));
}

export async function encryptLocal(plaintext: string): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deviceKey(), new TextEncoder().encode(plaintext));
  return { iv: base64(iv), data: base64(new Uint8Array(encrypted)) };
}

export async function decryptLocal(value: EncryptedSecret): Promise<string> {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(unbase64(value.iv)) },
      await deviceKey(),
      Uint8Array.from(unbase64(value.data)),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // A pre-fix ciphertext encrypted with a lost candidate key cannot be
    // recovered from the remaining device key. Never claim it can.
    throw new Error("Credenziale locale non decifrabile. Reinserisci la chiave nelle Impostazioni; un vecchio cifrato privo della sua chiave originale non è recuperabile.");
  }
}

// Cifra il contenuto IndexedDB rispetto alle letture accidentali dello storage.
// Il browser che esegue BookWriter può decifrare: NON è protezione contro XSS
// e non rappresenta un vault portabile/E2EE tra dispositivi.
