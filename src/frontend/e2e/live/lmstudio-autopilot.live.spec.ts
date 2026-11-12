import { captureChatRequests, configureLmStudio, expect, liveTest as test, readStored } from "../support/lmstudio";

async function startIdeaBook(page: import("@playwright/test").Page) {
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Le scimmie e il leone");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Due scimmie rubano il cibo al leone. Libro illustrato per bambini, tono leggero, 3 capitoli brevi.");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText("Libro creato in IndexedDB.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Autopilot", exact: true }).click();
}

const SHOWING = /Risposta in streaming|Reasoning trasmesso/;

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
  await expect(stream.getByText(SHOWING)).toBeVisible({ timeout: lm.taskTimeoutMs - 30_000 });

  await page.getByRole("button", { name: "Pausa", exact: true }).click();
  await expect(page.locator(".status-bar")).toContainText("In pausa · Brainstorming");
  const stored = await readStored(page);
  expect(stored.status).toBe("paused");
  expect(stored.activities.filter(a => a.aiRequested).map(a => a.status)).toEqual(["cancelled"]);
  expect(stored.activities.some(a => a.status === "succeeded")).toBe(false);
});

test("LM Studio reale: intervento registrato durante il lavoro, inviato nel prompt alla ripresa e ancora in attesa dopo Pausa", async ({ page, lm }, info) => {
  test.setTimeout(lm.taskTimeoutMs);
  const requests = captureChatRequests(page);
  await page.goto("/");
  await configureLmStudio(page, lm, info.project.name);
  await startIdeaBook(page);
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.getByRole("region", { name: "Streaming task corrente" }).getByText(SHOWING))
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

  // Task non completato: la nota resta in attesa e non risulta applicata.
  await page.getByRole("button", { name: "Pausa", exact: true }).click();
  await expect(page.locator(".status-bar")).toContainText("In pausa");
  const stored = await readStored(page);
  expect(stored.interventions[0]?.appliedAt).toBeUndefined();
  await expect(page.getByRole("region", { name: "Indicazioni in attesa" })).toContainText(note);
});

// Un modello con reasoning lungo può impiegare decine di minuti: opt-in con LMSTUDIO_FULL_TASK=1.
test("LM Studio reale: task completo, nota applicata nel commit e usage comunicato", async ({ page, lm }, info) => {
  test.skip(process.env.LMSTUDIO_FULL_TASK !== "1", "Imposta LMSTUDIO_FULL_TASK=1 per attendere un task completo.");
  test.setTimeout(lm.taskTimeoutMs * 3);
  const requests = captureChatRequests(page);
  await page.goto("/");
  await configureLmStudio(page, lm, info.project.name, { streamTimeoutSeconds: 3600 });
  await startIdeaBook(page);
  await expect.poll(() => requests.length).toBe(1);

  const note = "Il leone si chiama Orazio e ha paura del buio.";
  await page.getByRole("textbox", { name: "Il tuo intervento" }).fill(note);
  await page.getByRole("button", { name: "Interrompi e registra intervento" }).click();
  await expect(page.locator(".status-bar")).toContainText("In pausa");
  await page.getByRole("button", { name: "Riprendi" }).click();
  await expect.poll(() => requests.length).toBe(2);
  await page.getByRole("button", { name: "Ferma a fine task" }).click();
  await expect(page.locator(".status-bar")).toContainText(/In pausa|Errore/, { timeout: lm.taskTimeoutMs * 2 });
  const stored = await readStored(page);
  const failed = stored.activities.filter(a => a.status === "failed").map(a => a.error);
  expect(stored.status, `Il task reale è finito in errore: ${stored.previousError ?? failed.join(" | ")}`).toBe("paused");
  await expect(page.getByText(/Autopilot in pausa: il task in corso è stato completato e salvato/)).toBeVisible();

  const done = stored.activities.find(a => a.status === "succeeded" && a.aiRequested);
  expect(done?.output?.trim().length ?? 0).toBeGreaterThan(0);
  expect(done?.appliedInterventionIds).toHaveLength(1);
  expect(stored.interventions[0]?.appliedAt).toBeTruthy();
  // Se LM Studio non comunica l'usage, il budget AI resta in modalità prudente: lo segnaliamo.
  expect.soft(done?.outputTokens, "LM Studio dovrebbe comunicare usage in streaming").toBeGreaterThan(0);
});
