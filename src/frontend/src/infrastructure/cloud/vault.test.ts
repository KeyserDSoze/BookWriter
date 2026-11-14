import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertPassphrase, deriveVaultKey, fromBase64, kdfOf, newVaultKdf, openWithKey, sealAccount, sealWithKey,
  VaultPassphraseError, VAULT_PBKDF2_ITERATIONS, toBase64,
} from "./vault";
import { forgetVaultKey, loadRememberedVaultKey, rememberVaultKey } from "./vault-store";
import { getDb } from "../db";
import type { VaultSecrets } from "../../domain/cloud-profile";

const SECRETS: VaultSecrets = {
  githubToken: "github_pat_SEGRETISSIMO_1234567890",
  endpointKeys: { openai: "sk-live-CHIAVE-OPENAI-9999", locale: "chiave-locale-xyz" },
};
const PASSPHRASE = "una frase molto lunga e privata";

beforeEach(async () => { await (await getDb()).clear("meta"); });

describe("vault con passphrase (E2EE)", () => {
  it("cifra e decifra con la stessa passphrase", async () => {
    const kdf = newVaultKdf();
    const envelope = await sealWithKey(SECRETS, await deriveVaultKey(PASSPHRASE, kdf), kdf);
    expect(envelope.kdf).toMatchObject({ name: "PBKDF2", hash: "SHA-256", iterations: VAULT_PBKDF2_ITERATIONS });
    expect(await openWithKey(envelope, await deriveVaultKey(PASSPHRASE, kdfOf(envelope)))).toEqual(SECRETS);
  });
  it("il file cifrato non contiene alcun frammento dei segreti né della passphrase", async () => {
    const kdf = newVaultKdf();
    const text = JSON.stringify(await sealWithKey(SECRETS, await deriveVaultKey(PASSPHRASE, kdf), kdf));
    for (const forbidden of ["github_pat", "SEGRETISSIMO", "sk-live", "CHIAVE-OPENAI", "chiave-locale", "openai", PASSPHRASE])
      expect(text).not.toContain(forbidden);
  });
  it("una passphrase errata non rivela nulla e dà un errore chiaro", async () => {
    const kdf = newVaultKdf();
    const envelope = await sealWithKey(SECRETS, await deriveVaultKey(PASSPHRASE, kdf), kdf);
    const wrong = await deriveVaultKey("un'altra frase completamente diversa", kdfOf(envelope));
    await expect(openWithKey(envelope, wrong)).rejects.toBeInstanceOf(VaultPassphraseError);
    await expect(openWithKey(envelope, wrong)).rejects.not.toThrow(/github_pat|sk-live/);
  });
  it("un vault manomesso (dati, IV o salt) non viene mai aperto", async () => {
    const kdf = newVaultKdf();
    const key = await deriveVaultKey(PASSPHRASE, kdf);
    const envelope = await sealWithKey(SECRETS, key, kdf);
    const flip = (value: string) => { const bytes = fromBase64(value); bytes[0] = bytes[0]! ^ 1; return toBase64(bytes); };
    await expect(openWithKey({ ...envelope, data: flip(envelope.data) }, key)).rejects.toBeInstanceOf(VaultPassphraseError);
    await expect(openWithKey({ ...envelope, iv: flip(envelope.iv) }, key)).rejects.toBeInstanceOf(VaultPassphraseError);
    const otherSalt = { ...envelope, kdf: { ...envelope.kdf, salt: flip(envelope.kdf.salt) } };
    await expect(openWithKey(otherSalt, await deriveVaultKey(PASSPHRASE, kdfOf(otherSalt)))).rejects.toBeInstanceOf(VaultPassphraseError);
  });
  it("ogni cifratura usa un IV nuovo; il salt cambia per ogni nuovo vault", async () => {
    const kdf = newVaultKdf();
    const key = await deriveVaultKey(PASSPHRASE, kdf);
    const [a, b] = [await sealWithKey(SECRETS, key, kdf), await sealWithKey(SECRETS, key, kdf)];
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
    expect(toBase64(newVaultKdf().salt)).not.toBe(toBase64(newVaultKdf().salt));
  });
  it("la chiave derivata non è esportabile", async () => {
    const key = await deriveVaultKey(PASSPHRASE, newVaultKdf());
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
  it("rifiuta passphrase corte e parametri KDF fuori limite", async () => {
    expect(() => assertPassphrase("undici cara")).toThrow(/almeno 12/);
    expect(() => assertPassphrase("            ")).toThrow();
    expect(() => assertPassphrase(PASSPHRASE)).not.toThrow();
    await expect(deriveVaultKey(PASSPHRASE, { iterations: 10, salt: new Uint8Array(16) })).rejects.toThrow(/Parametri/);
    await expect(deriveVaultKey(PASSPHRASE, { iterations: 50_000_000, salt: new Uint8Array(16) })).rejects.toThrow(/Parametri/);
  });
  it("accenti scritti in forma composta o scomposta aprono lo stesso vault", async () => {
    const kdf = newVaultKdf();
    const composed = "perché la città è così bella";
    const envelope = await sealWithKey(SECRETS, await deriveVaultKey(composed, kdf), kdf);
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed);
    expect(await openWithKey(envelope, await deriveVaultKey(decomposed, kdfOf(envelope)))).toEqual(SECRETS);
  });
  it("rifiuta segreti non conformi allo schema prima di cifrare", async () => {
    const kdf = newVaultKdf();
    const key = await deriveVaultKey(PASSPHRASE, kdf);
    await expect(sealWithKey({ githubToken: "", endpointKeys: {} }, key, kdf)).rejects.toThrow();
  });
});

describe("vault «solo account»", () => {
  it("è leggibile da chi accede all'account: non finge di essere cifrato", () => {
    const envelope = sealAccount(SECRETS);
    expect(envelope.mode).toBe("account");
    expect(JSON.stringify(envelope)).toContain("github_pat_SEGRETISSIMO");
  });
});

describe("chiave derivata ricordata su questo dispositivo", () => {
  it("si ritrova solo con lo stesso salt e le stesse iterazioni", async () => {
    const kdf = newVaultKdf();
    const key = await deriveVaultKey(PASSPHRASE, kdf);
    const envelope = await sealWithKey(SECRETS, key, kdf);
    expect(await loadRememberedVaultKey("google:abc", envelope)).toBeNull();
    await rememberVaultKey("google:abc", key, envelope);
    const remembered = await loadRememberedVaultKey("google:abc", envelope);
    expect(remembered).not.toBeNull();
    expect(remembered!.extractable).toBe(false);
    expect(await openWithKey(envelope, remembered!)).toEqual(SECRETS);
    // Passphrase changed on another device: new salt, the old remembered key must not match.
    const kdf2 = newVaultKdf();
    const changed = await sealWithKey(SECRETS, await deriveVaultKey("passphrase nuova e diversa", kdf2), kdf2);
    expect(await loadRememberedVaultKey("google:abc", changed)).toBeNull();
    expect(await loadRememberedVaultKey("microsoft:abc", envelope)).toBeNull();
    await forgetVaultKey("google:abc");
    expect(await loadRememberedVaultKey("google:abc", envelope)).toBeNull();
  });
  it("in IndexedDB non resta mai la passphrase", async () => {
    const kdf = newVaultKdf();
    const key = await deriveVaultKey(PASSPHRASE, kdf);
    await rememberVaultKey("google:abc", key, await sealWithKey(SECRETS, key, kdf));
    const stored = await (await getDb()).get("meta", "cloud-vault-key:v1:google:abc") as Record<string, unknown>;
    expect(JSON.stringify({ salt: stored.salt, iterations: stored.iterations })).not.toContain(PASSPHRASE);
    expect(Object.keys(stored).sort()).toEqual(["iterations", "key", "salt"]);
  });
});
