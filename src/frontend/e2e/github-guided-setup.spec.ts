import { expect, test, type Page } from "@playwright/test";
import { newBook } from "../src/domain/types";

const TOKEN = "github_pat_synthetic_guided_setup_2026";
const HEAD = "a".repeat(40);
const metadata = { name: "novel", owner: { login: "setup-owner" }, private: true,
  default_branch: "trunk", permissions: { push: true } };
const nav = (page: Page) => page.getByRole("navigation", {
  name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
});

async function prepare(page: Page, options: { multiple?: boolean; existing?: boolean; rejectLease?: boolean } = {}) {
  let empty = !options.existing;
  let puts = 0, leasePosts = 0;
  const remoteBook = newBook("Synthetic remote idea", "Remote manuscript", "", "");
  await page.route("https://api.github.com/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const headers = { "content-type": "application/json", "access-control-allow-origin": "*",
      "access-control-expose-headers": "X-RateLimit-Reset",
      "X-RateLimit-Reset": String(Math.floor((Date.now() + 30 * 60_000) / 1000)) };
    const reply = (body: unknown, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(body) });
    if (url.pathname === "/user/repos") return reply(options.multiple
      ? [metadata, { ...metadata, name: "public-novel", private: false }]
      : [metadata]);
    const path = url.pathname.replace(/^\/repos\/setup-owner\/(?:novel|public-novel)/, "");
    if (!path) return reply({ ...metadata, private: !url.pathname.includes("public-novel") });
    if (path === "/branches") return reply(empty ? [] : [{ name: "trunk" }]);
    if (path === "/git/ref/heads/trunk") return reply({ object: { sha: HEAD } });
    if (path === "/contents/.bookwriter/initialization.json" && method === "PUT") {
      const body = req.postDataJSON() as { content: string; sha?: string };
      expect(body.sha).toBeUndefined();
      expect(Buffer.from(body.content, "base64").toString()).toBe('{"schemaVersion":1,"purpose":"bookwriter-initialization"}\n');
      puts++; empty = false;
      return reply({ commit: { sha: HEAD } }, 201);
    }
    if (path === "/contents/.bookwriter/project.json" && options.existing)
      return reply({ type: "file", encoding: "base64", content: Buffer.from(JSON.stringify(remoteBook)).toString("base64") });
    if (path === "/contents/.bookwriter/activities.json" && options.existing)
      return reply({ type: "file", encoding: "base64", content: btoa("[]") });
    if (path.startsWith("/git/ref/heads/bookwriter-lock/")) return reply({}, 404);
    if (path.startsWith("/git/commits/")) return reply({ tree: { sha: "b".repeat(40) } });
    if (path === "/git/trees") return reply({ sha: "c".repeat(40) });
    if (path === "/git/commits") return reply({ sha: "d".repeat(40) });
    if (path === "/git/refs" && options.rejectLease) { leasePosts++; return reply({ message: TOKEN }, 422); }
    return reply({}, 404);
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Local manuscript");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  await nav(page).getByRole("button", { name: "Archivio", exact: true }).click();
  await page.getByLabel("PAT GitHub", { exact: true }).fill(TOKEN);
  await page.getByRole("button", { name: "Salva PAT cifrato", exact: true }).click();
  return { puts: () => puts, leasePosts: () => leasePosts, remoteBook };
}

test("PAT mostrabile e riutilizzabile, repository vuota collegata senza campi manuali", async ({ page }) => {
  const api = await prepare(page);
  await expect(page.getByText(/Libro collegato a setup-owner\/novel/)).toBeVisible();
  expect(api.puts()).toBe(1);
  await expect(page.getByRole("textbox", { name: "Owner GitHub", exact: true })).toBeHidden();
  const saved = page.getByRole("textbox", { name: "PAT salvato", exact: true });
  await expect(saved).not.toHaveValue(TOKEN);
  await page.getByRole("button", { name: "Mostra PAT", exact: true }).click();
  await expect(saved).toHaveValue(TOKEN);
  await page.getByRole("button", { name: "Nascondi PAT", exact: true }).click();
  await expect(saved).not.toHaveValue(TOKEN);
  await page.getByRole("button", { name: "Usa lo stesso PAT per un altro libro", exact: true }).click();
  await expect(page.getByRole("region", { name: "Nuovo libro", exact: true })).toBeVisible();
  await expect(page.getByText(/Il PAT GitHub è già salvato/)).toBeVisible();
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Second manuscript");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  await nav(page).getByRole("button", { name: "Archivio", exact: true }).click();
  await page.getByRole("button", { name: "Mostra PAT", exact: true }).click();
  await expect(saved).toHaveValue(TOKEN);
  await page.reload();
  await expect(saved).not.toHaveValue(TOKEN);
  expect(api.puts()).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("con più repository chiede solo la scelta; una pubblica non viene inizializzata senza consenso", async ({ page }) => {
  const api = await prepare(page, { multiple: true });
  const repos = page.getByRole("list", { name: "Repository trovate" });
  await expect(repos.getByRole("listitem")).toHaveCount(2);
  expect(api.puts()).toBe(0);
  page.once("dialog", dialog => dialog.dismiss());
  await repos.getByRole("listitem").filter({ hasText: "public-novel" }).getByRole("button").click();
  await expect(page.getByText(/Verifica delle repository GitHub in corso/)).toHaveCount(0);
  expect(api.puts()).toBe(0);
  await repos.getByRole("listitem").filter({ hasText: "setup-owner/novel" }).getByRole("button").click();
  await expect(page.getByText(/Libro collegato a setup-owner\/novel/)).toBeVisible();
  expect(api.puts()).toBe(1);
});

test("riconosce un libro esistente e lo importa solo su clic, senza sostituire l'originale", async ({ page }) => {
  const api = await prepare(page, { existing: true });
  await expect(page.getByText(/Trovato «Remote manuscript»/)).toBeVisible();
  await page.getByRole("button", { name: "Apri o importa «Remote manuscript»", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Libro attivo" })).toHaveValue(api.remoteBook.id);
  await expect.poll(async () => (await page.getByRole("combobox", { name: "Libro attivo" }).locator("option").allTextContents()).sort())
    .toEqual(["+ Nuovo libro", "Local manuscript", "Remote manuscript"]);
  expect(api.puts()).toBe(0);
});

test("rifiuto del lease: mostra operazione e HTTP, non inventa un altro browser e non avvia AI", async ({ page }) => {
  const api = await prepare(page, { rejectLease: true });
  await expect(page.getByText(/Libro collegato a setup-owner\/novel/)).toBeVisible();
  await nav(page).getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Autopilot", exact: true }).click();
  await expect(page.getByText(/GitHub ha rifiutato la creazione del ramo.*HTTP 422/)).toBeVisible();
  await expect(page.getByText(/Lease aggiornato da un altro browser/)).toHaveCount(0);
  expect(api.leasePosts()).toBe(1);
  await expect(page.getByText(/Da avviare · Brainstorming/, { exact: true })).toBeVisible();
  await nav(page).getByRole("button", { name: "Archivio", exact: true }).click();
  await page.getByRole("button", { name: "Verifica blocco GitHub", exact: true }).click();
  await expect(page.getByText(/Nessun lock remoto attivo/)).toBeVisible();
});
