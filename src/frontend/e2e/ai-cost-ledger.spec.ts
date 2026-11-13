import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("ledger CSV desktop/mobile: download locale, costo stimato e dati privati esclusi", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Romanzo ledger");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Un libro che verifica i consumi della propria AI.");
  await page.getByRole("button", { name: "Crea libro" }).click();

  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["books", "activities"], "readwrite");
      const get = tx.objectStore("books").getAll();
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const book = get.result[0] as { id: string };
        const activities = tx.objectStore("activities");
        const common = {
          bookId: book.id, runId: "run-test", phase: "prose",
          title: "PROSA_SEGRETA_NON_EXPORTARE",
          reason: "PROMPT_PRIVATO_NON_EXPORTARE",
          nextStep: "PROMPT_PRIVATO_NON_EXPORTARE",
          summary: "MANOSCRITTO_PRIVATO_NON_EXPORTARE",
          createdAt: "2026-11-11T09:00:00.000Z", status: "succeeded",
        };
        const snapshot = {
          ...common, id: "ledger-priced", endpointId: "provider",
          modelId: "=FORMULA", aiRequested: true, inputTokens: 2000,
          outputTokens: 1000, priceRateSnapshot: {
            endpointId: "provider", modelId: "=FORMULA",
            inputEurPerMillion: 3, outputEurPerMillion: 9,
          },
        };
        activities.put(snapshot, snapshot.id);
        const missing = {
          ...common, id: "ledger-missing", endpointId: "provider",
          modelId: "unpriced", status: "failed", aiRequested: true,
        };
        activities.put(missing, missing.id);
        activities.put({
          ...common, id: "manual-dont-export",
        }, "manual-dont-export");
        activities.put({
          ...snapshot, id: "other-book-dont-export", bookId: book.id + "-other",
        }, "other-book-dont-export");
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await page.getByRole("button", { name: "Costi", exact: true }).click();
  const panel = page.getByRole("region", { name: "Budget AI" });
  await expect(panel.getByRole("button", { name: "Esporta ledger CSV" })).toBeEnabled();
  const downloading = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Esporta ledger CSV" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^bookwriter-ledger-[a-zA-Z0-9_-]+\.csv$/);
  const file = await download.path();
  expect(file).toBeTruthy();
  const csv = await readFile(file!, "utf8");
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv).toContain('"ledger-priced"');
  expect(csv).toContain('"\'=FORMULA"');
  expect(csv).toContain('"2000";"";"1000";"completo";"snapshot";"3";"9";"";"0.015";"";"non_disponibile"');
  expect(csv).toContain('"ledger-missing"');
  expect(csv).toContain('"mancante";"tariffa_assente";"";"";"";"";"";"non_disponibile"');
  expect(csv).not.toMatch(/PROSA_SEGRETA|PROMPT_PRIVATO|MANOSCRITTO_PRIVATO|manual-dont-export|other-book-dont-export/);
  expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3);
  await expect(panel.getByText(/CSV del ledger preparato localmente/)).toBeVisible();
  const width = await page.evaluate(() => ({
    actual: document.documentElement.scrollWidth, viewport: window.innerWidth,
  }));
  expect(width.actual).toBeLessThanOrEqual(width.viewport + 1);
});
