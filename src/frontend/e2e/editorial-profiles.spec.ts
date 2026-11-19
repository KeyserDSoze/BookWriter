import { expect, test, type Page } from "@playwright/test";
import { profileBook } from "@engine/domain/__fixtures__/editorial-profiles";
import { DEFAULT_SETTINGS } from "@engine/domain/types";
import { projectBook } from "@engine/domain/narrarium";

const nav = (page: Page) => page.getByRole("navigation", {
  name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
});
async function create(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Profili del libro sintetico");
  // These tests start from the standard workflow; the default checklist has its own test.
  await page.getByRole("checkbox", { name: /Checklist dello scrittore/ }).uncheck();
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  await openProfiles(page);
}
/** Readers, writer and director are in the «Redazione» tab of the book's settings. */
async function openProfiles(page: Page) {
  await page.getByRole("button", { name: "Modelli e redazione", exact: true }).click();
  await page.getByRole("tab", { name: /^Redazione/ }).click();
}
const panel = (page: Page) => page.getByRole("region", { name: "Profili dei lettori e dello scrittore" });
async function saved(page: Page) {
  return page.evaluate(async () => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    return (await (await getDb()).getAll("books"));
  });
}

test("CMS per libro: lettori e scrittori modificabili, conferma, persistenza e isolamento fra libri", async ({ page }) => {
  let calls = 0;
  await page.route("**/chat/completions", async route => { calls++; await route.abort(); });
  await create(page);
  const before = (await saved(page))[0]!;
  await panel(page).getByRole("tab", { name: /Lettori/ }).click();
  await panel(page).getByLabel("Nome lettore 1", { exact: true }).fill("Lettrice attenta al ritmo");
  await panel(page).getByLabel("Template lettore 1", { exact: true }).fill("Valuta il ritmo senza chiedere spiegazioni inutili. READER_PRIVATE_PROFILE");
  await panel(page).getByRole("button", { name: "Aggiungi lettore", exact: true }).click();
  await panel(page).getByText("Nuovo lettore", { exact: true }).click();
  await panel(page).getByLabel("Nome lettore 6", { exact: true }).fill("Lettore del sottotesto");
  await panel(page).getByRole("tab", { name: /Scrittore/ }).click();
  await panel(page).getByRole("button", { name: "Aggiungi scrittore", exact: true }).click();
  await panel(page).getByLabel("Nome scrittore 1", { exact: true }).fill("Scrittore essenziale");
  await panel(page).getByLabel("Prompt di scrittura 1", { exact: true }).fill("Mostra senza spiegare tutto; evita dettagli inutili. WRITER_PRIVATE_PROFILE");
  await panel(page).getByLabel("Prompt di revisione dello scrittore 1", { exact: true }).fill("Rileggi e cita spiegazioni superflue presenti nella prosa.");
  await panel(page).getByRole("radio", { name: "Vincolo forte" }).click();
  await expect(panel(page).getByText("Modifiche non salvate")).toBeVisible();
  page.once("dialog", dialog => dialog.dismiss());
  await panel(page).getByRole("button", { name: "Salva profili del libro", exact: true }).click();
  expect((await saved(page))[0]!.editorialProfiles).toBeUndefined();
  page.once("dialog", dialog => dialog.accept());
  await panel(page).getByRole("button", { name: "Salva profili del libro", exact: true }).click();
  await expect(panel(page).getByText(/Profili salvati/)).toBeVisible();
  await expect(panel(page).getByText("Modifiche non salvate")).toHaveCount(0);
  const configured = (await saved(page)).find(b => b.id === before.id)!;
  expect(configured.editorialProfiles.readers).toHaveLength(6);
  expect(configured.editorialProfiles.writers[0]).toMatchObject({ name: "Scrittore essenziale", strength: "strict", reviewEnabled: true, version: 1 });
  expect(configured.editorialProfiles.writers[0].rules.map((r: { id: string }) => r.id)).toContain("show-dont-tell");
  expect(configured.chapters).toEqual(before.chapters);
  expect(configured.memory).toEqual(before.memory);
  const otherId = await page.evaluate(async () => {
    const { newBook } = await (window as any).__engine("domain/types.ts");
    const { saveBook } = await import("/src/infrastructure/db.ts");
    const book = newBook("Un altro libro.", "Altro libro standard", "Semplice", "Adulti");
    await saveBook(book, false); return book.id;
  });
  await page.reload();
  await page.getByRole("combobox", { name: "Libro attivo", exact: true }).selectOption(otherId);
  await openProfiles(page);
  await expect(panel(page).getByText(/Workflow standard attivo/)).toBeVisible();
  await expect(panel(page).getByLabel("Nome scrittore 1", { exact: true })).toHaveCount(0);
  await panel(page).getByRole("tab", { name: /Lettori/ }).click();
  await expect(panel(page).getByLabel("Template lettore 1", { exact: true })).not.toHaveValue(/READER_PRIVATE_PROFILE/);
  await page.getByRole("combobox", { name: "Libro attivo", exact: true }).selectOption(before.id);
  await expect(panel(page).getByText(/Profili personalizzati attivi/)).toBeVisible();
  await panel(page).getByRole("tab", { name: /Scrittore/ }).click();
  await expect(panel(page).getByLabel("Prompt di scrittura 1", { exact: true })).toHaveValue(/WRITER_PRIVATE_PROFILE/);
  expect(calls).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("un libro nuovo parte con la checklist dello scrittore, con regole consultive e i cinque lettori standard", async ({ page }) => {
  let calls = 0;
  await page.route("**/chat/completions", async route => { calls++; await route.abort(); });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Libro con checklist");
  await expect(page.getByRole("checkbox", { name: /Checklist dello scrittore/ })).toBeChecked();
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(1);
  const profiles = (await saved(page))[0]!.editorialProfiles;
  expect(profiles.writers).toHaveLength(1);
  expect(profiles.selectedWriterId).toBe(profiles.writers[0].id);
  expect(profiles.writers[0].reviewEnabled).toBe(true);
  // Blocking a chapter on a rule stays an explicit choice of the author.
  expect(profiles.writers[0].rules.map((r: { mandatory: boolean }) => r.mandatory)).toEqual([false, false, false, false]);
  expect(profiles.readers.filter((r: { enabled: boolean }) => r.enabled)).toHaveLength(5);
  await openProfiles(page);
  await expect(panel(page).getByText(/Profili personalizzati attivi/)).toBeVisible();
  expect(calls).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("checklist, direttore e cicli: regole obbligatorie, linee guida e versioni salvate", async ({ page }) => {
  await create(page);
  await panel(page).getByRole("button", { name: "Aggiungi scrittore", exact: true }).click();
  await expect(panel(page).getByRole("group", { name: /Checklist delle regole narrative \(4\)/ })).toBeVisible();
  await panel(page).getByRole("button", { name: "Aggiungi regola", exact: true }).click();
  await panel(page).getByLabel("Regola 5", { exact: true }).fill("Niente avverbi in -mente nei dialoghi");
  await panel(page).getByLabel("Come verificarla (regola 5)", { exact: true }).fill("Cerca avverbi che spiegano il tono invece di mostrarlo.");
  await panel(page).getByRole("switch", { name: "Obbligatoria" }).last().click();
  // Turning the review off makes every rule advisory: nothing could verify it.
  await panel(page).getByRole("switch", { name: "Aggiungi la rilettura indipendente dello scrittore" }).click();
  await expect(panel(page).getByRole("switch", { name: "Obbligatoria" }).first()).toBeDisabled();
  await panel(page).getByRole("switch", { name: "Aggiungi la rilettura indipendente dello scrittore" }).click();
  await panel(page).getByRole("switch", { name: "Obbligatoria" }).last().click();
  await panel(page).getByRole("tab", { name: /Direttore/ }).click();
  await panel(page).getByRole("switch", { name: "Linee guida personalizzate per il direttore" }).click();
  await panel(page).getByLabel("Linee guida del direttore", { exact: true }).fill("Privilegia ritmo e tensione; DIRECTOR_GUIDE_SENTINEL.");
  await panel(page).getByRole("tab", { name: /Ciclo/ }).click();
  await panel(page).getByRole("radio", { name: "2 cicli" }).click();
  page.once("dialog", dialog => dialog.accept());
  await panel(page).getByRole("button", { name: "Salva profili del libro", exact: true }).click();
  await expect(panel(page).getByText(/Profili salvati/)).toBeVisible();
  const profiles = (await saved(page))[0]!.editorialProfiles;
  expect(profiles.maxRounds).toBe(2);
  expect(profiles.director).toMatchObject({ version: 1 });
  expect(profiles.director.instructions).toContain("DIRECTOR_GUIDE_SENTINEL");
  const rules = profiles.writers[0].rules;
  expect(rules).toHaveLength(5);
  expect(rules[4]).toMatchObject({ label: "Niente avverbi in -mente nei dialoghi", mandatory: true });
  await expect(panel(page).getByRole("list", { name: "Flusso della redazione" })).toContainText("max 2 cicli");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("una regola obbligatoria respinta dal direttore ferma il capitolo per l'autore", async ({ page }) => {
  await page.route("https://api.openai.com/v1/chat/completions", async route => {
    const data = route.request().postDataJSON() as { messages: Array<{ content: string }> };
    const system = data.messages[0]!.content;
    let content = JSON.stringify({ verdict: "pass", summary: "Nessun problema concreto nella scena.", findings: [], memoryNote: "" });
    if (system.includes("WRITER_REVIEW_ONLY")) content = JSON.stringify({ verdict: "issues", summary: "Emozione dichiarata.", memoryNote: "",
      checklist: [{ ruleId: "show-dont-tell", outcome: "fail", note: "Stato d'animo spiegato." }],
      findings: [{ sceneId: "scene:001:001", category: "show", severity: "major", evidence: "Mara attraversa il porto",
        reason: "Il passaggio dichiara invece di mostrare.", remediation: "Mostrare con un gesto concreto.", ruleId: "show-dont-tell" }] });
    else if (system.includes("direttore editoriale")) content = JSON.stringify({ reasoning: "Valutazione dei rapporti.",
      ruleChecks: [{ ruleId: "show-dont-tell", verdict: "respected", rationale: "Il passaggio mostra un gesto concreto." }], decisions: [
      { findingId: "1:writerReview:0:0", action: "reject", rationale: "Il passaggio è già concreto e breve.", remediation: "Nessuna modifica." }] });
    await route.fulfill({ json: { choices: [{ message: { content } }], usage: { prompt_tokens: 50, completion_tokens: 10 } } });
  });
  await create(page);
  const source = profileBook();
  source.editorialProfiles!.writers[0]!.rules = [{ id: "show-dont-tell", label: "Mostra, non spiegare", description: "", mandatory: true }];
  await page.evaluate(async ({ source, defaults }) => {
    const { getDb, saveBook, saveSettings } = await import("/src/infrastructure/db.ts");
    const { encryptLocal } = await import("/src/infrastructure/crypto.ts");
    const current = (await (await getDb()).getAll("books"))[0];
    await saveBook({ ...source, id: current.id, status: "paused" as const }, false);
    defaults.endpoints[0].secret = await encryptLocal("sk-synthetic-mandatory-rule");
    defaults.defaultRoute.modelId = "synthetic-editor";
    await saveSettings(defaults);
  }, { source, defaults: structuredClone(DEFAULT_SETTINGS) });
  await page.reload();
  await nav(page).getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Riprendi", exact: true }).click();
  await expect.poll(async () => (await saved(page))[0]?.status, { timeout: 30_000 }).toBe("paused");
  const book = (await saved(page))[0]!;
  expect(book.editorialCycle.stage).toBe("blocked");
  expect(book.editorialCycle.blockedReason).toContain("Mostra, non spiegare");
  expect(book.chapters[0].frozenAt).toBeUndefined();
  expect(book.editorialCycle.reports.at(-1).checklist[0]).toMatchObject({ ruleId: "show-dont-tell", outcome: "fail" });
  await expect(page.getByText(/Regola obbligatoria non soddisfatta/).first()).toBeVisible();
});

test("nuova rilettura dello scrittore prima del giudice: 14 review indipendenti, nessun segreto ai lettori", async ({ page }) => {
  const requests: Array<{ system: string; prompt: string }> = [];
  await page.route("https://api.openai.com/v1/chat/completions", async route => {
    const data = route.request().postDataJSON() as { messages: Array<{ content: string }> };
    const system = data.messages[0]!.content, prompt = data.messages[1]!.content;
    requests.push({ system, prompt });
    const judge = system.includes("direttore editoriale"), summary = prompt.includes('"chapterSummary"');
    const content = judge ? JSON.stringify({ reasoning: "I rapporti sono stati esaminati criticamente e non indicano difetti.", decisions: [] }) :
      summary ? JSON.stringify({ chapterSummary: "Mara attraversa il porto e osserva la nave silenziosa.", bookSummary: "Il romanzo inizia quando Mara attraversa il porto verso una nave silenziosa." }) :
      JSON.stringify({ verdict: "pass", summary: "OTHER_REVIEW_SENTINEL: nessun problema concreto nella scena.", findings: [], memoryNote: "" });
    await route.fulfill({ json: { choices: [{ message: { content } }], usage: { prompt_tokens: 123, completion_tokens: 45 } } });
  });
  await create(page);
  const source = profileBook();
  const id = await page.evaluate(async ({ source, defaults }) => {
    const { getDb, saveBook, saveSettings } = await import("/src/infrastructure/db.ts");
    const { encryptLocal } = await import("/src/infrastructure/crypto.ts");
    const current = (await (await getDb()).getAll("books"))[0];
    const book = { ...source, id: current.id, status: "paused" as const };
    await saveBook(book, false);
    defaults.endpoints[0].secret = await encryptLocal("sk-synthetic-editorial-profiles");
    defaults.defaultRoute.modelId = "synthetic-editor";
    await saveSettings(defaults); return book.id;
  }, { source, defaults: structuredClone(DEFAULT_SETTINGS) });
  await page.reload();
  await nav(page).getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Riprendi", exact: true }).click();
  await expect.poll(async () => (await saved(page)).find(b => b.id === id)?.status, { timeout: 30_000 }).toBe("completed");
  const book = (await saved(page)).find(b => b.id === id)!;
  expect(book.chapters[0].editorialRounds[0].reports).toHaveLength(14);
  expect(book.chapters[0].editorialMode).toBeUndefined();
  expect(requests).toHaveLength(16);
  const writer = requests.find(r => r.system.includes("WRITER_REVIEW_ONLY"))!;
  expect(writer).toBeDefined();
  expect(writer.prompt).not.toContain("PRIVATE_CANON_SENTINEL");
  expect(writer.prompt).not.toContain("OTHER_REVIEW_SENTINEL");
  for (const req of requests.filter(r => r.system.includes("EXTRA_READER_ONLY") || r.system.includes("READER_ONE_ONLY"))) {
    expect(req.prompt).not.toContain("PRIVATE_CANON_SENTINEL");
    expect(req.prompt).not.toContain("OTHER_REVIEW_SENTINEL");
    expect(req.system).not.toContain("WRITER_ONLY");
  }
  expect(book.chapters[0].frozenAt).toBeTruthy();
});

test("due schede: un salvataggio stale dei profili viene rifiutato e il testo digitato resta", async ({ page, context }) => {
  await create(page);
  const other = await context.newPage();
  await other.goto("/");
  await openProfiles(other);
  await panel(other).getByRole("tab", { name: /Lettori/ }).click();
  await panel(page).getByRole("tab", { name: /Lettori/ }).click();
  await panel(other).getByLabel("Nome lettore 1", { exact: true }).fill("Seconda scheda da conservare");
  await panel(page).getByLabel("Nome lettore 1", { exact: true }).fill("Prima scheda salvata");
  page.once("dialog", dialog => dialog.accept());
  await panel(page).getByRole("button", { name: "Salva profili del libro", exact: true }).click();
  await expect(panel(page).getByText(/Profili salvati/)).toBeVisible();
  other.once("dialog", dialog => dialog.accept());
  await panel(other).getByRole("button", { name: "Salva profili del libro", exact: true }).click();
  await expect(panel(other).getByText(/Il libro è cambiato/)).toBeVisible();
  await expect(panel(other).getByLabel("Nome lettore 1", { exact: true })).toHaveValue("Seconda scheda da conservare");
  expect((await saved(page))[0]!.editorialProfiles.readers[0].name).toBe("Prima scheda salvata");
  await other.close();
});

test("i template Markdown sono soltanto bozze fino al salvataggio confermato", async ({ page }) => {
  let calls = 0;
  await page.route("**/chat/completions", async route => { calls++; await route.abort(); });
  await create(page);
  const files = Object.fromEntries(Object.entries(projectBook(profileBook(), []).files).filter(([path]) => path.endsWith(".md")));
  await page.evaluate(async files => {
    const { getDb } = await import("/src/infrastructure/db.ts");
    const db = await getDb(), book = (await db.getAll("books"))[0];
    book.markdownSource = files;
    await db.put("books", book, book.id);
  }, files);
  await page.reload();
  await openProfiles(page);
  await expect(panel(page).getByText(/Workflow standard attivo/)).toBeVisible();
  await panel(page).getByRole("button", { name: "Carica template Markdown del libro", exact: true }).click();
  await expect(panel(page).getByText(/caricati soltanto come bozza/)).toBeVisible();
  await expect(panel(page).getByLabel("Prompt di scrittura 1", { exact: true })).toHaveValue(/WRITER_ONLY/);
  expect((await saved(page))[0]!.editorialProfiles).toBeUndefined();
  page.once("dialog", dialog => dialog.dismiss());
  await panel(page).getByRole("button", { name: "Salva profili del libro", exact: true }).click();
  expect((await saved(page))[0]!.editorialProfiles).toBeUndefined();
  page.once("dialog", dialog => dialog.accept());
  await panel(page).getByRole("button", { name: "Salva profili del libro", exact: true }).click();
  await expect(panel(page).getByText(/Profili salvati/)).toBeVisible();
  expect((await saved(page))[0]!.editorialProfiles.selectedWriterId).toBe("show-writer");
  expect(calls).toBe(0);
});
