import { expect, test, type Page } from "@playwright/test";

type Pending = { release: () => void; model: string };
async function openSettings(page: Page) {
  await page.goto("/");
  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ?
      "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await expect(page.getByRole("heading", { name: "Endpoint OpenAI-compatible" })).toBeVisible();
}
async function interceptCatalog(page: Page) {
  let calls = 0;
  const pending = new Map<number, Pending>();
  await page.route("https://api.openai.com/v1/models", async route => {
    const index = ++calls;
    await new Promise<void>(resolve => pending.set(index, {
      release: resolve, model: "catalog-" + index,
    }));
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization,content-type",
      },
      body: JSON.stringify({data: [{id:"catalog-" + index}]}),
    });
  });
  return {
    wait: async (count: number) => {
      await expect.poll(() => calls, { timeout: 10_000 }).toBe(count);
    },
    release: (index: number) => {
      const item = pending.get(index);
      if (!item) throw new Error("Catalogo mock non ancora richiesto.");
      item.release(); pending.delete(index);
    },
    count: () => calls,
    releaseAll: () => {
      for (const item of pending.values()) item.release();
      pending.clear();
    },
  };
}

test("cataloghi tardivi scartati dopo URL, chiave o modifica manuale dei modelli", async ({ page }) => {
  test.setTimeout(60_000);
  const catalog = await interceptCatalog(page);
  try {
    await openSettings(page);
    const key = page.getByLabel("API key");
    const url = page.getByRole("textbox", { name: "Base URL" });
    const models = page.getByRole("textbox", { name: "Modelli rilevati / manuali" });
    const read = page.getByRole("button", { name: "Leggi /models" });
    await key.fill("sk-fixture-model-list-only");
    await models.fill("manually-selected");

    await read.click();
    await catalog.wait(1);
    await url.fill("https://changed.example.test/v1");
    catalog.release(1);
    await expect(page.getByText(/Catalogo ignorato: endpoint, chiave o modelli modificati/)).toBeVisible();
    await expect(models).toHaveValue("manually-selected");

    await url.fill("https://api.openai.com/v1");
    await read.click();
    await catalog.wait(2);
    await key.fill("sk-second-local-fixture");
    catalog.release(2);
    await expect(page.getByText(/Catalogo ignorato: endpoint, chiave o modelli modificati/)).toBeVisible();
    await expect(models).toHaveValue("manually-selected");

    await read.click();
    await catalog.wait(3);
    await models.fill("new-manual-choice");
    catalog.release(3);
    await expect(page.getByText(/Catalogo ignorato: endpoint, chiave o modelli modificati/)).toBeVisible();
    await expect(models).toHaveValue("new-manual-choice");
    expect(catalog.count()).toBe(3);
  } finally { catalog.releaseAll(); }
});

test("solo l'ultima ricerca concorrente aggiorna i modelli; salvataggio persistente", async ({ page }) => {
  test.setTimeout(60_000);
  const catalog = await interceptCatalog(page);
  try {
    await openSettings(page);
    await page.getByLabel("API key").fill("sk-fixture-model-concurrent");
    const models = page.getByRole("textbox", { name: "Modelli rilevati / manuali" });
    await models.fill("manual-before");
    const read = page.getByRole("button", { name: "Leggi /models" });
    await read.click(); await catalog.wait(1);
    await read.click(); await catalog.wait(2);

    catalog.release(2);
    await expect(models).toHaveValue("catalog-2");
    await expect(page.getByText("Trovati 1 modelli. Premi Salva impostazioni per conservarli.")).toBeVisible();

    catalog.release(1);
    // The earlier request cannot overwrite the newer accepted catalogue.
    await expect(models).toHaveValue("catalog-2");
    await page.getByRole("button", { name: "Salva impostazioni" }).click();
    await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
    await page.reload();
    const nav = page.getByRole("navigation", {
      name: test.info().project.name === "mobile-chromium" ?
        "Navigazione mobile" : "Navigazione principale",
    });
    await nav.getByRole("button", { name: "Impostazioni" }).click();
    await expect(page.getByRole("textbox", { name: "Modelli rilevati / manuali" }))
      .toHaveValue("catalog-2");
  } finally { catalog.releaseAll(); }
});

test("catalogo in arrivo per profilo rimosso non aggiorna altri endpoint", async ({ page }) => {
  test.setTimeout(60_000);
  const catalog = await interceptCatalog(page);
  try {
    await openSettings(page);
    await page.getByRole("button", { name: "Aggiungi endpoint" }).click();
    await expect(page.getByRole("textbox", { name: "Base URL" })).toHaveCount(2);
    await page.getByLabel("API key").last().fill("sk-temporary-second-endpoint");
    await page.getByRole("button", { name: "Leggi /models" }).last().click();
    await catalog.wait(1);
    await page.getByRole("button", { name: "Rimuovi" }).last().click();
    await expect(page.getByRole("textbox", { name: "Base URL" })).toHaveCount(1);
    catalog.release(1);
    await expect(page.getByText(/Catalogo ignorato: endpoint, chiave o modelli modificati/)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Modelli rilevati / manuali" }))
      .toHaveValue("");
    expect(catalog.count()).toBe(1);
  } finally { catalog.releaseAll(); }
});
