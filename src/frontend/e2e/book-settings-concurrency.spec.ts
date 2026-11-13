import { expect, test, type Page } from "@playwright/test";

async function bookState(page: Page) {
  return page.evaluate(() => new Promise<{
    id: string; updatedAt: string;
    prose?: { endpointId: string; modelId: string };
  }>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("books", "readonly");
      const all = tx.objectStore("books").getAll();
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        const book = all.result[0] as {
          id: string; updatedAt: string;
          modelRoutes?: { prose?: { endpointId: string; modelId: string } };
        };
        db.close();
        if (!book) reject(new Error("Libro assente da IndexedDB"));
        else resolve({
          id: book.id, updatedAt: book.updatedAt,
          prose: book.modelRoutes?.prose,
        });
      };
    };
  }));
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Modelli e redazione" }).click();
  await expect(page.getByRole("heading", { name: /Modelli e redazione:/ })).toBeVisible();
}

test("due schede: override modello stale rifiutato, writer attivo protetto, retry dopo rilascio", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Romanzo per concorrenza");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Un libro lungo per verificare il salvataggio concorrente.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();
  await openSettings(page);

  const second = await page.context().newPage();
  try {
    await second.goto("/");
    await openSettings(second);
    const firstInput = page.getByRole("textbox", { name: "Modello libro per Scrittura" });
    const secondInput = second.getByRole("textbox", { name: "Modello libro per Scrittura" });
    const id = (await bookState(page)).id;

    await firstInput.fill("first-model");
    await firstInput.press("Tab");
    await expect(page.getByText("Modello per il libro aggiornato in sicurezza.")).toBeVisible();
    await expect.poll(async () => (await bookState(page)).prose?.modelId).toBe("first-model");

    // Tab two still has an old React snapshot and must not overwrite tab one's book.
    await secondInput.fill("obsolete-model");
    await secondInput.press("Tab");
    await expect(second.getByText(/Il libro è cambiato in un'altra scheda/)).toBeVisible();
    expect((await bookState(second)).prose?.modelId).toBe("first-model");
    await expect(second.getByRole("textbox", { name: "Modello libro per Scrittura" }))
      .toHaveValue("first-model");

    // Holding the real Web Lock simulates a live autopilot writer in tab one.
    await page.evaluate(bookId => {
      void navigator.locks.request("bookwriter:writer:" + bookId, async lock => {
        if (!lock) return;
        document.documentElement.dataset.manualLock = "held";
        await new Promise<void>(resolve => {
          (window as Window & { releaseManualLock?: () => void }).releaseManualLock = resolve;
        });
      });
    }, id);
    await expect.poll(() => page.evaluate(
      () => document.documentElement.dataset.manualLock,
    )).toBe("held");

    const blockedInput = second.getByRole("textbox", { name: "Modello libro per Scrittura" });
    await blockedInput.fill("during-writer");
    await blockedInput.press("Tab");
    await expect(second.getByText(/Un'altra scheda sta scrivendo questo libro/)).toBeVisible();
    expect((await bookState(second)).prose?.modelId).toBe("first-model");

    await page.evaluate(() => {
      (window as Window & { releaseManualLock?: () => void }).releaseManualLock?.();
    });
    await expect.poll(async () => page.evaluate(async bookId => {
      const locks = await navigator.locks.query();
      return locks.held?.some(lock => lock.name === "bookwriter:writer:" + bookId) ?? false;
    }, id)).toBe(false);

    const retryInput = second.getByRole("textbox", { name: "Modello libro per Scrittura" });
    await expect(retryInput).toHaveValue("first-model");
    await retryInput.fill("final-model");
    await retryInput.press("Tab");
    await expect(second.getByText("Modello per il libro aggiornato in sicurezza.")).toBeVisible();
    await expect.poll(async () => (await bookState(second)).prose?.modelId).toBe("final-model");
  } finally {
    await second.close();
  }
});
