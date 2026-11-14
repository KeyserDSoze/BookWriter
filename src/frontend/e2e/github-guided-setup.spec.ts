import { expect, test, type Page } from "@playwright/test";
import { newBook } from "../src/domain/types";

const TOKEN = "github_pat_synthetic_guided_setup_2026";
const HEAD = "a".repeat(40);
const metadata = { name: "novel", owner: { login: "setup-owner" }, private: true,
  default_branch: "trunk", permissions: { push: true } };
const nav = (page: Page) => page.getByRole("navigation", {
  name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
});

async function prepare(page: Page, options: { multiple?: boolean; existing?: boolean; rejectLease?: boolean;
  localProgress?: boolean; delayedInitialLease?: boolean; leaseConflictAfterInitialization?: boolean } = {}) {
  let empty = !options.existing;
  let puts = 0, leasePosts = 0;
  let postInitializationLeaseReads = 0;
  let initialLeaseConflict!: () => void;
  const initialLeaseRead = new Promise<void>(resolve => { initialLeaseConflict = resolve; });
  let releaseInitialLease!: () => void;
  const delayedLease = new Promise<void>(resolve => { releaseInitialLease = resolve; });
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
      if (options.localProgress) await initialLeaseRead;
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
    if (path.startsWith("/git/ref/heads/bookwriter-lock/")) {
      if (empty) {
        if (options.delayedInitialLease) {
          initialLeaseConflict();
          await delayedLease;
        }
        await reply({}, 409);
        initialLeaseConflict();
        return;
      }
      postInitializationLeaseReads++;
      return reply({}, options.leaseConflictAfterInitialization ? 409 : 404);
    }
    if (path.startsWith("/git/commits/")) return reply({ tree: { sha: "b".repeat(40) } });
    if (path === "/git/trees") return reply({ sha: "c".repeat(40) });
    if (path === "/git/commits") return reply({ sha: "d".repeat(40) });
    if (path === "/git/refs" && options.rejectLease) { leasePosts++; return reply({ message: TOKEN }, 422); }
    return reply({}, 404);
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Local manuscript");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  const before = options.localProgress ? await page.evaluate(async () => {
    const { getDb, saveBook } = await import("/src/infrastructure/db.ts");
    const db = await getDb();
    const book = (await db.getAll("books"))[0];
    book.remote = { owner: "setup-owner", repository: "novel", branch: "trunk" };
    book.status = "paused";
    book.phase = "chapterReview";
    book.chapters = [{ id: "ch-1", number: 1, title: "Capitolo iniziato in locale", purpose: "Sviluppare la storia.",
      scenes: [{ id: "scene:001:001", number: 1, title: "Prima scena", objective: "Presentare Mara.",
        text: "Mara raggiunge il porto quando il sole è già tramontato.", status: "canon" }] }];
    book.editorialCycle = { chapterId: "ch-1", round: 1, stage: "review", reports: [], repairCursor: 0, priorRounds: [] };
    book.memory.currentState = "Una memoria locale da conservare senza modifiche.";
    await saveBook(book, false);
    return book;
  }) : undefined;
  if (options.localProgress) await page.reload();
  await nav(page).getByRole("button", { name: "Archivio", exact: true }).click();
  await page.getByLabel("PAT GitHub", { exact: true }).fill(TOKEN);
  await page.getByRole("button", { name: "Salva PAT cifrato", exact: true }).click();
  return { puts: () => puts, leasePosts: () => leasePosts, postInitializationLeaseReads: () => postInitializationLeaseReads,
    releaseInitialLease, remoteBook, before };
}

test("repository vuota già collegata e libro in redazione: ricontrolla subito il blocco senza perdere il lavoro locale", async ({ page }) => {
  const api = await prepare(page, { localProgress: true });
  await expect(page.getByText(/Libro collegato a setup-owner\/novel/)).toBeVisible();
  await expect(page.getByText(/Nessun lock remoto attivo/)).toBeVisible();
  expect(api.postInitializationLeaseReads()).toBeGreaterThan(0);
  await expect(page.getByText(/GitHub ha rifiutato la lettura.*HTTP 409/)).toHaveCount(0);
  await expect(page.getByText(/Repository vuota: al collegamento/)).toHaveCount(0);
  await expect(page.getByText(/Completa la redazione.*prima di pubblicare/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sincronizza su GitHub", exact: true })).toBeDisabled();
  await expect(page.getByText(/manoscritto non è ancora stato pubblicato: usa Sincronizza/)).toHaveCount(0);
  const after = await page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    return (await (await getDb()).getAll("books"))[0];
  });
  const { remote: _beforeRemote, updatedAt: _beforeRevision, ...beforeNarrative } = api.before!;
  const { remote: _afterRemote, updatedAt: _afterRevision, ...afterNarrative } = after;
  expect(afterNarrative).toEqual(beforeNarrative);
  expect(api.puts()).toBe(1);
  expect(api.leasePosts()).toBe(0);
});

test("una risposta 409 precedente arrivata in ritardo non sostituisce la verifica successiva al collegamento", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args);
      if (response.status === 409 && response.url.includes("/git/ref/heads/bookwriter-lock/"))
        (window as Window & { sawOldLeaseConflict?: boolean }).sawOldLeaseConflict = true;
      return response;
    };
  });
  const api = await prepare(page, { localProgress: true, delayedInitialLease: true });
  await expect(page.getByText(/Libro collegato a setup-owner\/novel/)).toBeVisible();
  await expect(page.getByText(/Nessun lock remoto attivo/)).toBeVisible();
  api.releaseInitialLease();
  // Production deliberately cancels the HTTP error body, so do not wait for
  // response.finished(): synchronize on fetch resolving in the page instead.
  await page.waitForFunction(() => (window as Window & { sawOldLeaseConflict?: boolean }).sawOldLeaseConflict === true);
  // Wait for the response's React updates to paint, not for an arbitrary timeout.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText(/Nessun lock remoto attivo/)).toBeVisible();
  await expect(page.getByText(/Impossibile verificare il lock GitHub/)).toHaveCount(0);
  expect(api.leasePosts()).toBe(0);
});

test("un nuovo 409 dopo l'inizializzazione rimane un errore: non viene interpretato come blocco assente", async ({ page }) => {
  const api = await prepare(page, { localProgress: true, leaseConflictAfterInitialization: true });
  await expect(page.getByText(/Libro collegato a setup-owner\/novel/)).toBeVisible();
  await expect.poll(api.postInitializationLeaseReads).toBeGreaterThan(0);
  await expect(page.getByText(/GitHub ha rifiutato la lettura.*HTTP 409/)).toBeVisible();
  await expect(page.getByText(/Nessun lock remoto attivo/)).toHaveCount(0);
  const before = api.postInitializationLeaseReads();
  await page.getByRole("button", { name: "Verifica blocco GitHub", exact: true }).click();
  await expect.poll(api.postInitializationLeaseReads).toBeGreaterThan(before);
  await expect(page.getByText(/GitHub ha rifiutato la lettura.*HTTP 409/)).toBeVisible();
  await expect(page.getByText(/Nessun lock remoto attivo/)).toHaveCount(0);
  expect(api.leasePosts()).toBe(0);
});

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
