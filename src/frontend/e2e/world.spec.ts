import { expect, test, type Page, type Route } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../src/domain/types";

const nav = (page: Page) => page.getByRole("navigation", {
  name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
});
const pass = JSON.stringify({ verdict: "pass", summary: "Nessun problema concreto nel segmento letto.", findings: [], memoryNote: "" });
type Handler = (system: string, prompt: string) => string | undefined;
/** The editorial board always approves: the tests focus on what the change does. */
function provider(page: Page, handler: Handler, seen: string[] = []) {
  return page.route("https://api.openai.com/v1/chat/completions", async (route: Route) => {
    const data = route.request().postDataJSON() as { messages: Array<{ content: string }> };
    const system = data.messages[0]!.content, prompt = data.messages[1]!.content;
    seen.push(prompt.slice(0, 120));
    let content = handler(system, prompt);
    if (content === undefined) {
      if (system.includes("direttore editoriale")) content = JSON.stringify({ reasoning: "Rapporti esaminati criticamente, nessun difetto.", decisions: [] });
      else if (prompt.includes('"sceneSummaries"') && !prompt.includes("rifletta la NUOVA versione")) content = JSON.stringify({ sceneSummaries: Object.fromEntries(
        [...prompt.matchAll(/SCENA (\S+) «/g)].map(match => [match[1], "Elena segue un indizio e lo collega al Consiglio cittadino."])) });
      else if (prompt.includes('"chapterSummary"')) content = JSON.stringify({ chapterSummary: "Elena segue la pista della firma e del Consiglio.",
        bookSummary: "Elena cerca il fratello scomparso e scopre il ruolo del Consiglio." });
      else if (system.includes("revisore letterario INDIPENDENTE")) content = pass;
      else content = "RISPOSTA_INATTESA";
    }
    await route.fulfill({ json: { choices: [{ message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 40 } } });
  });
}
/** A synthetic mystery with sheets, events and two frozen chapters. */
async function seed(page: Page, mutate = "") {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Le sparizioni");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  const id = await page.evaluate(async ({ defaults, mutate }) => {
    const { knowledgeBook } = await import("/src/domain/__fixtures__/knowledge.ts");
    const { getDb, saveBook, saveSettings } = await import("/src/infrastructure/db.ts");
    const { encryptLocal } = await import("/src/infrastructure/crypto.ts");
    const current = (await (await getDb()).getAll("books"))[0];
    const book = knowledgeBook();
    book.id = current.id; book.title = "Le sparizioni";
    if (mutate === "legacy") delete book.knowledge;
    await saveBook(book, false);
    defaults.endpoints[0].secret = await encryptLocal("sk-synthetic-world");
    defaults.defaultRoute.modelId = "synthetic-writer";
    await saveSettings(defaults);
    return book.id;
  }, { defaults: structuredClone(DEFAULT_SETTINGS), mutate });
  await page.reload();
  return id;
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

test("Mondo: sezioni, schede con relazioni e presenze, timeline nei due ordini e memoria, senza AI", async ({ page }) => {
  let calls = 0;
  await page.route("**/chat/completions", async route => { calls++; await route.abort(); });
  await seed(page);
  await nav(page).getByRole("button", { name: "Mondo", exact: true }).click();
  await expect(page).toHaveURL(/\/worldbuilding/);
  await expect(page.getByRole("button", { name: "Personaggi (2)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Timeline ed eventi (4)", exact: true })).toBeVisible();
  await openSection(page, /^Personaggi/);
  await page.getByRole("list", { name: "Personaggi" }).getByRole("button", { name: /Elena/ }).click();
  const sheet = page.getByRole("article", { name: "Scheda di Elena" });
  await expect(sheet.getByText("Frasi brevi, domande dirette")).toBeVisible();
  await expect(sheet.getByText("Detto anche: Elena Voss")).toBeVisible();
  await expect(sheet.getByText("Cap. 1 · 2. Il registro")).toBeVisible();
  await expect(sheet.getByText("Investigatrice, cerca il fratello.")).toBeVisible();
  await sheet.getByRole("button", { name: /alleato · Markus/ }).click();
  await expect(page.getByRole("article", { name: "Scheda di Markus" })).toBeVisible();
  // On phones the list is replaced by the sheet: the author goes back explicitly.
  if (test.info().project.name === "mobile-chromium") await page.getByRole("button", { name: "Torna all'elenco" }).click();
  await page.getByRole("searchbox", { name: "Cerca nel mondo" }).fill("voss");
  await expect(page.getByRole("list", { name: "Personaggi" }).getByRole("button")).toHaveCount(1);
  await page.getByRole("button", { name: "Cancella la ricerca" }).click();
  await openSection(page, /^Timeline ed eventi/);
  const story = page.getByRole("list", { name: "Timeline nell'ordine della storia" });
  await expect(story.getByRole("listitem").first()).toContainText("Scomparsa del fratello");
  await expect(story.getByText("Markus: sa e nasconde · Elena: non sa")).toBeVisible();
  await page.getByRole("radio", { name: "Ordine del racconto" }).click();
  await expect(page.getByRole("list", { name: "Timeline nell'ordine del racconto" })).toBeVisible();
  await page.getByLabel("Timeline", { exact: true }).selectOption({ label: "Indagine sulle sparizioni" });
  await expect(page.getByRole("list", { name: "Timeline nell'ordine del racconto" }).getByRole("listitem")).toHaveCount(2);
  await openSection(page, /^Memoria · Segreti/);
  await expect(page.getByRole("button", { name: /^Memoria · Segreti \(solo autore\)/ })).toBeVisible();
  expect(calls).toBe(0);
  expect(await noOverflow(page)).toBe(true);
});

test("modifica automatica di una scheda: analisi, riscrittura mirata, nuova redazione, storico e ripristino", async ({ page }) => {
  test.setTimeout(90_000);
  const seen: string[] = [];
  await provider(page, (_system, prompt) => {
    if (prompt.includes("L'autore chiede di modificare la scheda «Elena»")) return JSON.stringify({
      interpretation: "Elena reagisce d'istinto, l'obiettivo resta trovare il fratello.", rationale: "Solo la scena dell'archivio mostra il carattere.",
      rewriteSceneIds: ["scene:001:002"], changedFacts: ["Elena è impulsiva"],
      unchangedDirect: [{ sceneId: "scene:001:001", reason: "Ricordo d'infanzia: il carattere adulto non conta." },
        { sceneId: "scene:002:002", reason: "Elena tace e riflette: nessuna reazione da cambiare." }],
      entity: { name: "Elena", aliases: ["Elena Voss"], importance: "main", summary: "Investigatrice impulsiva ed emotiva.", attributes: { role: "Protagonista", personality: "Impulsiva ed emotiva", speech: "Esclamazioni, frasi spezzate" } } });
    if (prompt.includes("Riscrivi SOLO la scena scene:001:002")) return "Nell'archivio municipale Elena strappa il registro dallo scaffale e trova una firma cancellata.";
    if (prompt.includes("rifletta la NUOVA versione")) return JSON.stringify({ mode: "delta", characters: { Elena: "Investigatrice impulsiva, cerca il fratello." },
      sceneSummaries: { "scene:001:002": "Elena strappa il registro e trova una firma cancellata." }, knowledge: {} });
    return undefined;
  }, seen);
  await seed(page);
  await nav(page).getByRole("button", { name: "Mondo", exact: true }).click();
  await openSection(page, /^Personaggi/);
  await page.getByRole("list", { name: "Personaggi" }).getByRole("button", { name: /Elena/ }).click();
  await page.getByRole("radio", { name: "Modifica e aggiorna il libro" }).click();
  const box = page.getByLabel("Descrivi la modifica a «Elena»");
  await box.fill("Elena non deve più essere fredda e razionale: impulsiva ed emotiva, ma con lo stesso obiettivo.");
  await page.getByRole("button", { name: "Applica la modifica" }).click();
  await expect.poll(async () => (await stored(page)).status, { timeout: 60_000 }).toBe("completed");
  const book = await stored(page);
  const op = book.changeOperations[0];
  expect(op.state).toBe("completed");
  expect(op.plan.rewriteSceneIds).toEqual(["scene:001:002"]);
  expect(book.chapters[0].scenes[1].text).toContain("strappa il registro");
  expect(book.chapters[0].scenes[0].text).toContain("Elena ricorda la notte");
  expect(book.knowledge.entities.find((e: { id: string }) => e.id === "character:elena").version).toBe(2);
  expect(book.chapters.every((c: { frozenAt?: string }) => !!c.frozenAt)).toBe(true);
  expect(seen.filter(p => p.includes("Riscrivi SOLO la scena"))).toHaveLength(1);
  await openSection(page, /^Modifiche/);
  const history = page.getByRole("list", { name: "Storico delle modifiche" });
  await expect(history.getByText("Completata")).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await history.getByRole("button", { name: "Ripristina versione precedente" }).click();
  await expect(page.getByText(/Versione precedente ripristinata/)).toBeVisible();
  const reverted = await stored(page);
  expect(reverted.changeOperations[0].state).toBe("reverted");
  expect(reverted.chapters[0].scenes[1].text).toContain("sfoglia il registro");
  expect(reverted.knowledge.entities.find((e: { id: string }) => e.id === "character:elena").summary).toBe("Investigatrice protagonista.");
  expect(await noOverflow(page)).toBe(true);
});

test("con conferma: il piano mostra scene dirette e indirette e attende la decisione dell'autore", async ({ page }) => {
  test.setTimeout(90_000);
  await provider(page, (_system, prompt) => {
    if (prompt.includes("modificare l'evento «Primo indizio»")) return JSON.stringify({ interpretation: "L'indizio diventa una fotografia.",
      rationale: "Archivio e rivelazione citano la firma.", rewriteSceneIds: ["scene:001:002", "scene:002:002"], changedFacts: ["Fotografia al posto della firma"],
      event: { title: "Primo indizio", summary: "Una fotografia nascosta nel registro." } });
    if (prompt.includes("Riscrivi SOLO la scena scene:001:002")) return "Nell'archivio municipale Elena trova una fotografia nascosta nel registro.";
    if (prompt.includes("Riscrivi SOLO la scena scene:002:002")) return "Elena capisce che la fotografia ritrae il Consiglio cittadino. Non dice nulla a Markus.";
    if (prompt.includes("rifletta la NUOVA versione")) return JSON.stringify({ mode: "delta", knowledge: {} });
    return undefined;
  });
  await seed(page);
  await nav(page).getByRole("button", { name: "Mondo", exact: true }).click();
  await page.getByRole("radio", { name: "Dopo la mia conferma" }).click();
  await expect.poll(async () => (await stored(page)).changeMode).toBe("confirm");
  await openSection(page, /^Timeline ed eventi/);
  const event = page.getByRole("listitem").filter({ hasText: "Primo indizio" }).first();
  await event.getByText("Modifica questo evento con un prompt").click();
  await event.getByRole("radio", { name: "Modifica e aggiorna il libro" }).click();
  await event.getByLabel("Descrivi la modifica a «Primo indizio»").fill("L'indizio non è una firma ma una fotografia nascosta.");
  await event.getByRole("button", { name: "Analizza la modifica" }).click();
  const banner = page.getByRole("region", { name: "Modifica in corso" });
  await expect(banner.getByText("Da confermare")).toBeVisible({ timeout: 30_000 });
  await expect(banner.getByText("Cap. 1 · 2. Il registro").first()).toBeVisible();
  await expect(banner.getByText("Cap. 2 · 2. La prova").first()).toBeVisible();
  expect((await stored(page)).chapters.every((c: { frozenAt?: string }) => !!c.frozenAt)).toBe(true);
  await banner.getByRole("button", { name: "Conferma il piano" }).click();
  await expect.poll(async () => (await stored(page)).status, { timeout: 60_000 }).toBe("completed");
  const book = await stored(page);
  expect(book.changeOperations[0].state).toBe("completed");
  expect(book.chapters[1].scenes[1].text).toContain("fotografia");
  expect(book.knowledge.events.find((e: { id: string }) => e.id === "event:primo-indizio").summary).toBe("Una fotografia nascosta nel registro.");
});

test("Libro: capitolo in testo, scene e riassunto; una modifica di stile rivede solo quel capitolo", async ({ page }) => {
  test.setTimeout(90_000);
  const seen: string[] = [];
  await provider(page, (_system, prompt) => {
    if (prompt.includes("Riscrivi la scena scene:001:002 secondo questa richiesta"))
      return "Nell'archivio municipale, nel silenzio, Elena sfoglia il registro. Una firma cancellata. Il respiro le si ferma.";
    if (prompt.includes("Confronta la versione PRECEDENTE")) return JSON.stringify({ changeKind: "style", changedFacts: [], dependentSceneIds: [],
      summary: "Elena, tesa, trova una firma cancellata nel registro.", rationale: "Cambiano solo ritmo e tensione." });
    return undefined;
  }, seen);
  const id = await seed(page);
  const before = await stored(page);
  await nav(page).getByRole("button", { name: "Libro", exact: true }).click();
  await page.getByRole("button", { name: "Cap. 1", exact: true }).click();
  await expect(page.getByText("Nell'archivio municipale Elena sfoglia il registro e trova una firma cancellata.")).toBeVisible();
  await page.getByRole("tab", { name: /Riassunto/ }).click();
  await expect(page.getByText("Consolidato alla revisione")).toBeVisible();
  await expect(page.getByText("Elena entra nell'archivio.")).toBeVisible();
  await page.getByRole("tab", { name: /Scene/ }).click();
  const scene = page.getByRole("list", { name: "Scene del capitolo 1" }).getByRole("listitem").filter({ hasText: "Il registro" });
  await expect(scene.getByText("Luogo: Archivio municipale")).toBeVisible();
  await scene.getByRole("button", { name: "Leggi e modifica" }).click();
  await scene.getByRole("radio", { name: "Modifica e aggiorna il libro" }).click();
  await scene.getByLabel("Descrivi la modifica a «Il registro»").fill("Rendi il passaggio più teso, senza cambiare cosa accade.");
  await scene.getByRole("button", { name: "Applica la modifica" }).click();
  await expect.poll(async () => (await stored(page)).status, { timeout: 60_000 }).toBe("completed");
  const book = await stored(page);
  expect(book.id).toBe(id);
  expect(book.changeOperations[0].plan.changeKind).toBe("style");
  expect(book.chapters[0].scenes[1].summary).toBe("Elena, tesa, trova una firma cancellata nel registro.");
  // Chapter 2 was never reopened: its frozen synopsis is untouched and no reviewer read it.
  expect(book.chapters[1].frozenAt).toBe(before.chapters[1].frozenAt);
  expect(book.bookSummary).toBe(before.bookSummary);
  expect(seen.some(p => p.startsWith("Capitolo 2 "))).toBe(false);
  await page.getByRole("tab", { name: /Scene/ }).click();
  await expect(page.getByText("1 modifica")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});

test("libro senza schede: generazione esplicita dalla pagina Mondo", async ({ page }) => {
  test.setTimeout(60_000);
  await provider(page, (_system, prompt) => prompt.includes("Crea la knowledge base") ? JSON.stringify({
    entities: [{ type: "character", name: "Elena", importance: "main", summary: "Investigatrice." }, { type: "character", name: "Markus", importance: "secondary", summary: "Informatore." }],
    events: [{ title: "Primo indizio", summary: "La firma.", storyOrder: 1, involves: ["Elena"], sceneIds: ["scene:001:002"] }],
    timelines: [{ title: "Indagine", kind: "global" }] }) : undefined);
  await seed(page, "legacy");
  await nav(page).getByRole("button", { name: "Mondo", exact: true }).click();
  await expect(page.getByText("Nessuna scheda strutturata per questo libro")).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Genera le schede del libro" }).click();
  await expect(page.getByRole("button", { name: /^Personaggi/ })).toBeVisible({ timeout: 30_000 });
  const book = await stored(page);
  expect(book.knowledge.entities.map((e: { name: string }) => e.name)).toEqual(expect.arrayContaining(["Elena", "Markus", "Archivio municipale"]));
  expect(book.knowledge.pending).toBeUndefined();
  expect(book.chapters.every((c: { frozenAt?: string }) => !!c.frozenAt)).toBe(true);
});
