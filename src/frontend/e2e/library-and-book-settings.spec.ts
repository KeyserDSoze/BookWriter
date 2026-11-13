import { expect, test, type Page } from "@playwright/test";

async function createBook(page: Page, title: string) {
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill(title);
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Un libro di prova per la libreria.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();
}

test("libreria: elenco, apertura, ultimo libro riaperto al riavvio e impostazioni del libro (desktop/mobile)", async ({ page }) => {
  test.setTimeout(90_000);
  const mobile = test.info().project.name === "mobile-chromium";
  const nav = page.getByRole("navigation", { name: mobile ? "Navigazione mobile" : "Navigazione principale" });
  await page.goto("/");
  await createBook(page, "Primo romanzo");

  // A second book through the library's «Nuovo libro».
  await nav.getByRole("button", { name: "Libreria" }).click();
  await expect(page.getByRole("heading", { name: "I tuoi libri" })).toBeVisible();
  await page.getByRole("button", { name: "Nuovo libro" }).click();
  await createBook(page, "Secondo romanzo");

  await nav.getByRole("button", { name: "Libreria" }).click();
  const list = page.getByRole("list", { name: "Elenco dei libri" });
  await expect(list.getByRole("heading", { name: "Primo romanzo" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Secondo romanzo" })).toBeVisible();

  // Open the first one: it becomes the active book.
  await page.getByRole("button", { name: "Apri Primo romanzo" }).click();
  await expect(page.getByRole("combobox", { name: "Libro attivo" })).toHaveValue(/.+/);
  await expect(page.locator("#book-select option:checked")).toHaveText("Primo romanzo");

  // After a reload the last opened book is reopened, not the first in the list.
  await page.reload();
  await expect(page.locator("#book-select option:checked")).toHaveText("Primo romanzo");
  await nav.getByRole("button", { name: "Libreria" }).click();
  await expect(page.getByRole("button", { name: /Riprendi l'ultimo libro: Primo romanzo/ })).toBeVisible();

  // Book settings are reachable from the library card and are per book.
  await page.getByRole("button", { name: "Modelli e redazione di Secondo romanzo" }).click();
  await expect(page.getByRole("heading", { name: "Modelli e redazione: Secondo romanzo" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Modalità di redazione" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Revisori in parallelo" })).toBeVisible();
  await expect(page.locator("#book-select option:checked")).toHaveText("Secondo romanzo");

  // The global settings page no longer carries the per-book table but links to it.
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await expect(page.getByRole("combobox", { name: "Modalità di redazione" })).toHaveCount(0);
  await page.getByRole("button", { name: /Apri Modelli e redazione di/ }).click();
  await expect(page.getByRole("heading", { name: "Modelli e redazione: Secondo romanzo" })).toBeVisible();
});

test("prezzi per modello nell'endpoint, con input in cache, e riepilogo in sola lettura nei Costi (desktop/mobile)", async ({ page }) => {
  test.setTimeout(90_000);
  const mobile = test.info().project.name === "mobile-chromium";
  const nav = page.getByRole("navigation", { name: mobile ? "Navigazione mobile" : "Navigazione principale" });
  await page.goto("/");
  await createBook(page, "Romanzo con tariffe");
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByLabel("API key").fill("sk-test-prezzi-non-reale");
  await page.getByRole("textbox", { name: "Modello predefinito" }).fill("modello-prezzi");
  await page.getByRole("spinbutton", { name: "Prezzo input per milione: modello-prezzi" }).fill("2");
  await page.getByRole("spinbutton", { name: "Prezzo output per milione: modello-prezzi" }).fill("8");
  await page.getByRole("spinbutton", { name: "Prezzo input in cache per milione: modello-prezzi" }).fill("0.5");
  await page.getByRole("button", { name: "Salva impostazioni" }).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();

  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await expect(page.getByRole("spinbutton", { name: "Prezzo input in cache per milione: modello-prezzi" })).toHaveValue("0.5");

  await page.getByRole("button", { name: "Costi", exact: true }).click();
  const budget = page.getByRole("region", { name: "Budget AI" });
  await expect(budget.getByText(/input 2 · output 8 · input in cache 0\.5/)).toBeVisible();
  await expect(budget.getByRole("spinbutton", { name: /Prezzo input per milione/ })).toHaveCount(0);
});
