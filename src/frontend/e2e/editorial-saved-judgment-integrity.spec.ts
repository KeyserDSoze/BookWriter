import { expect, test } from "@playwright/test";

test("giudizio importato duplicato: recovery senza chiamate AI (desktop/mobile)", async ({ page }) => {
  let providerCalls = 0;
  await page.route("https://api.openai.com/v1/chat/completions", async route => {
    providerCalls++;
    await route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*",
      "content-type": "application/json" },
    body: JSON.stringify({ error: { message: "La fonte ritirata non deve raggiungere il giudice." } }) });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Mara e il telegrafo");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("Mara invia un messaggio mentre indaga su un segreto.");
  await page.getByRole("button", { name: "Crea libro" }).click();

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const opened = indexedDB.open("bookwriter");
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result;
      const tx = db.transaction("books", "readwrite");
      const store = tx.objectStore("books");
      const req = store.getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const book = req.result[0] as Record<string, unknown>;
        const narrative = "Nel 1848 Mara usa il telegrafo per mandare un messaggio.";
        const quote = "Mara usa il telegrafo";
        let hash = 2166136261;
        for (let i = 0; i < narrative.length; i++)
          hash = Math.imul(hash ^ narrative.charCodeAt(i), 16777619);
        const segmentTextStamp = narrative.length + ":" +
          (hash >>> 0).toString(16).padStart(8, "0");
        const oldId = "itwiki:42:210", newId = "itwiki:42:211";
        const sources = [210, 211].map(revisionId => ({
          id: "itwiki:42:" + revisionId, pageId: 42, revisionId,
          provider: "it.wikipedia.org", title: "Telegrafo",
          url: "https://it.wikipedia.org/wiki/Telegrafo",
          query: "Telegrafo elettrico nel 1848",
          excerpt: "Il telegrafo elettrico cominciò a diffondersi in Europa durante il XIX secolo.",
          retrievedAt: "2026-11-09T12:00:00.000Z",
        }));
        book.phase = "chapterReview";
        book.status = "paused";
        book.chapters = [{
          id: "c1", number: 1, title: "Il messaggio", purpose: "Aprire il capitolo",
          scenes: [{ id: "s1", number: 1, title: "Telegrafo",
            objective: "Inviare un messaggio", status: "canon", text: narrative }],
          historicalDossier: {
            queries: ["Telegrafo elettrico nel 1848"], sources,
            activeSourceIds: [oldId], searchedAt: "2026-11-09T17:00:00.000Z",
            unansweredQueries: [],
          },
        }];
        const roles = [
          "continuity", "secrets", "timeline", "historical", "characterVoice",
          "style", "narrative", "readerGenre", "readerCasual", "readerSkeptic",
          "readerCharacters", "readerMystery",
        ];
        const reports = roles.map(role => ({
          role, segmentIndex: 0, segmentCount: 1,
          verdict: role === "historical" || role === "style" ? "issues" : "pass",
          summary: "Esame documentale del segmento completato.",
          memoryNote: "", createdAt: "2026-11-09T18:00:00.000Z",
          segmentTextStamp,
          findings: role === "style" ? [{
            id: "1:style:0:0", sceneId: "s1", category: "stile", severity: "minor",
            evidence: "Nel 1848 Mara",
            reason: "La frase merita una lettura stilistica più attenta.",
            remediation: "Chiarire il ritmo iniziale senza alterare i riferimenti.",
            evidenceAnchor: { segmentIndex: 0, offset: 0,
              quote: "Nel 1848 Mara", occurrences: 1, context: narrative },
          }] : role !== "historical" ? [] : [{
            id: "1:historical:0:0", sceneId: "s1", category: "storia", severity: "minor",
            evidence: quote,
            reason: "Il riferimento al telegrafo merita un riscontro storico.",
            remediation: "Specificare prudentemente il periodo e il contesto.",
            historical: {
              claim: "L'uso ottocentesco del telegrafo in Europa deve essere verificato.",
              assessment: "consistent_with_excerpt", sourceIds: [oldId],
              sourceQuote: "Il telegrafo elettrico cominciò a diffondersi",
            },
            evidenceAnchor: { segmentIndex: 0, offset: narrative.indexOf(quote),
              quote, occurrences: 1, context: narrative },
          }],
        }));
        book.editorialCycle = {
          chapterId: "c1", round: 1, stage: "repair",
          reports, repairCursor: 0, priorRounds: [],
          judgment: {
            reasoning: "La ricostruzione del telegrafo necessita di prudenza.",
            verdict: "repair", createdAt: "2026-11-09T18:30:00.000Z",
            decisions: [{
              findingId: "1:historical:0:0", action: "accept",
              rationale: "Serve contestualizzare il mezzo di comunicazione nel periodo.",
              remediation: "Specificare il contesto ottocentesco della comunicazione.",
            }, {
              findingId: "1:historical:0:0", action: "accept",
              rationale: "Questo duplicato è stato introdotto da un checkpoint non affidabile.",
              remediation: "Specificare il contesto ottocentesco della comunicazione.",
            }],
          },
        };
        store.put(book, book.id as string);
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }));

  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ?
      "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name: "Impostazioni" }).click();
  await page.getByLabel("API key").fill("sk-test-historical-freshness-not-real");
  await page.getByRole("textbox", { name: "Modello predefinito" }).fill("mock-historical-judge");
  await page.getByRole("button", { name: "Salva impostazioni" }).click();
  await page.reload();

  const panel = page.getByRole("region", { name: "Redazione multi-agente" });
  await expect(panel.getByLabel("Checkpoint editoriale da recuperare")).toBeVisible();
  await expect(panel.getByText(/decisione duplicata/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Recupera checkpoint e ricomincia" })).toBeEnabled();
  await page.getByRole("button", { name: "Riprendi" }).click();
  await expect.poll(() => page.evaluate(() => new Promise<{
    status: string; frozen: boolean; count: number; reason: string;
  }>((resolve, reject) => {
    const opened = indexedDB.open("bookwriter");
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result;
      const tx = db.transaction("books", "readonly");
      const request = tx.objectStore("books").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const book = request.result[0] as {
          status: string; previousError?: string;
          editorialCycle: { reports: unknown[] };
          chapters: Array<{ frozenAt?: string }>;
        };
        resolve({ status: book.status, reason: book.previousError ?? "",
          count: book.editorialCycle.reports.length,
          frozen: !!book.chapters[0]?.frozenAt });
        db.close();
      };
    };
  })), { timeout: 30_000 }).toMatchObject({
    status: "error", count: 12, frozen: false,
  });
  expect(providerCalls).toBe(0);
  const recover = panel.getByRole("button",{name:"Recupera checkpoint e ricomincia"});
  page.once("dialog",dialog=>void dialog.dismiss());
  await recover.click();
  await expect(panel.getByLabel("Checkpoint editoriale da recuperare")).toBeVisible();
  page.once("dialog",dialog=>void dialog.accept());
  await recover.click();
  await expect(panel.getByText(/Checkpoint archiviato/)).toBeVisible();
  const saved=await page.evaluate(()=>new Promise<{
    status:string; stage:string; currentReports:number; archivedStage:string;
    archivedVerdict:string; archivedReports:number; text:string;
  }>((resolve,reject)=>{
    const opened=indexedDB.open("bookwriter");
    opened.onerror=()=>reject(opened.error);
    opened.onsuccess=()=>{
      const db=opened.result;
      const request=db.transaction("books","readonly").objectStore("books").getAll();
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const book=request.result[0] as {
          status:string;editorialCycle:{stage:string;reports:unknown[]};
          editorialRecoveryArchives:Array<{cycle:{stage:string;reports:unknown[];
            judgment:{verdict:string}}}>;
          chapters:Array<{scenes:Array<{text:string}>}>;
        };
        const old=book.editorialRecoveryArchives[0]!.cycle;
        resolve({status:book.status,stage:book.editorialCycle.stage,
          currentReports:book.editorialCycle.reports.length,archivedStage:old.stage,
          archivedVerdict:old.judgment.verdict,archivedReports:old.reports.length,
          text:book.chapters[0]!.scenes[0]!.text});
        db.close();
      };
    };
  }));
  expect(saved).toMatchObject({
    status:"paused",stage:"review",currentReports:0,
    archivedStage:"repair",archivedVerdict:"repair",archivedReports:12,
    text:"Nel 1848 Mara usa il telegrafo per mandare un messaggio.",
  });
  expect(providerCalls).toBe(0);
});
