import { expect, test } from "@playwright/test";

test("thinking: i livelli arrivano da LM Studio, i menu li rispettano e il preset usa solo quelli dichiarati (desktop/mobile)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "http://localhost:1234/v1/models")
        return json({ data: [{ id: "meta/muse-glimmer" }, { id: "plain-model" }] });
      if (url === "http://localhost:1234/api/v1/models") return json({ models: [
        { type: "llm", key: "meta/muse-glimmer", capabilities: { vision: true,
          reasoning: { allowed_options: ["low", "medium", "high", "xhigh"], default: "high" } } },
        { type: "llm", key: "plain-model", capabilities: { trained_for_tool_use: true } },
      ] });
      return original(input, init);
    };
  });
  await page.goto("/");
  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByRole("textbox", { name: "Base URL" }).fill("http://localhost:1234/v1");
  await page.getByRole("combobox", { name: "Autenticazione AI" }).selectOption("none");
  await page.getByRole("textbox", { name: "Modello predefinito" }).fill("meta/muse-glimmer");
  const brainstorm = page.getByRole("combobox", { name: "Reasoning di Brainstorming" });
  await expect(page.getByText(/Livelli di meta\/muse-glimmer non verificati/).first()).toBeVisible();

  await page.getByRole("button", { name: "Leggi /models" }).click();
  await expect(page.getByText("Trovati 2 modelli e i livelli di thinking che dichiarano. Premi Salva impostazioni per conservarli.")).toBeVisible();
  await expect(brainstorm.locator("option")).toHaveText([
    "Eredita dall'endpoint",
    "Automatico: non inviare il parametro (usa il predefinito del modello: High)",
    "Low — rapido", "Medium", "High", "Extra high — molto lento",
  ]);
  await expect(page.getByText(/meta\/muse-glimmer supporta: Low, Medium, High, Extra high\. Con «Automatico» usa il suo livello predefinito: High\./).first()).toBeVisible();

  // A model that declares no thinking offers no level at all.
  await page.getByRole("combobox", { name: "Modello per Scrittura" }).selectOption("plain-model");
  const prose = page.getByRole("combobox", { name: "Reasoning di Scrittura" });
  await expect(prose.locator("option")).toHaveText(["Eredita dall'endpoint", "Automatico: non inviare il parametro"]);
  await expect(page.getByText(/plain-model non dichiara un controllo del thinking/).first()).toBeVisible();

  await page.getByRole("button", { name: "Applica thinking consigliato" }).click();
  await expect(page.getByText(/Thinking consigliato applicato a 14 attività; 1 usano modelli senza thinking/)).toBeVisible();
  await expect(brainstorm).toHaveValue("medium");
  await expect(page.getByRole("combobox", { name: "Reasoning di Direttore editoriale" })).toHaveValue("high");
  await expect(page.getByRole("combobox", { name: "Reasoning di Cinque lettori" })).toHaveValue("low");
  await expect(prose).toHaveValue("");

  await page.getByRole("button", { name: "Salva impostazioni" }).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  // The declared levels survive a reload without asking the server again.
  await expect(page.getByRole("combobox", { name: "Reasoning di Brainstorming" })).toHaveValue("medium");
  await expect(page.getByRole("combobox", { name: "Reasoning di Brainstorming" }).locator("option")).toHaveCount(6);
  const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
});
