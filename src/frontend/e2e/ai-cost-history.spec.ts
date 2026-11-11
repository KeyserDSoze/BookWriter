import { expect, test } from "@playwright/test";

test("storico costi AI desktop/mobile: dieci righe, filtro incerti, altri task e libro isolato", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Storico costi AI");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Libro di prova per la consultazione del ledger per task.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(["books", "activities"], "readwrite");
      const req = tx.objectStore("books").getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const book = req.result[0] as { id: string };
        const target = tx.objectStore("activities");
        const rate = { endpointId: "provider-task", modelId: "model-task",
          inputEurPerMillion: 3, outputEurPerMillion: 9 };
        for (let i = 0; i < 13; i++) {
          const activity = {
            id: "task-" + String(i).padStart(2, "0"), bookId: book.id,
            runId: "run-task", phase: "chapterReview",
            title: "Revisore AI " + i, reason: "PROMPT_NON_MOSTRARE",
            nextStep: "RISPOSTA_NON_MOSTRARE", summary: "PROSA_NON_MOSTRARE",
            output: "MANOSCRITTO_NON_MOSTRARE", error: "CHIAVE_NON_MOSTRARE",
            status: i === 12 ? "failed" : "succeeded",
            createdAt: new Date(Date.UTC(2026, 10, 11, 9, i)).toISOString(),
            endpointId: rate.endpointId, modelId: rate.modelId,
            aiRequested: true, priceRateSnapshot: rate,
            ...(i === 12 ? {} : { inputTokens: 2000, outputTokens: 1000 }),
          };
          target.put(activity, activity.id);
        }
        target.put({
          id: "manual-hidden", bookId: book.id, runId: "run-task",
          title: "Manuale", phase: "review", status: "succeeded",
          reason: "Senza provider", nextStep: "Nessuna chiamata",
          createdAt: "2026-11-11T10:00:00.000Z",
        }, "manual-hidden");
        target.put({
          id: "other-book-hidden", bookId: book.id + "-other", runId: "other",
          title: "Libro privato diverso", phase: "prose", status: "succeeded",
          reason: "Test", nextStep: "Test",
          createdAt: "2026-11-11T10:10:00.000Z",
          endpointId: rate.endpointId, modelId: rate.modelId,
          inputTokens: 9999999, outputTokens: 9999999, aiRequested: true,
          priceRateSnapshot: rate,
        }, "other-book-hidden");
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();

  const panel = page.getByRole("region", { name: "Storico costi AI per task" });
  await expect(panel.getByRole("heading", { name: "Storico dei costi per task AI" })).toBeVisible();
  await expect(panel.locator("ol > li")).toHaveCount(10);
  await expect(panel.getByText("Revisore AI 12", { exact: true })).toBeVisible();
  await expect(panel.getByText("Revisore AI 0", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Stima non calcolabile")).toBeVisible();
  await expect(panel.getByText(/0,015.*€ \(stima\)/).first()).toBeVisible();
  await expect(panel.getByText("Tariffa salvata al tentativo").first()).toBeVisible();
  await expect(panel.getByText("13 tentativi visualizzabili su 13 registrati.")).toBeVisible();
  await expect(panel.getByText(/PROMPT_NON_MOSTRARE|RISPOSTA_NON_MOSTRARE|PROSA_NON_MOSTRARE|MANOSCRITTO_NON_MOSTRARE|CHIAVE_NON_MOSTRARE/)).toHaveCount(0);
  await expect(panel.getByText("Libro privato diverso")).toHaveCount(0);
  await expect(panel.getByText("Manuale")).toHaveCount(0);

  await panel.getByRole("checkbox", { name: "Solo tentativi senza stima" }).check();
  await expect(panel.locator("ol > li")).toHaveCount(1);
  await expect(panel.getByText("1 tentativo visualizzabile su 13 registrati.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Mostra altri 10 tentativi" })).toHaveCount(0);
  await panel.getByRole("checkbox", { name: "Solo tentativi senza stima" }).uncheck();
  await expect(panel.locator("ol > li")).toHaveCount(10);
  await panel.getByRole("button", { name: "Mostra altri 10 tentativi" }).click();
  await expect(panel.locator("ol > li")).toHaveCount(13);
  await expect(panel.getByText("Revisore AI 0", { exact: true })).toBeVisible();

  await page.locator("#book-select").selectOption("");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Secondo libro isolato");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" }).fill("Nessun consumo AI.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  const next = page.getByRole("region", { name: "Storico costi AI per task" });
  await expect(next.getByText("Nessun tentativo AI registrato per questo libro.")).toBeVisible();
  await expect(next.getByText("Revisore AI 12")).toHaveCount(0);
  const widths = await page.evaluate(() => ({
    actual: document.documentElement.scrollWidth, viewport: window.innerWidth,
  }));
  expect(widths.actual).toBeLessThanOrEqual(widths.viewport + 1);
});
