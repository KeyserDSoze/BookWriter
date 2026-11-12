import { captureChatRequests, configureLmStudio, expect, liveTest as test, readStored } from "../support/lmstudio";

async function startIdeaBook(page: import("@playwright/test").Page) {
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Le scimmie e il leone");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Due scimmie rubano il cibo al leone. Libro illustrato per bambini, tono leggero, 3 capitoli brevi.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText("Libro creato in IndexedDB.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Autopilot", exact: true }).click();
}

test("LM Studio reale: il testo arriva in streaming e «Pausa» non applica nulla", async ({ page, lm }, info) => {
  test.setTimeout(lm.taskTimeoutMs);
  const requests = captureChatRequests(page);
  await page.goto("/");
  await configureLmStudio(page, lm, info.project.name);
  await startIdeaBook(page);

  const stream = page.getByRole("region", { name: "Streaming task corrente" });
  await expect(stream).toContainText(lm.model);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests[0]).toMatchObject({ url: `${lm.baseUrl}/chat/completions`, stream: true });
  // Prima risposta visibile mentre il modello sta ancora lavorando.
  await expect(stream.getByText(/Risposta in streaming|Reasoning trasmesso/)).toBeVisible({ timeout: lm.taskTimeoutMs - 30_000 });

  await page.getByRole("button", { name: "Pausa", exact: true }).click();
  await expect(page.locator(".status-bar")).toContainText("In pausa · Brainstorming");
  const stored = await readStored(page);
  expect(stored.status).toBe("paused");
  expect(stored.activities.filter(a => a.aiRequested).map(a => a.status)).toEqual(["cancelled"]);
  expect(stored.activities.some(a => a.status === "succeeded")).toBe(false);
});

test("LM Studio reale: intervento registrato durante il lavoro, applicato alla ripresa e visibile nel prompt", async ({ page, lm }, info) => {
  test.setTimeout(lm.taskTimeoutMs * 2);
  const requests = captureChatRequests(page);
  await page.goto("/");
  await configureLmStudio(page, lm, info.project.name);
  await startIdeaBook(page);
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.getByRole("region", { name: "Streaming task corrente" }).getByText(/Risposta in streaming|Reasoning trasmesso/))
    .toBeVisible({ timeout: lm.taskTimeoutMs - 30_000 });

  const note = "Il leone si chiama Orazio e ha paura del buio.";
  await page.getByRole("textbox", { name: "Il tuo intervento" }).fill(note);
  await page.getByRole("button", { name: "Interrompi e registra intervento" }).click();
  await expect(page.locator(".status-bar")).toContainText("In pausa");
  const interrupted = requests.length;

  await page.getByRole("button", { name: "Riprendi" }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(interrupted);
  expect(requests[interrupted]!.userPrompt).toContain("INDICAZIONI DELL'AUTORE PER QUESTO PASSO");
  expect(requests[interrupted]!.userPrompt).toContain(note);

  await page.getByRole("button", { name: "Ferma a fine task" }).click();
  await expect(page.locator(".status-bar")).toContainText("In pausa", { timeout: lm.taskTimeoutMs });
  await expect(page.getByText(/Autopilot in pausa: il task in corso è stato completato e salvato/)).toBeVisible();

  const stored = await readStored(page);
  const done = stored.activities.find(a => a.status === "succeeded" && a.aiRequested);
  expect(done?.output?.trim().length ?? 0).toBeGreaterThan(0);
  expect(done?.appliedInterventionIds).toHaveLength(1);
  expect(stored.interventions[0]?.appliedAt).toBeTruthy();
  // Se LM Studio non comunica l'usage, il budget AI resta in modalità prudente: lo segnaliamo.
  expect.soft(done?.outputTokens, "LM Studio dovrebbe comunicare usage in streaming").toBeGreaterThan(0);
});
