import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";

test("EPUB scaricato: XML valido, ZIP EPUB 3 e solo scene canoniche desktop/mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("L'ultima stella & il sogno");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("SEGRETO-DEL-BRIEF: mai esportare il materiale privato.");
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
        book.memory.secrets["twist"] = "SEGRETO-MEMORIA-NON-ESPORTARE";
        book.chapters = [
          {
            id: crypto.randomUUID(), number: 1, title: "Il viaggio & la 🌙", purpose: "Partenza",
            scenes: [
              { id: crypto.randomUUID(), number: 1, title: "Scena <prima>",
                objective: "Ambientazione", status: "canon",
                text: "Nel cielo brillò una stella. 🌟\nE poi una nuova linea.\n\nL'ombra & il mare.\u0001",
              },
              { id: crypto.randomUUID(), number: 2, title: "Appunti",
                objective: "Non pubblicare", status: "draft",
                text: "SEGRETO-DRAFT-NON-ESPORTARE" },
              { id: crypto.randomUUID(), number: 3, title: 'Ultima & "voce"',
                objective: "Ultima scena", status: "canon",
                text: "Una seconda scena confermata." },
            ],
          },
          {
            id: crypto.randomUUID(), number: 2, title: "Solo pianificato", purpose: "Futuro",
            scenes: [{ id: crypto.randomUUID(), number: 1, title: "Non scritta",
              objective: "No", status: "planned", text: "" }],
          },
          {
            id: crypto.randomUUID(), number: 3, title: "Il ritorno", purpose: "Finale",
            scenes: [{ id: crypto.randomUUID(), number: 1, title: "Conclusione",
              objective: "Fine", status: "canon", text: "Il viaggio si concluse." }],
          },
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
  await page.getByRole("button", { name: "EPUB", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/ultima-stella.*\.epub$/i);
  const bytes = readFileSync(await download.path());
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(header.getUint32(0, true)).toBe(0x04034b50);
  expect(header.getUint16(8, true)).toBe(0);
  const files = unzipSync(new Uint8Array(bytes));
  expect(strFromU8(files.mimetype)).toBe("application/epub+zip");
  expect(Object.keys(files)).toEqual([
    "mimetype", "META-INF/container.xml", "OEBPS/style.css", "OEBPS/titlepage.xhtml",
    "OEBPS/chapter-1.xhtml", "OEBPS/chapter-2.xhtml",
    "OEBPS/nav.xhtml", "OEBPS/content.opf",
  ]);
  const contents = Object.values(files).map(value => strFromU8(value)).join("\n");
  expect(contents).toContain("Nel cielo brillò una stella. 🌟");
  expect(contents).toContain("Il viaggio &amp; la 🌙");
  expect(contents).toContain("Scena &lt;prima&gt;");
  expect(contents).toContain("Una seconda scena confermata.");
  expect(contents).toContain("L&#39;ombra &amp; il mare.");
  expect(contents).not.toContain("\u0001");
  for (const forbidden of [
    "SEGRETO-DRAFT-NON-ESPORTARE", "SEGRETO-MEMORIA-NON-ESPORTARE",
    "SEGRETO-DEL-BRIEF", "Solo pianificato",
  ]) expect(contents).not.toContain(forbidden);
  const xml = [
    "META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml",
    "OEBPS/titlepage.xhtml", "OEBPS/chapter-1.xhtml", "OEBPS/chapter-2.xhtml",
  ].map(name => strFromU8(files[name]));
  const parserErrors = await page.evaluate((documents: string[]) =>
    documents.map(source => {
      const result = new DOMParser().parseFromString(source, "application/xml");
      return result.querySelector("parsererror")?.textContent ?? null;
    }), xml);
  expect(parserErrors).toEqual(Array(xml.length).fill(null));
  const tocTargets = await page.evaluate(({ nav, documents }: {
    nav: string; documents: Record<string, string>;
  }) => {
    const parser = new DOMParser();
    const index = parser.parseFromString(nav, "application/xml");
    return Array.from(index.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "a"))
      .filter(link => link.getAttribute("href")?.includes("#"))
      .map(link => {
        const href = link.getAttribute("href") ?? "";
        const [path, fragment] = href.split("#");
        const page = path && documents[path] ? parser.parseFromString(documents[path], "application/xml") : null;
        const section = fragment && page ? page.querySelector('[id="' + fragment + '"]') : null;
        const heading = section && page ? page.querySelector('[id="' + section.getAttribute("aria-labelledby") + '"]') : null;
        return { href, title: link.textContent, heading: heading?.textContent ?? null };
      });
  }, {
    nav: strFromU8(files["OEBPS/nav.xhtml"]),
    documents: {
      "chapter-1.xhtml": strFromU8(files["OEBPS/chapter-1.xhtml"]),
      "chapter-2.xhtml": strFromU8(files["OEBPS/chapter-2.xhtml"]),
    },
  });
  expect(tocTargets).toEqual([
    { href: "chapter-1.xhtml#scene-1", title: "Scena <prima>", heading: "Scena <prima>" },
    { href: "chapter-1.xhtml#scene-2", title: 'Ultima & "voce"', heading: 'Ultima & "voce"' },
    { href: "chapter-2.xhtml#scene-1", title: "Conclusione", heading: "Conclusione" },
  ]);
  const landmarks = await page.evaluate(({ nav, documents }: {
    nav: string; documents: Record<string, string>;
  }) => {
    const parser = new DOMParser();
    const xhtmlNS = "http://www.w3.org/1999/xhtml";
    const epubNS = "http://www.idpf.org/2007/ops";
    const index = parser.parseFromString(nav, "application/xml");
    const containers = Array.from(index.getElementsByTagNameNS(xhtmlNS, "nav"))
      .filter(element => element.getAttributeNS(epubNS, "type") === "landmarks");
    return containers.map(container =>
      Array.from(container.getElementsByTagNameNS(xhtmlNS, "a")).map(link => {
        const type = link.getAttributeNS(epubNS, "type");
        const href = link.getAttribute("href") ?? "";
        const target = documents[href] ? parser.parseFromString(documents[href], "application/xml") : null;
        const structuralTarget = type === "titlepage"
          ? target?.getElementsByTagNameNS(xhtmlNS, "section")[0]
          : target?.getElementsByTagNameNS(xhtmlNS, "body")[0];
        return {
          type, href,
          targetType: structuralTarget?.getAttributeNS(epubNS, "type") ?? null,
          heading: target?.getElementsByTagNameNS(xhtmlNS, "h1")[0]?.textContent ?? null,
        };
      }),
    );
  }, {
    nav: strFromU8(files["OEBPS/nav.xhtml"]),
    documents: {
      "titlepage.xhtml": strFromU8(files["OEBPS/titlepage.xhtml"]),
      "chapter-1.xhtml": strFromU8(files["OEBPS/chapter-1.xhtml"]),
      "chapter-2.xhtml": strFromU8(files["OEBPS/chapter-2.xhtml"]),
    },
  });
  expect(landmarks).toEqual([[
    { type: "titlepage", href: "titlepage.xhtml", targetType: "titlepage",
      heading: "L'ultima stella & il sogno" },
    { type: "bodymatter", href: "chapter-1.xhtml", targetType: "bodymatter",
      heading: "Capitolo 1 — Il viaggio & la 🌙" },
  ]]);
  const opf = strFromU8(files["OEBPS/content.opf"]);
  expect(opf.match(/<itemref idref="[^"]+"\/>/g)).toEqual([
    '<itemref idref="titlepage"/>', '<itemref idref="chapter-1"/>', '<itemref idref="chapter-2"/>',
  ]);
  const packageReferences = await page.evaluate(({ opf, archivePaths }: {
    opf: string; archivePaths: string[];
  }) => {
    const packageNS = "http://www.idpf.org/2007/opf";
    const doc = new DOMParser().parseFromString(opf, "application/xml");
    const entries = Array.from(doc.getElementsByTagNameNS(packageNS, "item"))
      .map(item => ({ id: item.getAttribute("id"), href: item.getAttribute("href") }));
    const byId = new Map(entries.map(item => [item.id, item.href]));
    const spine = Array.from(doc.getElementsByTagNameNS(packageNS, "itemref"))
      .map(item => byId.get(item.getAttribute("idref")) ?? null);
    return {
      missing: entries.filter(item => !item.href || !archivePaths.includes("OEBPS/" + item.href)),
      spine,
    };
  }, {
    opf: strFromU8(files["OEBPS/content.opf"]),
    archivePaths: Object.keys(files),
  });
  expect(packageReferences.missing).toEqual([]);
  expect(packageReferences.spine).toEqual([
    "titlepage.xhtml", "chapter-1.xhtml", "chapter-2.xhtml",
  ]);
  await expect(page.getByText(/Esportazione EPUB completata/)).toBeVisible();
});
