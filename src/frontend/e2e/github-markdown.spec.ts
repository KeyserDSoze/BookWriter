import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { syntheticNarrarium } from "../src/domain/__fixtures__/narrarium";
import { projectBook } from "../src/domain/narrarium";
import { newBook } from "../src/domain/types";

const HEAD = "a".repeat(40);
const TOKEN = "github_pat_synthetic_markdown_browser";
const sha = (content: string) => createHash("sha1").update("blob " + Buffer.byteLength(content) + "\0").update(content).digest("hex");
const nav = (page: Page) => page.getByRole("navigation", {
  name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
});

async function prepare(page: Page, files: Record<string, string>) {
  const calls: string[] = [];
  let aiCalls = 0;
  const blobs = new Map(Object.values(files).map(content => [sha(content), content]));
  await page.route("https://api.github.com/**", async route => {
    const req = route.request(), url = new URL(req.url());
    calls.push(req.method() + " " + url.pathname);
    expect(req.method()).toBe("GET");
    const reply = (body: unknown, status = 200) => route.fulfill({ status,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    const repo = { name: "manual-novel", owner: { login: "synthetic-owner" }, private: true,
      default_branch: "main", permissions: { push: true } };
    if (url.pathname === "/user/repos") return reply([repo]);
    const path = url.pathname.replace("/repos/synthetic-owner/manual-novel", "");
    if (!path) return reply(repo);
    if (path === "/branches") return reply([{ name: "main" }]);
    if (path === "/git/ref/heads/main") return reply({ object: { sha: HEAD } });
    if (path.startsWith("/contents/")) {
      expect(url.searchParams.get("ref")).toBe(HEAD);
      const content = files[decodeURIComponent(path.slice("/contents/".length))];
      return content === undefined ? reply({}, 404) : reply({ type: "file", encoding: "base64", content: Buffer.from(content).toString("base64") });
    }
    if (path === "/git/trees/" + HEAD) return reply({ truncated: false,
      tree: Object.entries(files).map(([path, content]) => ({ path, sha: sha(content), mode: "100644", type: "blob" })) });
    if (path.startsWith("/git/blobs/")) {
      const content = blobs.get(path.split("/").at(-1)!)!;
      return reply({ encoding: "base64", size: Buffer.byteLength(content), content: Buffer.from(content).toString("base64") });
    }
    return reply({}, 404);
  });
  await page.route("**/chat/completions", async route => { aiCalls++; await route.abort(); });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Libro locale intatto");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  const before = await page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    return (await (await getDb()).getAll("books"))[0];
  });
  await nav(page).getByRole("button", { name: "Archivio", exact: true }).click();
  await page.getByLabel("PAT GitHub", { exact: true }).fill(TOKEN);
  await page.getByRole("button", { name: "Salva PAT cifrato", exact: true }).click();
  return { calls, before, aiCalls: () => aiCalls };
}

test("un libro Markdown manuale si riconosce e importa senza JSON, AI o scritture GitHub", async ({ page }) => {
  const api = await prepare(page, syntheticNarrarium);
  await expect(page.getByText(/Trovato «Il porto di prova» in formato Markdown/)).toBeVisible();
  expect(await page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    return (await (await getDb()).getAll("books")).length;
  })).toBe(1);
  await page.getByRole("button", { name: "Apri o importa «Il porto di prova»", exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    return (await (await getDb()).getAll("books")).length;
  })).toBe(2);
  const books = await page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    return (await (await getDb()).getAll("books"));
  });
  expect(books.find(b => b.id === api.before.id)).toEqual(api.before);
  const imported = books.find(b => b.id !== api.before.id)!;
  expect(imported.chapters[0].scenes[0].text).toContain("Il vento si ferma.");
  expect(imported.chapters[0].scenes[0].viewpoint).toBe("character:mara");
  expect(imported.markdownSource["reviews/sinossi-autore.md"]).toBe(syntheticNarrarium["reviews/sinossi-autore.md"]);
  expect(imported.status).toBe("paused");
  expect(imported.chapters[0].frozenAt).toBeUndefined();
  expect(api.calls.every(call => call.startsWith("GET "))).toBe(true);
  expect(api.aiCalls()).toBe(0);
});

test("una scena modificata fuori dall'app non viene nascosta dal JSON: copia separata solo su conferma", async ({ page }) => {
  const source = newBook("Premessa", "Versione JSON precedente", "Stile", "Adulti");
  // Use the complete interoperable fixture as the source of the application snapshot.
  const files = projectBook(source, []).files;
  Object.assign(files, syntheticNarrarium);
  const api = await prepare(page, files);
  await expect(page.getByText(/I Markdown e lo snapshot BookWriter sono diversi o non confrontabili/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Apri o importa «Versione JSON precedente»/ })).toHaveCount(0);
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Importa Markdown come copia separata", exact: true }).click();
  expect(await page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    return (await (await getDb()).getAll("books")).length;
  })).toBe(1);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Importa Markdown come copia separata", exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    return (await (await getDb()).getAll("books")).length;
  })).toBe(2);
  const books = await page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    return (await (await getDb()).getAll("books"));
  });
  expect(books.find(b => b.id === api.before.id)).toEqual(api.before);
  const copy = books.find(b => b.id !== api.before.id)!;
  expect(copy.title).toContain("copia Markdown");
  expect(copy.remote).toBeUndefined();
  expect(copy.chapters[0].scenes[0].text).toContain("Il vento si ferma.");
  expect(copy.editorialCycle).toBeUndefined();
  expect(api.calls.every(call => call.startsWith("GET "))).toBe(true);
  expect(api.aiCalls()).toBe(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
