import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_SETTINGS } from "@engine/domain/types";

const nav = (page: Page) => page.getByRole("navigation", {
  name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
});
const PROSE = "Elena sale sul tram rosso e bianco. Markus non si volta.";

/** A synthetic book whose next step is writing one planned scene, with a working (mocked) model. */
async function seed(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Le sparizioni");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  await page.evaluate(async ({ defaults }) => {
    const { knowledgeBook } = await (window as any).__engine("domain/__fixtures__/knowledge.ts");
    const { getDb, saveBook, saveSettings } = await import("/src/infrastructure/db.ts");
    const { encryptLocal } = await import("/src/infrastructure/crypto.ts");
    const current = (await (await getDb()).getAll("books"))[0];
    const book = knowledgeBook();
    book.id = current.id; book.title = "Le sparizioni";
    book.chapters[1]!.frozenAt = undefined;
    book.chapters[1]!.scenes.push({ id: "scene:002:003", number: 3, title: "Il tram", objective: "Elena segue Markus sul tram", text: "", status: "planned" });
    await saveBook(book, false);
    defaults.endpoints[0].secret = await encryptLocal("sk-synthetic-resume");
    defaults.defaultRoute.modelId = "synthetic-writer";
    await saveSettings(defaults);
  }, { defaults: structuredClone(DEFAULT_SETTINGS) });
  await page.reload();
}
/** The first model call never answers (it is the one a reload cuts off); the following ones do. */
async function provider(page: Page) {
  const state = { calls: 0, firstSeen: undefined as unknown as Promise<void> };
  let seen!: () => void;
  state.firstSeen = new Promise<void>(resolve => { seen = resolve; });
  await page.route("https://api.openai.com/v1/chat/completions", async (route: Route) => {
    state.calls++;
    if (state.calls === 1) {
      seen();
      await new Promise(resolve => setTimeout(resolve, 25_000));
      await route.abort().catch(() => undefined);
      return;
    }
    const prompt = (route.request().postDataJSON() as { messages: Array<{ content: string }> }).messages[1]!.content;
    const content = prompt.includes("Scrivi SOLTANTO la scena") ? PROSE
      : prompt.includes("RISCRIVI la scena") ? PROSE + " Si ferma." : JSON.stringify({ mode: "delta" });
    await route.fulfill({ json: { choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 30 } } }).catch(() => undefined);
  });
  return state;
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    const db = await getDb();
    return { book: (await db.getAll("books"))[0], activities: await db.getAll("activities") };
  });
}
async function startAndCutOff(page: Page, how: "reload" | "navigate") {
  const model = await provider(page);
  await seed(page);
  await page.getByRole("button", { name: "Riprendi" }).click();
  await model.firstSeen;
  await expect.poll(async () => (await stored(page)).book.status).toBe("running");
  if (how === "reload") await page.reload(); else await page.goto("/");
  return model;
}

test("F5 mentre l'autopilot lavora: riprende da solo dall'ultimo checkpoint e si vede", async ({ page }) => {
  test.setTimeout(90_000);
  const model = await startAndCutOff(page, "reload");
  await expect(page.getByText(/«Le sparizioni» stava lavorando prima del ricaricamento ed è ripreso da solo/)).toBeVisible();
  await expect.poll(async () => (await stored(page)).book.chapters[1].scenes[2].text, { timeout: 60_000 }).toContain("tram rosso e bianco");
  expect(model.calls).toBeGreaterThanOrEqual(2);
  const { activities } = await stored(page);
  const lost = activities.find((a: { error?: string }) => a.error?.includes("Browser interrotto prima della conclusione"));
  expect(lost).toMatchObject({ status: "cancelled" });
  await page.getByRole("button", { name: "Pausa" }).click({ timeout: 5_000 }).catch(() => undefined);
});

test("con l'interruttore spento un ricaricamento lascia il libro in pausa", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem("bookwriter.ui.autoResume", "false"));
  const model = await startAndCutOff(page, "reload");
  await expect(page.getByText("In pausa ·").first()).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(model.calls).toBe(1);
  const { book } = await stored(page);
  expect(book.status).toBe("paused");
  expect(book.chapters[1].scenes[2].text).toBe("");
  await expect(page.getByText(/è ripreso da solo/)).toHaveCount(0);
});

test("aprire l'app da un link, non da un ricaricamento, non riavvia l'autopilot", async ({ page }) => {
  test.setTimeout(90_000);
  const model = await startAndCutOff(page, "navigate");
  await expect(page.getByText("In pausa ·").first()).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(model.calls).toBe(1);
  expect((await stored(page)).book.status).toBe("paused");
  await expect(page.getByRole("button", { name: "Riprendi" })).toBeVisible();
});

test("l'interruttore è in Impostazioni → Questo dispositivo, si ricorda e spiega i limiti in background", async ({ page }) => {
  await page.goto("/");
  await nav(page).getByRole("button", { name: "Impostazioni" }).click();
  await page.getByRole("tab", { name: "Questo dispositivo" }).click();
  const toggle = page.getByRole("switch", { name: "Riprendi da solo dopo un ricaricamento" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/il browser non permette di continuare a pagina chiusa/)).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await page.getByRole("tab", { name: "Questo dispositivo" }).click();
  await expect(page.getByRole("switch", { name: "Riprendi da solo dopo un ricaricamento" })).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
