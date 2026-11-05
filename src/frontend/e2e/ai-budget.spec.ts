import { expect, test } from "@playwright/test";

test("budget desktop/mobile: prevent provider spend and stop after missing usage", async ({ page }) => {
  test.setTimeout(90_000);
  let networkCalls = 0;
  await page.route("https://api.openai.com/v1/chat/completions",async route => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({status:204,headers:{
        "access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type",
        "access-control-allow-methods":"POST,OPTIONS",
      }});return;
    }
    networkCalls++;
    await route.fulfill({status:200,headers:{
      "content-type":"application/json",
      "access-control-allow-origin":"*",
      "access-control-allow-headers":"authorization,content-type",
    },body:JSON.stringify({choices:[{message:{content:JSON.stringify({
      verdict:"pass",summary:"Controllo editoriale eseguito senza problemi rilevati.",
      findings:[],memoryNote:"Nessuna criticità in questo segmento.",
    })}}]})}); // Deliberately no usage.
  });
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Libro con budget");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Un romanzo con segreti, indizi e cronologia da verificare.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(async()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite");
      const store=tx.objectStore("books");
      const req=store.getAll();
      req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{
        const b=req.result[0] as Record<string,unknown>;
        b.status="paused";b.phase="prose";
        b.chapters=[{id:"ch-budget",number:1,title:"La chiave",purpose:"Tensione",
          scenes:[{id:"scene-budget",number:1,title:"Entrata",objective:"Incontro",
            status:"canon",summary:"Mara entra.",
            text:"Mara saluta il guardiano davanti alla porta."}]}];
        store.put(b,b.id as string);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await page.getByLabel("API key").fill("sk-test-budget-guard-not-real");
  await page.getByRole("textbox",{name:"Modello predefinito"}).fill("budget-review-model");
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await nav.getByRole("button",{name:"Dashboard"}).click();
  await page.reload();
  const panel=page.getByRole("region",{name:"Budget AI"});
  await expect(panel.getByRole("heading",{name:"Budget AI del libro"})).toBeVisible();
  await panel.getByRole("spinbutton",{name:"Prezzo input per milione"}).fill("3");
  await panel.getByRole("spinbutton",{name:"Prezzo output per milione"}).fill("9");
  await panel.getByRole("button",{name:"Salva tariffa del modello"}).click();
  await expect(panel.getByText(/Tariffa salvata localmente/)).toBeVisible();
  await panel.getByRole("spinbutton",{name:"Soglia budget in euro"}).fill("0.01");
  await panel.getByRole("checkbox",{name:"Attiva limite stimato"}).check();
  await panel.getByRole("button",{name:"Salva budget del libro"}).click();
  await expect(panel.getByText(/Budget stimato attivo/)).toBeVisible();

  async function state() {
    return page.evaluate(async()=>new Promise<{
      status:string;error?:string;attempts:number;reviewed:number;
    }>((resolve,reject)=>{
      const open=indexedDB.open("bookwriter");
      open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{
        const tx=open.result.transaction(["books","activities"],"readonly");
        const books=tx.objectStore("books").getAll();
        const acts=tx.objectStore("activities").getAll();
        tx.onerror=()=>reject(tx.error);
        tx.oncomplete=()=>{
          const book=books.result[0] as {
            status:string;previousError?:string;editorialCycle?:{reports:Array<unknown>};
          };
          const rows=acts.result as Array<{aiRequested?:boolean}>;
          resolve({status:book.status,error:book.previousError,
            attempts:rows.filter(x=>x.aiRequested===true).length,
            reviewed:book.editorialCycle?.reports.length ?? 0});
        };
      };
    }));
  }
  await page.getByRole("button",{name:"Riprendi"}).click();
  await expect.poll(async()=>(await state()).error??"",{timeout:20_000})
    .toContain("Budget stimato raggiunto");
  expect(networkCalls).toBe(0);
  expect((await state()).attempts).toBe(0);

  await panel.getByRole("spinbutton",{name:"Soglia budget in euro"}).fill("2");
  await panel.getByRole("button",{name:"Salva budget del libro"}).click();
  await page.getByRole("button",{name:"Riprendi"}).click();
  await expect.poll(async()=>(await state()).error??"",{timeout:25_000})
    .toContain("senza usage completo");
  expect(networkCalls).toBe(1);
  const after=await state();
  expect(after.status).toBe("paused");
  expect(after.attempts).toBe(1);
  expect(after.reviewed).toBe(1);
  await expect(panel.getByText(/Consumi incerti/)).toBeVisible();
  const widths=await page.evaluate(()=>({actual:document.documentElement.scrollWidth,
    expected:window.innerWidth}));
  expect(widths.actual).toBeLessThanOrEqual(widths.expected+1);
});
