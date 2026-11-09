import { expect, test } from "@playwright/test";

test("recupero checkpoint incompleto: conferma autore, archivio e riavvio senza AI (desktop/mobile)", async ({ page }) => {
  let providerCalls = 0;
  await page.route("https://api.openai.com/v1/chat/completions", async route => {
    providerCalls++;
    await route.fulfill({ status: 500, body: "{}" });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("La porta di Mara");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Un romanzo sulla custode di un segreto.");
  await page.getByRole("button", { name: "Crea libro" }).click();

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("books", "readwrite");
      const store = tx.objectStore("books");
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const book = request.result[0] as Record<string, unknown>;
        book.status = "paused";
        book.phase = "chapterReview";
        book.memory = { characters: {}, locations: {}, factions: {}, items: {},
          secrets: { door: "SEGRETO-PRIVATO-MAI-AI" }, timeline: [], currentState: "" };
        book.chapters = [{
          id: "chapter-1", number: 1, title: "Il guardiano", purpose: "Primo incontro",
          scenes: [{ id: "scene-1", number: 1, title: "La porta", objective: "Entrare",
            text: "Mara incontra il guardiano davanti al portone.", status: "canon" }],
        }];
        book.editorialCycle = {
          chapterId: "chapter-1", round: 1, stage: "adjudicate",
          reports: [{
            role: "continuity", segmentIndex: 0, segmentCount: 1,
            verdict: "pass", summary: "Nessuna incongruenza segnalata.",
            findings: [], memoryNote: "Rapporto legacy", createdAt: "2026-11-09T10:00:00.000Z",
          }], repairCursor: 0, priorRounds: [],
        };
        store.put(book, book.id as string);
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }));
  await page.reload();

  const panel = page.getByRole("region", { name: "Redazione multi-agente" });
  await expect(panel.getByLabel("Checkpoint editoriale da recuperare")).toBeVisible();
  const button = panel.getByRole("button", { name: "Recupera checkpoint e ricomincia" });
  await expect(button).toBeEnabled();

  // Cancel leaves all data intact and does not call the provider.
  page.once("dialog", dialog => void dialog.dismiss());
  await button.click();
  await expect(panel.getByLabel("Checkpoint editoriale da recuperare")).toBeVisible();

  page.once("dialog", dialog => void dialog.accept());
  await button.click();
  await expect(panel.getByText(/Checkpoint archiviato/)).toBeVisible();
  await expect(panel.getByText(/Tornata 1\/3/)).toBeVisible();
  await expect(panel.getByText(/Verifiche completate: 0/)).toBeVisible();
  await panel.getByText("Archivio recuperi editoriali (1)").click();
  await expect(panel.getByText("Nessuna incongruenza segnalata.")).toBeVisible();
  const saved = await page.evaluate(() => new Promise<{
    cycleReports: number; status: string; stage: string; archived: number;
    previousReports: number; previousSummary: string; canonical: string; frozen: boolean;
  }>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("books", "readonly");
      const request = tx.objectStore("books").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const b = request.result[0] as {
          status: string; editorialCycle: { stage: string; reports: unknown[] };
          editorialRecoveryArchives: Array<{ cycle: { reports: Array<{ summary: string }> } }>;
          chapters: Array<{ frozenAt?: string; scenes: Array<{ text: string }> }>;
        };
        resolve({ status: b.status, stage: b.editorialCycle.stage,
          cycleReports: b.editorialCycle.reports.length,
          archived: b.editorialRecoveryArchives.length,
          previousReports: b.editorialRecoveryArchives[0]!.cycle.reports.length,
          previousSummary: b.editorialRecoveryArchives[0]!.cycle.reports[0]!.summary,
          canonical: b.chapters[0]!.scenes[0]!.text,
          frozen: !!b.chapters[0]!.frozenAt });
        db.close();
      };
    };
  }));
  expect(saved).toMatchObject({
    status: "paused", stage: "review", cycleReports: 0, archived: 1,
    previousReports: 1, previousSummary: "Nessuna incongruenza segnalata.",
    canonical: "Mara incontra il guardiano davanti al portone.", frozen: false,
  });
  expect(providerCalls).toBe(0);
});
