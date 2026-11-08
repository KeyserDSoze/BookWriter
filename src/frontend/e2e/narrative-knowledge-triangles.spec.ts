import {expect,test} from "@playwright/test";

test("avvisi consultivi su tre decisioni dirette, rettifica e privacy desktop/mobile",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Tre conoscenze");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara, Elio e Nina osservano la stessa lettera, ma potrebbero mentire.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open("bookwriter");
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const tx=request.result.transaction("books","readwrite"),store=tx.objectStore("books"),
        all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const book=all.result[0] as {id:string;status:string;phase:string;
          chapters:unknown[]};
        book.status="paused";book.phase="completed";
        book.chapters=[
          {id:"c1",number:1,title:"Mara",purpose:"Notizia",
            frozenAt:"2026-11-08T08:00:00.000Z",
            scenes:[{id:"s1",number:1,title:"Mara",objective:"Notizia",
              text:"Mara scopre che la lettera è falsa.",status:"canon"}]},
          {id:"c2",number:2,title:"Elio",purpose:"Notizia",
            frozenAt:"2026-11-08T09:00:00.000Z",
            scenes:[{id:"s2",number:1,title:"Elio",objective:"Notizia",
              text:"Elio apprende che la lettera è falsa.",status:"canon"}]},
          {id:"c3",number:3,title:"Nina",purpose:"Notizia",
            frozenAt:"2026-11-08T10:00:00.000Z",
            scenes:[{id:"s3",number:1,title:"Nina",objective:"Notizia",
              text:"Nina capisce che la lettera è falsa.",status:"canon"}]},
        ];
        store.put(book,book.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const outgoing:string[]=[];
  page.on("request",r=>{
    if(r.url().includes("api.openai.com")||r.url().includes("api.github.com"))
      outgoing.push(r.url());
  });
  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  await board.locator("summary").filter({hasText:"Indice eventi candidati"}).first().click();
  for(const quote of [
    "Mara scopre che la lettera è falsa",
    "Elio apprende che la lettera è falsa",
    "Nina capisce che la lettera è falsa",
  ]){
    const item=board.getByText("«"+quote+"»",{exact:true}).first().locator("..");
    await item.getByRole("textbox",{name:/Motivazione evento/})
      .fill("L'autore riconosce la menzione; non verifica che la notizia sia vera.");
    page.once("dialog",dialog=>dialog.accept());
    await item.getByRole("button",{name:"Annota come avvenuto"}).click();
    await expect(item.getByText(/Interpretazione attuale: annotato come avvenuto/))
      .toBeVisible();
  }
  const knowledge=board.locator('details[aria-label="Registro conoscenze autore"]');
  await knowledge.locator("> summary").click();
  const source=knowledge.getByRole("combobox",{name:"Menzione di conoscenza attestata"});
  for(let i=0;i<3;i++){
    await source.selectOption({index:i});
    await knowledge.getByRole("textbox",{name:"Motivazione conoscenza autore"})
      .fill("L'autore registra la voce senza certificare né la verità né la comunicazione.");
    page.once("dialog",dialog=>dialog.accept());
    await knowledge.getByRole("button",{name:"Riferita da altri"}).click();
    await expect(knowledge.locator("> summary")).toContainText("("+(i+1)+" correnti)");
  }
  const panel=knowledge.locator('details[aria-label="Relazioni conoscenze autore"]');
  await panel.locator("> summary").click();
  const comparison=panel.getByRole("group",{name:"Confronta due conoscenze"});
  const first=comparison.getByLabel("Prima conoscenza da confrontare");
  const second=comparison.getByLabel("Seconda conoscenza da confrontare");
  const rationale=comparison.getByRole("textbox",{name:"Motivazione relazione conoscenze"});
  async function decide(firstIndex:number,secondIndex:number,kind:"same"|"different"){
    await first.selectOption({index:firstIndex});
    await second.selectOption({index:secondIndex});
    await rationale.fill("L'autore confronta le tre frasi; questa coppia può riferirsi a una notizia diversa.");
    page.once("dialog",dialog=>dialog.accept());
    await comparison.getByRole("button",{
      name:kind==="same"?"Conferma stessa informazione":"Conferma informazioni differenti",
    }).click();
  }
  await decide(0,0,"same");
  await decide(1,1,"same");
  await expect(panel.getByLabel("Avvisi triangoli conoscenze")).toHaveCount(0);
  await decide(0,1,"different");
  const warnings=panel.locator('details[aria-label="Avvisi triangoli conoscenze"]');
  await expect(warnings.locator("> summary")).toContainText("1 possibili incoerenze");
  await warnings.locator("> summary").click();
  await expect(warnings.getByText(/non un collegamento aggiunto/)).toBeVisible();
  await expect(warnings.getByText(/Mara scopre che la lettera è falsa/)).toBeVisible();
  await expect(warnings.getByText(/Elio apprende che la lettera è falsa/)).toBeVisible();
  await expect(warnings.getByText(/Nina capisce che la lettera è falsa/)).toBeVisible();
  await decide(0,1,"same");
  await expect(warnings).toHaveCount(0);
  await page.reload();
  const loaded=page.getByRole("region",{name:"Redazione multi-agente"});
  await loaded.locator("summary").filter({hasText:"Indice eventi candidati"}).first().click();
  const bookKnowledge=loaded.locator('details[aria-label="Registro conoscenze autore"]');
  await bookKnowledge.locator("> summary").click();
  const topics=bookKnowledge.locator('details[aria-label="Relazioni conoscenze autore"]');
  await topics.locator("> summary").click();
  await expect(topics.locator('details[aria-label="Avvisi triangoli conoscenze"]'))
    .toHaveCount(0);
  expect(outgoing).toEqual([]);
  const width=await page.evaluate(()=>
    ({content:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  expect(width.content).toBeLessThanOrEqual(width.viewport+1);
});
