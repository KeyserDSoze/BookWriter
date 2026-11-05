import { expect, test } from "@playwright/test";

test("redazione capitolo desktop/mobile: 12 agenti separati, giudice, freeze e riapertura", async ({page}) => {
  const calls: Array<{system:string;prompt:string;model:string}> = [];
  const reports = JSON.stringify({
    verdict:"pass",summary:"Controllo editoriale indipendente superato senza criticità.",
    findings:[],memoryNote:"Nessun problema nel segmento letto.",
  });
  await page.route("https://api.openai.com/v1/chat/completions",async route=>{
    const body=route.request().postDataJSON() as {
      model:string;messages:Array<{role:string;content:string}>;
    };
    const system=body.messages.find(m=>m.role==="system")?.content ?? "";
    const prompt=body.messages.find(m=>m.role==="user")?.content ?? "";
    calls.push({system,prompt,model:body.model});
    const content=system.includes("direttore editoriale CRITICO")?
      JSON.stringify({reasoning:"Le dodici verifiche non hanno prodotto rilievi. Il capitolo rispetta la coerenza narrativa e può essere congelato.",decisions:[]}) :
      prompt.includes("chapterSummary")?
        JSON.stringify({chapterSummary:"Mara arriva al castello incontrando il guardiano alla porta principale.",
          bookSummary:"All'inizio del romanzo Mara raggiunge il castello e incontra il guardiano."}) : reports;
    await route.fulfill({status:200,headers:{
      "content-type":"application/json","access-control-allow-origin":"*",
      "access-control-allow-headers":"authorization,content-type",
    },body:JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:100,completion_tokens:20}})});
  });

  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Castello in revisione");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara custodisce una chiave e arriva al castello.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(async()=>await new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite");
      const store=tx.objectStore("books");
      const request=store.getAll();
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const book=request.result[0] as Record<string,unknown>;
        book.status="paused";book.phase="prose";
        book.chapters=[{id:"ch-1",number:1,title:"Il castello",
          purpose:"Mostrare il mistero",scenes:[{
            id:"scene-1",number:1,title:"Il guardiano",objective:"Presentare il conflitto",
            text:"Mara incontra il guardiano e attraversa il portone.",summary:"Mara entra.",
            status:"canon",
          }]}];
        (book.memory as {secrets:Record<string,string>}).secrets.chiave=
          "La chiave apre il passaggio segreto del castello.";
        store.put(book,book.id as string);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  const nav=page.getByRole("navigation",{name:test.info().project.name==="mobile-chromium"?
    "Navigazione mobile":"Navigazione principale"});
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await page.getByLabel("API key").fill("sk-test-editorial-not-real");
  await page.getByRole("textbox",{name:"Modello predefinito"}).fill("mock-review-editorial");
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await page.reload();
  const panel=page.getByRole("region",{name:"Redazione multi-agente"});
  await expect(panel.getByText("Non ancora congelato")).toBeVisible();
  await page.getByRole("button",{name:"Riprendi"}).click();
  await expect(panel.getByText(/Congelato il/)).toBeVisible({timeout:45_000});
  expect(calls).toHaveLength(14);
  expect(calls.every(x=>x.model==="mock-review-editorial")).toBe(true);
  expect(calls.filter(x=>x.system.includes("revisore letterario INDIPENDENTE"))).toHaveLength(12);
  expect(calls.filter(x=>x.system.includes("direttore editoriale CRITICO"))).toHaveLength(1);
  expect(calls.filter(x=>x.prompt.includes("chapterSummary"))).toHaveLength(1);
  const readers=calls.filter(x=>x.system.includes("Lettore ")||x.system.includes("Lettura"));
  expect(readers).toHaveLength(5);
  expect(readers.every(x=>!x.prompt.includes("passaggio segreto del castello"))).toBe(true);
  const specialists=calls.filter(x=>x.system.includes("Segreti, indizi"));
  expect(specialists).toHaveLength(1);
  expect(specialists[0]?.prompt).toContain("passaggio segreto");
  await panel.getByText(/Giudizi archiviati \(1\)/).click();
  await expect(panel.getByText(/Tornata 1 · 12 verifiche/)).toBeVisible();
  page.once("dialog",dialog=>dialog.accept());
  await panel.getByRole("button",{name:"Rivaluta"}).click();
  await expect(panel.getByText(/In review/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Riprendi"})).toBeEnabled();
  const width=await page.evaluate(()=>({
    actual:document.documentElement.scrollWidth,expected:window.innerWidth,
  }));
  expect(width.actual).toBeLessThanOrEqual(width.expected+1);
});
