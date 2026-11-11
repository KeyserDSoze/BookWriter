import { expect, test } from "@playwright/test";

test("avvisi preventivi 80% per libro e sessione, costi incerti e isolamento libro su desktop/mobile", async ({page}) => {
  await page.goto("/");
  await page.getByRole("textbox", {name:"Titolo provvisorio"}).fill("Budget vicino alla soglia");
  await page.getByRole("textbox", {name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Un romanzo con una revisione editoriale complessa.");
  await page.getByRole("button", {name:"Crea libro"}).click();

  // Two independently priced sessions: book 8/10 EUR, latest run 0.8/1 EUR.
  // Provider usage and price snapshots are synthetic, never real billing.
  await page.evaluate(async () => new Promise<void>((resolve,reject) => {
    const request = indexedDB.open("bookwriter");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction(["books","activities"],"readwrite");
      const get = tx.objectStore("books").getAll();
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const book = get.result[0] as {id:string; aiBudget?:unknown};
        book.aiBudget = {enabled:true,enabledAt:"2026-11-11T00:00:00.000Z",
          limitEur:10,sessionLimitEur:1,maxOutputTokens:8192};
        tx.objectStore("books").put(book,book.id);
        const quote = {endpointId:"test-provider",modelId:"test-model",
          inputEurPerMillion:1,outputEurPerMillion:0};
        for (const [id,runId,inputTokens,createdAt] of [
          ["old","previous-run",7200000,"2026-11-11T08:00:00.000Z"],
          ["recent","latest-run",800000,"2026-11-11T09:00:00.000Z"],
        ] as const) {
          tx.objectStore("activities").put({
            id,runId,bookId:book.id,phase:"chapterReview",title:"Revisione "+id,
            reason:"Test locale",nextStep:"Proseguire",status:"succeeded",
            createdAt,aiRequested:true,endpointId:quote.endpointId,modelId:quote.modelId,
            inputTokens,outputTokens:0,priceRateSnapshot:quote,
          },id);
        }
        tx.objectStore("activities").put({
          id:"other-book",bookId:book.id+"-other",runId:"latest-run",
          phase:"prose",title:"Altro libro",reason:"Test",nextStep:"Nessuna",
          status:"succeeded",createdAt:"2026-11-11T10:00:00.000Z",
          aiRequested:true,endpointId:quote.endpointId,modelId:quote.modelId,
          inputTokens:100000000,outputTokens:0,priceRateSnapshot:quote,
        },"other-book");
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  const panel = page.getByRole("region",{name:"Budget AI"});
  await expect(panel.getByRole("alert",{name:/Avviso preventivo libro/})).toBeVisible();
  await expect(panel.getByRole("alert",{name:/Avviso preventivo sessione/})).toBeVisible();
  await expect(panel.locator("p").filter({hasText:"Margine stimato noto del libro:"})).toContainText("2,00");
  await expect(panel.locator("p").filter({hasText:"Margine stimato noto della sessione:"})).toContainText("0,20");
  await expect(panel.locator("p").filter({hasText:"Ultima sessione AI registrata:"})).toContainText("0,80");

  // Raising the global limit must not reset the latest session warning.
  await panel.getByRole("spinbutton",{name:"Soglia budget in euro"}).fill("20");
  await panel.getByRole("button",{name:"Salva budget del libro"}).click();
  await expect(panel.getByRole("alert",{name:/Avviso preventivo libro/})).toHaveCount(0);
  await expect(panel.getByRole("alert",{name:/Avviso preventivo sessione/})).toBeVisible();
  await panel.getByRole("spinbutton",{name:"Limite sessione AI in euro"}).fill("2");
  await panel.getByRole("button",{name:"Salva budget del libro"}).click();
  await expect(panel.getByRole("alert",{name:/Avviso preventivo sessione/})).toHaveCount(0);

  // Unknown usage outranks reassuring numeric headroom and must hide it.
  await page.evaluate(async() => new Promise<void>((resolve,reject) => {
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction(["books","activities"],"readwrite");
      const req=tx.objectStore("books").getAll();
      req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{
        const book=req.result[0] as {id:string};
        tx.objectStore("activities").put({
          id:"unknown",bookId:book.id,runId:"latest-run",
          phase:"chapterReview",title:"Tentativo inconcluso",
          reason:"Rete interrotta",nextStep:"Controllare la fattura",
          status:"failed",createdAt:"2026-11-11T10:00:00.000Z",
          aiRequested:true,endpointId:"test-provider",modelId:"test-model",
        },"unknown");
      };
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
    };
  }));
  await page.reload();
  await expect(panel.getByRole("alert",{name:/Consumi incerti del libro/})).toBeVisible();
  await expect(panel.getByRole("alert",{name:/Consumi incerti della sessione/})).toBeVisible();
  await expect(panel.locator("p").filter({hasText:"Margine stimato noto del libro:"})).toHaveCount(0);
  await expect(panel.locator("p").filter({hasText:"Margine stimato noto della sessione:"})).toHaveCount(0);
  await expect(panel.getByRole("alert",{name:/Avviso preventivo/})).toHaveCount(0);

  // Another book cannot inherit warning messages or recorded spending.
  await page.locator("#book-select").selectOption("");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Secondo libro senza budget");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Un libro nuovo senza richieste ai modelli.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  const other = page.getByRole("region",{name:"Budget AI"});
  await expect(other.getByRole("alert")).toHaveCount(0);
  await expect(other.getByText(/Margine stimato noto/)).toHaveCount(0);
  const sizes = await page.evaluate(() => ({
    scroll:document.documentElement.scrollWidth, screen:window.innerWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.screen + 1);
});
