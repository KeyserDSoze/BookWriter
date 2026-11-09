import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";

test("DOCX scaricato: package OPC XML valido, solo prosa canonica desktop/mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("L'ultima stella & il sogno");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("BRIEF-PRIVATO-NON-ESPORTARE");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText(/Libro creato in IndexedDB/)).toBeVisible();

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("books", "readwrite");
      const books = tx.objectStore("books");
      const get = books.getAll();
      get.onsuccess = () => {
        const book = get.result[0] as {
          id: string; updatedAt: string; chapters: unknown[];
          memory: { secrets: Record<string, string> };
        };
        book.memory.secrets["plot"] = "SEGRETO-PRIVATO-NON-ESPORTARE";
        book.chapters = [
          { id: crypto.randomUUID(), number: 1, title: "Viaggio & <origine>", purpose: "Inizio",
            scenes: [
              { id: crypto.randomUUID(), number: 1, title: 'Prima "luce"',
                objective: "Inizio", status: "canon",
                text: "Una stella brillò. 🌟 & <ombra>\n\nUn nuovo paragrafo.\u0001" },
              { id: crypto.randomUUID(), number: 2, title: "Bozza riservata",
                objective: "Da rivedere", status: "draft", text: "PROSA-DRAFT-NON-ESPORTARE" },
              { id: crypto.randomUUID(), number: 3, title: "Ultima voce",
                objective: "Evoluzione", status: "canon", text: "Il vento rispose. 🪶" },
            ] },
          { id: crypto.randomUUID(), number: 2, title: "Solo bozze", purpose: "Privato",
            scenes: [{ id: crypto.randomUUID(), number: 1, title: "Inedito",
              objective: "Non pubblicare", status: "planned", text: "PROSA-PLANNED-NON-ESPORTARE" }] },
          { id: crypto.randomUUID(), number: 3, title: "Il ritorno", purpose: "Finale",
            scenes: [{ id: crypto.randomUUID(), number: 1, title: "Conclusione",
              objective: "Finale", status: "canon", text: "Il viaggio si concluse." }] },
        ];
        book.updatedAt = new Date(Math.max(Date.now(), Date.parse(book.updatedAt) + 1)).toISOString();
        books.put(book, book.id);
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }));
  await page.reload();
  await page.getByRole("button", { name: "Archivio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Esporta libro" })).toBeVisible();

  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Word (DOCX)", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/ultima-stella.*\.docx$/i);

  const bytes = readFileSync(await download.path());
  const files = unzipSync(new Uint8Array(bytes));
  const required = ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "docProps/core.xml"];
  for (const path of required) expect(files[path], path).toBeDefined();
  const xml = Object.entries(files).filter(([name]) => name.endsWith(".xml") || name.endsWith(".rels"))
    .map(([, value]) => strFromU8(value)).join("\n");
  for (const forbidden of [
    "BRIEF-PRIVATO-NON-ESPORTARE", "SEGRETO-PRIVATO-NON-ESPORTARE",
    "PROSA-DRAFT-NON-ESPORTARE", "PROSA-PLANNED-NON-ESPORTARE",
    "Bozza riservata", "Solo bozze",
  ]) expect(xml).not.toContain(forbidden);
  expect(xml).not.toContain("\u0001");

  const result = await page.evaluate((sources: Record<string, string>) => {
    const parser = new DOMParser();
    const docs = Object.fromEntries(Object.entries(sources).map(([name, source]) =>
      [name, parser.parseFromString(source, "application/xml")],
    ));
    const errors = Object.fromEntries(Object.entries(docs).map(([name, doc]) =>
      [name, doc.getElementsByTagName("parsererror").length === 0],
    ));
    const word = docs["word/document.xml"];
    const namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const paragraphs = Array.from(word.getElementsByTagNameNS(namespace, "p")).map(paragraph =>
      Array.from(paragraph.getElementsByTagNameNS(namespace, "t"))
        .map(node => node.textContent ?? "").join(""),
    ).filter(Boolean);
    return { errors, paragraphs };
  }, Object.fromEntries(required.map(name => [name, strFromU8(files[name])])));
  expect(Object.values(result.errors)).toEqual([true, true, true, true]);
  const expected = [
    "L'ultima stella & il sogno", "Capitolo 1 — Viaggio & <origine>",
    'Prima "luce"', "Una stella brillò. 🌟 & <ombra>", "Un nuovo paragrafo.",
    "Ultima voce", "Il vento rispose. 🪶",
    "Capitolo 3 — Il ritorno", "Conclusione", "Il viaggio si concluse.",
  ];
  let previous = -1;
  for (const text of expected) {
    const at = result.paragraphs.indexOf(text, previous + 1);
    expect(at, "Paragrafo DOCX mancante/fuori ordine: " + text).toBeGreaterThan(previous);
    previous = at;
  }
  await expect(page.getByText(/Esportazione DOCX completata/)).toBeVisible();
});
