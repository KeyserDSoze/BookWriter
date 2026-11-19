import { expect, test } from "@playwright/test";
import { generateKeyPairSync, sign, createHash, randomUUID } from "node:crypto";
import { newBook } from "@engine/domain/types";
import { BOOK_FORMAT_VERSION } from "@engine/domain/book-format";
import { serverCommandDigestInput } from "@engine/domain/personal-server";

test("branch, pull e unione sul server: decisioni sui conflitti, consenso AI e nessuna chiamata diretta al modello", async ({ page }) => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const serverId = randomUUID(), clientId = randomUUID(), epoch = randomUUID();
  const token = "synthetic-personal-server-" + "g".repeat(40);
  const book = newBook("Brief sintetico.", "Libro con branch", "Chiaro", "Adulti");
  book.executionAuthority = { kind: "server", serverId, epoch }; book.status = "paused";
  book.remote = { owner: "demo", repository: "faro", branch: "main", autoSync: false, allowPublicSync: false,
    lastSyncedCommit: "a".repeat(40), lastSyncedLocalUpdatedAt: book.updatedAt };
  const scene = (text: string) => ({ id: "s:1", number: 1, title: "Incontro", objective: "o", text, status: "canon", summary: "s" });
  book.chapters = [{ id: "ch:1", number: 1, title: "Il ponte", purpose: "p", scenes: [scene("Parlò con Elio.")] }];
  const conflictId = 'scene:["ch:1","s:1"]';
  book.mergeSession = { id: randomUUID(), kind: "branch", mode: "author", oursBranch: "main", theirsBranch: "bozza",
    oursCommit: "a".repeat(40), theirsCommit: "b".repeat(40), oursStamp: "1:abcd1234", createdAt: new Date().toISOString(),
    conflicts: [{ id: conflictId, kind: "scene", label: "Scena: Incontro", group: "Capitoli e scene", origin: "both-changed",
      chapterId: "ch:1", sceneId: "s:1", ours: scene("Tacque."), theirs: scene("Urlò.") }] };
  const commands: Array<{ type: string } & Record<string, unknown>> = [];
  let revision = 1, nextSequence = 1, aiCalls = 0;
  page.on("request", request => { if (request.url().includes("/chat/completions")) aiCalls++; });
  await page.route("http://127.0.0.1:24106/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { "Access-Control-Allow-Origin": "http://127.0.0.1:5173", "Access-Control-Allow-Headers": "apikey,content-type,if-match",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Expose-Headers": "ETag" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    if (url.pathname === "/api/v1/info") {
      const nonce = url.searchParams.get("nonce")!;
      await route.fulfill({ headers, json: { apiVersion: 1, serverVersion: "0.1.0", engineVersion: "0.33.0", bookFormatVersion: BOOK_FORMAT_VERSION,
        serverId, publicKey, fingerprint: createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex"), nonce,
        signature: sign(null, Buffer.from(nonce + "\n" + serverId + "\n" + publicKey), keys.privateKey).toString("base64") } });
      return;
    }
    if (url.pathname === "/api/v1/session") { await route.fulfill({ headers, json: { clientId, label: "Test", scopes: ["read", "write", "run"] } }); return; }
    if (url.pathname === "/api/v1/books") {
      await route.fulfill({ headers, json: { books: [{ bookId: book.id, title: book.title, status: book.status, epoch, revision }], nextCursor: null } }); return;
    }
    if (url.pathname.endsWith("/snapshot")) {
      await route.fulfill({ headers: { ...headers, ETag: `"${epoch}:${revision}"` }, json: { book, activities: [], revision, nextSequence, retrySchedule: null, hasManualPushIntent: false } }); return;
    }
    if (url.pathname.endsWith("/branches")) {
      await route.fulfill({ headers, json: { current: "main", baseline: "a".repeat(40), dirty: false, branches: [
        { name: "bozza", sha: "b".repeat(40) }, { name: "main", sha: "a".repeat(40) }] } }); return;
    }
    if (url.pathname.endsWith("/commands") && request.method() === "POST") {
      const envelope = request.postDataJSON();
      commands.push(envelope.command);
      if (envelope.command.type === "git_merge_resolve") {
        const decision = envelope.command.decisions[conflictId];
        book.mergeSession!.conflicts[0]!.choice = decision.choice;
      }
      if (envelope.command.type === "git_merge_finish") delete book.mergeSession;
      revision++; nextSequence++;
      await route.fulfill({ headers, status: 202, json: { digest: createHash("sha256").update(serverCommandDigestInput(clientId, envelope)).digest("hex"),
        clientId, sequence: envelope.sequence, state: "completed", result: { accepted: true } } });
      return;
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
  await page.getByRole("button", { name: "Sincronizza dal server", exact: true }).click();
  await expect(page.getByText(/1 repliche confermate/)).toBeVisible();
  await page.getByLabel("Libro attivo", { exact: true }).selectOption(book.id);
  const nav = page.getByRole("navigation", { name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale" });
  await nav.getByRole("button", { name: "Dashboard", exact: true }).click();

  const panel = page.getByRole("region", { name: "GitHub e branch sul server" });
  await expect(panel.getByRole("region", { name: "Unione in corso" })).toBeVisible();
  await expect(panel.getByText(/1 conflitti senza decisione su 1/)).toBeVisible();
  await expect(panel.getByText("Tacque.")).toBeVisible();
  await expect(panel.getByText("Urlò.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Concludi e pubblica l'unione" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Avvia sul server", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Salva su GitHub dal server" })).toBeDisabled();

  await panel.getByRole("radio", { name: "Prendi «bozza»" }).check();
  await panel.getByRole("button", { name: "Salva le decisioni" }).click();
  await expect(page.getByText(/Comando ricevuto dal server/)).toBeVisible();
  expect(commands.at(-1)).toMatchObject({ type: "git_merge_resolve", decisions: { [conflictId]: { choice: "theirs" } } });
  await page.getByRole("button", { name: "Aggiorna replica", exact: true }).click();
  await expect(panel.getByText(/0 conflitti senza decisione su 1/)).toBeVisible();
  await panel.getByRole("button", { name: "Concludi e pubblica l'unione" }).click();
  await expect.poll(() => commands.at(-1)?.type).toBe("git_merge_finish");
  await page.getByRole("button", { name: "Aggiorna replica", exact: true }).click();
  await expect(panel.getByRole("region", { name: "Unione in corso" })).toHaveCount(0);

  await expect(panel.getByRole("button", { name: "Aggiorna da GitHub (pull)" })).toBeEnabled();
  await panel.getByLabel("Se ci sono conflitti").selectOption("autopilot");
  await expect(panel.getByRole("button", { name: "Aggiorna da GitHub (pull)" })).toBeDisabled();
  await panel.getByRole("checkbox", { name: /Autorizzo l'invio al modello/ }).check();
  await panel.getByRole("button", { name: "Aggiorna da GitHub (pull)" }).click();
  await expect.poll(() => commands.at(-1)).toEqual({ type: "git_pull", mode: "autopilot", consentAi: true });

  await page.getByRole("button", { name: "Aggiorna replica", exact: true }).click();
  await panel.getByRole("button", { name: "Elenca i branch" }).click();
  await expect(panel.getByText(/Branch: bozza, main \(corrente\)/)).toBeVisible();
  await panel.getByLabel("Nome del nuovo branch").fill("revisione");
  await panel.getByRole("button", { name: "Crea il branch" }).click();
  await expect.poll(() => commands.at(-1)).toEqual({ type: "git_create_branch", name: "revisione", switchTo: true });
  expect(aiCalls).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("rilascio dal server: il libro torna al dispositivo, locale e pulito rispetto alla versione rilasciata", async ({ page }) => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const serverId = randomUUID(), clientId = randomUUID(), epoch = randomUUID();
  const token = "synthetic-personal-server-" + "r".repeat(40);
  const released = "c".repeat(40);
  const book = newBook("Brief sintetico.", "Libro rilasciato", "Chiaro", "Adulti");
  const owned = { kind: "server" as const, serverId, epoch };
  let revision = 1, done = false;
  book.executionAuthority = owned; book.status = "paused";
  book.remote = { owner: "demo", repository: "faro", branch: "main", autoSync: false, allowPublicSync: false,
    lastSyncedCommit: released, lastSyncedLocalUpdatedAt: book.updatedAt };
  await page.route("http://127.0.0.1:24106/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { "Access-Control-Allow-Origin": "http://127.0.0.1:5173", "Access-Control-Allow-Headers": "apikey,content-type,if-match",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Expose-Headers": "ETag" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    if (url.pathname === "/api/v1/info") {
      const nonce = url.searchParams.get("nonce")!;
      await route.fulfill({ headers, json: { apiVersion: 1, serverVersion: "0.1.0", engineVersion: "0.34.0", bookFormatVersion: BOOK_FORMAT_VERSION,
        serverId, publicKey, fingerprint: createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex"), nonce,
        signature: sign(null, Buffer.from(nonce + "\n" + serverId + "\n" + publicKey), keys.privateKey).toString("base64") } });
      return;
    }
    if (url.pathname === "/api/v1/session") { await route.fulfill({ headers, json: { clientId, label: "Test", scopes: ["read", "write", "run"] } }); return; }
    if (url.pathname === "/api/v1/books") {
      await route.fulfill({ headers, json: { books: [{ bookId: book.id, title: book.title, status: book.status, epoch, revision, ...(done ? { released: true } : {}) }], nextCursor: null } }); return;
    }
    if (url.pathname.endsWith("/snapshot")) {
      book.executionAuthority = done ? { ...owned, releasedAt: "2026-11-19T12:00:00.000Z", releasedCommit: released } : owned;
      await route.fulfill({ headers: { ...headers, ETag: `"${epoch}:${revision}"` }, json: { book, activities: [], revision, nextSequence: 2, retrySchedule: null, hasManualPushIntent: false } }); return;
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
  await page.getByRole("button", { name: "Sincronizza dal server", exact: true }).click();
  await expect(page.getByText(/1 repliche confermate/)).toBeVisible();
  await page.getByLabel("Libro attivo", { exact: true }).selectOption(book.id);
  const nav = page.getByRole("navigation", { name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale" });
  await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("button", { name: "Riporta il libro sul dispositivo" })).toBeVisible();
  done = true; revision = 3;
  await page.getByRole("button", { name: "Aggiorna replica", exact: true }).click();
  await expect(page.getByRole("region", { name: "Libro rilasciato dal server" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Avvia sul server", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "GitHub e branch sul server" })).toHaveCount(0);
  await page.getByRole("button", { name: "Riprendi il libro su questo dispositivo" }).click();
  await expect(page.getByRole("region", { name: "Libro sul server personale" })).toHaveCount(0);
  const local = await page.evaluate(async id => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    const db = await getDb(); const stored = await db.get("books", id);
    return { authority: !!stored.executionAuthority, commit: stored.remote.lastSyncedCommit, clean: stored.remote.lastSyncedLocalUpdatedAt === stored.updatedAt,
      replica: !!(await db.get("meta", "personal-server:replica:v1:" + id)) };
  }, book.id);
  expect(local).toEqual({ authority: false, commit: released, clean: true, replica: false });
  await page.goto("/impostazioni?tab=server");
  await page.getByRole("button", { name: "Sincronizza dal server", exact: true }).click();
  await expect(page.getByText(/0 repliche confermate/)).toBeVisible();
});
