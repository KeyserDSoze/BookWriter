import { expect, test } from "@playwright/test";

async function createBook(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill(title);
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" }).fill("Un libro per provare gli indirizzi.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();
}

test("indirizzi: F5 riapre pagina, libro, capitolo e task; Indietro torna alla pagina precedente (desktop/mobile)", async ({ page }) => {
  test.setTimeout(90_000);
  const mobile = test.info().project.name === "mobile-chromium";
  const nav = page.getByRole("navigation", { name: mobile ? "Navigazione mobile" : "Navigazione principale" });
  await page.goto("/");
  await createBook(page, "Primo indirizzo");
  await nav.getByRole("button", { name: "Libreria" }).click();
  await page.getByRole("button", { name: "Nuovo libro" }).click();
  await createBook(page, "Secondo indirizzo");

  // Page + book survive a refresh.
  await nav.getByRole("button", { name: "Costi", exact: true }).click();
  await expect(page).toHaveURL(/#\/costi\?book=/);
  await page.reload();
  await expect(page.getByRole("region", { name: "Budget AI" })).toBeVisible();
  await expect(page.locator("#book-select option:checked")).toHaveText("Secondo indirizzo");

  // The URL decides the book, not the last one opened.
  await nav.getByRole("button", { name: "Libreria" }).click();
  await page.getByRole("button", { name: "Apri Primo indirizzo" }).click();
  await page.reload();
  await expect(page.locator("#book-select option:checked")).toHaveText("Primo indirizzo");
  const url = page.url();
  await page.goto("/");
  await page.goto(url.replace(/#.*/, "") + "#/costi?book=" + new URL(url).hash.match(/book=([\w.:-]+)/)![1]);
  await expect(page.locator("#book-select option:checked")).toHaveText("Primo indirizzo");

  // Back returns to the previous page.
  await nav.getByRole("button", { name: "Attività" }).click();
  await expect(page).toHaveURL(/#\/attivita/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/costi/);
  await expect(page.getByRole("region", { name: "Budget AI" })).toBeVisible();
});

test("indirizzi: il capitolo aperto nel libro resta dopo F5", async ({ page }) => {
  test.setTimeout(60_000);
  const mobile = test.info().project.name === "mobile-chromium";
  const nav = page.getByRole("navigation", { name: mobile ? "Navigazione mobile" : "Navigazione principale" });
  await page.goto("/");
  await createBook(page, "Libro con capitoli");
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("books", "readwrite");
      const store = tx.objectStore("books");
      const all = store.getAll();
      all.onsuccess = () => {
        const book = all.result[0] as Record<string, unknown>;
        book.status = "paused"; book.phase = "prose";
        book.chapters = [1, 2].map(n => ({ id: `ch-${n}`, number: n, title: `Titolo ${n}`, purpose: "Scopo",
          scenes: [{ id: `sc-${n}`, number: 1, title: `Scena ${n}`, objective: "Obiettivo", status: "canon", summary: "S", text: `Testo del capitolo ${n}.` }] }));
        store.put(book, book.id as string);
        tx.oncomplete = () => resolve();
      };
    };
  }));
  await page.reload();
  await nav.getByRole("button", { name: "Libro", exact: true }).click();
  await page.getByRole("button", { name: "Cap. 2", exact: true }).click();
  await expect(page).toHaveURL(/chapter=ch-2/);
  await expect(page.getByText("Testo del capitolo 2.")).toBeVisible();
  await expect(page.getByText("Testo del capitolo 1.")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Testo del capitolo 2.")).toBeVisible();
  await expect(page.getByText("Testo del capitolo 1.")).toHaveCount(0);
  await page.getByRole("button", { name: "Tutto il libro" }).click();
  await expect(page.getByText("Testo del capitolo 1.")).toBeVisible();
});

test("lavoro in background: il riquadro in basso a destra segnala il libro in esecuzione e porta al task (desktop/mobile)", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await createBook(page, "Libro al lavoro");
  const other = await page.context().newPage();
  await other.goto("/");
  await expect(other.locator("#book-select option:checked")).toHaveText("Libro al lavoro");
  const bookId = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(["books", "activities"], "readwrite");
      const store = tx.objectStore("books");
      const all = store.getAll();
      all.onsuccess = () => {
        const book = all.result[0] as Record<string, unknown>;
        book.status = "running";
        store.put(book, book.id as string);
        tx.objectStore("activities").put({ id: "act-bg", bookId: book.id, runId: "r", phase: "brainstorm", title: "Brainstorming in corso",
          reason: "r", nextStep: "n", status: "running", createdAt: new Date().toISOString(), aiRequested: true }, "act-bg");
        tx.oncomplete = () => resolve(book.id as string);
      };
    };
  }));
  // The run belongs to another tab: it holds the writer lock, so this tab must not "recover" it.
  await other.evaluate(id => { void navigator.locks.request("bookwriter:writer:" + id, () => new Promise(() => undefined)); }, bookId);
  await page.reload();
  const toast = page.getByRole("complementary", { name: "Lavoro in background" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Autopilot al lavoro");
  await toast.getByRole("button", { name: /Autopilot al lavoro/ }).click();
  await toast.getByRole("button", { name: /Apri il lavoro in corso su Libro al lavoro/ }).click();
  await expect(page).toHaveURL(/#\/attivita\?book=/);
});
