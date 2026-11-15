import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../src/domain/types";

const nav = (page: Page) => page.getByRole("navigation", {
  name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
});
type Handler = (system: string, prompt: string) => string | undefined;
function provider(page: Page, handler: Handler, seen: string[] = []) {
  return page.route("https://api.openai.com/v1/chat/completions", async (route: Route) => {
    const data = route.request().postDataJSON() as { messages: Array<{ content: string }> };
    const system = data.messages[0]!.content, prompt = data.messages[1]!.content;
    seen.push(system.slice(0, 80) + " | " + prompt.slice(0, 120));
    const content = handler(system, prompt) ?? "RISPOSTA_INATTESA";
    await route.fulfill({ json: { choices: [{ message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 40 } } });
  });
}
async function seed(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Le sparizioni");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  await page.evaluate(async ({ defaults }) => {
    const { knowledgeBook } = await import("/src/domain/__fixtures__/knowledge.ts");
    const { getDb, saveBook, saveSettings } = await import("/src/infrastructure/db.ts");
    const { encryptLocal } = await import("/src/infrastructure/crypto.ts");
    const current = (await (await getDb()).getAll("books"))[0];
    const book = knowledgeBook();
    book.id = current.id; book.title = "Le sparizioni";
    await saveBook(book, false);
    defaults.endpoints[0].secret = await encryptLocal("sk-synthetic-edit");
    defaults.defaultRoute.modelId = "synthetic-writer";
    await saveSettings(defaults);
  }, { defaults: structuredClone(DEFAULT_SETTINGS) });
  await page.reload();
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    return (await (await getDb()).getAll("books"))[0];
  });
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
/** Worldbuilding sections are accordions, closed by default: open one by its title. */
async function openSection(page: Page, name: RegExp) {
  const header = page.getByRole("button", { name, expanded: false });
  if (await header.count()) await header.first().click();
  await expect(page.getByRole("button", { name, expanded: true }).first()).toBeVisible();
}
const pass = JSON.stringify({ verdict: "pass", summary: "Coerente con schede e scene vicine.", findings: [] });

test("modifica manuale di una scena: salvata senza review, capitolo segnalato, confronto e ripristino", async ({ page }) => {
  let calls = 0;
  await page.route("**/chat/completions", async route => { calls++; await route.abort(); });
  await seed(page);
  await nav(page).getByRole("button", { name: "Libro", exact: true }).click();
  await page.getByRole("button", { name: "Cap. 1", exact: true }).click();
  await page.getByRole("button", { name: "Modifica la scena 2. Il registro" }).click();
  const editor = page.getByRole("form", { name: "Modifica di Cap. 1 · 2. Il registro" });
  const text = editor.getByLabel("Testo della scena");
  await text.fill("Nell'archivio municipale Elena sfoglia il registro con le mani che tremano e trova una firma cancellata.");
  await expect(editor.getByText("Non salvata")).toBeVisible();
  await editor.getByRole("button", { name: "Salva senza review" }).click();
  await expect(editor.getByText(/Nessuna review è partita/)).toBeVisible();
  let book = await stored(page);
  expect(book.edits).toHaveLength(1);
  expect(book.edits[0]).toMatchObject({ origin: "manual", reviewState: "modified_unreviewed" });
  expect(book.chapters[0].frozenAt).toBeTruthy();
  expect(book.chapters[0].reviewStale.editIds).toEqual([book.edits[0].id]);
  await editor.getByRole("button", { name: "Chiudi" }).click();
  await expect(page.getByRole("note").getByText(/Hai modificato questo capitolo dopo la revisione/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cap. 1", exact: true })).toContainText("Modificato dopo la revisione");
  await expect(page.getByRole("button", { name: "Revisioni: 1 da rivedere" })).toBeVisible();
  await page.getByRole("tab", { name: /Scene/ }).click();
  const scene = page.getByRole("list", { name: "Scene del capitolo 1" }).getByRole("listitem").filter({ hasText: "Il registro" }).first();
  await expect(scene.getByText("Da rivedere")).toBeVisible();
  await scene.getByRole("button", { name: "Leggi e modifica" }).click();
  await scene.getByText("Cronologia delle modifiche (1)").click();
  await scene.getByRole("button", { name: "Confronta" }).click();
  await expect(scene.getByRole("figure", { name: "Confronto prima e dopo" }).locator("ins")).toContainText("con le mani che tremano");
  page.once("dialog", dialog => dialog.accept());
  await scene.getByRole("button", { name: "Ripristina com'era prima" }).click();
  await expect(scene.getByText(/Versione precedente ripristinata/)).toBeVisible();
  book = await stored(page);
  expect(book.chapters[0].scenes[1].text).toBe("Nell'archivio municipale Elena sfoglia il registro e trova una firma cancellata.");
  expect(book.edits).toHaveLength(2);
  expect(calls).toBe(0);
  expect(await noOverflow(page)).toBe(true);
});

test("review mirata di solo controllo: la esegue l'autopilot, poi il libro torna in pausa", async ({ page }) => {
  test.setTimeout(90_000);
  const seen: string[] = [];
  await provider(page, system => system.includes("verificatore editoriale") ? pass : undefined, seen);
  await seed(page);
  await page.evaluate(async () => {
    const { getDb, saveBook } = await import("/src/infrastructure/db.ts");
    const { editScene } = await import("/src/domain/book-editing.ts");
    const book = (await (await getDb()).getAll("books"))[0];
    editScene(book, "scene:002:001", { text: "Markus aspetta sul molo al tramonto. Dice di conoscere il Consiglio cittadino." }, { now: new Date().toISOString(), origin: "manual" });
    await saveBook(book, false);
  });
  await page.reload();
  await page.getByRole("button", { name: "Revisioni: 1 da rivedere" }).click();
  await expect(page).toHaveURL(/\/revisioni/);
  const list = page.getByRole("list", { name: "Elenco delle modifiche da rivedere" });
  await list.getByRole("checkbox", { name: "Seleziona scena «Cap. 2 · 1. Il molo»" }).check();
  await list.getByText("Cosa è cambiato").click();
  await expect(list.locator("ins", { hasText: "al tramonto" })).toBeVisible();
  const actions = page.getByRole("region", { name: "Scegli la review" });
  await actions.getByRole("radio", { name: /Review mirata/ }).click();
  await actions.getByRole("radio", { name: /Solo controllo/ }).click();
  await expect(actions.getByText(/Stima: 1 chiamata AI/)).toBeVisible();
  await actions.getByRole("button", { name: "Avvia la review" }).click();
  await expect.poll(async () => (await stored(page)).manualReviews?.[0]?.status, { timeout: 60_000 }).toBe("completed");
  const book = await stored(page);
  expect(book.status).toBe("paused");
  expect(book.manualReviews[0].outcome).toBe("passed");
  expect(book.chapters[1].reviewStale).toBeUndefined();
  expect(book.chapters[1].scenes[0].text).toContain("al tramonto");
  expect(seen.filter(s => s.includes("verificatore editoriale"))).toHaveLength(1);
  const reports = page.getByRole("region", { name: "Rapporti delle review" });
  await expect(reports.getByText("Superata")).toBeVisible();
  await expect(page.getByRole("region", { name: "Modifiche da rivedere" }).getByText("Nessuna modifica da rivedere")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});

test("review di una parte delle modifiche: le escluse restano da rivedere; la redazione completa si sceglie a parte", async ({ page }) => {
  test.setTimeout(90_000);
  const seen: string[] = [];
  await provider(page, system => system.includes("verificatore editoriale") ? pass : undefined, seen);
  await seed(page);
  await page.evaluate(async () => {
    const { getDb, saveBook } = await import("/src/infrastructure/db.ts");
    const { editScene } = await import("/src/domain/book-editing.ts");
    const book = (await (await getDb()).getAll("books"))[0];
    editScene(book, "scene:002:001", { text: "Markus aspetta sul molo al tramonto. Dice di conoscere il Consiglio cittadino." }, { now: "2026-11-14T10:00:00.000Z", origin: "manual" });
    editScene(book, "scene:002:001", { text: "Markus aspetta sul molo al tramonto, nervoso. Dice di conoscere il Consiglio cittadino." }, { now: "2026-11-14T11:00:00.000Z", origin: "manual" });
    await saveBook(book, false);
  });
  await page.reload();
  await page.getByRole("button", { name: "Revisioni: 1 da rivedere" }).click();
  const list = page.getByRole("list", { name: "Elenco delle modifiche da rivedere" });
  await list.getByRole("checkbox", { name: "Seleziona scena «Cap. 2 · 1. Il molo»" }).check();
  await list.getByRole("group", { name: /Quali modifiche rivedere \(2 di 2\)/ }).getByRole("checkbox").nth(1).uncheck();
  await expect(list.getByRole("group", { name: /Quali modifiche rivedere \(1 di 2\)/ })).toBeVisible();
  const actions = page.getByRole("region", { name: "Scegli la review" });
  await expect(actions.getByText(/Alcune modifiche degli elementi scelti sono escluse/)).toBeVisible();
  await actions.getByRole("radio", { name: /Review mirata/ }).click();
  await actions.getByRole("radio", { name: /Solo controllo/ }).click();
  await actions.getByRole("button", { name: "Avvia la review" }).click();
  await expect.poll(async () => (await stored(page)).manualReviews?.[0]?.status, { timeout: 60_000 }).toBe("completed");
  const book = await stored(page);
  expect(book.edits.map((e: { reviewState: string }) => e.reviewState)).toEqual(["review_passed", "modified_unreviewed"]);
  expect(seen.filter(s => s.includes("verificatore editoriale"))).toHaveLength(1);
  // The change left out is still waiting for the author.
  await expect(list.getByRole("checkbox", { name: "Seleziona scena «Cap. 2 · 1. Il molo»" })).toBeVisible();
  // The whole board is an explicit choice of the full review, with its own estimate and no «Come».
  await actions.getByRole("radio", { name: /Review completa/ }).click();
  await actions.getByRole("radio", { name: /Redazione completa/ }).click();
  await expect(actions.getByText(/Stima: almeno \d+ chiamate AI per 2 capitoli/)).toBeVisible();
  await expect(actions.getByRole("radiogroup", { name: "Modalità della review" })).toHaveCount(0);
  expect((await stored(page)).manualReviews).toHaveLength(1);
  expect(await noOverflow(page)).toBe(true);
});

test("modifica solo questo con l'AI su una scheda, poi review con proposta di correzione approvata dall'autore", async ({ page }) => {
  test.setTimeout(120_000);
  await provider(page, (system, prompt) => {
    if (system.includes("Sei il romanziere e l'editor di questo libro") && prompt.includes("Modifica SOLO questa scheda"))
      return JSON.stringify({ name: "Markus", importance: "secondary", summary: "Informatore che teme il Consiglio e ne nasconde i segreti.", attributes: {} });
    if (system.includes("verificatore editoriale")) return prompt.includes("SCHEDA ATTUALE") ? JSON.stringify({ verdict: "issues", summary: "Il molo mostra un Markus sicuro.", findings: [
      { sceneId: "scene:002:001", severity: "major", category: "character", evidence: "Markus aspetta sul molo", issue: "Markus ora teme il Consiglio ma ne parla con sicurezza.", suggestion: "Rendilo esitante." }] }) : pass;
    if (system.includes("corregge una scena dopo una review")) return "Markus aspetta sul molo, nervoso. Esita prima di nominare il Consiglio cittadino.";
    return undefined;
  });
  await seed(page);
  await nav(page).getByRole("button", { name: "Mondo", exact: true }).click();
  await openSection(page, /^Personaggi/);
  await page.getByRole("list", { name: "Personaggi" }).getByRole("button", { name: /Markus/ }).click();
  const sheet = page.getByRole("article", { name: "Scheda di Markus" });
  await expect(sheet.getByRole("radio", { name: "Modifica solo questo" })).toHaveAttribute("aria-checked", "true");
  await sheet.getByLabel("Richiesta di modifica per «Markus»").fill("Fai in modo che tema il Consiglio e ne nasconda i segreti.");
  await sheet.getByRole("button", { name: "Proponi la modifica" }).click();
  const proposal = sheet.getByRole("list", { name: "Modifiche proposte dall'AI" });
  await expect(proposal.locator("ins")).toContainText("teme il Consiglio");
  expect((await stored(page)).knowledge.entities.find((e: { id: string }) => e.id === "character:markus").summary).toBe("Informatore.");
  await proposal.getByRole("button", { name: "Applica questa modifica" }).click();
  await expect(sheet.getByText(/Applicata come modifica AI/)).toBeVisible();
  let book = await stored(page);
  expect(book.edits[0]).toMatchObject({ origin: "ai", target: { kind: "entity", id: "character:markus" }, reviewState: "modified_unreviewed" });
  expect(book.manualReviews).toBeUndefined();
  await page.getByRole("button", { name: "Revisioni: 1 da rivedere" }).click();
  await page.getByRole("checkbox", { name: "Seleziona personaggio «Markus»" }).check();
  const actions = page.getByRole("region", { name: "Scegli la review" });
  await actions.getByRole("radio", { name: /Review mirata/ }).click();
  await actions.getByRole("radio", { name: /Proposte da approvare/ }).click();
  await actions.getByRole("button", { name: "Avvia la review" }).click();
  await expect.poll(async () => (await stored(page)).manualReviews?.[0]?.status, { timeout: 60_000 }).toBe("completed");
  book = await stored(page);
  expect(book.manualReviews[0].outcome).toBe("failed");
  expect(book.chapters[1].scenes[0].text).toBe("Markus aspetta sul molo. Dice di conoscere il Consiglio cittadino.");
  const reports = page.getByRole("region", { name: "Rapporti delle review" });
  await expect(reports.getByText("Rendilo esitante.")).toBeVisible();
  await expect(reports.locator("ins").first()).toBeVisible();
  await reports.getByRole("button", { name: "Applica la correzione" }).click();
  await expect(reports.getByText(/Correzione applicata come modifica AI/)).toBeVisible();
  book = await stored(page);
  expect(book.chapters[1].scenes[0].text).toContain("Esita prima di nominare");
  expect(book.edits.at(-1)).toMatchObject({ origin: "ai", target: { kind: "scene", id: "scene:002:001" }, reviewState: "modified_unreviewed" });
  expect(await noOverflow(page)).toBe(true);
});

test("riscrivi la selezione con l'AI: confronto, solo il passaggio scelto cambia, poi review con la scena già scelta", async ({ page }) => {
  test.setTimeout(90_000);
  const prompts: string[] = [];
  await provider(page, (system, prompt) => {
    if (!system.includes("Sei il romanziere e l'editor di questo libro") || !prompt.includes("[[INIZIO SELEZIONE]]")) return undefined;
    prompts.push(prompt);
    return "Esita, poi sussurra il nome del Consiglio cittadino.";
  });
  await seed(page);
  await nav(page).getByRole("button", { name: "Libro", exact: true }).click();
  await page.getByRole("button", { name: "Cap. 2", exact: true }).click();
  await page.getByRole("button", { name: "Modifica la scena 1. Il molo" }).click();
  const editor = page.getByRole("form", { name: "Modifica di Cap. 2 · 1. Il molo" });
  const text = editor.getByLabel("Testo della scena");
  // Select the second sentence; the last character comes from a real keystroke, as an author would do.
  await text.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(el.value.indexOf("Dice"), el.value.length - 1); });
  await text.press("Shift+ArrowRight");
  await expect(editor.getByText(/selezionati 41 caratteri/)).toBeVisible();
  await editor.getByRole("button", { name: "Riscrivi la selezione con l'AI" }).click();
  await expect(editor.getByText("Passaggio selezionato:")).toBeVisible();
  await editor.getByLabel("Richiesta di modifica per «la selezione»").fill("Rendi Markus esitante quando nomina il Consiglio.");
  await editor.getByRole("button", { name: "Proponi la modifica" }).click();
  const proposal = editor.getByRole("list", { name: "Modifiche proposte dall'AI" });
  await expect(proposal.locator("ins", { hasText: "sussurra" })).toBeVisible();
  await expect(proposal.locator("del", { hasText: "Dice" })).toBeVisible();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("Markus aspetta sul molo. [[INIZIO SELEZIONE]]Dice di conoscere il Consiglio cittadino.[[FINE SELEZIONE]]");
  // Nothing changes until the author applies the proposal.
  expect((await stored(page)).chapters[1].scenes[0].text).toBe("Markus aspetta sul molo. Dice di conoscere il Consiglio cittadino.");
  await proposal.getByRole("button", { name: "Applica questa modifica" }).click();
  await expect(editor.getByText(/Passaggio riscritto con l'AI/)).toBeVisible();
  const book = await stored(page);
  expect(book.chapters[1].scenes[0].text).toBe("Markus aspetta sul molo. Esita, poi sussurra il nome del Consiglio cittadino.");
  expect(book.edits.at(-1)).toMatchObject({ origin: "ai", target: { kind: "scene", id: "scene:002:001" }, reviewState: "modified_unreviewed" });
  expect(book.manualReviews).toBeUndefined();
  expect(await noOverflow(page)).toBe(true);
  // From the editor straight to the reviews, with this scene already chosen: no review starts by itself.
  await editor.getByRole("button", { name: "Scegli una review" }).click();
  await expect(page).toHaveURL(/\/revisioni/);
  await expect(page.getByRole("checkbox", { name: "Seleziona scena «Cap. 2 · 1. Il molo»" })).toBeChecked();
  await expect(page.getByText("Selezionati 1 elemento: scegli il tipo di review qui sotto.")).toBeVisible();
  expect((await stored(page)).manualReviews).toBeUndefined();
  expect(await noOverflow(page)).toBe(true);
});

test("struttura e mondo a mano: nuova scena, nuova scheda ed evento con coinvolti e cause", async ({ page }) => {
  let calls = 0;
  await page.route("**/chat/completions", async route => { calls++; await route.abort(); });
  await seed(page);
  await nav(page).getByRole("button", { name: "Libro", exact: true }).click();
  await page.getByRole("button", { name: "Cap. 2", exact: true }).click();
  await page.getByRole("tab", { name: /Modifica/ }).click();
  const newScene = page.getByRole("form", { name: "Nuova scena" });
  await newScene.getByPlaceholder("Titolo").fill("Il tram");
  await newScene.getByPlaceholder("Cosa deve accadere").fill("Elena segue Markus");
  await newScene.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByRole("region", { name: "Struttura del capitolo 2" }).getByText("Il tram", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sposta su la scena 3" }).click();
  await expect.poll(async () => (await stored(page)).chapters[1].scenes.map((s: { title: string }) => s.title)).toEqual(["Il molo", "Il tram", "La prova"]);
  const book = await stored(page);
  expect(book.chapters[1].scenes[1]).toMatchObject({ status: "planned", number: 2 });
  expect(book.chapters[1].reviewStale.editIds).toHaveLength(2);
  await nav(page).getByRole("button", { name: "Mondo", exact: true }).click();
  await openSection(page, /^Oggetti/);
  await page.getByRole("button", { name: "Nuova scheda" }).click();
  const form = page.getByRole("form", { name: "Nuova scheda: oggetto" });
  await form.getByLabel("Nome").fill("La lettera");
  await form.getByLabel("Descrizione breve").fill("Una lettera mai spedita.");
  await form.getByRole("button", { name: "Crea la scheda" }).click();
  await expect(page.getByRole("article", { name: "Scheda di La lettera" })).toBeVisible();
  await openSection(page, /^Timeline ed eventi/);
  const event = page.getByRole("listitem").filter({ hasText: "Primo indizio" }).first();
  await event.getByRole("button", { name: "Modifica l'evento Primo indizio" }).click();
  const editor = page.getByRole("form", { name: "Modifica l'evento Primo indizio" });
  await editor.getByLabel("Aggiungi a Chi è coinvolto").selectOption({ label: "La lettera" });
  await editor.getByLabel("Quando accade (nella storia)").fill("autunno 1923");
  await editor.getByRole("button", { name: "Salva senza review" }).click();
  await expect(editor.getByText(/Evento salvato/)).toBeVisible();
  const saved = await stored(page);
  const indizio = saved.knowledge.events.find((e: { id: string }) => e.id === "event:primo-indizio");
  expect(indizio.involves).toContain("item:la-lettera");
  expect(indizio.when).toBe("autunno 1923");
  expect(saved.edits.map((e: { target: { kind: string } }) => e.target.kind)).toEqual(["structure", "structure", "entity", "event"]);
  expect(calls).toBe(0);
  expect(await noOverflow(page)).toBe(true);
});
