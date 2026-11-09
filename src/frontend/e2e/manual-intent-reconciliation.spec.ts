import { expect, test, type Page } from "@playwright/test";

const BASE = "a".repeat(40);
const PUBLISHED = "b".repeat(40);
const ADVANCED = "e".repeat(40);
const LOCAL = "c".repeat(40);
type Snapshot = {
  book: { id: string; brief: string; updatedAt: string;
    remote?: { owner: string; repository: string; lastSyncedCommit?: string } };
  intent?: { operationId: string; sourceRevision: string; owner: string; repository: string };
  outbox?: { operationId: string; state: string; revision: number };
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
      const books = tx.objectStore("books").getAll();
      const outbox = tx.objectStore("outbox").getAll();
      let intent: IDBRequest<unknown>;
      books.onsuccess = () => {
        const first = books.result[0] as { id: string };
        intent = tx.objectStore("meta").get("manual-github-push:" + first.id);
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        resolve({
          book: books.result[0] as Snapshot["book"],
          intent: intent.result as Snapshot["intent"],
          outbox: outbox.result[0] as Snapshot["outbox"],
        });
      };
    };
  }));
}

test("riconciliazione esplicita: solo GET, nessuna perdita di libro/outbox", async ({ page }) => {
  let bookId = "";
  let operationId = "";
  let sourceRevision = "";
  let validMarker = false;
  const methods: string[] = [];
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-github-api-version",
    "access-control-expose-headers": "X-RateLimit-Reset",
    "x-ratelimit-reset": String(Math.floor((Date.now() + 30 * 60_000) / 1000)),
  };
  await page.context().route("https://api.github.com/**", async route => {
    const req = route.request();
    const method = req.method();
    const path = new URL(req.url()).pathname;
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    methods.push(method + " " + path);
    let status = 200;
    let data: unknown = {};
    if (method === "GET" && path.endsWith("/repos/old-writer/old-novel/git/ref/heads/main")) {
      data = { object: { sha: ADVANCED } };
    } else if (method === "GET" &&
               path.endsWith("/repos/old-writer/old-novel/git/commits/" + ADVANCED)) {
      data = { message: "Another device checkpoint", parents: [{ sha: PUBLISHED }] };
    } else if (method === "GET" &&
               path.endsWith("/repos/old-writer/old-novel/git/commits/" + PUBLISHED)) {
      data = { message: "bookwriter: sync " + operationId, parents: [{ sha: BASE }] };
    } else if (method === "GET" &&
               path.endsWith("/repos/old-writer/old-novel/contents/.bookwriter/sync.json")) {
      // The marker must be read at the historical commit, not at the
      // newer HEAD, which belongs to another device.
      expect(new URL(req.url()).searchParams.get("ref")).toBe(PUBLISHED);
      data = { type: "file", encoding: "base64", content: btoa(JSON.stringify({
        operationId: validMarker ? operationId : crypto.randomUUID(),
        bookId, sourceRevision,
      })) };
    } else {
      status = 404;
      data = { message: "Not Found" };
    }
    await route.fulfill({ status, headers, body: JSON.stringify(data) });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Riconciliazione GitHub");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Una bozza che cambia repository dopo un tentativo GitHub.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();
  await archive(page).click();
  await page.getByLabel("PAT GitHub").fill("github_pat_mock_reconcile_old_head_2026");
  await page.getByRole("button", { name: "Salva PAT cifrato" }).click();
  await expect(page.getByText(/PAT salvato cifrato/)).toBeVisible();

  const seeded = await page.evaluate(({ oldBase, newBase }) =>
    new Promise<{ bookId: string; operationId: string; sourceRevision: string }>((resolve, reject) => {
      const open = indexedDB.open("bookwriter");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["books", "meta", "outbox"], "readwrite");
        const books = tx.objectStore("books");
        const query = books.getAll();
        let seededData: { bookId: string; operationId: string; sourceRevision: string };
        query.onsuccess = () => {
          const book = query.result[0] as { id: string; updatedAt: string; remote?: unknown };
          const previousRevision = book.updatedAt;
          const op = crypto.randomUUID();
          // The old operation was queued against the old remote and its
          // lastSyncedCommit BEFORE the author switched destinations.
          const intent = {
            bookId: book.id, operationId: op,
            owner: "old-writer", repository: "old-novel", branch: "main",
            baseSha: oldBase, sourceRevision: previousRevision,
            preparedAt: new Date().toISOString(),
          };
          book.remote = {
            owner: "new-writer", repository: "new-novel", branch: "main",
            lastSyncedCommit: newBase, autoSync: false,
          };
          book.updatedAt = new Date(
            Math.max(Date.now(), Date.parse(previousRevision) + 1)).toISOString();
          books.put(book, book.id);
          tx.objectStore("meta").put(intent, "manual-github-push:" + book.id);
          tx.objectStore("outbox").put({
            bookId: book.id, operationId: crypto.randomUUID(),
            revision: 4, requestedAt: new Date().toISOString(),
            state: "blocked", attempts: 2,
          }, book.id);
          seededData = {
            bookId: book.id, operationId: op, sourceRevision: previousRevision,
          };
        };
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => { db.close(); resolve(seededData); };
      };
    }), { oldBase: BASE, newBase: LOCAL });
  ({ bookId, operationId, sourceRevision } = seeded);

  const second = await page.context().newPage();
  try {
    await second.goto("/");
    // Another tab keeps writing the current local novel before reconciliation.
    await second.evaluate(() => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("bookwriter");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("books", "readwrite");
        const store = tx.objectStore("books");
        const query = store.getAll();
        query.onsuccess = () => {
          const b = query.result[0] as { id: string; brief: string; updatedAt: string };
          b.brief = "Il manoscritto attuale contiene un nuovo capitolo di un'altra scheda.";
          b.updatedAt = new Date(Math.max(Date.now(), Date.parse(b.updatedAt) + 1)).toISOString();
          store.put(b, b.id);
        };
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    }));
    const before = await snapshot(second);
    await page.reload();
    await archive(page).click();
    const button = page.getByRole("button", { name: "Verifica e archivia tentativo precedente" });
    await expect(button).toBeVisible();
    await expect(page.getByText("Destinazione originaria: old-writer/old-novel · main")).toBeVisible();
    page.on("dialog", dialog => { void dialog.accept(); });

    // A wrong marker cannot authorize the deletion of the intent.
    await button.click();
    await expect(page.getByText(/Il commit o il marker GitHub non attestano/)).toBeVisible();
    expect(await snapshot(second)).toEqual(before);
    expect(methods.every(method => method.startsWith("GET "))).toBe(true);

    // HEAD has advanced; only the historical ancestor and its marker prove
    // the old operation belongs to this author.
    validMarker = true;
    await button.click();
    await expect(page.getByText(/Tentativo GitHub precedente verificato e archiviato/)).toBeVisible();
    const after = await snapshot(second);
    expect(after.book).toEqual(before.book);
    expect(after.outbox).toEqual(before.outbox);
    expect(after.intent).toBeUndefined();
    expect(methods.every(method => method.startsWith("GET "))).toBe(true);
    expect(methods.filter(x => x.includes("/repos/old-writer/old-novel/"))).toHaveLength(9);
    await expect(button).toHaveCount(0);
  } finally {
    await second.close();
  }
});
