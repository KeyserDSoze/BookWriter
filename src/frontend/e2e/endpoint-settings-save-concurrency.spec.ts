import { expect, test, type Page } from "@playwright/test";

type CryptoProbe = Window & {
  holdNextEncrypt?: boolean;
  encryptBlocked?: boolean;
  releaseEncrypt?: () => void;
};

async function addDelayedEncryption(page: Page) {
  // Install before App / WebCrypto run. The real AES-GCM method is used after
  // release; the fixture never replaces encryption with plaintext or a fake.
  await page.addInitScript(() => {
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    const probe = window as CryptoProbe;
    Object.defineProperty(crypto.subtle, "encrypt", {
      configurable: true,
      value: async (...args: Parameters<SubtleCrypto["encrypt"]>) => {
        if (probe.holdNextEncrypt) {
          probe.holdNextEncrypt = false;
          probe.encryptBlocked = true;
          await new Promise<void>(resolve => { probe.releaseEncrypt = resolve; });
          probe.encryptBlocked = false;
          probe.releaseEncrypt = undefined;
        }
        return original(...args);
      },
    });
  });
}
async function openSettings(page: Page) {
  await page.goto("/");
  const navigation = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ?
      "Navigazione mobile" : "Navigazione principale",
  });
  await navigation.getByRole("button", { name:"Impostazioni" }).click();
  await expect(page.getByRole("heading", { name:"Endpoint OpenAI-compatible" })).toBeVisible();
}
async function blockNextEncrypt(page: Page) {
  await page.evaluate(() => {
    const probe = window as CryptoProbe;
    probe.holdNextEncrypt = true;
    probe.encryptBlocked = false;
  });
}
async function waitBlocked(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as CryptoProbe).encryptBlocked === true))
    .toBe(true);
}
async function releaseEncrypt(page: Page) {
  await page.evaluate(() => (window as CryptoProbe).releaseEncrypt?.());
}
async function savedSettings(page: Page) {
  return page.evaluate(() => new Promise<{
    endpoints: number; url: string | null; model: string | null; encrypted: boolean;
  } | null>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("settings", "readonly");
      const get = tx.objectStore("settings").get("global");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        const value = get.result as {
          endpoints?: Array<{baseUrl: string; models: string[]; secret: {iv: string; data: string} | null}>;
        } | undefined;
        const first = value?.endpoints?.[0];
        resolve(value ? {
          endpoints: value.endpoints?.length ?? 0,
          url: first?.baseUrl ?? null,
          model: first?.models?.[0] ?? null,
          encrypted: !!first?.secret?.iv && !!first?.secret?.data,
        } : null);
        db.close();
      };
    };
  }));
}

test("cifratura ritardata: URL e chiave draft restano intatti, solo retry esplicito persiste", async ({page}) => {
  test.setTimeout(60_000);
  await addDelayedEncryption(page);
  await openSettings(page);
  const key = page.getByLabel("API key");
  const url = page.getByRole("textbox", {name:"Base URL"});
  const models = page.getByRole("textbox", {name:"Modelli rilevati / manuali"});
  const save = page.getByRole("button", {name:"Salva impostazioni"});
  await key.fill("sk-fixture-encryption-only");
  await models.fill("manual-original");
  await blockNextEncrypt(page);
  await save.click();
  await waitBlocked(page);
  await url.fill("https://second.example.test/v1");
  await models.fill("manual-after-edit");
  await releaseEncrypt(page);
  await expect(page.getByText(/Impostazioni cambiate durante la cifratura o il salvataggio/))
    .toBeVisible();
  await expect(key).toHaveValue("sk-fixture-encryption-only");
  await expect(url).toHaveValue("https://second.example.test/v1");
  await expect(models).toHaveValue("manual-after-edit");
  expect(await savedSettings(page)).toBeNull();

  await save.click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  expect(await savedSettings(page)).toMatchObject({
    endpoints:1,url:"https://second.example.test/v1",model:"manual-after-edit",encrypted:true,
  });
  await page.reload();
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await expect(page.getByRole("textbox",{name:"Base URL"}))
    .toHaveValue("https://second.example.test/v1");
  await expect(page.getByRole("textbox",{name:"Modelli rilevati / manuali"}))
    .toHaveValue("manual-after-edit");
  await expect(page.getByLabel("Nuova API key (opzionale; già salvata)")).toHaveValue("");
});

test("doppio Salva: il tentativo lento non sostituisce impostazioni o chiave del successivo", async ({page}) => {
  test.setTimeout(60_000);
  await addDelayedEncryption(page);
  await openSettings(page);
  const key=page.getByLabel("API key");
  const model=page.getByRole("textbox",{name:"Modelli rilevati / manuali"});
  const save=page.getByRole("button",{name:"Salva impostazioni"});
  await key.fill("sk-first-fixture");
  await blockNextEncrypt(page);
  await save.click();
  await waitBlocked(page);
  await key.fill("sk-second-fixture");
  await model.fill("second-model");
  await save.click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await expect(key).toHaveValue("");
  expect(await savedSettings(page)).toMatchObject({model:"second-model",encrypted:true});
  await releaseEncrypt(page);
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  expect(await savedSettings(page)).toMatchObject({model:"second-model",encrypted:true});
});

test("rimozione endpoint durante cifratura: nessuna scrittura parziale", async ({page}) => {
  test.setTimeout(60_000);
  await addDelayedEncryption(page);
  await openSettings(page);
  await page.getByRole("button",{name:"Aggiungi endpoint"}).click();
  await expect(page.getByRole("textbox",{name:"Base URL"})).toHaveCount(2);
  await page.getByLabel("API key").last().fill("sk-removed-profile-fixture");
  await blockNextEncrypt(page);
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await waitBlocked(page);
  await page.getByRole("button",{name:"Rimuovi"}).last().click();
  await releaseEncrypt(page);
  await expect(page.getByText(/Impostazioni cambiate durante la cifratura o il salvataggio/)).toBeVisible();
  await expect(page.getByRole("textbox",{name:"Base URL"})).toHaveCount(1);
  expect(await savedSettings(page)).toBeNull();
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  expect(await savedSettings(page)).toMatchObject({endpoints:1,encrypted:false});
});
