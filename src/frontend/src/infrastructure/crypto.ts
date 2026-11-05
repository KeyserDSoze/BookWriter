import type { EncryptedSecret } from "../domain/types";
import { getDb } from "./db";

const KEY_ID = "device-encryption-key";

async function deviceKey(): Promise<CryptoKey> {
  const db = await getDb();
  let key = (await db.get("meta", KEY_ID)) as CryptoKey | undefined;
  if (!key) {
    key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await db.put("meta", key, KEY_ID);
  }
  return key;
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
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unbase64(value.iv) },
    await deviceKey(),
    unbase64(value.data),
  );
  return new TextDecoder().decode(decrypted);
}

// Cifra il contenuto IndexedDB rispetto alle letture accidentali dello storage.
// Il browser che esegue BookWriter può decifrare: NON è protezione contro XSS
// e non rappresenta un vault portabile/E2EE tra dispositivi.
