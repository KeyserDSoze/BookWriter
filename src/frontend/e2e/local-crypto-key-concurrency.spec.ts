import { expect, test, type Page } from "@playwright/test";

type Cipher = { iv: string; data: string };
type CryptoGate = Window & {
  holdDeviceKey?: boolean;
  enteredDeviceKey?: boolean;
  releaseDeviceKey?: () => void;
  cryptoTask?: Promise<Cipher>;
};

async function startEncryption(page: Page, text: string): Promise<void> {
  await page.evaluate(plaintext => {
    const probe = window as CryptoGate;
    probe.holdDeviceKey = true;
    probe.enteredDeviceKey = false;
    // No return of this promise: Playwright must not wait for the intentionally
    // blocked WebCrypto call. The real app module still does the encryption.
    probe.cryptoTask = import("/src/infrastructure/crypto.ts")
      .then(module => module.encryptLocal(plaintext));
  }, text);
}
async function waitAtGeneration(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(
    () => (window as CryptoGate).enteredDeviceKey === true,
  ), {timeout: 15_000}).toBe(true);
}
async function finishEncryption(page: Page): Promise<Cipher> {
  await page.evaluate(() => (window as CryptoGate).releaseDeviceKey?.());
  return page.evaluate(async () => {
    const task = (window as CryptoGate).cryptoTask;
    if (!task) throw Error("Cifratura di test non avviata");
    return task;
  });
}
async function decrypt(page: Page, cipher: Cipher): Promise<string> {
  return page.evaluate(async value => {
    const {decryptLocal} = await import("/src/infrastructure/crypto.ts");
    return decryptLocal(value);
  }, cipher);
}

test("chiave AES-GCM unica per due schede che la inizializzano contemporaneamente", async ({page}) => {
  test.setTimeout(75_000);
  const context = page.context();
  await context.addInitScript(() => {
    const original = crypto.subtle.generateKey.bind(crypto.subtle);
    Object.defineProperty(crypto.subtle, "generateKey", {
      configurable: true,
      value: async (...args: Parameters<SubtleCrypto["generateKey"]>) => {
        const probe = window as CryptoGate;
        if (probe.holdDeviceKey) {
          probe.holdDeviceKey = false;
          probe.enteredDeviceKey = true;
          await new Promise<void>(resolve => {
            probe.releaseDeviceKey = resolve;
          });
          probe.releaseDeviceKey = undefined;
        }
        return original(...args);
      },
    });
  });
  const second = await context.newPage();
  const left = "fixture-local-only-alpha";
  const right = "fixture-local-only-beta";
  const aiCalls: string[] = [];
  page.on("request", req => {
    if (req.url().includes("/chat/completions")) aiCalls.push(req.url());
  });
  second.on("request", req => {
    if (req.url().includes("/chat/completions")) aiCalls.push(req.url());
  });
  try {
    await Promise.all([page.goto("/"), second.goto("/")]);
    await Promise.all([startEncryption(page, left), startEncryption(second, right)]);
    // Both tabs must already be in generateKey after independently seeing no
    // device key. Releasing A first, then B, forces the old get/generate/put
    // implementation to overwrite A's key; the transactional CAS cannot.
    await Promise.all([waitAtGeneration(page), waitAtGeneration(second)]);
    const cipherA = await finishEncryption(page);
    const cipherB = await finishEncryption(second);

    expect(cipherA.iv).not.toBe(cipherB.iv);
    expect(cipherA.data).not.toContain(left);
    expect(cipherB.data).not.toContain(right);
    expect(await decrypt(page,cipherA)).toBe(left);
    expect(await decrypt(second,cipherB)).toBe(right);
    // Both tabs have one stable key in the shared IndexedDB 'meta' store.
    const info = await page.evaluate(async () => {
      const {getDb} = await import("/src/infrastructure/db.ts");
      const db = await getDb();
      const key = await db.get("meta", "device-encryption-key") as CryptoKey;
      return {
        type:key.type, name:key.algorithm.name, extractable:key.extractable,
        length:(key.algorithm as AesKeyAlgorithm).length,
        encrypt:key.usages.includes("encrypt"), decrypt:key.usages.includes("decrypt"),
      };
    });
    expect(info).toEqual({
      type:"secret",name:"AES-GCM",extractable:false,length:256,
      encrypt:true,decrypt:true,
    });
    await Promise.all([page.reload(), second.reload()]);
    expect(await decrypt(page,cipherB)).toBe(right);
    expect(await decrypt(second,cipherA)).toBe(left);
    expect(aiCalls).toEqual([]);
  } finally {
    await second.close();
  }
});
