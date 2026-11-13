import { expect, test } from "@playwright/test";

type HeaderMockWindow = Window & {
  headerMockCalls?: number;
  fastHeaderDeadline?: boolean;
  headerMockAborted?: number;
};

test("Header POST bloccati: pausa, ripresa supervisionata e usage ignoto (desktop/mobile)",async({page})=>{
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const oldFetch=window.fetch.bind(window);
    const oldSetTimeout=window.setTimeout.bind(window);
    const flags=window as HeaderMockWindow;
    flags.headerMockCalls=0;
    flags.headerMockAborted=0;
    flags.fastHeaderDeadline=false;
    window.fetch=(input: RequestInfo | URL, init?: RequestInit)=>{
      const uri=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
      if(!uri.endsWith("/chat/completions"))return oldFetch(input,init);
      flags.headerMockCalls=(flags.headerMockCalls??0)+1;
      init?.signal?.addEventListener("abort",()=>{
        flags.headerMockAborted=(flags.headerMockAborted??0)+1;
      },{once:true});
      // This proxy never returns headers and deliberately ignores abort.
      return new Promise<Response>(()=>{});
    };
    // Accelerate ONLY the configured 60 s POST header timer, after a
    // deliberate author pause on the first attempt. Other app timers run normally.
    window.setTimeout=((handler:TimerHandler,timeout?:number,...args:unknown[])=>
      oldSetTimeout(handler,timeout===60_000 && flags.fastHeaderDeadline?25:timeout,...args)
    ) as typeof window.setTimeout;
  });
  await page.route("https://api.openai.com/v1/chat/completions", route=>route.abort());
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Il manoscritto protetto");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara arriva al castello e incontra un guardiano enigmatico.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(() => new Promise<void>((resolve,reject) => {
    const opened = indexedDB.open("bookwriter");
    opened.onerror=()=>reject(opened.error);
    opened.onsuccess=()=>{
      const db=opened.result,tx=db.transaction("books","readwrite");
      const get=tx.objectStore("books").getAll();
      get.onerror=()=>reject(get.error);
      get.onsuccess=()=>{
        const book=get.result[0] as Record<string,unknown>;
        book.status="paused"; book.phase="chapterReview";
        book.chapters=[{id:"ch-1",number:1,title:"La porta",purpose:"Presentare il mistero",
          scenes:[{id:"s-1",number:1,title:"Il guardiano",objective:"Presentare il guardiano",
            text:"Mara incontra il guardiano al portone.",status:"canon"}]}];
        book.editorialCycle={chapterId:"ch-1",round:1,stage:"review",
          reports:[],repairCursor:0,priorRounds:[]};
        tx.objectStore("books").put(book,book.id as string);
      };
      tx.onerror=()=>reject(tx.error);
      tx.oncomplete=()=>{db.close();resolve();};
    };
  }));
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await page.getByLabel("API key").fill("sk-local-test-only");
  await page.getByRole("textbox",{name:"Modello predefinito"}).fill("mock-json-boundary");
  await page.getByRole("spinbutton",{name:"Prezzo input per milione: mock-json-boundary"}).fill("3");
  await page.getByRole("spinbutton",{name:"Prezzo output per milione: mock-json-boundary"}).fill("9");
  await page.getByText("Opzioni avanzate").first().click();
  await page.getByRole("spinbutton",{name:"Attesa massima header AI (secondi)"}).fill("60");
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();


  await page.getByRole("button",{name:"Costi",exact:true}).click();
  const budget=page.getByRole("region",{name:"Budget AI"});
  await budget.getByRole("spinbutton",{name:"Soglia budget in euro"}).fill("5");

  const state=()=>page.evaluate(()=>new Promise<{
    status:string;error?:string;reports:number;scene:string;frozen:boolean;
    activities:Array<{status:string;aiRequested?:boolean;inputTokens?:number;
      outputTokens?:number;priceRateSnapshot?:unknown}>;
  }>((resolve,reject)=>{
    const opened=indexedDB.open("bookwriter");
    opened.onerror=()=>reject(opened.error);
    opened.onsuccess=()=>{
      const db=opened.result,tx=db.transaction(["books","activities"],"readonly");
      const books=tx.objectStore("books").getAll(),activities=tx.objectStore("activities").getAll();
      tx.onerror=()=>reject(tx.error);
      tx.oncomplete=()=>{
        const b=books.result[0] as {status:string;previousError?:string;
          editorialCycle:{reports:unknown[]};chapters:Array<{frozenAt?:string;
          scenes:Array<{text:string}>}>};
        resolve({status:b.status,error:b.previousError,
          reports:b.editorialCycle.reports.length,
          scene:b.chapters[0]!.scenes[0]!.text,
          frozen:!!b.chapters[0]!.frozenAt,
          activities:activities.result});
        db.close();
      };
    };
  }));

  await page.getByRole("button",{name:"Riprendi"}).click();
  await expect.poll(()=>page.evaluate(()=>(window as HeaderMockWindow).headerMockCalls),{
    timeout:15_000,
  }).toBe(1);
  await page.getByRole("button",{name:"Pausa"}).click();
  await expect.poll(async()=>(await state()).status,{timeout:15_000}).toBe("paused");
  expect((await state()).activities[0]!.status).toBe("cancelled");
  expect(await page.evaluate(()=>(window as HeaderMockWindow).headerMockCalls)).toBe(1);
  // This author opt-in starts the budget period AFTER the cancelled attempt.
  // We never permit a retry past an active guard with unknown usage.
  await budget.getByRole("checkbox",{name:"Attiva limite stimato"}).check();
  await budget.getByRole("button",{name:"Salva budget del libro"}).click();
  await expect(budget.getByText(/Budget stimato attivo/)).toBeVisible();
  await page.evaluate(()=>(window as HeaderMockWindow).fastHeaderDeadline=true);
  await page.getByRole("button",{name:"Riprendi"}).click();
  await expect.poll(async()=>(await state()).status,{timeout:30_000}).toBe("error");
  const saved=await state();
  expect(saved.reports).toBe(0);
  expect(saved.frozen).toBe(false);
  expect(saved.scene).toBe("Mara incontra il guardiano al portone.");
  expect(saved.error).toContain("Tempo scaduto in attesa degli header");
  expect(saved.error).not.toContain("sk-local-test");
  expect(saved.activities).toHaveLength(2);
  expect(saved.activities.map(x=>x.status).sort()).toEqual(["cancelled","failed"]);
  const failed=saved.activities.find(x=>x.status==="failed")!;
  expect(failed).toMatchObject({aiRequested:true,
    priceRateSnapshot:{inputEurPerMillion:3,outputEurPerMillion:9}});
  expect(failed.inputTokens).toBeUndefined();
  expect(failed.outputTokens).toBeUndefined();
  const flags=await page.evaluate(()=>({
    calls:(window as HeaderMockWindow).headerMockCalls,
    aborted:(window as HeaderMockWindow).headerMockAborted,
  }));
  expect(flags.calls).toBe(2); // one per supervised attempt; no automatic retry
  expect(flags.aborted).toBe(2);
  await page.reload();
  await page.getByRole("button",{name:"Costi",exact:true}).click();
  const ledger=page.getByRole("region",{name:"Budget AI"});
  await expect(ledger.getByText(/Consumi incerti/)).toBeVisible();
  await expect(ledger.getByText(/Spesa stimata da usage noto:/).locator("..")).toContainText("0,00");
});
