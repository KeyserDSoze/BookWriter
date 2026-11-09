import { expect, test, type Page } from "@playwright/test";

type Snapshot = {
  id: string; updatedAt: string; status: string; phase: string;
  constraints: string[]; instruction?: string;
};
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => new Promise<Snapshot>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("books", "readonly");
      const books = tx.objectStore("books").getAll();
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        const b = books.result[0] as {
          id: string; updatedAt: string; status: string; phase: string;
          authorConstraints: string[]; revision?: { instruction: string };
        };
        db.close();
        if (!b) reject(new Error("Libro test non trovato"));
        else resolve({
          id: b.id, updatedAt: b.updatedAt, status: b.status, phase: b.phase,
          constraints: b.authorConstraints, instruction: b.revision?.instruction,
        });
      };
    };
  }));
}

test("due schede: revisione stale rifiutata, lock writer rispettato e draft preservato", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Libro di revisione concorrente");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Una vicenda complessa che richiede feedback dell'autore.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();

  const second = await page.context().newPage();
  const firstFeedback = page.getByRole("textbox", { name: "Istruzione di revisione" });
  const otherFeedback = second.getByRole("textbox", { name: "Istruzione di revisione" });
  try {
    await second.goto("/");
    await expect(otherFeedback).toBeVisible();
    const id = (await snapshot(page)).id;
    const firstInstruction = "Conserva l'indizio della chiave per la fine.";
    const secondInstruction = "Fai emergere il mistero dai dialoghi.";

    await firstFeedback.fill(firstInstruction);
    await page.getByRole("button", { name: "Richiedi revisione" }).click();
    await expect(page.getByText(/Istruzione permanente salvata/)).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).instruction).toBe(firstInstruction);
    const saved = await snapshot(page);

    // Tab two still displays the previous revision and must not clobber it.
    await otherFeedback.fill(secondInstruction);
    await second.getByRole("button", { name: "Richiedi revisione" }).click();
    await expect(second.getByText(/Il libro è cambiato in un'altra scheda/)).toBeVisible();
    await expect(otherFeedback).toHaveValue(secondInstruction);
    expect(await snapshot(second)).toEqual(saved);

    // A writer lock can be held even if a stale dashboard still says paused.
    await page.evaluate(bookId => {
      void navigator.locks.request("bookwriter:writer:" + bookId, async lock => {
        if (!lock) return;
        document.documentElement.dataset.revisionLock = "held";
        await new Promise<void>(resolve => {
          (window as Window & { releaseRevisionLock?: () => void }).releaseRevisionLock = resolve;
        });
      });
    }, id);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.revisionLock))
      .toBe("held");

    await second.getByRole("button", { name: "Richiedi revisione" }).click();
    await expect(second.getByText(/Un'altra scheda sta scrivendo questo libro/)).toBeVisible();
    await expect(otherFeedback).toHaveValue(secondInstruction);
    expect(await snapshot(second)).toEqual(saved);

    await page.evaluate(() => {
      (window as Window & { releaseRevisionLock?: () => void }).releaseRevisionLock?.();
    });
    await expect.poll(async () => page.evaluate(async bookId =>
      (await navigator.locks.query()).held?.some(lock =>
        lock.name === "bookwriter:writer:" + bookId) ?? false, id)).toBe(false);

    // Author explicitly retries against the now-refreshed revision.
    await second.getByRole("button", { name: "Richiedi revisione" }).click();
    await expect(second.getByText(/Istruzione permanente salvata/)).toBeVisible();
    const final = await snapshot(second);
    expect(final.constraints).toEqual([firstInstruction, secondInstruction]);
    expect(final.instruction).toBe(secondInstruction);
    expect(final.phase).toBe("revision");
    expect(final.status).toBe("paused");
    await expect(otherFeedback).toHaveValue("");
  } finally {
    await second.close();
  }
});
