import { expect, test } from "@playwright/test";
import { generateKeyPairSync, sign, createHash, randomUUID } from "node:crypto";
import { newBook } from "@engine/domain/types";
import { BOOK_FORMAT_VERSION } from "@engine/domain/book-format";

test("connessione firmata, token cifrato e replica server senza fallback locale", async ({ page }) => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const serverId = randomUUID(), epoch = randomUUID();
  const token = "synthetic-personal-server-" + "x".repeat(40);
  const remoteBook = newBook("Brief sintetico.", "Libro sul server", "Chiaro", "Adulti");
  remoteBook.executionAuthority = { kind: "server", serverId, epoch }; remoteBook.status = "running";
  let offline = false;
  let aiCalls = 0;
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("/chat/completions")) aiCalls++; });
  await page.route("http://127.0.0.1:24106/**", async route => {
    const request = route.request(); const url = new URL(request.url()); requests.push(request.url());
    if (offline) { await route.abort(); return; }
    const headers = { "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
      "Access-Control-Allow-Headers": "apikey,content-type,if-match", "Access-Control-Expose-Headers": "ETag" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    if (url.pathname === "/api/v1/info") {
      expect(request.headers().apikey).toBeUndefined();
      const nonce = url.searchParams.get("nonce")!;
      await route.fulfill({ headers, json: { apiVersion: 1, serverVersion: "0.1.0",
        engineVersion: "0.31.0", bookFormatVersion: BOOK_FORMAT_VERSION, serverId, publicKey,
        fingerprint: createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex"),
        nonce, signature: sign(null, Buffer.from(nonce + "\n" + serverId + "\n" + publicKey), keys.privateKey).toString("base64") } }); return;
    }
    expect(request.headers().apikey).toBe(token);
    if (url.pathname === "/api/v1/session") {
      await route.fulfill({ headers, json: { clientId: randomUUID(), label: "Test", scopes: ["read", "write", "run"] } }); return;
    }
    if (url.pathname === "/api/v1/books") {
      await route.fulfill({ headers, json: { books: [{ bookId: remoteBook.id, title: remoteBook.title,
        status: remoteBook.status, epoch, revision: 1 }], nextCursor: null } }); return;
    }
    if (url.pathname.endsWith("/snapshot")) {
      await route.fulfill({ headers: { ...headers, ETag: `"${epoch}:1"` }, json: {
        book: remoteBook, activities: [], revision: 1, nextSequence: 1, retrySchedule: null, hasManualPushIntent: false } }); return;
    }
    await route.fulfill({ status: 404, headers, json: { code: "route", message: "Unavailable" } });
  });
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/impostazioni?tab=server");
  await page.getByRole("textbox", { name: "URL del server" }).fill("http://127.0.0.1:24106");
  await page.getByLabel("Token BookWriter (header apikey)", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Verifica server", exact: true }).click();
  await expect(page.getByText(/Identità firmata ricevuta/)).toBeVisible();
  await page.getByRole("button", { name: "Collega server", exact: true }).click();
  await expect(page.getByText(/Connessione verificata e token cifrato/)).toBeVisible();
  await expect(page.getByLabel("Token BookWriter (header apikey)", { exact: true })).toHaveValue("");
  const encrypted = await page.evaluate(async expected => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    const value = await (await getDb()).get("meta", "personal-server:connection:v1");
    return !!value?.token?.data && !JSON.stringify(value).includes(expected);
  }, token);
  expect(encrypted).toBe(true);
  await page.getByRole("button", { name: "Sincronizza dal server", exact: true }).click();
  await expect(page.getByText(/1 repliche confermate/)).toBeVisible();
  await page.getByLabel("Libro attivo", { exact: true }).selectOption(remoteBook.id);
  const nav = page.getByRole("navigation", { name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale" });
  await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("region", { name: "Libro sul server personale" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Riprendi", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Avvia sul server", exact: true })).toBeDisabled();
  const stillRunning = await page.evaluate(async id => {
    const { getBook } = await import("/src/infrastructure/db.ts");
    return (await getBook(id))?.status;
  }, remoteBook.id);
  expect(stillRunning).toBe("running");
  offline = true;
  await page.getByRole("button", { name: "Aggiorna replica", exact: true }).click();
  await expect(page.getByText(/Server non raggiungibile o operazione non confermata/)).toBeVisible();
  expect(aiCalls).toBe(0);
  expect(requests.every(url => !url.includes(token))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("retry long-term: consenso, minuti e limite illimitato esplicito persistono", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/impostazioni");
  await page.getByText("Opzioni avanzate", { exact: true }).first().click();
  const retry = page.getByRole("checkbox", { name: /Long-term retry:/ }).first();
  await retry.check();
  await page.getByLabel("Minuti fra i cicli long-term", { exact: true }).first().fill("7");
  await page.getByRole("combobox", { name: "Ripartenze long-term", exact: true }).first().selectOption("unlimited");
  await page.getByRole("button", { name: "Salva impostazioni", exact: true }).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByText("Opzioni avanzate", { exact: true }).first().click();
  await expect(page.getByRole("checkbox", { name: /Long-term retry:/ }).first()).toBeChecked();
  await expect(page.getByLabel("Minuti fra i cicli long-term", { exact: true }).first()).toHaveValue("7");
  await expect(page.getByRole("combobox", { name: "Ripartenze long-term", exact: true }).first()).toHaveValue("unlimited");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("affidare un libro locale: blocco prima dell'invio, risposta persa, ripresa idempotente e nessuna AI", async ({ page }) => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const serverId = randomUUID(), clientId = randomUUID();
  const token = "synthetic-personal-server-" + "y".repeat(40);
  let accepted: { handoffId: string; epoch: string; book: { id: string; executionAuthority: { epoch: string } } } | undefined;
  let dropFirst = true, posts = 0, aiCalls = 0;
  const bodies: string[] = [];
  page.on("request", request => { if (request.url().includes("/chat/completions")) aiCalls++; });
  await page.route("http://127.0.0.1:24106/**", async route => {
    const request = route.request(); const url = new URL(request.url());
    const headers = { "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
      "Access-Control-Allow-Headers": "apikey,content-type,if-match", "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Expose-Headers": "ETag" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    if (url.pathname === "/api/v1/info") {
      const nonce = url.searchParams.get("nonce")!;
      await route.fulfill({ headers, json: { apiVersion: 1, serverVersion: "0.1.0", engineVersion: "0.31.0",
        bookFormatVersion: BOOK_FORMAT_VERSION, serverId, publicKey,
        fingerprint: createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex"), nonce,
        signature: sign(null, Buffer.from(nonce + "\n" + serverId + "\n" + publicKey), keys.privateKey).toString("base64") } });
      return;
    }
    if (url.pathname === "/api/v1/session") { await route.fulfill({ headers, json: { clientId, label: "Test", scopes: ["read", "write", "run"] } }); return; }
    if (url.pathname === "/api/v1/handoffs" && request.method() === "POST") {
      posts++; bodies.push(request.postData() ?? "");
      accepted = JSON.parse(request.postData() ?? "{}");
      if (dropFirst) { dropFirst = false; await route.abort("failed"); return; }
      await route.fulfill({ status: 201, headers, json: { bookId: accepted!.book.id } });
      return;
    }
    if (url.pathname.endsWith("/snapshot") && accepted) {
      await route.fulfill({ headers: { ...headers, ETag: `"${accepted.book.executionAuthority.epoch}:1"` },
        json: { book: accepted.book, activities: [], revision: 1, nextSequence: 1, retrySchedule: null, hasManualPushIntent: false } });
      return;
    }
    await route.fulfill({ status: 404, headers, json: { code: "route", message: "Unavailable" } });
  });
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Libro da affidare");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true }).first()).toBeVisible();
  await page.goto("/impostazioni?tab=server");
  await page.getByRole("textbox", { name: "URL del server" }).fill("http://127.0.0.1:24106");
  await page.getByLabel("Token BookWriter (header apikey)", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Verifica server", exact: true }).click();
  await expect(page.getByText(/Identità firmata ricevuta/)).toBeVisible();
  await page.getByRole("button", { name: "Collega server", exact: true }).click();
  await expect(page.getByText(/Connessione verificata e token cifrato/)).toBeVisible();

  await page.getByRole("button", { name: /Affida «Libro da affidare» al server/ }).click();
  await expect(page.getByRole("region", { name: "Trasferimento al server non concluso" })).toBeVisible();
  const locked = await page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    const book = (await (await getDb()).getAll("books"))[0];
    return { authority: !!book.executionAuthority, marker: !!(await (await getDb()).get("meta", "personal-server:handoff:v1:" + book.id)) };
  });
  expect(locked).toEqual({ authority: true, marker: true });

  await page.getByRole("button", { name: "Riprendi invio", exact: true }).click();
  await expect(page.getByText(/Libro accettato dal server e replica confermata/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Trasferimento al server non concluso" })).toHaveCount(0);
  expect(posts).toBe(2);
  expect(bodies[1]).toBe(bodies[0]);
  const after = await page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    const db = await getDb(); const book = (await db.getAll("books"))[0];
    return { marker: !!(await db.get("meta", "personal-server:handoff:v1:" + book.id)), replica: !!(await db.get("meta", "personal-server:replica:v1:" + book.id)) };
  });
  expect(after).toEqual({ marker: false, replica: true });
  expect(aiCalls).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("aggiornamento automatico: un evento SSE autenticato aggiorna la replica, senza comandi né AI", async ({ page }) => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const serverId = randomUUID(), epoch = randomUUID(), clientId = randomUUID();
  const token = "synthetic-personal-server-" + "z".repeat(40);
  const remoteBook = newBook("Brief sintetico.", "Libro in diretta", "Chiaro", "Adulti");
  remoteBook.executionAuthority = { kind: "server", serverId, epoch }; remoteBook.status = "running";
  let revision = 1, stream = false, streamApikey: string | null = null, commands = 0, aiCalls = 0;
  page.on("request", request => { if (request.url().includes("/chat/completions")) aiCalls++; });
  await page.route("http://127.0.0.1:24106/**", async route => {
    const request = route.request(); const url = new URL(request.url());
    const headers = { "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
      "Access-Control-Allow-Headers": "apikey,content-type,if-match", "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Expose-Headers": "ETag" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    if (url.pathname === "/api/v1/info") {
      const nonce = url.searchParams.get("nonce")!;
      await route.fulfill({ headers, json: { apiVersion: 1, serverVersion: "0.1.0", engineVersion: "0.31.0",
        bookFormatVersion: BOOK_FORMAT_VERSION, serverId, publicKey,
        fingerprint: createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex"), nonce,
        signature: sign(null, Buffer.from(nonce + "\n" + serverId + "\n" + publicKey), keys.privateKey).toString("base64") } });
      return;
    }
    if (url.pathname === "/api/v1/session") { await route.fulfill({ headers, json: { clientId, label: "Test", scopes: ["read", "write", "run"] } }); return; }
    if (url.pathname === "/api/v1/events") {
      streamApikey = request.headers().apikey ?? null;
      if (!stream) { await route.fulfill({ status: 503, headers, json: { code: "maintenance" } }); return; }
      await route.fulfill({ status: 200, headers: { ...headers, "Content-Type": "text/event-stream" },
        body: `event: snapshot-required\ndata: {"all":true}\n\nevent: heartbeat\ndata: {}\n\n` });
      return;
    }
    if (url.pathname === "/api/v1/books") {
      await route.fulfill({ headers, json: { books: [{ bookId: remoteBook.id, title: remoteBook.title, status: remoteBook.status, epoch, revision }], nextCursor: null } });
      return;
    }
    if (url.pathname.endsWith("/snapshot")) {
      await route.fulfill({ headers: { ...headers, ETag: `"${epoch}:${revision}"` },
        json: { book: remoteBook, activities: [], revision, nextSequence: 1, retrySchedule: null, hasManualPushIntent: false } });
      return;
    }
    if (url.pathname.endsWith("/commands")) commands++;
    await route.fulfill({ status: 404, headers, json: { code: "route", message: "Unavailable" } });
  });
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/impostazioni?tab=server");
  await page.getByRole("textbox", { name: "URL del server" }).fill("http://127.0.0.1:24106");
  await page.getByLabel("Token BookWriter (header apikey)", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Verifica server", exact: true }).click();
  await expect(page.getByText(/Identità firmata ricevuta/)).toBeVisible();
  await page.getByRole("button", { name: "Collega server", exact: true }).click();
  await expect(page.getByText(/Connessione verificata e token cifrato/)).toBeVisible();
  await page.getByRole("button", { name: "Sincronizza dal server", exact: true }).click();
  await expect(page.getByText(/1 repliche confermate/)).toBeVisible();
  const status = () => page.evaluate(async id => {
    const { getBook } = await import("/src/infrastructure/db.ts");
    return (await getBook(id))?.status;
  }, remoteBook.id);
  expect(await status()).toBe("running");

  remoteBook.status = "paused"; revision = 2; stream = true;
  await expect.poll(status, { timeout: 15_000 }).toBe("paused");
  await expect(page.getByText(/Ultimo aggiornamento/)).toBeVisible();
  expect(streamApikey).toBe(token);
  expect(commands).toBe(0);
  expect(aiCalls).toBe(0);

  const checkbox = page.getByRole("checkbox", { name: "Aggiorna automaticamente le repliche su questo dispositivo" });
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(page.getByText(/spento su questo dispositivo/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
