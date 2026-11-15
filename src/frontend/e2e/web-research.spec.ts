import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../src/domain/types";

const nav = (page: Page) => page.getByRole("navigation", {
  name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
});
async function seed(page: Page, options: { searchModel?: boolean; planned?: boolean } = {}) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Le sparizioni");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  await page.evaluate(async ({ defaults, options }) => {
    const { knowledgeBook } = await import("/src/domain/__fixtures__/knowledge.ts");
    const { defaultWebResearchSettings } = await import("/src/domain/web-research.ts");
    const { getDb, saveBook, saveSettings } = await import("/src/infrastructure/db.ts");
    const { encryptLocal } = await import("/src/infrastructure/crypto.ts");
    const current = (await (await getDb()).getAll("books"))[0];
    const book = knowledgeBook();
    book.id = current.id; book.title = "Le sparizioni";
    if (options.planned) {
      book.chapters[1]!.frozenAt = undefined;
      book.chapters[1]!.scenes.push({ id: "scene:002:003", number: 3, title: "Il tram", objective: "Elena segue Markus sul tram", text: "", status: "planned" });
      book.webResearch = defaultWebResearchSettings(new Date().toISOString());
    }
    await saveBook(book, false);
    defaults.endpoints[0].secret = await encryptLocal("sk-synthetic-research");
    defaults.defaultRoute.modelId = "synthetic-writer";
    if (options.searchModel) defaults.taskRoutes.research = { endpointId: defaults.endpoints[0].id, modelId: "sonar-sintetico" };
    await saveSettings(defaults);
  }, { defaults: structuredClone(DEFAULT_SETTINGS), options });
  await page.reload();
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    return (await (await getDb()).getAll("books"))[0];
  });
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

test("ricerca web: consenso esplicito, Wikipedia senza chiave, prova e registro nella pagina Mondo", async ({ page }) => {
  let ai = 0;
  const queries: string[] = [];
  await page.route("**/chat/completions", async route => { ai++; await route.abort(); });
  await page.route("https://it.wikipedia.org/w/api.php**", async (route: Route) => {
    const url = new URL(route.request().url());
    queries.push(url.searchParams.get("gsrsearch") ?? "");
    await route.fulfill({ json: { query: { pages: [{ pageid: 7, index: 1, title: "Tram di Vienna", canonicalurl: "https://it.wikipedia.org/wiki/Tram_di_Vienna",
      extract: "La rete tranviaria di Vienna è una delle più estese al mondo." }] } }, headers: { "access-control-allow-origin": "*" } });
  });
  await seed(page);
  await page.getByRole("button", { name: "Modelli e redazione" }).first().click();
  await page.getByRole("tab", { name: /^Ricerca web/ }).click();
  const panel = page.getByRole("region", { name: "Ricerca web dell'AI" });
  await expect(panel.getByText("Spenta")).toBeVisible();
  page.once("dialog", dialog => { expect(dialog.message()).toContain("lasciano il dispositivo"); void dialog.accept(); });
  await panel.getByRole("button", { name: "Attiva la ricerca web" }).click();
  await expect(panel.getByText("Attiva", { exact: true })).toBeVisible();
  expect((await stored(page)).webResearch).toMatchObject({ enabled: true, provider: "model" });
  await panel.getByRole("radio", { name: "Wikipedia" }).click();
  await panel.getByRole("switch", { name: "Direttore editoriale" }).click();
  await panel.getByRole("button", { name: "Salva la ricerca web" }).click();
  await expect(panel.getByText("Impostazioni della ricerca salvate.")).toBeVisible();
  const saved = (await stored(page)).webResearch;
  expect(saved.provider).toBe("wikipedia");
  expect(saved.agents).not.toContain("director");
  await panel.getByPlaceholder(/orari dei treni/).fill("tram di Vienna nel 1923");
  await panel.getByRole("button", { name: "Cerca adesso" }).click();
  await expect(panel.getByRole("link", { name: /Tram di Vienna/ })).toHaveAttribute("href", "https://it.wikipedia.org/wiki/Tram_di_Vienna");
  expect(queries).toEqual(["tram di Vienna nel 1923"]);
  await nav(page).getByRole("button", { name: "Mondo", exact: true }).click();
  await page.getByRole("button", { name: /^Ricerche/ }).click();
  const log = page.getByRole("list", { name: "Registro delle ricerche" });
  await expect(log.getByText("«tram di Vienna nel 1923»")).toBeVisible();
  await expect(log.getByText(/Prova della ricerca · Wikipedia/)).toBeVisible();
  expect(ai).toBe(0);
  expect(await noOverflow(page)).toBe(true);
});

test("ricerca web nell'autopilot: la scrittura chiede, il modello di ricerca risponde, la scena usa i risultati", async ({ page }) => {
  test.setTimeout(90_000);
  const steps: string[] = [];
  await page.route("https://api.openai.com/v1/chat/completions", async (route: Route) => {
    const data = route.request().postDataJSON() as { model: string; messages: Array<{ content: string }> };
    const system = data.messages[0]!.content, prompt = data.messages[1]!.content;
    let content: string;
    if (system.includes("servizio di ricerca sul web")) {
      steps.push("search:" + data.model);
      content = JSON.stringify({ research_summary: "Nel 1923 i tram di Vienna erano rossi e bianchi.", sources: [{ title: "Storia dei tram", url: "https://example.org/tram", excerpt: "rossi e bianchi" }] });
    } else if (prompt.includes("Scrivi SOLTANTO la scena scene:002:003")) {
      if (!prompt.includes("RISULTATI DELLA RICERCA WEB")) { steps.push("ask"); content = JSON.stringify({ web_search: { queries: ["colore dei tram di Vienna nel 1923"], reason: "Dettaglio d'epoca." } }); }
      else { steps.push("write"); content = "Elena sale sul tram rosso e bianco. Markus non si volta."; }
    } else if (prompt.includes("RISCRIVI la scena")) { steps.push("review"); content = "Elena sale sul tram rosso e bianco. Markus non si volta, ma la vede."; }
    else if (prompt.includes('"sceneSummaries"')) { steps.push("summaries"); content = JSON.stringify({ sceneSummaries: Object.fromEntries(
      [...prompt.matchAll(/SCENA (\S+) «/g)].map(match => [match[1], "Elena sale sul tram e Markus finge di non vederla."])) }); }
    else { steps.push("other"); content = JSON.stringify({ mode: "delta", knowledge: {} }); }
    await route.fulfill({ json: { choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 30 } } });
  });
  await seed(page, { searchModel: true, planned: true });
  await page.getByRole("button", { name: "Riprendi" }).click();
  await expect.poll(async () => steps.includes("review"), { timeout: 60_000 }).toBe(true);
  // The scene is written: stop the run (the board of chapter 2 is not part of this test).
  await page.getByRole("button", { name: "Pausa" }).click({ timeout: 3000 }).catch(() => undefined);
  await expect.poll(async () => (await stored(page)).chapters[1].scenes[2].text, { timeout: 60_000 }).toContain("rosso e bianco");
  expect(steps.slice(0, 3)).toEqual(["ask", "search:sonar-sintetico", "write"]);
  const book = await stored(page);
  expect(book.webResearchLog).toHaveLength(1);
  expect(book.webResearchLog[0]).toMatchObject({ query: "colore dei tram di Vienna nel 1923", status: "ok", provider: "model" });
  await nav(page).getByRole("button", { name: "Attività", exact: true }).click();
  await expect(page.getByText("Ricerca web: «colore dei tram di Vienna nel 1923»").first()).toBeVisible();
});
