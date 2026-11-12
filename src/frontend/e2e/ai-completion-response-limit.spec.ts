import { expect, test } from "@playwright/test";

type MockWindow = Window & {
  providerMockCalls?: number;
  providerStreamCancelled?: boolean;
};

for (const caseName of ["stream oltre il limite", "JSON incompleto"] as const) {
test("POST AI " + caseName + ": nessun canone e usage sconosciuto (desktop/mobile)", async ({page}) => {
  test.setTimeout(90_000);
  await page.addInitScript(kind => {
    const originalFetch = window.fetch.bind(window);
    const flags = window as MockWindow;
    flags.providerMockCalls = 0;
    flags.providerStreamCancelled = false;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const uri = typeof input === "string" ? input :
        input instanceof URL ? input.toString() : input.url;
      if (!uri.endsWith("/chat/completions")) return originalFetch(input, init);
      flags.providerMockCalls = (flags.providerMockCalls ?? 0) + 1;
      const encoder = new TextEncoder();
      if (kind === "JSON incompleto") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(
              '{"choices":[{"message":{"content":"NON APPLICARE"}}],"usage":{"prompt_tokens":999,',
            ));
            controller.close();
          },
        });
        return new Response(stream, {status:200,
          headers:{"content-type":"application/json"}});
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // Real ReadableStream, not a preloaded route.fulfill body. A false
          // short Content-Length must not override the observed byte total.
          controller.enqueue(encoder.encode(
            '{"usage":{"prompt_tokens":999,"completion_tokens":999},"choices":[',
          ));
          controller.enqueue(new Uint8Array(1_300_000));
          controller.enqueue(new Uint8Array(800_000));
        },
        cancel() { flags.providerStreamCancelled = true; },
      });
      return new Response(stream, {status:200, headers:{
        "content-type":"application/json","content-length":"42",
      }});
    };
  }, caseName);
  // A broken fetch override must not hit a real provider.
  await page.route("https://api.openai.com/v1/chat/completions", route => route.abort());
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
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();

  await page.getByRole("button",{name:"Costi",exact:true}).click();
  const budget=page.getByRole("region",{name:"Budget AI"});
  await budget.getByRole("spinbutton",{name:"Prezzo input per milione"}).fill("3");
  await budget.getByRole("spinbutton",{name:"Prezzo output per milione"}).fill("9");
  await budget.getByRole("button",{name:"Salva tariffa del modello"}).click();
  await expect(budget.getByText(/Tariffa salvata localmente/)).toBeVisible();
  await budget.getByRole("spinbutton",{name:"Soglia budget in euro"}).fill("5");
  await budget.getByRole("checkbox",{name:"Attiva limite stimato"}).check();
  await budget.getByRole("button",{name:"Salva budget del libro"}).click();
  await expect(budget.getByText(/Budget stimato attivo/)).toBeVisible();

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
  await expect.poll(async()=>(await state()).status,{timeout:30_000}).toBe("error");
  const result=await state();
  expect(result.reports).toBe(0);
  expect(result.frozen).toBe(false);
  expect(result.scene).toBe("Mara incontra il guardiano al portone.");
  expect(result.activities).toHaveLength(1);
  expect(result.activities[0]).toMatchObject({status:"failed",aiRequested:true,
    priceRateSnapshot:{inputEurPerMillion:3,outputEurPerMillion:9}});
  expect(result.activities[0]!.inputTokens).toBeUndefined();
  expect(result.activities[0]!.outputTokens).toBeUndefined();
  expect(result.error).toContain(caseName === "stream oltre il limite"?
    "Risposta AI troppo grande" : "JSON valido");
  expect(result.error).not.toContain("sk-local-test");
  expect(result.error).not.toContain("NON APPLICARE");
  const flags=await page.evaluate(()=>({
    calls:(window as MockWindow).providerMockCalls,
    canceled:(window as MockWindow).providerStreamCancelled,
  }));
  expect(flags.calls).toBe(1);
  if(caseName==="stream oltre il limite") expect(flags.canceled).toBe(true);

  await page.reload();
  await page.getByRole("button",{name:"Costi",exact:true}).click();
  const ledger=page.getByRole("region",{name:"Budget AI"});
  await expect(ledger.getByText(/Consumi incerti/)).toBeVisible();
  // The UI formats an exactly-zero *known* spend as 0,00 €, unlike
  // fractional nonzero estimates. The unknown provider cost remains
  // separately visible as "Consumi incerti", never folded into this value.
  await expect(ledger.getByText(/Spesa stimata da usage noto:/).locator(".."))
    .toContainText("0,00");
});
}
