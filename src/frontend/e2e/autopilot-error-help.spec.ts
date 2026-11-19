import { expect, test } from "@playwright/test";

test("spiega una citazione scartata e attiva i tentativi sull'endpoint giusto senza avviare AI", async ({ page }) => {
  let aiCalls = 0;
  await page.route("https://api.openai.com/**", async route => { aiCalls++; await route.abort(); });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Errore di revisione");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  await page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    const { DEFAULT_SETTINGS, TASK_KINDS } = await (window as any).__engine("domain/types.ts");
    const db = await getDb();
    const tx = db.transaction(["books", "activities", "settings"], "readwrite");
    const book = (await tx.objectStore("books").getAll())[0];
    const settings = await tx.objectStore("settings").get("global") ?? structuredClone(DEFAULT_SETTINGS);
    // The default route is intentionally empty, but every task has a valid route.
    const id = settings.endpoints[0].id;
    settings.endpoints[0].authMode = "none";
    settings.endpoints[0].baseUrl = "http://localhost:1234/v1";
    settings.endpoints[0].secret = null;
    settings.defaultRoute.modelId = "";
    for (const kind of TASK_KINDS) settings.taskRoutes[kind] = { endpointId: id, modelId: "configured-task-model" };
    book.status = "error";
    book.previousError = "Prova narrativa non presente letteralmente nel segmento esaminato: cita 12+ caratteri esatti, senza parafrasi o omissioni.";
    await tx.objectStore("books").put(book, book.id);
    const activityId = crypto.randomUUID();
    await tx.objectStore("activities").put({ id: activityId, bookId: book.id, runId: "synthetic",
      phase: "chapterReview", title: "Redazione: readerGenre 23/36", reason: "Verificare il testo", nextStep: "Prossimo revisore",
      status: "failed", aiRequested: true, endpointId: id, modelId: "configured-task-model", createdAt: new Date().toISOString() }, activityId);
    await tx.objectStore("settings").put(settings, "global");
    await tx.done;
  });
  await page.reload();
  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
  const help = page.getByRole("region", { name: "Spiegazione dell'errore" });
  await expect(help).toContainText("Cosa significa:");
  await expect(help).toContainText("rapporto è stato scartato");
  await expect(help).toContainText("Cosa fare:");
  await expect(page.getByText(/Modello o endpoint mancanti|Nessun modello predefinito/)).toHaveCount(0);
  page.once("dialog", dialog => dialog.dismiss());
  await help.getByRole("button", { name: "Attiva tentativi automatici" }).click();
  await expect(help.getByRole("button", { name: "Attiva tentativi automatici" })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await help.getByRole("button", { name: "Attiva tentativi automatici" }).click();
  await expect(help).toContainText("Tentativi automatici attivi");
  await expect(help).toContainText("massimo 2 nuovi tentativi");
  expect(aiCalls).toBe(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Spiegazione dell'errore" })).toContainText("Tentativi automatici attivi");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
