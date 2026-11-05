import { expect, test } from "@playwright/test";

test("dashboard desktop/mobile: distingue uso misurato, parziale, mancato e diversi libri", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Libro con consumi AI");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Un libro generato con modelli differenti.");
  await page.getByRole("button", { name: "Crea libro" }).click();

  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("bookwriter");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction(["books", "activities"], "readwrite");
        const books = tx.objectStore("books").getAll();
        books.onerror = () => reject(books.error);
        books.onsuccess = () => {
          const book = books.result[0] as { id: string };
          const activities = tx.objectStore("activities");
          const create = (title: string, status: string, modelId: string | undefined,
            endpointId: string | undefined, input?: number, output?: number) => {
            const row = {
              id: crypto.randomUUID(), bookId: book.id, runId: crypto.randomUUID(),
              phase: "prose", title, reason: "Test", nextStep: "Continuare",
              createdAt: new Date().toISOString(), status,
              ...(modelId ? { modelId } : {}),
              ...(endpointId ? { endpointId } : {}),
              ...(input === undefined ? {} : { inputTokens: input }),
              ...(output === undefined ? {} : { outputTokens: output }),
            };
            activities.put(row, row.id);
          };
          create("Scrittura scena", "succeeded", "Sol", "endpoint-one", 120, 45);
          create("Riassunto", "succeeded", "Luna", "endpoint-two", 70);
          create("Provider senza usage", "succeeded", "Astra", "endpoint-three");
          create("Chiamata fallita", "failed", "Sol", "endpoint-one");
          create("Revisione manuale", "succeeded", undefined, undefined);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  const panel = page.getByRole("region", { name: "Consumi AI" });
  await expect(panel.getByRole("heading", { name: "Consumi AI registrati" })).toBeVisible();
  await expect(panel.getByText("190", { exact: true })).toBeVisible();
  await expect(panel.getByText("45", { exact: true })).toBeVisible();
  await expect(panel.getByText("235", { exact: true })).toBeVisible();
  await expect(panel.getByText("Sol", { exact: true })).toBeVisible();
  await expect(panel.getByText("Luna", { exact: true })).toBeVisible();
  await expect(panel.getByText("Astra", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Report completi: 1 · Parziali: 1 · Senza conteggio: 2/)).toBeVisible();
  await expect(panel.getByText(/Conteggio incompleto/)).toBeVisible();
  await expect(panel.getByText(/non corrispondono necessariamente ai crediti rimasti/)).toBeVisible();

  await page.locator("#book-select").selectOption("");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Altro manoscritto");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" }).fill("Altro libro senza AI.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  const freshPanel = page.getByRole("region", { name: "Consumi AI" });
  await expect(freshPanel.getByText(/Non sono ancora disponibili consumi AI/)).toBeVisible();
  await expect(freshPanel.getByText("235", { exact: true })).toHaveCount(0);

  const width = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth, viewport: window.innerWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
});
