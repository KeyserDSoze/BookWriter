import { createHash } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";

const GOOGLE_ID = "123456789012-abcdefghijklmnop.apps.googleusercontent.com";
const MICROSOFT_ID = "11111111-2222-4333-8444-555555555555";
const PAT = "github_pat_E2E_TOKEN_0123456789";
const API_KEY = "sk-e2e-CHIAVE-SEGRETA-0123456789";
const PASSPHRASE = "la frase privata dei test e2e";
const SHA_A = "a".repeat(40), SHA_B = "b".repeat(40);
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, if-match",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
const preflight = (route: Route) => route.fulfill({ status: 204, headers: CORS });

/** A second computer: its own browser storage, same size and touch settings as the first. */
async function secondDevice(browser: Browser, firstPage: Page): Promise<{ context: BrowserContext; page: Page }> {
  const use = test.info().project.use as {
    viewport?: { width: number; height: number } | null; isMobile?: boolean; hasTouch?: boolean; deviceScaleFactor?: number; userAgent?: string;
  };
  const context = await browser.newContext({
    baseURL: new URL(firstPage.url()).origin, viewport: use.viewport ?? undefined,
    isMobile: use.isMobile, hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent,
  });
  return { context, page: await context.newPage() };
}
const nav = (page: Page) => page.getByRole("navigation", {
  name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale" });

/** The cloud account lives in its own tab of the general settings. */
async function openCloud(page: Page) {
  await nav(page).getByRole("button", { name: "Impostazioni" }).click();
  await page.getByRole("tab", { name: "Account e cloud" }).click();
}

async function seedDevice(page: Page, title: string): Promise<string> {
  return page.evaluate(async ({ title, pat, key, sha }) => {
    const dbPath = "/src/infrastructure/db.ts", cryptoPath = "/src/infrastructure/crypto.ts", typesPath = "/src/domain/types.ts";
    const { saveBook, saveSettings, getBook } = await import(/* @vite-ignore */ dbPath);
    const { encryptLocal } = await import(/* @vite-ignore */ cryptoPath);
    const { newBook, DEFAULT_SETTINGS } = await import(/* @vite-ignore */ typesPath);
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.githubToken = await encryptLocal(pat);
    settings.endpoints = [{ id: "openai", name: "OpenAI E2E", baseUrl: "https://api.openai.com/v1",
      secret: await encryptLocal(key), models: ["gpt-e2e"] }];
    settings.defaultRoute = { endpointId: "openai", modelId: "gpt-e2e" };
    await saveSettings(settings);
    const book = newBook("BRIEF RISERVATO DEL ROMANZO", title, "Sobrio", "Adulti");
    book.status = "paused";
    book.memory.secrets = { Mara: "SEGRETO NARRATIVO DI MARA" };
    book.remote = { owner: "demo-owner", repository: "faro-e2e", branch: "main", lastSyncedCommit: sha,
      lastSyncAt: new Date().toISOString() };
    await saveBook(book, false);
    const stored = await getBook(book.id);
    stored.remote.lastSyncedLocalUpdatedAt = stored.updatedAt;
    const db = await (await import(/* @vite-ignore */ dbPath)).getDb();
    await db.put("books", stored, stored.id);
    return JSON.stringify(stored);
  }, { title, pat: PAT, key: API_KEY, sha: SHA_A });
}

async function saveClientIds(page: Page, values: { google?: string; microsoft?: string }) {
  await openCloud(page);
  const panel = page.getByRole("region", { name: "Account cloud" });
  await panel.getByText("Impostazioni avanzate: Client ID e nome del dispositivo").click();
  if (values.google) await panel.getByLabel("Client ID Google").fill(values.google);
  if (values.microsoft) await panel.getByLabel("Application (client) ID Microsoft").fill(values.microsoft);
  await panel.getByRole("button", { name: "Salva Client ID su questo dispositivo" }).click();
  await expect(panel.getByText(/Impostazioni dell'accesso cloud salvate/)).toBeVisible();
  return panel;
}

// ---- Google: a fake Google Identity Services script and a fake Drive appDataFolder ----
interface DriveState { files: Array<{ id: string; name: string; version: number; text: string }>; counter: number; writes: number }
async function installFakeGoogle(context: BrowserContext, drive: DriveState) {
  await context.route("https://accounts.google.com/gsi/client", route => route.fulfill({
    status: 200, contentType: "application/javascript",
    body: `window.google={accounts:{oauth2:{initTokenClient:function(c){return{requestAccessToken:function(){
      setTimeout(function(){c.callback({access_token:"ya29.e2e-token",expires_in:3599,
      scope:"openid email profile https://www.googleapis.com/auth/drive.appdata"})},30)}}},
      hasGrantedAllScopes:function(){return true},revoke:function(t,d){if(d)d()}}}};` }));
  await context.route("https://www.googleapis.com/**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (method === "OPTIONS") return preflight(route);
    expect(request.headers().authorization).toBe("Bearer ya29.e2e-token");
    if (url.pathname === "/oauth2/v3/userinfo") return json(route, { sub: "google-sub-1", email: "autore@example.com" });
    const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    if (method === "GET" && url.pathname === "/drive/v3/files") {
      const name = /name = '([^']+)'/.exec(url.searchParams.get("q") ?? "")?.[1];
      return json(route, { files: drive.files.filter(file => file.name === name).map(file => ({ id: file.id, version: String(file.version) })) });
    }
    if (method === "GET" && url.searchParams.get("alt") === "media")
      return route.fulfill({ status: 200, headers: CORS, body: drive.files.find(file => file.id === id)?.text ?? "" });
    if (method === "GET") { const file = drive.files.find(item => item.id === id); return file ? json(route, { id, version: String(file.version) }) : json(route, {}, 404); }
    if (method === "POST") {
      const body = request.postData() ?? "";
      const name = /"name":"([^"]+)"/.exec(body)?.[1] ?? "";
      const content = body.split("\r\n\r\n")[2]!.replace(/\r\n--bookwriter-[^]*$/, "");
      const file = { id: "drive-file-" + ++drive.counter, name, version: 1, text: content };
      drive.files.push(file); drive.writes++;
      return json(route, { id: file.id, version: "1" });
    }
    if (method === "PATCH") {
      const file = drive.files.find(item => item.id === id)!;
      file.text = request.postData() ?? ""; file.version++; drive.writes++;
      return json(route, { id, version: String(file.version) });
    }
    if (method === "DELETE") { drive.files = drive.files.filter(file => file.id !== id); return route.fulfill({ status: 204, headers: CORS }); }
    return json(route, {}, 400);
  });
}

// ---- GitHub: one repository with a moving head ----
interface GitHubState { head: string; history: string[]; books: Map<string, string>; calls: string[] }
async function installFakeGitHub(context: BrowserContext, state: GitHubState) {
  await context.route("https://api.github.com/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "OPTIONS") return preflight(route);
    state.calls.push(url.pathname + url.search);
    const base = "/repos/demo-owner/faro-e2e";
    if (url.pathname === base + "/git/ref/heads/main") return json(route, { object: { sha: state.head } });
    if (url.pathname === base + "/contents/.bookwriter/project.json") {
      const text = state.books.get(url.searchParams.get("ref") ?? "");
      return text ? json(route, { type: "file", encoding: "base64", content: Buffer.from(text).toString("base64") })
        : json(route, { message: "Not Found" }, 404);
    }
    if (url.pathname === base + "/commits") {
      return json(route, url.searchParams.get("page") === "1" ? state.history.map(sha => ({ sha })) : []);
    }
    return json(route, { message: "Not Found" }, 404);
  });
}

test("Google: PC1 carica profilo cifrato e libreria, PC2 li ritrova, scarica e aggiorna il libro da GitHub", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const drive: DriveState = { files: [], counter: 0, writes: 0 };
  const github: GitHubState = { head: SHA_A, history: [SHA_A], books: new Map(), calls: [] };

  // ---- PC 1: settings with keys, one book on GitHub; upload to the cloud with a passphrase ----
  await installFakeGoogle(context, drive);
  await page.goto("/");
  const bookJson = await seedDevice(page, "Il faro dell'est");
  github.books.set(SHA_A, bookJson);
  await page.reload();
  let panel = await saveClientIds(page, { google: GOOGLE_ID });
  await expect(panel.getByRole("button", { name: "Accedi con Microsoft" })).toBeDisabled();
  await panel.getByRole("button", { name: "Accedi con Google" }).click();
  await expect(panel.getByText("Connesso come autore@example.com.")).toBeVisible();
  await expect(panel.getByText("Nel cloud non c'è ancora nessun profilo.")).toBeVisible();
  // The index was created on sign-in; the profile only after an explicit choice.
  expect(drive.files.map(file => file.name)).toEqual(["bookwriter-library.json"]);
  await panel.getByLabel("Nuova passphrase del vault").fill(PASSPHRASE);
  await panel.getByLabel("Ripeti la nuova passphrase").fill(PASSPHRASE);
  await panel.getByRole("button", { name: "Carica impostazioni e chiavi sul cloud" }).click();
  await expect(panel.getByText(/Impostazioni e credenziali inviate al cloud \(revisione 1\)/)).toBeVisible();
  await panel.screenshot({ path: test.info().outputPath("pc1-connesso.png") });

  const profile = drive.files.find(file => file.name === "bookwriter-profile.json")!.text;
  const library = drive.files.find(file => file.name === "bookwriter-library.json")!.text;
  for (const secret of [PAT, API_KEY, "github_pat", "sk-e2e", PASSPHRASE]) expect(profile).not.toContain(secret);
  expect(profile).toContain('"mode":"passphrase"');
  expect(profile).toContain("OpenAI E2E");
  for (const forbidden of ["BRIEF RISERVATO", "SEGRETO NARRATIVO", PAT, API_KEY]) { expect(library).not.toContain(forbidden); expect(profile).not.toContain(forbidden); }
  expect(library).toContain("Il faro dell'est");
  expect(library).toContain("demo-owner");

  // ---- PC 2: a brand-new browser. Same account, nothing local. ----
  const second = await secondDevice(browser, page);
  await installFakeGoogle(second.context, drive);
  await installFakeGitHub(second.context, github);
  const pc2 = second.page;
  await pc2.goto("/");
  panel = await saveClientIds(pc2, { google: GOOGLE_ID });
  await panel.getByRole("button", { name: "Accedi con Google" }).click();
  await expect(panel.getByText(/Nel cloud c'è già un profilo \(revisione 1/)).toBeVisible();
  await panel.screenshot({ path: test.info().outputPath("pc2-scelta-profilo.png") });
  await panel.getByLabel("Passphrase del vault esistente").fill("una frase sbagliata ma abbastanza lunga");
  await panel.getByRole("button", { name: "Usa il profilo cloud su questo dispositivo" }).click();
  await expect(panel.getByRole("alert")).toContainText(/Passphrase errata/);
  await panel.getByLabel("Passphrase del vault esistente").fill(PASSPHRASE);
  await panel.getByRole("button", { name: "Usa il profilo cloud su questo dispositivo" }).click();
  await expect(panel.getByText(/Impostazioni applicate dal cloud \(revisione 1.*PAT GitHub incluso, 1 chiavi API incluse/)).toBeVisible();
  await expect(panel.getByText(/Impostazioni sincronizzate \(revisione 1/)).toBeVisible();
  // The endpoint arrived with its name and key.
  const arrived = await pc2.evaluate(async () => {
    const dbPath = "/src/infrastructure/db.ts", cryptoPath = "/src/infrastructure/crypto.ts";
    const settings = await (await import(/* @vite-ignore */ dbPath)).loadSettings();
    const { decryptLocal } = await import(/* @vite-ignore */ cryptoPath);
    return { name: settings.endpoints[0].name, key: await decryptLocal(settings.endpoints[0].secret), pat: await decryptLocal(settings.githubToken) };
  });
  expect(arrived).toEqual({ name: "OpenAI E2E", key: API_KEY, pat: PAT });

  // The shelf lists the book of the other computer; its text comes from GitHub.
  await nav(pc2).getByRole("button", { name: "Libreria" }).click();
  const shelf = pc2.getByRole("region", { name: "Libri dagli altri dispositivi" });
  await expect(shelf.getByRole("heading", { name: "Il faro dell'est" })).toBeVisible();
  await expect(shelf).toContainText("demo-owner/faro-e2e · main");
  await shelf.screenshot({ path: test.info().outputPath("pc2-libreria-cloud.png") });
  await shelf.getByRole("button", { name: "Scarica da GitHub Il faro dell'est" }).click();
  await expect(pc2.getByText(/«Il faro dell'est» scaricato da GitHub/)).toBeVisible();
  const local = pc2.getByRole("list", { name: "Elenco dei libri" });
  await expect(local.getByRole("heading", { name: "Il faro dell'est" })).toBeVisible();
  await expect(shelf.getByRole("button", { name: /Scarica da GitHub/ })).toHaveCount(0);

  // ---- PC 1 continues the book: new commit on GitHub, new status in the cloud index ----
  const advanced = await page.evaluate(async ({ sha }) => {
    const dbPath = "/src/infrastructure/db.ts";
    const { getBook, saveBook, listBooks, getDb } = await import(/* @vite-ignore */ dbPath);
    const stored = (await listBooks())[0];
    const book = await getBook(stored.id);
    book.title = "Il faro dell'est — capitolo 2";
    await saveBook(book, false);
    const fresh = await getBook(book.id);
    fresh.remote = { ...fresh.remote, lastSyncedCommit: sha, lastSyncAt: new Date().toISOString(), lastSyncedLocalUpdatedAt: fresh.updatedAt };
    await (await getDb()).put("books", fresh, fresh.id);
    return JSON.stringify(fresh);
  }, { sha: SHA_B });
  github.books.set(SHA_B, advanced); github.head = SHA_B; github.history = [SHA_B, SHA_A];
  await page.reload();
  panel = page.getByRole("region", { name: "Account cloud" });
  await openCloud(page);
  await expect(panel.getByText("Non connesso: la sessione è scaduta")).toBeVisible();
  await panel.getByRole("button", { name: "Riconnetti" }).click();
  await expect(panel.getByText("Connesso come autore@example.com.")).toBeVisible();
  await expect.poll(() => drive.files.find(file => file.name === "bookwriter-library.json")!.text).toContain("capitolo 2");

  // ---- PC 2 sees the update and takes it without touching anything else ----
  await openCloud(pc2);
  await pc2.getByRole("region", { name: "Account cloud" }).getByRole("button", { name: "Aggiorna elenco libri cloud" }).click();
  await nav(pc2).getByRole("button", { name: "Libreria" }).click();
  await expect(pc2.getByText(/aggiornamento disponibile da un altro dispositivo/)).toBeVisible();
  const updateShelf = pc2.getByRole("region", { name: "Libri dagli altri dispositivi" });
  await updateShelf.getByRole("button", { name: /Aggiorna da GitHub/ }).click();
  await expect(pc2.getByText(/aggiornato al commit bbbbbbbbbbbb/)).toBeVisible();
  await expect(pc2.getByRole("list", { name: "Elenco dei libri" }).getByRole("heading", { name: "Il faro dell'est — capitolo 2" })).toBeVisible();
  // Read-only checks on GitHub: no write verb was ever sent.
  expect(github.calls.every(call => !/POST|PATCH|PUT/.test(call))).toBe(true);
  await second.context.close();
});

// ---- Microsoft: a fake identity platform (PKCE popup) and a fake Graph approot ----
interface GraphState { items: Map<string, { text: string; etag: number }>; authorizations: URLSearchParams[]; tokens: URLSearchParams[] }
async function installFakeMicrosoft(context: BrowserContext, graph: GraphState) {
  const idToken = "h." + Buffer.from(JSON.stringify({ oid: "oid-1", tid: "tid-1", email: "autore@outlook.com" })).toString("base64url") + ".s";
  await context.route("https://login.microsoftonline.com/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "OPTIONS") return preflight(route);
    if (url.pathname.endsWith("/authorize")) {
      graph.authorizations.push(url.searchParams);
      const target = new URL(url.searchParams.get("redirect_uri")!);
      target.searchParams.set("code", "E2E-CODE"); target.searchParams.set("state", url.searchParams.get("state")!);
      return route.fulfill({ status: 302, headers: { location: target.toString() } });
    }
    if (url.pathname.endsWith("/token")) {
      const form = new URLSearchParams(request.postData() ?? "");
      graph.tokens.push(form);
      if (form.get("grant_type") === "authorization_code") {
        const challenge = createHash("sha256").update(form.get("code_verifier")!).digest("base64url");
        const asked = graph.authorizations.at(-1)!;
        if (challenge !== asked.get("code_challenge") || form.get("code") !== "E2E-CODE" || form.has("client_secret"))
          return json(route, { error: "invalid_grant" }, 400);
      } else if (form.get("refresh_token") !== "0.E2E-REFRESH") return json(route, { error: "invalid_grant" }, 400);
      return json(route, { token_type: "Bearer", access_token: "EwB.e2e-access", refresh_token: "0.E2E-REFRESH", id_token: idToken, expires_in: 3599 });
    }
    return json(route, {}, 404);
  });
  await context.route("https://graph.microsoft.com/**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (method === "OPTIONS") return preflight(route);
    expect(request.headers().authorization).toBe("Bearer EwB.e2e-access");
    const match = /approot:\/([^:]+)(:\/content)?$/.exec(decodeURIComponent(url.pathname));
    if (!match) return json(route, {}, 404);
    const name = match[1]!, item = graph.items.get(name);
    if (method === "GET") return item ? json(route, { id: "id-" + name, eTag: `"{${item.etag}}"`,
      "@microsoft.graph.downloadUrl": "https://download.example/" + name }) : json(route, {}, 404);
    if (method === "PUT") {
      if (url.searchParams.get("@microsoft.graph.conflictBehavior") === "fail" && item) return json(route, {}, 409);
      const next = { text: request.postData() ?? "", etag: (item?.etag ?? 0) + 1 };
      graph.items.set(name, next);
      return json(route, { id: "id-" + name, eTag: `"{${next.etag}}"` }, item ? 200 : 201);
    }
    if (method === "DELETE") { graph.items.delete(name); return route.fulfill({ status: 204, headers: CORS }); }
    return json(route, {}, 400);
  });
  await context.route("https://download.example/**", route =>
    route.fulfill({ status: 200, headers: CORS, body: graph.items.get(new URL(route.request().url()).pathname.slice(1))?.text ?? "" }));
}

test("Microsoft: accesso con finestra e PKCE, profilo «solo account», ripresa senza finestre dopo il ricarica", async ({ page, context }) => {
  test.setTimeout(120_000);
  const graph: GraphState = { items: new Map(), authorizations: [], tokens: [] };
  await installFakeMicrosoft(context, graph);
  await page.goto("/");
  await seedDevice(page, "Il faro dell'est");
  await page.reload();
  const panel = await saveClientIds(page, { microsoft: MICROSOFT_ID });
  await expect(panel.getByRole("button", { name: "Accedi con Google" })).toBeDisabled();
  await panel.getByRole("button", { name: "Accedi con Microsoft" }).click();
  await expect(panel.getByText("Connesso come autore@outlook.com.")).toBeVisible();

  const asked = graph.authorizations[0]!;
  expect(asked.get("client_id")).toBe(MICROSOFT_ID);
  expect(asked.get("response_type")).toBe("code");
  expect(asked.get("code_challenge_method")).toBe("S256");
  expect(asked.get("scope")).toContain("https://graph.microsoft.com/Files.ReadWrite.AppFolder");
  expect(asked.get("scope")).toContain("offline_access");
  expect(asked.get("redirect_uri")).toMatch(/\/oauth\/microsoft\.html$/);
  expect(graph.tokens[0]!.has("client_secret")).toBe(false);

  await panel.getByLabel("Solo con il login cloud (meno sicuro)").check();
  await expect(panel.getByText(/Chi entra nel tuo account può leggere PAT e chiavi/)).toBeVisible();
  await panel.getByRole("button", { name: "Carica impostazioni e chiavi sul cloud" }).click();
  await expect(panel.getByText(/Impostazioni e credenziali inviate al cloud \(revisione 1\)/)).toBeVisible();
  // «Account only» is honest: the secrets are readable by whoever enters the cloud account.
  expect(graph.items.get("bookwriter-profile.json")!.text).toContain(PAT);
  expect(graph.items.get("bookwriter-library.json")!.text).not.toContain("BRIEF RISERVATO");

  const authorizationsBefore = graph.authorizations.length;
  await page.reload();
  await openCloud(page);
  await expect(panel.getByText(/^Connesso · valida fino alle/)).toBeVisible();
  expect(graph.authorizations.length).toBe(authorizationsBefore); // no new window
  expect(graph.tokens.at(-1)!.get("grant_type")).toBe("refresh_token");
  await panel.getByRole("button", { name: "Scollega questo dispositivo" }).click();
  await expect(panel.getByRole("button", { name: "Accedi con Microsoft" })).toBeVisible();
  expect(graph.items.has("bookwriter-profile.json")).toBe(true); // the cloud copy stays for the other PCs
});

test("senza Client ID gli accessi sono disattivati e la pagina indica la guida", async ({ page }) => {
  await page.goto("/");
  await openCloud(page);
  const panel = page.getByRole("region", { name: "Account cloud" });
  await expect(panel.getByRole("button", { name: "Accedi con Google" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Accedi con Microsoft" })).toBeDisabled();
  await expect(panel.getByText(/docs\/cloud-app-registration-ste100\.md/)).toBeVisible();
  await expect(panel.getByText(/Mai.*testo, trama, memoria narrativa, segreti dei personaggi/)).toBeHidden();
  await panel.getByText("Cosa viene salvato nel cloud, e cosa no").click();
  await expect(panel.getByText(/Mai.*testo, trama, memoria narrativa, segreti dei personaggi/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
