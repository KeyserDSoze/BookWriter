import { expect, test } from "@playwright/test";

test("redazione a segmenti Unicode: i primi due prompt conservano interi i grafemi desktop/mobile", async ({ page }) => {
  test.setTimeout(60_000);
  const sceneText = "a".repeat(9_999) + "👩‍💻Mara incontra il guardiano davanti alla porta.";
  const reviews: Array<{ system: string; prompt: string }> = [];
  const providerSystems: string[] = [];
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  const pass = JSON.stringify({
    verdict: "pass", summary: "Questo segmento non contiene rilievi verificabili.",
    findings: [], memoryNote: "Osservazione completata senza suggerimenti.",
  });
  await page.route("https://api.openai.com/v1/chat/completions", async route => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization,content-type",
        "access-control-allow-methods": "POST,OPTIONS",
      } });
      return;
    }
    const payload = route.request().postDataJSON() as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = payload.messages.find(item => item.role === "system")?.content ?? "";
    const prompt = payload.messages.find(item => item.role === "user")?.content ?? "";
    providerSystems.push(system.slice(0, 100));
    if (system.includes("revisore letterario INDIPENDENTE")) reviews.push({ system, prompt });
    const result = system.includes("direttore editoriale CRITICO") ?
      JSON.stringify({
        reasoning: "Tutte le analisi sono complete e non richiedono interventi sulla prosa canonica.",
        decisions: [],
      }) : prompt.includes("chapterSummary") ?
        JSON.stringify({
          chapterSummary: "Mara arriva alla porta e incontra il guardiano, con un indizio.",
          bookSummary: "La prima parte del romanzo conduce Mara al castello.",
        }) : pass;
    await route.fulfill({ status: 200, headers: {
      "content-type": "application/json", "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type",
    }, body: JSON.stringify({
      choices: [{ message: { content: result } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }) });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("La scena con emoji");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("La protagonista Mara incontra un guardiano.");
  await page.getByRole("button", { name: "Crea libro" }).click();

  await page.evaluate(async text => await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("bookwriter");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("books", "readwrite");
      const store = tx.objectStore("books");
      const query = store.getAll();
      query.onerror = () => reject(query.error);
      query.onsuccess = () => {
        const book = query.result[0] as Record<string, unknown>;
        book.status = "paused";
        book.phase = "chapterReview";
        book.chapters = [{
          id: "chapter-1", number: 1, title: "La porta", purpose: "La prima prova",
          scenes: [{
            id: "scene-1", number: 1, title: "L'incontro",
            objective: "Verificare il dialogo", text, status: "canon",
          }],
        }];
        book.editorialCycle = {
          chapterId: "chapter-1", round: 1, stage: "review",
          reports: [], repairCursor: 0, priorRounds: [],
        };
        (book.memory as { secrets: Record<string, string> }).secrets["chiave"] =
          "NON-RIVELARE-IL-SEGRETO-NEI-LETTORI";
        store.put(book, book.id as string);
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }), sceneText);

  const navigation = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ?
      "Navigazione mobile" : "Navigazione principale",
  });
  await navigation.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByLabel("API key").fill("sk-test-grapheme-not-real");
  await page.getByRole("textbox", { name: "Modello predefinito" }).fill("mock-grapheme-review");
  await page.getByRole("button", { name: "Salva impostazioni" }).click();
  // App.saveEndpointSettings awaits WebCrypto key encryption and the IndexedDB
  // write. A Playwright click waits for the click event, NOT that async work.
  // Reloading immediately can lose the key/model and make the reviewer stop
  // before calling the mocked endpoint (an intermittent zero-request failure).
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  // Verify only a boolean presence flag, NEVER read/print the encrypted key.
  const settingsPersisted = () => page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const opened = indexedDB.open("bookwriter");
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result;
      const request = db.transaction("settings", "readonly").objectStore("settings").get("global");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const settings = request.result as {
          defaultRoute?: { modelId?: string };
          endpoints?: Array<{ id: string; secret?: unknown }>;
        } | undefined;
        resolve(settings?.defaultRoute?.modelId === "mock-grapheme-review" &&
          !!settings?.endpoints?.some(endpoint => endpoint.id === "openai" && endpoint.secret));
        db.close();
      };
    };
  }));
  await expect.poll(settingsPersisted).toBe(true);
  await page.reload();
  await page.evaluate(() => { location.hash = "#/dashboard"; });
  await expect(page.getByRole("region", { name: "Redazione multi-agente" }))
    .toBeVisible();
  await expect.poll(settingsPersisted).toBe(true);
  await page.getByRole("button", { name: "Riprendi" }).click();
  try {
    await expect.poll(() => reviews.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  } catch (error) {
    // On a CI failure distinguish a slow browser from an autopilot that
    // stopped before the HTTP request (or a changed request system prompt).
    const stored = await page.evaluate(() => new Promise<unknown>((resolve, reject) => {
      const opened = indexedDB.open("bookwriter");
      opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => {
        const db = opened.result;
        const request = db.transaction("books", "readonly").objectStore("books").getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const book = request.result[0] as {
            status?: string; phase?: string; previousError?: string;
            editorialCycle?: { stage?: string; reports?: unknown[] };
          } | undefined;
          resolve({
            status: book?.status, phase: book?.phase, previousError: book?.previousError,
            stage: book?.editorialCycle?.stage,
            reports: book?.editorialCycle?.reports?.length,
          });
          db.close();
        };
      };
    }));
    throw new Error("Nessun prompt Unicode ricevuto: " + JSON.stringify({
      stored, providerSystems, browserErrors, reviews: reviews.length,
      original: error instanceof Error ? error.message : String(error),
    }));
  }

  function reviewedText(prompt: string): string {
    const after = prompt.split("<manoscritto>\n");
    expect(after).toHaveLength(2);
    return after[1]!.split("\n</manoscritto>")[0]!;
  }
  const first = reviewedText(reviews[0]!.prompt);
  const second = reviewedText(reviews[1]!.prompt);
  expect(first).toHaveLength(9_999);
  expect(second.startsWith("👩‍💻Mara incontra")).toBe(true);
  expect(first + second).toBe(sceneText);
  expect([first, second].every(text => text.length <= 10_000)).toBe(true);
  expect([first, second].flatMap(text => Array.from(text)).every(char => {
    const code = char.codePointAt(0)!;
    return code < 0xd800 || code > 0xdfff;
  })).toBe(true);
});
