import { test, expect } from "@playwright/test";

const brief = "Un thriller storico realistico, con intrecci a lungo termine, personaggi complessi e misteri distribuiti su più capitoli.";

async function createBook(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Romanzo di prova");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" }).fill(brief);
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText("Libro creato in IndexedDB.")).toBeVisible();
}

test("workspace responsive e accessibile, anche dopo reload", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  const mobile = testInfo.project.name === "mobile-chromium";
  const nav = page.getByRole("navigation", { name: mobile ? "Navigazione mobile" : "Navigazione principale" });
  await expect(nav).toBeVisible();
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await expect(page.getByRole("heading", { name: "Endpoint OpenAI-compatible" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);

  await nav.getByRole("button", { name: "Dashboard" }).click();
  await createBook(page);
  await page.reload();
  await expect(page.getByText(brief)).toBeVisible();
  await expect(page.getByText("Da avviare · Brainstorming")).toBeVisible();
});

test("ZIP di contenuto esportabile e reimportabile senza sovrascrivere", async ({ page }) => {
  await createBook(page);
  const mobile = test.info().project.name === "mobile-chromium";
  if (mobile) {
    const metrics = await page.evaluate(() => {
      const nav = document.querySelector(".mobile-tabs");
      const rect = nav?.getBoundingClientRect();
      return {
        innerWidth: innerWidth, innerHeight: innerHeight, scrollY: scrollY,
        docHeight: document.documentElement.scrollHeight,
        rect: rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } : null,
        position: nav ? getComputedStyle(nav).position : "missing",
        visualHeight: visualViewport?.height,
        visualOffsetTop: visualViewport?.offsetTop,
      };
    });
    console.log("Mobile bottom-nav metrics after book creation:", JSON.stringify(metrics));
  }
  await page.getByRole("button", { name: "Archivio" }).click();
  await expect(page.getByRole("heading", { name: "Backup ZIP", exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Scarica backup ZIP" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/bookwriter-content.*\.zip$/);

  page.on("dialog", dialog => { void dialog.accept(); });
  await page.getByLabel("Archivio BookWriter (.zip)").setInputFiles(await download.path());
  await page.getByRole("button", { name: "Importa ZIP" }).click();
  await expect(page.getByText(/1 libri importati come copie/)).toBeVisible();

  await page.reload();
  const options = page.locator("#book-select option");
  await expect(options).toHaveCount(3);
  await expect(page.locator("#book-select")).toContainText("Romanzo di prova (importato)");
});
