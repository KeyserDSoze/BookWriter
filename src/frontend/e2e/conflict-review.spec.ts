import { expect, test } from "@playwright/test";

test("mobile/desktop: confronto GitHub, selezione consapevole e doppio backup locale", async ({ page }) => {
  let remoteBook: Record<string, unknown> | null = null;
  const HEAD = "b".repeat(40);
  let postCalls = 0;
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,x-github-api-version",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
  };
  const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  await page.route("https://api.github.com/repos/conflict-owner/book-one**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers }); return;
    }
    if (method !== "GET") postCalls += 1;
    let status = 200;
    let body: unknown = {};
    if (path === "/repos/conflict-owner/book-one") {
      body = { private: true, full_name: "conflict-owner/book-one",
        default_branch: "main", permissions: { push: true } };
    } else if (path.endsWith("/git/ref/heads/main")) {
      body = { object: { sha: HEAD } };
    } else if (path.endsWith("/contents/.bookwriter/project.json") && remoteBook) {
      body = { type: "file", encoding: "base64", content: base64(JSON.stringify(remoteBook)) };
    } else if (path.endsWith("/contents/.bookwriter/activities.json")) {
      body = { type: "file", encoding: "base64", content: base64("[]") };
    } else {
      status = 404; body = { message: "Not Found" };
    }
    await route.fulfill({ status, headers, body: JSON.stringify(body) });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Un libro importante");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Il protagonista parte verso il mare.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  const localBook = await page.evaluate(async () => {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const open = indexedDB.open("bookwriter");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const query = open.result.transaction("books", "readonly").objectStore("books").getAll();
        query.onsuccess = () => resolve(query.result[0] as Record<string, unknown>);
        query.onerror = () => reject(query.error);
      };
    });
  });
  remoteBook = {
    ...localBook,
    brief: "Il protagonista decide invece di esplorare una città nascosta.",
  };

  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium"
      ? "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Archivio", exact: true }).click();
  await page.getByLabel("PAT GitHub").fill("github_pat_test_only_conflict_2026");
  await page.getByRole("button", { name: "Salva PAT cifrato" }).click();
  await expect(page.getByText(/PAT salvato cifrato nel browser/)).toBeVisible();
  await page.getByRole("textbox", { name: "Owner GitHub" }).fill("conflict-owner");
  await page.getByRole("textbox", { name: "Repository del libro" }).fill("book-one");
  await page.getByRole("button", { name: "Verifica repository" }).click();
  await page.getByRole("button", { name: "Collega questo libro" }).click();

  await page.getByRole("button", { name: "Confronta locale e GitHub" }).click();
  await expect(page.getByText(/Confronto pronto: 1 differenze/)).toBeVisible();
  await expect(page.getByText(/Baseline:/)).toBeVisible();
  await page.getByText("Brief e premessa", { exact: true }).click();
  await expect(page.getByText(/Il protagonista parte verso il mare/).first()).toBeVisible();
  await expect(page.getByText(/città nascosta/).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Versione da conservare: field:brief" })
    .selectOption("remote");
  page.once("dialog", dialog => dialog.accept());
  const writesBefore = postCalls;
  await page.getByRole("button", { name: /Applica scelte con doppio backup/ }).click();
  await expect(page.getByText(/Risoluzione applicata/)).toBeVisible();
  expect(postCalls).toBe(writesBefore);
  // The selector includes its initial placeholder option plus three books.
  await expect(page.locator("#book-select option")).toHaveCount(4);
  await nav.getByRole("button", { name: "Dashboard" }).click();
  await expect(page.getByText(/Il protagonista decide invece di esplorare una città nascosta/)).toBeVisible();
  await nav.getByRole("button", { name: "Archivio", exact: true }).click();
  await expect(page.getByText(/Modifiche locali da sincronizzare/)).toBeVisible();
  const viewport = await page.evaluate(() =>
    ({ actual: document.documentElement.scrollWidth, expected: window.innerWidth }));
  expect(viewport.actual).toBeLessThanOrEqual(viewport.expected + 1);
});
