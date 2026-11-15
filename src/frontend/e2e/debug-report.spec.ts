import { expect, test } from "@playwright/test";

test("Attività: il prompt di debug si genera sul dispositivo, senza chiamate di rete, e si può copiare", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  const external: string[] = [];
  page.on("request", request => { if (new URL(request.url()).origin !== new URL(page.url() === "about:blank" ? "http://127.0.0.1:5173" : page.url()).origin && !request.url().startsWith("data:")) external.push(request.url()); });
  const mobile = test.info().project.name === "mobile-chromium";
  const nav = page.getByRole("navigation", { name: mobile ? "Navigazione mobile" : "Navigazione principale" });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Libro da debuggare");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  await nav.getByRole("button", { name: "Attività" }).click();
  await expect(page).toHaveURL(/\/attivita/);
  await page.getByText("Debug: prompt con gli ultimi errori").click();
  const area = page.getByRole("textbox", { name: "Prompt di debug" });
  await expect(area).toHaveValue(/# Debug di BookWriter \d+\.\d+\.\d+/);
  await expect(area).toHaveValue(/Libro da debuggare/);
  await expect(area).toHaveValue(/Nessun task fallito o interrotto/);
  await page.getByRole("button", { name: "Copia il prompt" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Copiato|Copia non riuscita/ })).toBeVisible();
  expect(external).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
