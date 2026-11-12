import { expect, test, type Page } from "@playwright/test";

type Stored = {
  sceneStatus: string;
  text: string;
  pending: string[];
  audits: Array<{ title: string; id: string }>;
  queued: number;
};

async function status(page: Page): Promise<Stored> {
  return page.evaluate(() => new Promise<Stored>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["books", "activities", "outbox"], "readonly");
      const books = tx.objectStore("books").getAll();
      const activities = tx.objectStore("activities").getAll();
      const outbox = tx.objectStore("outbox").getAll();
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        const book = books.result[0] as {
          chapters: Array<{ scenes: Array<{ status: string; text: string }> }>;
          editorialReviewSceneIds?: string[];
        };
        if (!book) { reject(new Error("Nessun libro nel test")); return; }
        resolve({
          sceneStatus: book.chapters[0]!.scenes[0]!.status,
          text: book.chapters[0]!.scenes[0]!.text,
          pending: book.editorialReviewSceneIds ?? [],
          audits: activities.result as Array<{ title: string; id: string }>,
          queued: outbox.result.length,
        });
      };
    };
  }));
}

async function openReader(page: Page) {
  const mobile = test.info().project.name === "mobile-chromium";
  const nav = page.getByRole("navigation", {
    name: mobile ? "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Libro" }).click();
  await expect(page.getByRole("button", { name: "Conferma scena come canonica" })).toBeVisible();
}

test("due tab: la conferma della scena segue il writer lock e non duplica audit dopo un edit stale", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Romanzo con una scena fusa");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Una scena deve essere riletta prima di diventare canon.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();

  const bookId = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("books", "readwrite");
      const books = tx.objectStore("books").getAll();
      let id = "";
      books.onsuccess = () => {
        const book = books.result[0] as Record<string, unknown>;
        id = book.id as string;
        book.status = "paused";
        book.chapters = [{
          id: "chapter1", number: 1, title: "Inizio", purpose: "Mistero",
          scenes: [{
            id: "scene1", number: 1, title: "La porta", objective: "Indizio",
            text: "Mara vede la porta chiusa.", status: "draft",
          }],
        }];
        book.editorialReviewSceneIds = ["scene1"];
        tx.objectStore("books").put(book, id);
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        resolve(id);
      };
    };
  }));

  await page.reload();
  await openReader(page);
  const second = await page.context().newPage();
  try {
    await second.goto("/");
    await openReader(second);

    // First tab acts as another live writer holding the real Web Lock.
    await page.evaluate(id => {
      void navigator.locks.request("bookwriter:writer:" + id, async lock => {
        if (!lock) return;
        document.documentElement.dataset.editorialLock = "held";
        await new Promise<void>(resolve => {
          (window as Window & { releaseEditorialLock?: () => void }).releaseEditorialLock = resolve;
        });
      });
    }, bookId);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.editorialLock))
      .toBe("held");

    second.once("dialog", dialog => { void dialog.accept(); });
    await second.getByRole("button", { name: "Conferma scena come canonica" }).click();
    await expect(second.getByText(/Un'altra scheda sta scrivendo questo libro/)).toBeVisible();
    expect(await status(second)).toMatchObject({
      sceneStatus: "draft", pending: ["scene1"], queued: 0, audits: [],
    });

    await page.evaluate(() => {
      (window as Window & { releaseEditorialLock?: () => void }).releaseEditorialLock?.();
    });
    await expect.poll(async () => page.evaluate(async id =>
      (await navigator.locks.query()).held?.some(lock => lock.name === "bookwriter:writer:" + id) ?? false,
    bookId)).toBe(false);

    page.once("dialog", dialog => { void dialog.accept(); });
    await page.getByRole("button", { name: "Conferma scena come canonica" }).click();
    await expect(page.getByText("(canonica)")).toBeVisible();
    expect((await status(page)).audits.filter(x => x.title === "Conferma editoriale della scena"))
      .toHaveLength(1);

    // Second tab still shows the old rendered revision: confirm must be refused.
    second.once("dialog", dialog => { void dialog.accept(); });
    await second.getByRole("button", { name: "Conferma scena come canonica" }).click();
    await expect(second.getByText(/Il libro è cambiato/)).toBeVisible();
    await expect(second.getByRole("button", { name: "Conferma scena come canonica" }))
      .toHaveCount(0);
    const saved = await status(second);
    expect(saved).toMatchObject({
      sceneStatus: "canon", text: "Mara vede la porta chiusa.", pending: [], queued: 0,
    });
    expect(saved.audits.filter(x => x.title === "Conferma editoriale della scena"))
      .toHaveLength(1);
  } finally {
    await second.close();
  }
});
