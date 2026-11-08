import {expect,test} from "@playwright/test";

test("timeline privata: conoscenza, flashback, rettifica e fonte stale desktop/mobile",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"})
    .fill("La conoscenza nel flashback");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("La lettera arriva a Mara in una scena di sogno non cronologica.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const tx=req.result.transaction("books","readwrite"),
        store=tx.objectStore("books"),all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as Record<string,unknown>;
        b.status="paused";b.phase="completed";
        b.remote={owner:"author",repository:"novel",branch:"main",autoSync:true};
        b.chapters=[{id:"ch1",number:1,title:"Il sogno",purpose:"Segreto",
          frozenAt:"2026-11-08T07:00:00.000Z",
          scenes:[{id:"s1",number:1,title:"Rivelazione",objective:"Rivelare",
            text:"Mara scopre che Elio nasconde la lettera.",status:"canon"}]}];
        store.put(b,b.id as string);
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
  await board.getByRole("textbox",{name:/Motivazione evento/})
    .fill("L'autore conferma questa menzione letterale nel manoscritto.");
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Annota come avvenuto"}).click();
  await expect(board.getByText(/Interpretazione attuale: annotato come avvenuto/))
    .toBeVisible();
  const knowledge=board.locator('details[aria-label="Registro conoscenze autore"]');
  await knowledge.locator("> summary").click();
  await knowledge.getByRole("textbox",{name:"Motivazione conoscenza autore"})
    .fill("Mara non conosce ancora la notizia poiché la scena è soltanto un sogno.");
  page.once("dialog",d=>d.accept());
  await knowledge.getByRole("button",{name:"Ancora segreta per il personaggio"}).click();
  await expect(knowledge.locator("> summary")).toContainText("(1 correnti)");

  const timing=knowledge.locator('details[aria-label="Timeline conoscenze autore"]');
  await expect(timing.locator("> summary")).toContainText("(0 posizioni correnti)");
  await timing.locator("> summary").click();
  await timing.getByRole("combobox",{name:"Momento accesso conoscenza"})
    .selectOption("not_yet_known");
  await timing.getByRole("combobox",{name:"Ordine narrativo conoscenza"})
    .selectOption("flashback_or_reordered");
  await timing.getByRole("textbox",{name:"Motivazione tempo conoscenza"})
    .fill("Il capitolo è un sogno collocato fuori dalla sequenza cronologica.");
  page.once("dialog",d=>d.accept());
  await timing.getByRole("button",{name:"Registra momento della conoscenza"}).click();
  await expect(timing.locator("> summary")).toContainText("(1 posizioni correnti)");
  await expect(timing.getByText(/Mara · 1 annotazioni correnti/)).toBeVisible();
  await expect(timing.getByText("Non ancora nota nella scena").first()).toBeVisible();
  await expect(timing.getByText("Flashback o ordine narrativo riorganizzato").first())
    .toBeVisible();

  const dbState=await page.evaluate(()=>new Promise<{
    moment:string;order:string;autoSync:boolean;
    text:string;secrets:unknown;consents:unknown;
  }>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const all=req.result.transaction("books","readonly").objectStore("books").getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as {
          narrativeKnowledgeTimingDecisions:Array<{accessMoment:string;narrativeOrder:string}>;
          narrativeKnowledgeShareDecisions?:unknown;remote:{autoSync:boolean};
          chapters:Array<{scenes:Array<{text:string}>}>;memory:{secrets:unknown};
        };
        resolve({
          moment:b.narrativeKnowledgeTimingDecisions[0]!.accessMoment,
          order:b.narrativeKnowledgeTimingDecisions[0]!.narrativeOrder,
          autoSync:b.remote.autoSync,
          text:b.chapters[0]!.scenes[0]!.text,
          secrets:b.memory.secrets,
          consents:b.narrativeKnowledgeShareDecisions??null,
        });
      };
    };
  }));
  expect(dbState).toEqual({
    moment:"not_yet_known",order:"flashback_or_reordered",autoSync:false,
    text:"Mara scopre che Elio nasconde la lettera.",secrets:{},consents:null,
  });
  await page.reload();
  const reopened=page.getByRole("region",{name:"Redazione multi-agente"});
  await reopened.locator("summary").filter({hasText:"Indice eventi candidati"}).first().click();
  const again=reopened.locator('details[aria-label="Registro conoscenze autore"]');
  await again.locator("> summary").click();
  const at=again.locator('details[aria-label="Timeline conoscenze autore"]');
  await expect(at.locator("> summary")).toContainText("(1 posizioni correnti)");
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const tx=req.result.transaction("books","readwrite"),store=tx.objectStore("books"),
        all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as {id:string;chapters:Array<{scenes:Array<{text:string}>}>};
        b.chapters[0]!.scenes[0]!.text+=" Frase successiva.";
        store.put(b,b.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const finalBoard=page.getByRole("region",{name:"Redazione multi-agente"});
  await finalBoard.locator("summary").filter({hasText:"Indice eventi candidati"})
    .first().click();
  const finalKnowledge=finalBoard.locator('details[aria-label="Registro conoscenze autore"]');
  await finalKnowledge.locator("> summary").click();
  const stale=finalKnowledge.locator('details[aria-label="Timeline conoscenze autore"]');
  await expect(stale.locator("> summary")).toContainText("(0 posizioni correnti)");
  await stale.locator("> summary").click();
  await stale.locator('details[aria-label="Storico tempi conoscenza"] > summary')
    .click();
  await expect(stale.getByText(/Non correnti o superate: 1/)).toBeVisible();
  expect(outgoing).toEqual([]);
  const width=await page.evaluate(()=>({
    page:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(width.page).toBeLessThanOrEqual(width.viewport+1);
});
