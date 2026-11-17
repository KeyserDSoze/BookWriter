import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.route("https://api.github.com/user/repos?**", route => route.fulfill({ json: [] }));
});

const nav = (page: Page) => page.getByRole("navigation", {
  name: test.info().project.name === "mobile-chromium" ? "Navigazione mobile" : "Navigazione principale",
});

/** A GitHub that remembers what was pushed, so what comes back can be compared with what was sent. */
async function githubThatRemembers(page: Page) {
  let head = "a".repeat(40), commits = 0;
  let staged: Array<{ path: string; content?: string; sha?: null }> = [];
  const files = new Map<string, string>();
  const headers = {
    "content-type": "application/json", "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,x-github-api-version",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-expose-headers": "X-RateLimit-Reset",
    "x-ratelimit-reset": String(Math.floor((Date.now() + 30 * 60_000) / 1000)),
  };
  await page.route("https://api.github.com/repos/save-owner/novel**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    let status = 200; let body: unknown = {};
    if (method === "GET" && path === "/repos/save-owner/novel")
      body = { private: true, default_branch: "main", full_name: "save-owner/novel", permissions: { push: true } };
    else if (method === "GET" && path.endsWith("/git/ref/heads/main")) body = { object: { sha: head } };
    else if (method === "GET" && path.includes("/git/ref/heads/bookwriter-lock/")) { status = 404; body = { message: "Not Found" }; }
    else if (method === "GET" && path.includes("/contents/")) {
      const text = files.get(path.split("/contents/")[1]!);
      if (text === undefined) { status = 404; body = { message: "Not Found" }; }
      else body = { type: "file", encoding: "base64", content: Buffer.from(text).toString("base64"), sha: "b".repeat(40) };
    } else if (method === "GET" && path.includes("/git/commits/")) body = { tree: { sha: "b".repeat(40) }, message: "commit" };
    else if (method === "POST" && path.endsWith("/git/trees")) {
      staged = (request.postDataJSON() as { tree: typeof staged }).tree; status = 201; body = { sha: "c".repeat(40) };
    } else if (method === "POST" && path.endsWith("/git/commits")) { commits++; status = 201; body = { sha: commits.toString(16).padStart(40, "0") }; }
    else if (method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
      const sent = request.postDataJSON() as { sha: string; force: boolean };
      expect(sent.force).toBe(false);
      head = sent.sha;
      for (const entry of staged) {
        if (entry.sha === null) files.delete(entry.path); else if (entry.content !== undefined) files.set(entry.path, entry.content);
      }
      body = { object: { sha: head } };
    } else { status = 500; body = { message: "Unexpected request: " + method + " " + path }; }
    await route.fulfill({ status, headers, body: JSON.stringify(body) });
  });
  return { commits: () => commits, files };
}

async function stored(page: Page) {
  return page.evaluate(async () => (await (await (await import("/src/infrastructure/db.ts")).getDb()).getAll("books"))[0]);
}

test("un libro a metà lavoro si salva su GitHub com'è (capitolo non congelato, revisione in corso) e si risalva con «Salva su GitHub»", async ({ page }) => {
  test.setTimeout(90_000);
  const github = await githubThatRemembers(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Romanzo a metà");
  await page.getByRole("button", { name: "Crea libro", exact: true }).click();
  // The work so far: a chapter still being written and a review that is not finished.
  await page.evaluate(async () => {
    const { getDb, saveBook } = await import("/src/infrastructure/db.ts");
    const book = (await (await getDb()).getAll("books"))[0];
    book.status = "paused"; book.phase = "chapterReview";
    book.chapters = [{ id: "ch-1", number: 1, title: "Capitolo in corso", purpose: "Sviluppare la storia.", scenes: [
      { id: "scene:001:001", number: 1, title: "Prima scena", objective: "Presentare Mara.",
        text: "Mara raggiunge il porto quando il sole è già tramontato.", status: "draft" }] }];
    book.editorialCycle = { chapterId: "ch-1", round: 1, stage: "review", reports: [], repairCursor: 0, priorRounds: [] };
    book.memory.currentState = "Mara è al porto e non sa ancora chi la aspetta.";
    await saveBook(book, false);
  });
  await page.reload();

  await nav(page).getByRole("button", { name: "Archivio" }).click();
  await page.getByLabel("PAT GitHub").fill("github_pat_test_only_save_in_progress_2026");
  await page.getByRole("button", { name: "Salva PAT cifrato" }).click();
  await page.getByText("Collegamento manuale (avanzato)", { exact: true }).click();
  await page.getByRole("textbox", { name: "Owner GitHub" }).fill("save-owner");
  await page.getByRole("textbox", { name: "Repository del libro" }).fill("novel");
  await page.getByRole("button", { name: "Verifica repository" }).click();
  await expect(page.getByText(/Repository privata verificata/)).toBeVisible();
  await page.getByRole("button", { name: "Collega questo libro" }).click();
  await expect(page.getByText(/Libro collegato a save-owner\/novel/)).toBeVisible();

  // Nothing asks to complete or freeze the chapter first.
  await expect(page.getByText(/Completa la redazione|non è ancora congelato/)).toHaveCount(0);
  await page.getByRole("button", { name: "Sincronizza su GitHub" }).click();
  await expect.poll(() => github.commits()).toBe(1);
  await expect(page.getByText(/MiB su 12/)).toBeVisible();
  const project = JSON.parse(github.files.get(".bookwriter/project.json")!);
  expect(project.chapters[0].scenes[0]).toMatchObject({ status: "draft", text: "Mara raggiunge il porto quando il sole è già tramontato." });
  expect(project.editorialCycle).toMatchObject({ chapterId: "ch-1", stage: "review" });
  expect(github.files.get("chapters/001-capitolo-in-corso/chapter.md")).toContain('canon: "draft"');

  // Automatic saving can be switched on mid-work, too, and sends the current state at once.
  const toggle = page.getByRole("checkbox", { name: /Sincronizzazione automatica dopo ogni compito/ });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(() => github.commits(), { timeout: 25_000 }).toBe(2);

  // The author changes something; the Dashboard says GitHub does not have it yet and «Salva su GitHub» sends it.
  await page.evaluate(async () => {
    const { getDb, saveBook } = await import("/src/infrastructure/db.ts");
    const book = (await (await getDb()).getAll("books"))[0];
    book.memory.currentState = "Mara ha visto l'uomo con il cappotto grigio.";
    await saveBook(book);
  });
  await page.reload();
  await nav(page).getByRole("button", { name: "Dashboard" }).click();
  await expect(page.getByTestId("github-save-line")).toContainText("modifiche non ancora salvate");
  await page.getByRole("button", { name: "Salva su GitHub", exact: true }).click();
  await expect.poll(() => github.commits(), { timeout: 25_000 }).toBe(3);
  await expect(page.getByTestId("github-save-line")).toContainText("GitHub: salvato alle");
  await expect(page.getByRole("button", { name: "Salva su GitHub", exact: true })).toHaveCount(0);
  expect(JSON.parse(github.files.get(".bookwriter/project.json")!).memory.currentState).toBe("Mara ha visto l'uomo con il cappotto grigio.");
  const book = await stored(page);
  expect(book.remote.lastSyncedLocalUpdatedAt).toBe(book.updatedAt);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
