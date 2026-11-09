import { expect, test } from "@playwright/test";

test("AI merge mobile/desktop: consent, model routing, GitHub writer lease, editable draft only", async ({ page }) => {
  const MAIN = "d".repeat(40), BASE_TREE = "e".repeat(40);
  let remoteBook: Record<string, unknown> | null = null;
  let nextSha = 1;
  const sha = () => (nextSha++).toString(16).padStart(40, "0");
  const refs = new Map<string, string>();
  const trees = new Map<string, string>([[BASE_TREE, ""]]);
  const commits = new Map<string, { parent: string | null; tree: string }>(
    [[MAIN, { parent: null, tree: BASE_TREE }]],
  );
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  const providerCalls: Array<Record<string, unknown>> = [];
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,x-github-api-version",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    // CORS-exposed header used for the conservative clock sanity check.
    "access-control-expose-headers": "X-RateLimit-Reset",
    "x-ratelimit-reset": String(Math.floor((Date.now()+30*60_000)/1000)),
  };
  const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

  await page.route("https://api.openai.com/v1/chat/completions", async route => {
    const request = route.request();
    const payload = request.postDataJSON() as Record<string, unknown>;
    providerCalls.push(payload);
    await route.fulfill({ status: 200, headers, body: JSON.stringify({
      choices: [{ message: { content: "Mara entra nella stanza e porta con sé il misterioso indizio." } }],
      usage: { prompt_tokens: 321, completion_tokens: 48 },
    }) });
  });

  await page.route("https://api.github.com/repos/ai-merge/novel**", async route => {
    const request = route.request();
    const url = new URL(request.url()), method = request.method();
    const path = url.pathname.replace(/^\/repos\/ai-merge\/novel/, "");
    if (method === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined;
    calls.push({ method, path, body });
    let response: unknown = {}, status = 200;
    if (method === "GET" && path === "") {
      response = { private: true, full_name: "ai-merge/novel",
        default_branch: "main", permissions: { push: true } };
    } else if (method === "GET" && path === "/git/ref/heads/main") {
      response = { object: { sha: MAIN } };
    } else if (method === "GET" && path.startsWith("/git/ref/heads/bookwriter-lock/")) {
      const key = path.slice("/git/ref/heads/".length);
      const head = refs.get(key);
      if (head) response = { object: { sha: head } };
      else { status = 404; response = { message: "Not Found" }; }
    } else if (method === "GET" && path.startsWith("/git/commits/")) {
      const commit = commits.get(path.split("/").at(-1)!);
      if (commit) response = { tree: { sha: commit.tree } };
      else { status = 404; response = { message: "Missing commit" }; }
    } else if (method === "GET" && path === "/contents/.bookwriter/project.json") {
      response = { type: "file", encoding: "base64", content: base64(JSON.stringify(remoteBook)) };
    } else if (method === "GET" && path === "/contents/.bookwriter/activities.json") {
      response = { type: "file", encoding: "base64", content: base64("[]") };
    } else if (method === "GET" && path === "/contents/.bookwriter/lease.json") {
      const commit = commits.get(url.searchParams.get("ref") ?? "");
      const file = trees.get(commit?.tree ?? "");
      if (file) response = { type: "file", encoding: "base64", content: base64(file) };
      else { status = 404; response = { message: "Missing lease" }; }
    } else if (method === "POST" && path === "/git/trees") {
      const id = sha();
      const tree = body?.tree as Array<{ content?: string }>;
      trees.set(id, tree[0]?.content ?? "");
      status = 201; response = { sha: id };
    } else if (method === "POST" && path === "/git/commits") {
      const id = sha();
      const parent = (body?.parents as string[])?.[0] ?? null;
      const tree = String(body?.tree);
      commits.set(id, { parent, tree });
      status = 201; response = { sha: id };
    } else if (method === "POST" && path === "/git/refs") {
      const ref = String(body?.ref).replace(/^refs\/heads\//, "");
      if (refs.has(ref)) { status = 422; response = { message: "already exists" }; }
      else {
        refs.set(ref, String(body?.sha));
        status = 201; response = { object: { sha: body?.sha } };
      }
    } else if (method === "PATCH" && path.startsWith("/git/refs/heads/bookwriter-lock/")) {
      expect(body?.force).toBe(false);
      const key = path.slice("/git/refs/heads/".length);
      const latest = refs.get(key);
      const proposed = String(body?.sha);
      if (commits.get(proposed)?.parent !== latest) {
        status = 409; response = { message: "non fast forward" };
      } else {
        refs.set(key, proposed);
        response = { object: { sha: proposed } };
      }
    } else {
      status = 500; response = { message: "Unexpected " + method + " " + path };
    }
    await route.fulfill({ status, headers, body: JSON.stringify(response) });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Romanzo AI");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" }).fill("Un mistero da mantenere.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  const seeded = await page.evaluate(async () =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = indexedDB.open("bookwriter");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction("books", "readwrite");
        const store = tx.objectStore("books");
        const all = store.getAll();
        all.onsuccess = () => {
          const book = all.result[0] as Record<string, unknown>;
          book.chapters = [{
            id: "chapter-1", number: 1, title: "Arrivo", purpose: "Rivelare un indizio",
            scenes: [{ id: "scene-1", number: 1, title: "Il segreto",
              objective: "Presentare un sospetto", status: "canon",
              text: "Mara entra nella stanza e lascia dietro di sé la traccia." }],
          }];
          (book.memory as { secrets: Record<string, string> }).secrets.rivelazione =
            "Il responsabile non deve apparire nel capitolo uno.";
          book.status = "paused";
          store.put(book, book.id as string);
          tx.oncomplete = () => resolve(book);
          tx.onerror = () => reject(tx.error);
        };
        all.onerror = () => reject(all.error);
      };
    }));
  remoteBook = structuredClone(seeded);
  (remoteBook.chapters as Array<{ scenes: Array<{ text: string }> }>)[0]!
    .scenes[0]!.text = "Mara entra nella stanza e scopre un indizio nascosto.";

  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium"
      ? "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByLabel("API key").fill("sk-test-merge-provider-not-real");
  await page.getByRole("textbox", { name: "Modello predefinito" }).fill("demo-merge-model");
  await page.getByRole("button", { name: "Salva impostazioni" }).click();

  await nav.getByRole("button", { name: "Archivio", exact: true }).click();
  await page.getByLabel("PAT GitHub").fill("github_pat_ai_merge_test_not_real_2026");
  await page.getByRole("button", { name: "Salva PAT cifrato" }).click();
  await page.getByRole("textbox", { name: "Owner GitHub" }).fill("ai-merge");
  await page.getByRole("textbox", { name: "Repository del libro" }).fill("novel");
  await page.getByRole("button", { name: "Verifica repository" }).click();
  await page.getByRole("button", { name: "Collega questo libro" }).click();
  await page.getByRole("button", { name: "Confronta locale e GitHub" }).click();
  await page.getByText("Scena: Il segreto", { exact: true }).click();
  await expect(page.getByText(/Modello fusione:/)).toBeVisible();
  await expect(page.getByText(/demo-merge-model/)).toBeVisible();

  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Genera proposta AI" }).click();
  await expect(page.getByText(/Proposta AI salvata/)).toBeVisible({ timeout: 20_000 });
  expect(providerCalls).toHaveLength(1);
  expect(JSON.stringify(providerCalls[0])).toContain("Mara entra nella stanza");
  expect(JSON.stringify(providerCalls[0])).not.toContain("github_pat_");
  expect(JSON.stringify(providerCalls[0])).not.toContain("sk-test-merge-provider");
  expect(providerCalls[0]?.model).toBe("demo-merge-model");
  await expect(page.getByText(/Input 321 token/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Testo bozza fusione/ }))
    .toHaveValue(/misterioso indizio/);

  await nav.getByRole("button", { name: "Libro" }).click();
  await expect(page.getByText(/lascia dietro di sé la traccia/)).toBeVisible();
  await nav.getByRole("button", { name: "Archivio", exact: true }).click();
  await page.getByRole("button", { name: "Confronta locale e GitHub" }).click();
  await page.getByText("Scena: Il segreto", { exact: true }).click();
  // Reopening the review must not auto-accept a persisted AI proposal.
  await expect(page.getByRole("combobox", { name: /Versione da conservare: scene:/ }))
    .toHaveValue("local");
  const history = page.getByRole("combobox", { name: /Storico bozze:/ });
  await expect(history.locator("option")).toHaveCount(2);
  await history.selectOption({ index: 1 });
  await expect(page.getByRole("button", { name: "Usa questa proposta per la scena" })).toBeVisible();
  // The only GitHub writes are to the lease branch; main remains unmodified.
  expect(calls.filter(x => x.method !== "GET").every(x =>
    !x.path.includes("/git/refs/heads/main"))).toBe(true);
});
