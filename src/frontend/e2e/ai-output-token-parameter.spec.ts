import { expect, test } from "@playwright/test";

type OutputParamWindow = Window & {
  outputParamCalls?: number;
  outputParamRequest?: Record<string,unknown>;
};

test("parametro output scelto: persistito e inviato una volta senza fallback su HTTP 400 (desktop/mobile)",async({page})=>{
  test.setTimeout(90_000);
  await page.addInitScript(()=>{
    const old=window.fetch.bind(window);
    const probe=window as OutputParamWindow;
    probe.outputParamCalls=0;
    window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
      if(!url.endsWith("/chat/completions"))return old(input,init);
      probe.outputParamCalls=(probe.outputParamCalls??0)+1;
      probe.outputParamRequest=JSON.parse(init?.body as string) as Record<string,unknown>;
      return new Response("Il modello richiede un parametro diverso (nessuna chiave)",
        {status:400,headers:{"content-type":"text/plain"}});
    };
  });
  // Any missed interception must not contact a real model.
  await page.route("https://api.openai.com/v1/chat/completions",route=>route.abort());
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Scelta limite output");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara arriva al castello e incontra il guardiano.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite");
      const req=tx.objectStore("books").getAll();
      req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{
        const book=req.result[0] as Record<string,unknown>;
        book.status="paused";book.phase="chapterReview";
        book.chapters=[{id:"ch-one",number:1,title:"La porta",purpose:"Una svolta",
          scenes:[{id:"sc-one",number:1,title:"L'incontro",objective:"Conoscere il guardiano",
            text:"Mara incontra il guardiano davanti alla porta.",status:"canon"}]}];
        book.editorialCycle={chapterId:"ch-one",round:1,stage:"review",
          reports:[],repairCursor:0,priorRounds:[]};
        tx.objectStore("books").put(book,book.id as string);
      };
      tx.onerror=()=>reject(tx.error);
      tx.oncomplete=()=>resolve();
    };
  }));
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?
      "Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  const output=page.getByRole("combobox",{name:"Parametro limite output API"});
  await expect(output).toHaveValue("max_tokens");
  await output.selectOption("max_completion_tokens");
  await page.getByLabel("API key").fill("sk-fixture-only");
  await page.getByRole("textbox",{name:"Modello predefinito"}).fill("reasoning-mock");
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();
  const nav2=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?
      "Navigazione mobile":"Navigazione principale",
  });
  await nav2.getByRole("button",{name:"Impostazioni"}).click();
  await expect(page.getByRole("combobox",{name:"Parametro limite output API"}))
    .toHaveValue("max_completion_tokens");
  await nav2.getByRole("button",{name:"Dashboard"}).click();

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
    status:string;error?:string;activities:Array<{
      status:string;aiRequested?:boolean;inputTokens?:number;outputTokens?:number;
    }>
  }>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction(["books","activities"],"readonly");
      const books=tx.objectStore("books").getAll();
      const activities=tx.objectStore("activities").getAll();
      tx.onerror=()=>reject(tx.error);
      tx.oncomplete=()=>{
        const book=books.result[0] as {status:string;previousError?:string};
        resolve({status:book.status,error:book.previousError,activities:activities.result});
      };
    };
  }));
  await page.getByRole("button",{name:"Riprendi"}).click();
  await expect.poll(async()=>(await state()).status,{timeout:30_000}).toBe("error");
  const result=await state();
  expect(result.error).toContain("HTTP 400");
  expect(result.error).not.toContain("sk-fixture");
  expect(result.activities).toHaveLength(1);
  expect(result.activities[0]).toMatchObject({status:"failed",aiRequested:true});
  expect(result.activities[0]!.inputTokens).toBeUndefined();
  expect(result.activities[0]!.outputTokens).toBeUndefined();
  const probe=await page.evaluate(()=>({
    calls:(window as OutputParamWindow).outputParamCalls,
    request:(window as OutputParamWindow).outputParamRequest,
  }));
  expect(probe.calls).toBe(1);
  expect(probe.request).toMatchObject({model:"reasoning-mock",max_completion_tokens:8192});
  expect(probe.request).not.toHaveProperty("max_tokens");
  expect(JSON.stringify(probe.request)).not.toContain("sk-fixture-only");
  const dimensions=await page.evaluate(()=>({
    scroll:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport+1);
});
