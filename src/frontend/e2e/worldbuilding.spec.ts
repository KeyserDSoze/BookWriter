import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../src/domain/types";

const mobile = () => test.info().project.name === "mobile-chromium";
const nav = (page: Page) => page.getByRole("navigation", { name: mobile() ? "Navigazione mobile" : "Navigazione principale" });

async function seed(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Le sparizioni");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  await page.evaluate(async defaults => {
    const { knowledgeBook } = await import("/src/domain/__fixtures__/knowledge.ts");
    const { getDb, saveBook, saveSettings } = await import("/src/infrastructure/db.ts");
    const { encryptLocal } = await import("/src/infrastructure/crypto.ts");
    const current = (await (await getDb()).getAll("books"))[0];
    const book = knowledgeBook();
    book.id = current.id; book.title = "Le sparizioni";
    await saveBook(book, false);
    defaults.endpoints[0].secret = await encryptLocal("sk-synthetic-world");
    defaults.defaultRoute.modelId = "synthetic-writer";
    await saveSettings(defaults);
  }, structuredClone(DEFAULT_SETTINGS));
  await page.reload();
}
const stored = (page: Page) => page.evaluate(async () => {
  const { getDb } = await import("/src/infrastructure/db.ts");
  return (await (await getDb()).getAll("books"))[0];
});

test("worldbuilding: indirizzo pulito, sezioni chiuse che ricordano cosa era aperto, ricerca che mostra solo ciò che corrisponde", async ({ page }) => {
  await seed(page);
  await nav(page).getByRole("button", { name: "Mondo", exact: true }).click();
  await expect(page).toHaveURL(/\/worldbuilding\?book=/);
  expect(new URL(page.url()).hash).toBe("");
  const characters = page.getByRole("button", { name: "Personaggi (2)", exact: true });
  const state = page.getByRole("button", { name: "Stato corrente", exact: true });
  await expect(characters).toHaveAttribute("aria-expanded", "false");
  await expect(state).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: /^Timeline ed eventi/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Cronologia della memoria/ })).toBeVisible();
  // Open one, reload: it is still the one open.
  await state.click();
  await expect(state).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "Stato corrente", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Personaggi (2)", exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Stato corrente", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stato corrente", exact: true })).toHaveAttribute("aria-expanded", "false");
  // The search opens only what matches and hides the rest.
  const search = page.getByRole("searchbox", { name: "Cerca nel mondo" });
  await search.fill("voss");
  await expect(page.getByRole("list", { name: "Personaggi" }).getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Luoghi/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Fazioni/ })).toHaveCount(0);
  await expect(page.getByText(/risultat[oi] in/)).toBeVisible();
  await search.fill("xyznessuno");
  await expect(page.getByText("Nessun risultato per «xyznessuno».")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Personaggi/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancella la ricerca" }).click();
  await expect(page.getByRole("button", { name: "Personaggi (2)", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  expect(overflow).toBe(true);
});

test("worldbuilding: la memoria si modifica a mano e da quella modifica si avvia la revisione del libro, sapendo prima e dopo", async ({ page }) => {
  test.setTimeout(90_000);
  const prompts: string[] = [];
  await page.route("https://api.openai.com/v1/chat/completions", async (route: Route) => {
    const data = route.request().postDataJSON() as { messages: Array<{ content: string }> };
    const prompt = data.messages[1]!.content;
    prompts.push(prompt);
    const content = prompt.includes("L'autore ha GIÀ modificato a mano la voce di memoria «Stato corrente»")
      ? JSON.stringify({ interpretation: "Elena ora sa del Consiglio.", rationale: "Nessuna scena scritta contraddice il nuovo stato.", rewriteSceneIds: [], changedFacts: [] })
      : "RISPOSTA_INATTESA";
    await route.fulfill({ json: { choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 30 } } });
  });
  await seed(page);
  await nav(page).getByRole("button", { name: "Mondo", exact: true }).click();
  await page.getByRole("button", { name: "Stato corrente", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Stato corrente" });
  await area.fill("Elena sa che Markus lavora per il Consiglio cittadino.");
  await page.getByRole("button", { name: "Salva senza review" }).click();
  await expect.poll(async () => (await stored(page)).memory.currentState).toBe("Elena sa che Markus lavora per il Consiglio cittadino.");
  // Saving starts nothing: the author chooses what happens next.
  expect(prompts).toHaveLength(0);
  const after = page.getByRole("region", { name: "Dopo la modifica di Stato corrente" });
  await expect(after.getByText("Modifica salvata: non ancora rivista")).toBeVisible();
  await expect(after.getByRole("button", { name: "Scegli una review" })).toHaveCount(0);
  page.once("dialog", dialog => dialog.accept());
  await after.getByRole("button", { name: "Rivedi e aggiorna il libro da questa modifica" }).click();
  await expect.poll(async () => (await stored(page)).status, { timeout: 60_000 }).toBe("completed");
  const book = await stored(page);
  expect(book.changeOperations[0].fromEdits).toHaveLength(1);
  expect(book.changeOperations[0].instruction).toContain("PRIMA:");
  expect(book.changeOperations[0].state).toBe("completed");
  expect(book.edits.at(-1).reviewState).toBe("review_passed");
  expect(prompts.filter(p => p.includes("L'autore ha GIÀ modificato a mano"))).toHaveLength(1);
  await expect(page.getByText("Modifica salvata: non ancora rivista")).toHaveCount(0);
});

test("worldbuilding: una voce nuova della memoria, con modifica e ricerca", async ({ page }) => {
  await seed(page);
  await nav(page).getByRole("button", { name: "Mondo", exact: true }).click();
  await page.getByRole("button", { name: /^Memoria · Luoghi/ }).click();
  await page.getByText("Aggiungi una voce a mano").click();
  const form = page.getByRole("form", { name: /Nuova voce/ });
  await form.getByLabel("Nome").fill("Porto di Trieste");
  await form.getByLabel("Cosa si sa").fill("Un molo battuto dal vento, dove Markus aspetta.");
  await form.getByRole("button", { name: "Aggiungi la voce" }).click();
  await expect.poll(async () => (await stored(page)).memory.locations["Porto di Trieste"]).toContain("molo");
  await page.getByRole("searchbox", { name: "Cerca nel mondo" }).fill("molo battuto");
  await expect(page.getByRole("button", { name: /^Memoria · Luoghi/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Porto di Trieste/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Personaggi/ })).toHaveCount(0);
});

test("menu laterale (desktop): si riduce alle icone, il nome compare sul passaggio del mouse e la scelta resta dopo F5", async ({ page }) => {
  test.skip(mobile(), "Su telefono la barra non cambia.");
  await seed(page);
  const toggle = page.getByRole("button", { name: "Comprimi il menu laterale" });
  await expect(page.locator(".site-nav")).toHaveAttribute("data-nav", "expanded");
  const wide = (await page.locator(".sidebar").boundingBox())!.width;
  // Expanded: labels are visible and there is no tooltip.
  await expect(nav(page).getByText("Mondo", { exact: true })).toBeVisible();
  expect(await nav(page).getByRole("button", { name: "Mondo", exact: true }).getAttribute("data-tip")).toBeNull();
  await toggle.click();
  await expect(page.locator(".site-nav")).toHaveAttribute("data-nav", "collapsed");
  const narrow = (await page.locator(".sidebar").boundingBox())!.width;
  expect(narrow).toBeLessThan(wide / 2);
  const world = nav(page).getByRole("button", { name: "Mondo", exact: true });
  await expect(world).toBeVisible();
  await expect(world).toHaveAttribute("data-tip", "Mondo");
  await world.hover();
  await expect.poll(() => world.evaluate(element => Number(getComputedStyle(element, "::after").opacity))).toBe(1);
  expect(await world.evaluate(element => getComputedStyle(element, "::after").content)).toContain("Mondo");
  // It still navigates, and the choice survives a reload.
  await world.click();
  await expect(page).toHaveURL(/\/worldbuilding/);
  await page.reload();
  await expect(page.locator(".site-nav")).toHaveAttribute("data-nav", "collapsed");
  await page.getByRole("button", { name: "Espandi il menu laterale" }).click();
  await expect(page.locator(".site-nav")).toHaveAttribute("data-nav", "expanded");
  await expect(nav(page).getByText("Mondo", { exact: true })).toBeVisible();
});
