import { expect, test, type Page } from "@playwright/test";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST,OPTIONS",
};
type Stored = {
  status: string; phase: string;
  interventions: Array<{ scope: string; instruction: string; appliedAt?: string }>;
  activities: Array<{ title: string; status: string; aiRequested?: boolean;
    interventionId?: string; appliedInterventionIds?: string[] }>;
};
function stored(page: Page): Promise<Stored> {
  return page.evaluate(() => new Promise<Stored>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["books", "activities"], "readonly");
      const books = tx.objectStore("books").getAll();
      const activities = tx.objectStore("activities").getAll();
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        const book = books.result[0] as { status: string; phase: string;
          authorInterventions?: Stored["interventions"] };
        resolve({ status: book.status, phase: book.phase, interventions: book.authorInterventions ?? [],
          activities: activities.result as Stored["activities"] });
        db.close();
      };
    };
  }));
}

test("dashboard: task leggibile, intervento registrato durante il lavoro e applicato alla ripresa (desktop/mobile)", async ({ page }) => {
  test.setTimeout(90_000);
  const prompts: string[] = [];
  let releaseFirst = () => {};
  let releaseSecond = () => {};
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
  await page.route("http://localhost:1234/v1/**", async route => {
    const request = route.request();
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers: CORS }); return; }
    if (!request.url().endsWith("/chat/completions")) { await route.abort(); return; }
    const body = JSON.parse(request.postData() ?? "{}") as { messages: Array<{ role: string; content: string }> };
    prompts.push(body.messages.find(message => message.role === "user")?.content ?? "");
    const call = prompts.length;
    if (call === 1) { await firstGate; await route.abort().catch(() => undefined); return; }
    if (call === 2) await secondGate;
    await route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({ choices: [{ message: { content: "Idee: il faro appare come presagio nel primo capitolo." } }],
        usage: { prompt_tokens: 60, completion_tokens: 12 } }) }).catch(() => undefined);
  });

  await page.goto("/");
  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByRole("textbox", { name: "Base URL" }).fill("http://localhost:1234/v1");
  await page.getByRole("combobox", { name: "Autenticazione AI" }).selectOption("none");
  await page.getByRole("textbox", { name: "Modelli rilevati / manuali" }).fill("demo-model");
  await page.getByRole("textbox", { name: "Modello predefinito" }).fill("demo-model");
  await page.getByRole("button", { name: "Salva impostazioni" }).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await nav.getByRole("button", { name: "Dashboard" }).click();

  await page.getByRole("radio", { name: /Da una sinossi capitolo per capitolo/ }).check();
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Il porto delle lettere");
  await page.getByRole("textbox", { name: "Sinossi capitolo per capitolo" }).fill(
    "Capitolo 1: L'arrivo\nMara arriva al porto e trova una lettera senza firma.\n\n" +
    "Capitolo 2: La lettera\nScopre che il padre è vivo.\n\nCapitolo 3: Il faro\nPadre e figlia si incontrano.");
  await expect(page.getByRole("region", { name: "Anteprima capitoli rilevati" })).toContainText("Rilevati 3 capitoli");
  await page.getByRole("button", { name: "Crea libro" }).click();
  await expect(page.getByText("Libro creato in IndexedDB.", { exact: false })).toBeVisible();
  const focus = page.getByRole("region", { name: "Lavoro dell'autopilot" });
  await expect(focus).toContainText("Avviato da una sinossi di 3 capitoli");
  await expect(focus).toContainText("Brainstorming: idee a lungo, medio e breve termine.");

  await page.getByRole("button", { name: "Autopilot", exact: true }).click();
  await expect(focus).toContainText("Sta lavorando su");
  await expect(focus.getByRole("region", { name: "Streaming task corrente" })).toContainText("demo-model");
  await expect(focus).toContainText("Perché:");
  await expect.poll(() => prompts.length).toBe(1);
  expect(prompts[0]).toContain("Mara arriva al porto e trova una lettera senza firma.");

  const note = "Il faro deve comparire già nel primo capitolo come presagio.";
  await page.getByRole("textbox", { name: "Il tuo intervento" }).fill(note);
  await page.getByRole("button", { name: "Interrompi e registra intervento" }).click();
  await expect(page.getByText(/Intervento registrato: verrà usato dal prossimo task di scrittura/)).toBeVisible();
  releaseFirst();
  await expect(page.locator(".status-bar")).toContainText("In pausa · Brainstorming");
  await expect(page.getByRole("region", { name: "Indicazioni in attesa" })).toContainText(note);
  const paused = await stored(page);
  expect(paused.interventions).toEqual([expect.objectContaining({ scope: "next_step", instruction: note })]);
  expect(paused.activities.filter(a => a.aiRequested).map(a => a.status)).toEqual(["cancelled"]);
  expect(paused.activities.filter(a => a.interventionId)).toHaveLength(1);

  await page.getByRole("button", { name: "Riprendi" }).click();
  await expect.poll(() => prompts.length).toBe(2);
  await page.getByRole("button", { name: "Ferma a fine task" }).click();
  releaseSecond();
  await expect(page.locator(".status-bar")).toContainText("In pausa · Validazione");
  await expect(page.getByText(/Autopilot in pausa: il task in corso è stato completato e salvato/)).toBeVisible();
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("INDICAZIONI DELL'AUTORE PER QUESTO PASSO");
  expect(prompts[1]).toContain(note);
  await expect(page.getByRole("region", { name: "Indicazioni in attesa" })).toHaveCount(0);
  await page.getByText(/Registro dei tuoi interventi/).click();
  await expect(page.getByRole("list", { name: "Registro interventi" }))
    .toContainText("Applicata nel task «Brainstorming su tre orizzonti»");
  const resumed = await stored(page);
  expect(resumed.phase).toBe("validate");
  expect(resumed.interventions[0]!.appliedAt).toBeTruthy();
  expect(resumed.activities.find(a => a.status === "succeeded" && a.aiRequested)?.appliedInterventionIds)
    .toHaveLength(1);
  const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
});
