import { test, expect } from "@playwright/test";

test("collegamento GitHub usa un PAT locale e persiste tra reload", async ({ page }) => {
  await page.route("https://api.github.com/repos/demo-owner/book-one", async route => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      body: JSON.stringify({
        private: true, full_name: "demo-owner/book-one",
        default_branch: "main", permissions: { push: true },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Libro sincronizzabile");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" }).fill(
    "Una storia originale con numerosi personaggi, luoghi e segreti.",
  );
  await page.getByRole("button", { name: "Crea libro" }).click();

  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Archivio" }).click();
  await expect(page.getByRole("heading", { name: /GitHub — sincronizzazione del libro/ })).toBeVisible();

  await page.getByRole("textbox", { name: "PAT GitHub" }).fill("github_pat_mock_for_browser_testing_2026");
  await page.getByRole("button", { name: "Salva PAT cifrato" }).click();
  await expect(page.getByText(/PAT salvato cifrato nel browser/)).toBeVisible();

  await page.getByRole("textbox", { name: "Owner GitHub" }).fill("demo-owner");
  await page.getByRole("textbox", { name: "Repository del libro" }).fill("book-one");
  await page.getByRole("textbox", { name: "Branch" }).fill("main");
  await page.getByRole("button", { name: "Verifica repository" }).click();
  await expect(page.getByText(/Repository privata verificata/)).toBeVisible();

  await page.getByRole("button", { name: "Collega questo libro" }).click();
  await expect(page.getByText(/Libro collegato a demo-owner\/book-one/)).toBeVisible();
  await expect(page.getByText(/demo-owner\/book-one · main/)).toBeVisible();

  await page.reload();
  await nav.getByRole("button", { name: "Archivio" }).click();
  await expect(page.getByText(/demo-owner\/book-one · main/)).toBeVisible();
  await expect(page.getByText(/Configurato nel browser/)).toBeVisible();
});
