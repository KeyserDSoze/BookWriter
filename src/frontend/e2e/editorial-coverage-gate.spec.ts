import { expect, test } from "@playwright/test";

test("checkpoint incompleto non chiama il giudice e non congela il capitolo desktop/mobile", async ({ page }) => {
  let judgeCalls = 0;
  let providerCalls = 0;
  await page.route("https://api.openai.com/v1/chat/completions", async route => {
    providerCalls++;
    const body = route.request().postData() ?? "";
    if (body.includes("direttore editoriale CRITICO")) judgeCalls++;
    await route.fulfill({
      status: 500, headers: { "access-control-allow-origin": "*",
        "content-type": "application/json" },
      body: JSON.stringify({ error: { message: "Un checkpoint corrotto non deve raggiungere il provider." } }),
    });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" })
    .fill("Controllo rapporti di redazione");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Mara raggiunge il castello dopo una lunga traversata.");
  await page.getByRole("button", { name: "Crea libro" }).click();

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
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
        book.phase = "chapterReview";
        book.status = "paused";
        book.chapters = [{
          id: "chapter-1", number: 1, title: "La porta",
          purpose: "Aprire il romanzo",
          scenes: [{ id: "scene-1", number: 1, title: "Il guardiano",
            objective: "Verificare le scelte", status: "canon",
            text: "Mara incontra il guardiano davanti alla porta." }],
        }];
        // A previously persisted incomplete/legacy checkpoint: only one
        // reviewer "pass", yet stage falsely claims the judge may start.
        book.editorialCycle = {
          chapterId: "chapter-1", round: 1, stage: "adjudicate",
          reports: [{
            role: "continuity", segmentIndex: 0, segmentCount: 1,
            verdict: "pass", summary: "Nessun rilievo nel segmento.",
            findings: [], memoryNote: "", createdAt: "2026-11-09T20:00:00.000Z",
          }],
          repairCursor: 0, priorRounds: [],
        };
        store.put(book, book.id as string);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));

  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ?
      "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByLabel("API key").fill("sk-test-coverage-not-real");
  await page.getByRole("textbox", { name: "Modello predefinito" })
    .fill("mock-coverage-judge");
  await page.getByRole("button", { name: "Salva impostazioni" }).click();
  await page.reload();
  await page.evaluate(() => { location.hash = "#/dashboard"; });
  await expect(page.getByRole("region", { name: "Redazione multi-agente" })).toBeVisible();
  await page.getByRole("button", { name: "Riprendi" }).click();
  const result = await expect.poll(async () => page.evaluate(() =>
    new Promise<{ status: string; reason: string; frozen: boolean; reports: number }>((resolve, reject) => {
      const open = indexedDB.open("bookwriter");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("books", "readonly");
        const request = tx.objectStore("books").getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const book = request.result[0] as {
            status: string; previousError?: string;
            chapters: Array<{ frozenAt?: string }>;
            editorialCycle?: { reports: unknown[] };
          };
          resolve({
            status: book.status, reason: book.previousError ?? "",
            frozen: !!book.chapters[0]?.frozenAt,
            reports: book.editorialCycle?.reports.length ?? -1,
          });
          db.close();
        };
      };
    })), { timeout: 30_000 }).toMatchObject({
      status: "error", frozen: false, reports: 1,
    });
  void result;
  expect(judgeCalls).toBe(0);
  expect(providerCalls).toBe(0);
});
