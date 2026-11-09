import { expect, test, type Page } from "@playwright/test";

const PREVIOUS = "a".repeat(40);
const COMMIT = "c".repeat(40);
const BASE_TREE = "b".repeat(40);
const NEW_TREE = "d".repeat(40);
type LocalSnapshot = {
  id: string;
  brief: string;
  updatedAt: string;
  lastSyncedCommit?: string;
  lastSyncedLocalUpdatedAt?: string;
  outbox?: { operationId: string; revision: number; state: string };
};
async function snapshot(page: Page): Promise<LocalSnapshot> {
  return page.evaluate(() => new Promise<LocalSnapshot>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["books", "outbox"], "readonly");
      const books = tx.objectStore("books").getAll();
      const outbox = tx.objectStore("outbox").getAll();
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        const book = books.result[0] as {
          id: string; brief: string; updatedAt: string;
          remote?: { lastSyncedCommit?: string; lastSyncedLocalUpdatedAt?: string };
        };
        if (!book) { reject(new Error("Libro non trovato nel test")); return; }
        resolve({
          id: book.id, brief: book.brief, updatedAt: book.updatedAt,
          lastSyncedCommit: book.remote?.lastSyncedCommit,
          lastSyncedLocalUpdatedAt: book.remote?.lastSyncedLocalUpdatedAt,
          outbox: outbox.result[0] as LocalSnapshot["outbox"],
        });
      };
    };
  }));
}
function archive(page: Page) {
  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium"
      ? "Navigazione mobile" : "Navigazione principale",
  });
  return nav.getByRole("button", { name: "Archivio", exact: true });
}

test("ACK GitHub non sovrascrive il canon nuovo da seconda tab e conserva la coda", async ({ page }) => {
  let patchStarted = false;
  let bookId = "";
  let releasePatch: () => void = () => undefined;
  const patchGate = new Promise<void>(resolve => { releasePatch = resolve; });
  let patchCount = 0;
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-github-api-version",
    "access-control-expose-headers": "X-RateLimit-Reset",
    "x-ratelimit-reset": String(Math.floor((Date.now() + 30 * 60_000) / 1000)),
  };
  await page.context().route("https://api.github.com/repos/ack-test/novel**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    let status = 200;
    let body: unknown = {};
    if (method === "GET" && path === "/repos/ack-test/novel") {
      body = { private: true, full_name: "ack-test/novel",
        default_branch: "main", permissions: { push: true } };
    } else if (method === "GET" && path.endsWith("/git/ref/heads/main")) {
      body = { object: { sha: PREVIOUS } };
    } else if (method === "GET" && path.endsWith("/git/commits/" + PREVIOUS)) {
      body = { tree: { sha: BASE_TREE } };
    } else if (method === "GET" && path.includes("/contents/.bookwriter/manifest.json")) {
      // The book is explicitly seeded with a prior synced commit. GitHub
      // must contain the matching manifest or the safe sync refuses the
      // push before PATCH, correctly treating that as a remote conflict.
      body = {
        type: "file", encoding: "base64",
        content: btoa(JSON.stringify({
          schemaVersion: 1, bookId,
          paths: [".bookwriter/project.json", ".bookwriter/manifest.json", "book.md"],
        })),
      };
    } else if (method === "GET" && path.includes("/contents/")) {
      status = 404; body = { message: "Not Found" };
    } else if (method === "POST" && path.endsWith("/git/trees")) {
      status = 201; body = { sha: NEW_TREE };
    } else if (method === "POST" && path.endsWith("/git/commits")) {
      status = 201; body = { sha: COMMIT };
    } else if (method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
      const payload = request.postDataJSON() as { force: boolean; sha: string };
      expect(payload).toEqual({ force: false, sha: COMMIT });
      patchStarted = true;
      patchCount++;
      await patchGate;
      body = { object: { sha: COMMIT } };
    } else if (method === "GET" && path.includes("/git/ref/heads/bookwriter-lock/")) {
      status = 404; body = { message: "Not Found" };
    } else {
      status = 500; body = { message: "Unexpected " + method + " " + path };
    }
    await route.fulfill({ status, headers, body: JSON.stringify(body) });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" })
    .fill("Romanzo con ACK concorrente");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Il capitolo contiene una chiave nascosta.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();
  await archive(page).click();
  await page.getByLabel("PAT GitHub").fill("github_pat_mock_ack_atomic_2026");
  await page.getByRole("button", { name: "Salva PAT cifrato" }).click();
  await expect(page.getByText(/PAT salvato cifrato/)).toBeVisible();

  await page.evaluate(previous => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["books", "outbox"], "readwrite");
      const books = tx.objectStore("books");
      const records = books.getAll();
      records.onsuccess = () => {
        const book = records.result[0] as {
          id: string; updatedAt: string; remote?: Record<string, unknown>;
        };
        book.remote = { owner: "ack-test", repository: "novel", branch: "main",
          lastSyncedCommit: previous, autoSync: false };
        book.updatedAt = new Date(
          Math.max(Date.now(), Date.parse(book.updatedAt) + 1)).toISOString();
        books.put(book, book.id);
        tx.objectStore("outbox").put({
          bookId: book.id, operationId: crypto.randomUUID(), revision: 1,
          requestedAt: new Date().toISOString(), state: "pending", attempts: 0,
        }, book.id);
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }), PREVIOUS);
  await page.reload();
  await archive(page).click();
  const before = await snapshot(page);
  bookId = before.id;
  expect(before.lastSyncedCommit).toBe(PREVIOUS);
  expect(before.outbox?.state).toBe("pending");

  const second = await page.context().newPage();
  try {
    await second.goto("/");
    await expect(second.getByRole("textbox", { name: "Istruzione di revisione" })).toBeVisible();
    await page.getByRole("button", { name: "Sincronizza su GitHub" }).click();
    await expect.poll(() => patchStarted).toBe(true);

    const change = await second.evaluate(() => new Promise<{
      updatedAt: string; operationId: string; revision: number;
    }>((resolve, reject) => {
      const open = indexedDB.open("bookwriter");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["books", "outbox"], "readwrite");
        const books = tx.objectStore("books");
        const q = books.getAll();
        let updatedAt = "";
        let operationId = "";
        let revision = 0;
        q.onsuccess = () => {
          const book = q.result[0] as {
            id: string; brief: string; updatedAt: string;
          };
          book.brief = "La seconda scheda ha aggiunto un nuovo indizio al manoscritto.";
          book.updatedAt = new Date(
            Math.max(Date.now(), Date.parse(book.updatedAt) + 1)).toISOString();
          updatedAt = book.updatedAt;
          books.put(book, book.id);
          const outbox = tx.objectStore("outbox").get(book.id);
          outbox.onsuccess = () => {
            const pending = outbox.result as {
              bookId: string; operationId: string; revision: number;
              requestedAt: string; state: string;
            };
            pending.revision++;
            pending.requestedAt = new Date().toISOString();
            pending.state = "pending";
            operationId = pending.operationId;
            revision = pending.revision;
            tx.objectStore("outbox").put(pending, book.id);
          };
        };
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => { db.close(); resolve({ updatedAt, operationId, revision }); };
      };
    }));
    expect(change.revision).toBe(2);
    releasePatch();

    await expect(page.getByText(/Sincronizzato ack-test\/novel/)).toBeVisible();
    const after = await snapshot(second);
    expect(after.brief).toContain("seconda scheda");
    expect(after.updatedAt).toBe(change.updatedAt);
    expect(after.lastSyncedCommit).toBe(COMMIT);
    expect(after.lastSyncedLocalUpdatedAt).toBe(before.updatedAt);
    expect(after.outbox?.revision).toBe(change.revision);
    expect(after.outbox?.operationId).toBe(change.operationId);
    expect(after.outbox?.state).toBe("pending");
    expect(patchCount).toBe(1);
  } finally {
    releasePatch();
    await second.close();
  }
});
