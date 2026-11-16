import { expect, test } from "@playwright/test";

test("modelli del libro: eredita dalle globali, cambio di gruppo e ritorno all'ereditarietà", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Romanzo con modelli propri");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Un libro per verificare l'ereditarietà dei modelli.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();
  await page.getByRole("button", { name: "Modelli e redazione" }).click();

  await expect(page.getByText("Questo libro eredita modelli e thinking dalle Impostazioni globali.")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);

  await page.getByRole("button", { name: "Crea le impostazioni di questo libro" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("del libro", { exact: true })).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Seleziona Scrittura" }).check();
  await page.getByRole("checkbox", { name: "Seleziona Direttore editoriale" }).check();
  await page.getByRole("textbox", { name: "Modello per le attività selezionate" }).fill("modello-di-gruppo");
  await page.getByRole("button", { name: "Applica alle selezionate" }).click();
  await expect(page.getByText("Modello aggiornato per 2 attività di questo libro.")).toBeVisible();
  await expect(page.getByText("del libro", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "Modello libro per Scrittura" })).toHaveValue("modello-di-gruppo");
  await expect(page.getByRole("textbox", { name: "Modello libro per Direttore editoriale" })).toHaveValue("modello-di-gruppo");

  await page.getByRole("checkbox", { name: "Seleziona Scrittura" }).check();
  await page.getByRole("button", { name: "Eredita dalle Impostazioni" }).click();
  await expect(page.getByText("del libro", { exact: true })).toHaveCount(1);

  page.once("dialog", dialog => void dialog.accept());
  await page.getByRole("button", { name: "Eredita tutto dalle Impostazioni" }).click();
  await expect(page.getByText("Questo libro eredita modelli e thinking dalle Impostazioni globali.")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});
