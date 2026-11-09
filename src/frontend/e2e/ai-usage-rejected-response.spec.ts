import { expect, test } from "@playwright/test";

test("usage noto e testo editoriale rifiutato: ledger conservato senza canone (desktop/mobile)", async ({page}) => {
  test.setTimeout(90_000);
  let providerCalls=0;
  await page.route("https://api.openai.com/v1/chat/completions",async route=>{
    if(route.request().method()==="OPTIONS") {
      await route.fulfill({status:204,headers:{
        "access-control-allow-origin":"*",
        "access-control-allow-headers":"authorization,content-type",
        "access-control-allow-methods":"POST,OPTIONS",
      }});return;
    }
    providerCalls++;
    await route.fulfill({status:200,headers:{
      "content-type":"application/json","access-control-allow-origin":"*",
      "access-control-allow-headers":"authorization,content-type",
    },body:JSON.stringify({
      choices:[{message:{content:"Questo non è JSON valido per un report editoriale."}}],
      usage:{prompt_tokens:243,completion_tokens:72},
    })});
  });
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Il ledger del romanzo");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara incontra un guardiano davanti al portone del castello.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(async()=>new Promise<void>((resolve,reject)=>{
    const opened=indexedDB.open("bookwriter");
    opened.onerror=()=>reject(opened.error);
    opened.onsuccess=()=>{
      const db=opened.result,tx=db.transaction("books","readwrite");
      const request=tx.objectStore("books").getAll();
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const book=request.result[0] as Record<string,unknown>;
        book.status="paused";book.phase="chapterReview";
        book.chapters=[{id:"ch-1",number:1,title:"Ingresso",purpose:"Mostrare l'incontro",
          scenes:[{id:"s-1",number:1,title:"Il portone",objective:"Incontrare il guardiano",
            text:"Mara incontra il guardiano davanti al portone del castello.",
            status:"canon"}]}];
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
  await page.getByLabel("API key").fill("sk-test-observed-usage-not-real");
  await page.getByRole("textbox",{name:"Modello predefinito"}).fill("mock-usage-review");
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();
  const panel=page.getByRole("region",{name:"Budget AI"});
  await expect(panel.getByRole("heading",{name:"Budget AI del libro"})).toBeVisible();
  await panel.getByRole("spinbutton",{name:"Prezzo input per milione"}).fill("3");
  await panel.getByRole("spinbutton",{name:"Prezzo output per milione"}).fill("9");
  await panel.getByRole("button",{name:"Salva tariffa del modello"}).click();
  await expect(panel.getByText(/Tariffa salvata localmente/)).toBeVisible();
  await panel.getByRole("spinbutton",{name:"Soglia budget in euro"}).fill("5");
  await panel.getByRole("checkbox",{name:"Attiva limite stimato"}).check();
  await panel.getByRole("button",{name:"Salva budget del libro"}).click();
  await expect(panel.getByText(/Budget stimato attivo/)).toBeVisible();
  const state=()=>page.evaluate(()=>new Promise<{
    status:string;error?:string;reports:number;scene:string;
    activities:Array<{status:string;aiRequested?:boolean;inputTokens?:number;
      outputTokens?:number;modelId?:string}>;
  }>((resolve,reject)=>{
    const opened=indexedDB.open("bookwriter");
    opened.onerror=()=>reject(opened.error);
    opened.onsuccess=()=>{
      const db=opened.result,tx=db.transaction(["books","activities"],"readonly");
      const books=tx.objectStore("books").getAll();
      const activities=tx.objectStore("activities").getAll();
      tx.onerror=()=>reject(tx.error);
      tx.oncomplete=()=>{
        const book=books.result[0] as {status:string;previousError?:string;
          editorialCycle:{reports:unknown[]};chapters:Array<{scenes:Array<{text:string}>}>};
        resolve({status:book.status,error:book.previousError,
          reports:book.editorialCycle.reports.length,
          scene:book.chapters[0]!.scenes[0]!.text,activities:activities.result});
        db.close();
      };
    };
  }));
  await page.getByRole("button",{name:"Riprendi"}).click();
  await expect.poll(async()=>(await state()).status,{timeout:30_000}).toBe("error");
  const saved=await state();
  expect(providerCalls).toBe(1);
  expect(saved.reports).toBe(0);
  expect(saved.scene).toBe("Mara incontra il guardiano davanti al portone del castello.");
  expect(saved.activities).toHaveLength(1);
  expect(saved.activities[0]).toMatchObject({status:"failed",aiRequested:true,
    modelId:"mock-usage-review",inputTokens:243,outputTokens:72});
  await expect(panel.getByText(/1 richieste · 0 senza usage completo · 0 senza tariffa/))
    .toBeVisible();
  await expect(panel.getByText(/Consumi incerti/)).toHaveCount(0);
});
