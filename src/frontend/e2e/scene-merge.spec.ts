import { expect, test } from "@playwright/test";

test("mobile/desktop: diff di scena, bozza manuale persistente e approvazione senza push", async ({ page }) => {
  let remoteBook: Record<string, unknown> | null = null;
  const HEAD = "d".repeat(40);
  const calls: string[] = [];
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,x-github-api-version",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
  };
  const encode = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  await page.route("https://api.github.com/repos/merge-owner/merge-novel**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname, method = route.request().method();
    if (method === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    calls.push(method + " " + path);
    let status = 200, body: unknown = {};
    if (path === "/repos/merge-owner/merge-novel") {
      body = { private: true, full_name: "merge-owner/merge-novel",
        default_branch: "main", permissions: { push: true } };
    } else if (path.endsWith("/git/ref/heads/main")) {
      body = { object: { sha: HEAD } };
    } else if (path.endsWith("/contents/.bookwriter/project.json") && remoteBook) {
      body = { type: "file", encoding: "base64", content: encode(JSON.stringify(remoteBook)) };
    } else if (path.endsWith("/contents/.bookwriter/activities.json")) {
      body = { type: "file", encoding: "base64", content: encode("[]") };
    } else {
      status = 404; body = { message: "Not Found" };
    }
    await route.fulfill({ status, headers, body: JSON.stringify(body) });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Romanzo con conflitti");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Due versioni differenti della scena.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  const seeded = await page.evaluate(async () => {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const open = indexedDB.open("bookwriter");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("books", "readwrite");
        const store = tx.objectStore("books");
        const query = store.getAll();
        query.onerror = () => reject(query.error);
        query.onsuccess = () => {
          const book = query.result[0] as Record<string, unknown>;
          book.chapters = [{
            id: "chapter-one", title: "Inizio", purpose: "La rivelazione", number: 1,
            scenes: [{ id: "scene-one", number: 1, title: "Incontro",
              objective: "L'indizio", status: "canon",
              text: "Mara incontra Luca. La porta resta chiusa." }],
          }];
          book.status = "paused";
          store.put(book, book.id as string);
          tx.oncomplete = () => resolve(book);
          tx.onerror = () => reject(tx.error);
        };
      };
    });
  });
  remoteBook = structuredClone(seeded);
  const chapter = (remoteBook.chapters as Array<{ scenes: Array<{ text: string }> }>)[0]!;
  chapter.scenes[0]!.text = "Mara incontra Luca. La porta si spalanca.";

  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium"
      ? "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Archivio", exact: true }).click();
  await page.getByLabel("PAT GitHub").fill("github_pat_mock_merge_novel_2026");
  await page.getByRole("button", { name: "Salva PAT cifrato" }).click();
  await page.getByRole("textbox", { name: "Owner GitHub" }).fill("merge-owner");
  await page.getByRole("textbox", { name: "Repository del libro" }).fill("merge-novel");
  await page.getByRole("button", { name: "Verifica repository" }).click();
  await page.getByRole("button", { name: "Collega questo libro" }).click();
  await page.getByRole("button", { name: "Confronta locale e GitHub" }).click();
  await expect(page.getByText(/Confronto pronto: 1 differenze/)).toBeVisible();
  await page.getByText("Scena: Incontro", { exact: true }).click();
  await page.getByText("Diff parola per parola").click();
  await expect(page.getByLabel("Differenze scena")).toBeVisible();
  await expect(page.getByText(/Rosso: solo nella versione locale/)).toBeVisible();

  const editor = page.getByRole("textbox", { name: /Testo bozza fusione/ });
  await editor.fill("Mara incontra Luca. La porta si apre lentamente, senza rivelare il segreto.");
  await page.getByRole("button", { name: "Salva nuova bozza manuale" }).click();
  await expect(page.getByText(/Bozza manuale salvata/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Storico bozze:/ }).locator("option")).toHaveCount(2);

  await page.reload();
  await nav.getByRole("button", { name: "Archivio", exact: true }).click();
  await page.getByRole("button", { name: "Confronta locale e GitHub" }).click();
  await page.getByText("Scena: Incontro", { exact: true }).click();
  const history = page.getByRole("combobox", { name: /Storico bozze:/ });
  await expect(history.locator("option")).toHaveCount(2);
  await history.selectOption({ index: 1 });
  await expect(page.getByRole("textbox", { name: /Testo bozza fusione/ }))
    .toHaveValue(/La porta si apre lentamente/);
  await page.getByRole("button", { name: "Usa questa proposta per la scena" }).click();
  await expect(page.getByRole("combobox", { name: /Versione da conservare: scene:/ }))
    .toHaveValue("proposal");
  const writesBefore = calls.filter(x => !x.startsWith("GET")).length;
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: /Applica scelte con doppio backup/ }).click();
  await expect(page.getByText(/Risoluzione applicata/)).toBeVisible();
  expect(calls.filter(x => !x.startsWith("GET")).length).toBe(writesBefore);
  await expect(page.locator("#book-select option")).toHaveCount(4);
  await nav.getByRole("button", { name: "Libro" }).click();
  await expect(page.getByText(/La porta si apre lentamente/)).toBeVisible();
  await expect(page.getByText("(draft)")).toBeVisible();
  const width = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth, viewport: innerWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
});
