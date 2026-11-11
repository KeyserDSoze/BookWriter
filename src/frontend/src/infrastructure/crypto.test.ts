import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "./db";
import { decryptLocal, encryptLocal } from "./crypto";

const KEY_ID = "device-encryption-key";

beforeEach(async () => {
  const db = await getDb();
  await db.delete("meta", KEY_ID);
});

describe("Inizializzazione atomica della chiave WebCrypto locale", () => {
  it("due e più cifrature simultanee a database vuoto restano tutte decifrabili", async () => {
    const originals = Array.from({length: 16}, (_, i) => "segreto-local-" + i);
    const ciphers = await Promise.all(originals.map(text => encryptLocal(text)));
    const db = await getDb();
    const key = await db.get("meta", KEY_ID) as CryptoKey;
    expect(key).toBeDefined();
    expect(key.type).toBe("secret");
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({name:"AES-GCM",length:256});
    expect(key.usages).toContain("decrypt");
    expect(key.usages).toContain("encrypt");

    expect(await Promise.all(ciphers.map(cipher => decryptLocal(cipher)))).toEqual(originals);
    expect(ciphers.every(x => x.iv && x.data && !x.data.includes("segreto-local"))).toBe(true);
  });

  it("non sovrascrive la prima chiave già salvata: un cifrato legacy resta leggibile", async () => {
    const legacy = await encryptLocal("legacy-saved-before-race");
    const db = await getDb();
    const first = await db.get("meta", KEY_ID) as CryptoKey;
    expect(first.extractable).toBe(false);
    const later = await Promise.all([
      encryptLocal("nuovo-a"), encryptLocal("nuovo-b"), encryptLocal("nuovo-c"),
    ]);
    const key = await db.get("meta", KEY_ID) as CryptoKey;
    expect(key.extractable).toBe(false);
    expect(await decryptLocal(legacy)).toBe("legacy-saved-before-race");
    expect(await Promise.all(later.map(decryptLocal))).toEqual(["nuovo-a","nuovo-b","nuovo-c"]);
  });

  it("un record meta già corrotto non viene rimpiazzato automaticamente", async () => {
    const db = await getDb();
    const broken = {invalid: true};
    await db.put("meta", broken, KEY_ID);
    await expect(encryptLocal("not-recoverable")).rejects.toThrow();
    expect(await db.get("meta", KEY_ID)).toEqual(broken);
  });

  it("un ciphertext non associato alla device key segnala reimmissione senza esporre segreti", async () => {
    const unavailable = await encryptLocal("segreto-scomparso");
    const db = await getDb();
    await db.delete("meta", KEY_ID);
    let message = "";
    try { await decryptLocal(unavailable); } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Credenziale locale non decifrabile/);
    expect(message).toMatch(/Reinserisci la chiave/);
    expect(message).not.toContain("segreto-scomparso");
    expect(await db.get("meta", KEY_ID)).toBeDefined();
  });
});
