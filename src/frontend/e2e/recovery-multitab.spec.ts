import { expect, test, type Page } from "@playwright/test";

type Seeded = { bookId: string; activityId: string };
async function readRun(page: Page, ids: Seeded) {
  return page.evaluate(({ bookId, activityId }) => new Promise<{
    status?: string; activity?: string; endedAt?: string;
  }>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["books", "activities"], "readonly");
      const book = tx.objectStore("books").get(bookId);
      const task = tx.objectStore("activities").get(activityId);
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        resolve({
          status: (book.result as { status: string } | undefined)?.status,
          activity: (task.result as { status: string } | undefined)?.status,
          endedAt: (task.result as { endedAt?: string } | undefined)?.endedAt,
        });
      };
    };
  }), ids);
}

test("aprire una seconda tab non interrompe l'autopilot attivo e recupera dopo la chiusura del lock", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Libro per due schede");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Una storia che prova il recovery del writer fra tab.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();

  // Emulate a checkpoint currently held by an autopilot session in tab one.
  // Use the real IndexedDB/Web Locks APIs of desktop and mobile Chromium.
  const ids = await page.evaluate(() => new Promise<Seeded>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["books", "activities"], "readwrite");
      let result: Seeded | undefined;
      const books = tx.objectStore("books").getAll();
      books.onsuccess = () => {
        const book = books.result[0] as { id: string; status: string };
        if (!book) { reject(new Error("Libro test assente")); return; }
        book.status = "running";
        tx.objectStore("books").put(book, book.id);
        const activityId = crypto.randomUUID();
        tx.objectStore("activities").put({
          id: activityId, bookId: book.id, runId: crypto.randomUUID(),
          phase: "prose", status: "running", title: "Scrittura attiva",
          reason: "Test due tab", nextStep: "Continuare", createdAt: new Date().toISOString(),
        }, activityId);
        result = { bookId: book.id, activityId };
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        if (result) resolve(result);
        else reject(new Error("Checkpoint non preparato"));
      };
    };
  }));
  await page.evaluate((bookId) => {
    void navigator.locks.request("bookwriter:writer:" + bookId, async lock => {
      if (!lock) return;
      document.documentElement.dataset.writerLock = "held";
      await new Promise<void>(resolve => {
        (window as Window & { releaseWriterLock?: () => void }).releaseWriterLock = resolve;
      });
    });
  }, ids.bookId);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.writerLock))
    .toBe("held");

  const second = await page.context().newPage();
  try {
    await second.goto("/");
    await expect(second.getByText("In esecuzione · Brainstorming")).toBeVisible();
    expect(await readRun(second, ids)).toMatchObject({
      status: "running", activity: "running",
    });

    // A real crash/closed writer releases the lock; only then can recovery
    // safely pause the book and cancel its unfinished activity.
    await page.evaluate(() => {
      (window as Window & { releaseWriterLock?: () => void }).releaseWriterLock?.();
    });
    await expect.poll(async () => page.evaluate(async bookId => {
      const entries = await navigator.locks.query();
      return entries.held?.some(lock => lock.name === "bookwriter:writer:" + bookId) ?? false;
    }, ids.bookId)).toBe(false);

    await second.reload();
    await expect(second.getByText("In pausa · Brainstorming")).toBeVisible();
    const recovered = await readRun(second, ids);
    expect(recovered).toMatchObject({ status: "paused", activity: "cancelled" });
    expect(recovered.endedAt).toBeTruthy();
  } finally {
    await second.close();
  }
});
