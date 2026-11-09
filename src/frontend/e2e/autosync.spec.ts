import { test, expect } from "@playwright/test";

test("autosync opt-in dopo commit manuale salva e recupera la coda su desktop/mobile", async ({ page }) => {
  const previous = "a".repeat(40);
  const tree = "b".repeat(40);
  let head = previous;
  let commits = 0;
  let staged: Array<{ path: string; content?: string; sha?: null }> = [];
  const remoteFiles = new Map<string, string>();
  const foreignSha = "f".repeat(40);
  let foreignLease: string | null = null;
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,x-github-api-version",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    // GitHub exposes this header to browser JavaScript; HTTP Date is hidden.
    "access-control-expose-headers": "X-RateLimit-Reset",
    "x-ratelimit-reset": String(Math.floor((Date.now()+30*60_000)/1000)),
  };
  await page.route("https://api.github.com/repos/sync-owner/book-archive**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    let status = 200;
    let response: unknown = {};
    if (method === "GET" && path === "/repos/sync-owner/book-archive") {
      response = {
        private: true, default_branch: "main", full_name: "sync-owner/book-archive",
        permissions: { push: true },
      };
    } else if (method === "GET" && path.endsWith("/git/ref/heads/main")) {
      response = { object: { sha: head } };
    } else if (method === "GET" && path.includes("/git/ref/heads/bookwriter-lock/")) {
      if (!foreignLease) { status = 404; response = { message: "Not Found" }; }
      else response = { object: { sha: foreignSha } };
    } else if (method === "GET" && path.includes("/contents/.bookwriter/lease.json")) {
      if (!foreignLease) { status = 404; response = { message: "Not Found" }; }
      else response = { type: "file", encoding: "base64", content: btoa(foreignLease) };
    } else if (method === "GET" && path.includes("/contents/")) {
      const name = path.split("/contents/")[1]!;
      const body = remoteFiles.get(name);
      if (body === undefined) {
        status = 404; response = { message: "Not Found" };
      } else {
        response = { type: "file", encoding: "base64", content: btoa(body), sha: tree };
      }
    } else if (method === "GET" && path.includes("/git/commits/")) {
      response = { tree: { sha: tree }, message: "Un commit precedente" };
    } else if (method === "POST" && path.endsWith("/git/trees")) {
      staged = (request.postDataJSON() as { tree: Array<{ path: string; content?: string; sha?: null }> }).tree;
      status = 201; response = { sha: tree };
    } else if (method === "POST" && path.endsWith("/git/commits")) {
      commits += 1;
      status = 201; response = { sha: commits.toString(16).padStart(40, "0") };
    } else if (method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
      const body = request.postDataJSON() as { sha: string; force: boolean };
      expect(body.force).toBe(false);
      head = body.sha;
      for (const entry of staged) {
        if (entry.sha === null) remoteFiles.delete(entry.path);
        else if (entry.content !== undefined) remoteFiles.set(entry.path, entry.content);
      }
      response = { object: { sha: head } };
    } else {
      status = 500; response = { message: "Unexpected request: " + method + " " + path };
    }
    await route.fulfill({ status, headers, body: JSON.stringify(response) });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Romanzo da sincronizzare");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" }).fill("Il protagonista scopre una cospirazione complessa.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Archivio" }).click();
  await page.getByLabel("PAT GitHub").fill("github_pat_test_only_autosync_2026");
  await page.getByRole("button", { name: "Salva PAT cifrato" }).click();
  await page.getByRole("textbox", { name: "Owner GitHub" }).fill("sync-owner");
  await page.getByRole("textbox", { name: "Repository del libro" }).fill("book-archive");
  await page.getByRole("button", { name: "Verifica repository" }).click();
  await expect(page.getByText(/Repository privata verificata/)).toBeVisible();
  await page.getByRole("button", { name: "Collega questo libro" }).click();
  await expect(page.getByText(/La verifica dell'orologio GitHub è approssimativa/)).toBeVisible();
  await page.getByRole("button", { name: "Sincronizza su GitHub" }).click();
  await expect.poll(() => commits).toBe(1);
  const toggle = page.getByRole("checkbox", { name: /Sincronizzazione automatica ai checkpoint/ });
  // Enabling performs async permission checks; do not require the controlled input
  // to be checked synchronously before the state commit has completed.
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(() => commits, { timeout: 25_000 }).toBe(2);
  await expect(page.getByText(/Nessuna modifica in attesa/)).toBeVisible({ timeout: 15_000 });
  expect(remoteFiles.get(".bookwriter/sync.json")).toContain("operationId");
  await page.reload();
  await nav.getByRole("button", { name: "Archivio" }).click();
  await expect(page.getByRole("checkbox", { name: /Sincronizzazione automatica ai checkpoint/ })).toBeChecked();

  // A second device already owns the lease: the runner must refuse to spend AI credits.
  const snapshot = JSON.parse(remoteFiles.get(".bookwriter/project.json")!) as { id: string };
  const now = new Date().toISOString();
  foreignLease = JSON.stringify({
    schemaVersion: 1, bookId: snapshot.id, sessionId: crypto.randomUUID(),
    state: "active", acquiredAt: now, renewedAt: now,
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
  });
  await nav.getByRole("button", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "Autopilot", exact: true }).click();
  await expect(page.getByText(/già in scrittura da un altro dispositivo/)).toBeVisible();

  // A grossly skewed device clock must not be allowed to claim the lease.
  await page.evaluate(() => {
    const correct=Date.now.bind(Date);
    Date.now=()=>correct()+24*60*60_000;
  });
  await page.getByRole("button", { name: "Autopilot", exact: true }).click();
  await expect(page.getByText(/orologio del dispositivo non è compatibile/)).toBeVisible();
  await expect(page.getByText(/Da avviare · Brainstorming/)).toBeVisible();
});
