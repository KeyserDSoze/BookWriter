import { expect, test, type Page } from "@playwright/test";

async function gotoArchive(page: Page) {
  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Archivio", exact: true }).click();
  await expect(page.getByRole("heading", { name: /GitHub — sincronizzazione del libro/ })).toBeVisible();
}

async function bookSnapshot(page: Page) {
  return page.evaluate(() => new Promise<{
    id: string; updatedAt: string; autoSync: boolean; remote?: string;
    constraints: string[]; outbox: number;
  }>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["books", "outbox"], "readonly");
      const books = tx.objectStore("books").getAll();
      const outbox = tx.objectStore("outbox").getAll();
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        const b = books.result[0] as {
          id: string; updatedAt: string; authorConstraints: string[];
          remote?: { owner: string; repository: string; autoSync?: boolean };
        };
        db.close();
        if (!b) { reject(new Error("Fixture mancante")); return; }
        resolve({
          id: b.id, updatedAt: b.updatedAt, autoSync: !!b.remote?.autoSync,
          remote: b.remote?.owner + "/" + b.remote?.repository,
          constraints: b.authorConstraints, outbox: outbox.result.length,
        });
      };
    };
  }));
}

test("due tab: collegamento stale e toggle autosync protetti da writer/outbox lock", async ({ page }) => {
  const reset = String(Math.floor((Date.now() + 30 * 60_000) / 1000));
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-github-api-version",
    "access-control-expose-headers": "X-RateLimit-Reset",
    "x-ratelimit-reset": reset,
  };
  await page.context().route("https://api.github.com/repos/sync-fence/novel**", async route => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (new URL(req.url()).pathname === "/repos/sync-fence/novel") {
      await route.fulfill({
        status: 200, headers,
        body: JSON.stringify({ private: true, full_name: "sync-fence/novel",
          default_branch: "main", permissions: { push: true } }),
      });
      return;
    }
    await route.fulfill({ status: 404, headers, body: JSON.stringify({ message: "Not Found" }) });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Libro con impostazioni concorrenti");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Un libro condiviso fra più schede.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();
  await gotoArchive(page);
  await page.getByLabel("PAT GitHub").fill("github_pat_mock_sync_fence_2026");
  await page.getByRole("button", { name: "Salva PAT cifrato" }).click();

  const second = await page.context().newPage();
  try {
    await second.goto("/");
    await gotoArchive(second);

    const configure = async (tab: Page) => {
      await tab.getByRole("textbox", { name: "Owner GitHub" }).fill("sync-fence");
      await tab.getByRole("textbox", { name: "Repository del libro" }).fill("novel");
    };
    await configure(page);
    await configure(second);

    await page.getByRole("button", { name: "Collega questo libro" }).click();
    await expect(page.getByText(/Libro collegato a sync-fence\/novel/)).toBeVisible();
    const linked = await bookSnapshot(page);
    expect(linked.remote).toBe("sync-fence/novel");
    expect(linked.outbox).toBe(0);

    // The second tab still displays the original local book revision.
    await second.getByRole("button", { name: "Collega questo libro" }).click();
    await expect(second.getByText(/Il libro è cambiato in un'altra scheda/)).toBeVisible();
    expect(await bookSnapshot(second)).toEqual(linked);

    // Seed an acknowledged manual commit without involving the network.
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("bookwriter");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("books", "readwrite");
        const books = tx.objectStore("books").getAll();
        books.onsuccess = () => {
          const b = books.result[0] as {
            id: string; updatedAt: string;
            remote: { lastSyncedCommit?: string };
          };
          b.remote.lastSyncedCommit = "a".repeat(40);
          b.updatedAt = new Date(Math.max(Date.now(), Date.parse(b.updatedAt) + 1)).toISOString();
          tx.objectStore("books").put(b, b.id);
        };
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    }));
    await page.reload();
    await second.reload();
    await gotoArchive(page);
    await gotoArchive(second);
    const id = (await bookSnapshot(page)).id;
    const checkbox = (tab: Page) => tab.getByRole("checkbox", {
      name: /Sincronizzazione automatica ai checkpoint/,
    });

    // Simulate an offline tab: enabling only queues IndexedDB work and cannot
    // start actual GitHub requests, preserving the queue for inspection.
    await page.evaluate(() => Object.defineProperty(navigator, "onLine", {
      configurable: true, value: false,
    }));
    await second.evaluate(() => Object.defineProperty(navigator, "onLine", {
      configurable: true, value: false,
    }));

    await page.evaluate(bookId => {
      void navigator.locks.request("bookwriter:writer:" + bookId, async lock => {
        if (!lock) return;
        document.documentElement.dataset.settingsWriterLock = "held";
        await new Promise<void>(resolve => {
          (window as Window & { releaseSettingsWriterLock?: () => void }).releaseSettingsWriterLock = resolve;
        });
      });
    }, id);
    await expect.poll(() => page.evaluate(
      () => document.documentElement.dataset.settingsWriterLock)).toBe("held");

    await checkbox(second).click();
    await expect(second.getByText(/Un'altra scheda sta scrivendo questo libro/)).toBeVisible();
    expect(await bookSnapshot(second)).toMatchObject({ autoSync: false, outbox: 0 });

    await page.evaluate(() =>
      (window as Window & { releaseSettingsWriterLock?: () => void }).releaseSettingsWriterLock?.());
    await expect.poll(async () => page.evaluate(async bookId =>
      (await navigator.locks.query()).held?.some(l => l.name === "bookwriter:writer:" + bookId) ?? false, id)).toBe(false);

    // The first tab is still on the current revision: enable successfully.
    await checkbox(page).click();
    await expect(checkbox(page)).toBeChecked();
    await expect.poll(async () => (await bookSnapshot(page)).outbox).toBe(1);
    const enabled = await bookSnapshot(page);
    expect(enabled.autoSync).toBe(true);

    // The second tab's stale click must be rejected, not silently disable
    // the active policy or remove the already queued checkpoint.
    await checkbox(second).click();
    await expect(second.getByText(/Il libro è cambiato in un'altra scheda/)).toBeVisible();
    expect(await bookSnapshot(second)).toEqual(enabled);
    await expect(checkbox(second)).toBeChecked();
  } finally {
    await second.close();
  }
});
