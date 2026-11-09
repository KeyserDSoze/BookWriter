import { expect, test, type Page } from "@playwright/test";

const BASE = "a".repeat(40);
const TREE = "b".repeat(40);
const CREATED_TREE = "c".repeat(40);
const COMMIT = "d".repeat(40);
type Snapshot = {
  id: string; brief: string; updatedAt: string; baseline?: string;
  publishedRevision?: string; intent?: { operationId: string; sourceRevision: string };
  outbox?: { operationId: string; revision: number; state: string };
};
function archive(page: Page) {
  return page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium"
      ? "Navigazione mobile" : "Navigazione principale",
  }).getByRole("button", { name: "Archivio", exact: true });
}
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => new Promise<Snapshot>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["books", "meta", "outbox"], "readonly");
      const b = tx.objectStore("books").getAll();
      const q = tx.objectStore("outbox").getAll();
      let intent: IDBRequest<unknown>;
      b.onsuccess = () => {
        const book = b.result[0] as { id: string };
        intent = tx.objectStore("meta").get("manual-github-push:" + book.id);
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        const book = b.result[0] as {
          id: string; brief: string; updatedAt: string;
          remote?: { lastSyncedCommit?: string; lastSyncedLocalUpdatedAt?: string };
        };
        if (!book) { reject(new Error("Book not seeded")); return; }
        resolve({
          id: book.id, brief: book.brief, updatedAt: book.updatedAt,
          baseline: book.remote?.lastSyncedCommit,
          publishedRevision: book.remote?.lastSyncedLocalUpdatedAt,
          intent: intent!.result as Snapshot["intent"],
          outbox: q.result[0] as Snapshot["outbox"],
        });
      };
    };
  }));
}

test("push manuale: crash dopo PATCH, reload, stesso ID e recovery senza duplicati", async ({ page }) => {
  let bookId = "";
  let head = BASE;
  let failHeadOnce = false;
  let patchCount = 0;
  let commitWrites = 0;
  let markerReads = 0;
  let marker: { operationId: string; bookId: string; sourceRevision: string } | undefined;
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-github-api-version",
    "access-control-expose-headers": "X-RateLimit-Reset",
    "x-ratelimit-reset": String(Math.floor((Date.now() + 30 * 60_000) / 1000)),
  };
  await page.context().route("https://api.github.com/repos/recovery/novel**", async route => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname;
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    let status = 200;
    let body: unknown = {};
    if (method === "GET" && path === "/repos/recovery/novel") {
      body = { private: true, default_branch: "main", permissions: { push: true } };
    } else if (method === "GET" && path.endsWith("/git/ref/heads/main")) {
      if (failHeadOnce) {
        failHeadOnce = false;
        await route.abort("failed"); // Readback fails after server applied PATCH.
        return;
      }
      body = { object: { sha: head } };
    } else if (method === "GET" && path.endsWith("/git/commits/" + BASE)) {
      body = { tree: { sha: TREE } };
    } else if (method === "GET" && path.endsWith("/git/commits/" + COMMIT)) {
      body = { message: "bookwriter: sync " + marker?.operationId };
    } else if (method === "GET" && path.includes("/contents/.bookwriter/manifest.json")) {
      body = { type: "file", encoding: "base64", content: btoa(JSON.stringify({
        schemaVersion: 1, bookId,
        paths: [".bookwriter/project.json", ".bookwriter/manifest.json", "book.md"],
      })) };
    } else if (method === "GET" && path.includes("/contents/.bookwriter/sync.json")) {
      markerReads++;
      body = marker
        ? { type: "file", encoding: "base64", content: btoa(JSON.stringify(marker)) }
        : { message: "Not Found" };
      if (!marker) status = 404;
    } else if (method === "GET" && path.includes("/contents/")) {
      status = 404;
      body = { message: "Not Found" };
    } else if (method === "POST" && path.endsWith("/git/trees")) {
      status = 201;
      const tree = req.postDataJSON() as { tree: Array<{ path: string; content?: string }> };
      const raw = tree.tree.find(x => x.path === ".bookwriter/sync.json")?.content;
      if (!raw) throw new Error("Missing sync marker in tree payload");
      marker = JSON.parse(raw) as typeof marker;
      body = { sha: CREATED_TREE };
    } else if (method === "POST" && path.endsWith("/git/commits")) {
      status = 201;
      commitWrites++;
      const commit = req.postDataJSON() as { message: string; parents: string[] };
      expect(commit.parents).toEqual([BASE]);
      expect(commit.message).toBe("bookwriter: sync " + marker!.operationId);
      body = { sha: COMMIT };
    } else if (method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
      const payload = req.postDataJSON() as { sha: string; force: boolean };
      expect(payload).toEqual({ sha: COMMIT, force: false });
      patchCount++;
      head = COMMIT; // GitHub has applied the commit.
      failHeadOnce = true;
      await route.abort("failed"); // The PATCH response was never delivered.
      return;
    } else {
      status = 500;
      body = { message: "Unexpected " + method + " " + path };
    }
    await route.fulfill({ status, headers, body: JSON.stringify(body) });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Romanzo recuperabile");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Una trama con più schede e un checkpoint remoto ambiguo.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();
  await archive(page).click();
  await page.getByLabel("PAT GitHub").fill("github_pat_mock_recovery_reload_2026");
  await page.getByRole("button", { name: "Salva PAT cifrato" }).click();
  await expect(page.getByText(/PAT salvato cifrato/)).toBeVisible();

  bookId = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("books", "readwrite");
      const q = tx.objectStore("books").getAll();
      let id = "";
      q.onsuccess = () => {
        const book = q.result[0] as { id: string; remote?: unknown; updatedAt: string };
        id = book.id;
        book.remote = { owner: "recovery", repository: "novel", branch: "main",
          lastSyncedCommit: "a".repeat(40), autoSync: false };
        book.updatedAt = new Date(Math.max(Date.now(), Date.parse(book.updatedAt) + 1)).toISOString();
        tx.objectStore("books").put(book, id);
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => { db.close(); resolve(id); };
    };
  }));
  await page.reload();
  await archive(page).click();
  const before = await snapshot(page);
  expect(before.baseline).toBe(BASE);
  expect(before.intent).toBeUndefined();

  await page.getByRole("button", { name: "Sincronizza su GitHub" }).click();
  await expect(page.getByText(/GitHub non raggiungibile/)).toBeVisible();
  const pending = await snapshot(page);
  expect(pending.intent?.sourceRevision).toBe(before.updatedAt);
  expect(pending.intent?.operationId).toBe(marker?.operationId);
  expect(pending.baseline).toBe(BASE);
  expect(pending.outbox).toBeUndefined();
  expect(patchCount).toBe(1);
  expect(commitWrites).toBe(1);

  const second = await page.context().newPage();
  try {
    await second.goto("/");
    await second.evaluate(() => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("bookwriter");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["books", "outbox"], "readwrite");
        const books = tx.objectStore("books");
        const q = books.getAll();
        q.onsuccess = () => {
          const b = q.result[0] as {
            id: string; brief: string; updatedAt: string;
          };
          b.brief = "Un'altra scheda ha aggiunto un nuovo indizio dopo il push.";
          b.updatedAt = new Date(Math.max(Date.now(), Date.parse(b.updatedAt) + 1)).toISOString();
          books.put(b, b.id);
          tx.objectStore("outbox").put({
            bookId: b.id, operationId: crypto.randomUUID(), revision: 2,
            requestedAt: new Date().toISOString(), state: "pending", attempts: 0,
          }, b.id);
        };
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    }));
    const changed = await snapshot(second);
    expect(changed.updatedAt).not.toBe(before.updatedAt);
    expect(changed.intent?.operationId).toBe(pending.intent?.operationId);

    // Simulate a tab crash/reopen: all in-memory UUIDs are gone. GitHub
    // HEAD contains the first commit, so only GETs are legal on retry.
    await page.reload();
    await archive(page).click();
    await page.getByRole("button", { name: "Sincronizza su GitHub" }).click();
    await expect(page.getByText(/Commit GitHub recuperato e confermato/)).toBeVisible();

    const recovered = await snapshot(second);
    expect(recovered.brief).toBe(changed.brief);
    expect(recovered.updatedAt).toBe(changed.updatedAt);
    expect(recovered.baseline).toBe(COMMIT);
    expect(recovered.publishedRevision).toBe(before.updatedAt);
    expect(recovered.intent).toBeUndefined();
    expect(recovered.outbox).toEqual(changed.outbox);
    expect(markerReads).toBe(1);
    expect(patchCount).toBe(1);
    expect(commitWrites).toBe(1);
  } finally {
    await second.close();
  }
});
