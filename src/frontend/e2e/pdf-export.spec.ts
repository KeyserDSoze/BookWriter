import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("PDF canonico: blocco glyph unsupported e download verificato desktop/mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Il segreto del mare");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("BRIEF-PRIVATO-NON-PUBBLICARE");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();

  async function editBook(text: string): Promise<void> {
    await page.evaluate((sceneText: string) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("bookwriter");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("books", "readwrite");
        const store = tx.objectStore("books");
        const get = store.getAll();
        get.onsuccess = () => {
          const book = get.result[0] as {
            id: string; updatedAt: string; chapters: unknown[];
            memory: { secrets: Record<string, string> };
          };
          book.memory.secrets["plot"] = "SEGRETO-MEMORIA-NON-PUBBLICARE";
          book.chapters = [
            { id: crypto.randomUUID(), number: 1, title: "Un inizio", purpose: "Premessa",
              scenes: [
                { id: crypto.randomUUID(), number: 1, title: "La marea",
                  status: "canon", objective: "Apertura", text: sceneText },
                { id: crypto.randomUUID(), number: 2, title: "Bozza",
                  status: "draft", objective: "Non ancora", text: "TESTO-BOZZA-PRIVATA" },
              ] },
            { id: crypto.randomUUID(), number: 2, title: "Solo draft", purpose: "Scartato",
              scenes: [{ id: crypto.randomUUID(), number: 1, title: "Inedita",
                status: "planned", objective: "Non pubblicare", text: "TESTO-PLANNED-PRIVATO" }] },
            { id: crypto.randomUUID(), number: 3, title: "Il ritorno", purpose: "Finale",
              scenes: [{ id: crypto.randomUUID(), number: 1, title: "La conclusione",
                status: "canon", objective: "Chiusura", text: "Tutto era terminato." }] },
          ];
          book.updatedAt = new Date(Math.max(Date.now(), Date.parse(book.updatedAt) + 1)).toISOString();
          store.put(book, book.id);
        };
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    }), text);
  }

  await editBook("Città misteriosa 😃");
  await page.reload();
  await page.getByRole("button", { name: "Archivio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Esporta libro" })).toBeVisible();
  const downloaded: string[] = [];
  page.on("download", item => downloaded.push(item.suggestedFilename()));
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await expect(page.getByText(/Il PDF non supporta il carattere U\+1F603/)).toBeVisible();
  expect(downloaded).toEqual([]);

  await editBook("La città tornò in silenzio — e il mare cambiò. €");
  await page.reload();
  await page.getByRole("button", { name: "Archivio", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(/segreto-del-mare.*\.pdf$/i);
  const pdf = readFileSync(await file.path()).toString("latin1");
  expect(pdf.startsWith("%PDF-")).toBe(true);
  expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
  expect((pdf.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(3);
  expect(pdf).toContain("Capitolo 1");
  expect(pdf).toContain("Capitolo 3");
  expect(pdf.indexOf("Capitolo 1")).toBeLessThan(pdf.indexOf("Capitolo 3"));
  // Only the two pages containing canonical chapters have printed folios.
  expect([...pdf.matchAll(/Pagina (\d+) di (\d+)/g)].map(match => match[0]))
    .toEqual(["Pagina 1 di 2", "Pagina 2 di 2"]);
  for (const privateData of [
    "BRIEF-PRIVATO-NON-PUBBLICARE", "SEGRETO-MEMORIA-NON-PUBBLICARE",
    "TESTO-BOZZA-PRIVATA", "TESTO-PLANNED-PRIVATO", "Solo draft",
  ]) expect(pdf).not.toContain(privateData);
  await expect(page.getByText(/Esportazione PDF completata/)).toBeVisible();

  // A real download with an embedded, licensed Unicode TTF (not a CDN font).
  await editBook("Nel viaggio a Łódź risuonava: Привет, мир!");
  await page.reload();
  await page.getByRole("button", { name: "Archivio", exact: true }).click();
  const unicodePending = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  const unicodeFile = await unicodePending;
  expect(unicodeFile.suggestedFilename()).toMatch(/segreto-del-mare.*\.pdf$/i);
  const unicodeBytes = readFileSync(await unicodeFile.path());
  const unicodePdf = unicodeBytes.toString("latin1");
  expect(unicodePdf.startsWith("%PDF-")).toBe(true);
  expect(unicodePdf.trimEnd().endsWith("%%EOF")).toBe(true);
  expect(unicodePdf).toContain("/FontFile2");
  expect(unicodePdf).toContain("/ToUnicode");
  expect(unicodeBytes.byteLength).toBeGreaterThan(75_000);
  expect((unicodePdf.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(3);
  expect(unicodePdf).not.toContain("SEGRETO-MEMORIA-NON-PUBBLICARE");
  await expect(page.getByText(/Esportazione PDF completata/)).toBeVisible();
});
