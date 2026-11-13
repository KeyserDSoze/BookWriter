import { expect, test } from "@playwright/test";

test("impostazioni compatte: stato di salvataggio sempre visibile, router a tabella con modifiche multiple (desktop/mobile)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const old = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url !== "http://localhost:1234/v1/models") return old(input, init);
      return new Response(JSON.stringify({ data: [{ id: "grande-modello" }, { id: "modello-veloce" }] }),
        { headers: { "content-type": "application/json" } });
    };
  });
  await page.route("http://localhost:1234/v1/**", route => route.abort());
  await page.goto("/");
  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Impostazioni" }).click();

  const saveBar = page.getByText("Tutto salvato");
  await expect(saveBar).toBeVisible();
  await page.getByRole("textbox", { name: "Base URL" }).fill("http://localhost:1234/v1");
  await page.getByRole("combobox", { name: "Autenticazione AI" }).selectOption("none");
  await expect(page.getByText("Modifiche non salvate")).toBeVisible();
  await page.getByRole("button", { name: "Leggi /models" }).click();
  await expect(page.getByText("Trovati 2 modelli", { exact: false })).toBeVisible();

  // Models come from a list: the default is a dropdown once the catalog exists.
  await page.getByRole("combobox", { name: "Modello predefinito" }).selectOption("grande-modello");

  // Filter to the editorial tasks, select them all and change the model in one go.
  await page.getByRole("button", { name: "Redazione", exact: true }).click();
  await expect(page.getByText("4 di 15 attività")).toBeVisible();
  await page.getByRole("checkbox", { name: "Seleziona tutte le attività visibili" }).check();
  await expect(page.getByText("4 selezionate")).toBeVisible();
  await page.getByRole("combobox", { name: "Cambia modello alle attività selezionate" }).selectOption("modello-veloce");
  // Nothing changes until «Applica».
  await expect(page.getByRole("combobox", { name: "Modello per Cinque lettori" })).toHaveValue("");
  await page.getByRole("button", { name: /Applica a 4 attività/ }).click();
  for (const label of ["Specialisti capitolo", "Cinque lettori", "Direttore editoriale", "Remediation mirata"])
    await expect(page.getByRole("combobox", { name: `Modello per ${label}` })).toHaveValue("modello-veloce");

  // Thinking changes independently of the model.
  await page.getByRole("combobox", { name: "Cambia thinking alle attività selezionate" }).selectOption("low");
  await page.getByRole("button", { name: /Applica a 4 attività/ }).click();
  await expect(page.getByRole("combobox", { name: "Reasoning di Cinque lettori" })).toHaveValue("low");
  await expect(page.getByRole("combobox", { name: "Modello per Cinque lettori" })).toHaveValue("modello-veloce");

  // Other tasks are untouched; the "only customised" filter shows exactly the four.
  await page.getByRole("button", { name: "Tutte", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Modello per Scrittura" })).toHaveValue("");
  await page.getByRole("checkbox", { name: "Solo personalizzate" }).check();
  await expect(page.getByText("4 di 15 attività")).toBeVisible();
  await page.getByRole("checkbox", { name: "Solo personalizzate" }).uncheck();

  await page.getByRole("button", { name: "Salva impostazioni" }).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await expect(saveBar).toBeVisible();
  await expect(page.getByText("Modifiche non salvate")).toHaveCount(0);

  await page.reload();
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await expect(page.getByRole("combobox", { name: "Modello predefinito" })).toHaveValue("grande-modello");
  await expect(page.getByRole("combobox", { name: "Modello per Direttore editoriale" })).toHaveValue("modello-veloce");
  await expect(page.getByRole("combobox", { name: "Reasoning di Direttore editoriale" })).toHaveValue("low");

  // Discarding restores the saved values.
  await page.getByRole("combobox", { name: "Modello per Direttore editoriale" }).selectOption("");
  await expect(page.getByText("Modifiche non salvate")).toBeVisible();
  await page.getByRole("button", { name: "Annulla modifiche" }).click();
  await expect(page.getByRole("combobox", { name: "Modello per Direttore editoriale" })).toHaveValue("modello-veloce");
  await expect(saveBar).toBeVisible();

  const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
});

test("router: cambio endpoint in blocco propone i modelli del nuovo endpoint e conserva il thinking (desktop/mobile)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByRole("textbox", { name: "Modelli rilevati / manuali" }).first().fill("base-1, base-2");
  await page.getByRole("button", { name: "Aggiungi endpoint" }).click();
  await page.getByRole("textbox", { name: "Nome endpoint" }).nth(1).fill("Secondo");
  await page.getByRole("textbox", { name: "Modelli rilevati / manuali" }).nth(1).fill("altro-1, altro-2");
  await page.getByRole("combobox", { name: "Modello predefinito" }).selectOption("base-1");

  await page.getByRole("checkbox", { name: "Seleziona tutte le attività visibili" }).check();
  const endpointBar = page.getByRole("combobox", { name: "Cambia endpoint alle attività selezionate" });
  await endpointBar.selectOption({ label: "Secondo" });
  await page.getByRole("combobox", { name: "Cambia modello alle attività selezionate" }).selectOption("altro-2");
  await page.getByRole("combobox", { name: "Cambia thinking alle attività selezionate" }).selectOption("high");
  await page.getByRole("button", { name: /Applica a 15 attività/ }).click();
  await expect(page.getByRole("combobox", { name: "Endpoint per Scrittura" }).locator("option:checked")).toHaveText("Secondo");
  await expect(page.getByRole("combobox", { name: "Modello per Scrittura" })).toHaveValue("altro-2");
  await expect(page.getByRole("combobox", { name: "Reasoning di Scrittura" })).toHaveValue("high");

  // Back to the default endpoint without choosing a model: the old model does not exist there,
  // so the first model of that endpoint is used; the thinking stays as decided.
  await page.getByRole("checkbox", { name: "Seleziona tutte le attività visibili" }).uncheck();
  await page.getByRole("checkbox", { name: "Seleziona Scrittura" }).check();
  const defaultName = await page.getByRole("textbox", { name: "Nome endpoint" }).first().inputValue();
  await endpointBar.selectOption({ label: defaultName });
  await page.getByRole("button", { name: /Applica a 1 attività/ }).click();
  await expect(page.getByRole("combobox", { name: "Modello per Scrittura" })).toHaveValue("base-1");
  await expect(page.getByRole("combobox", { name: "Reasoning di Scrittura" })).toHaveValue("high");
  await expect(page.getByRole("combobox", { name: "Modello per Brainstorming" })).toHaveValue("altro-2");
});
