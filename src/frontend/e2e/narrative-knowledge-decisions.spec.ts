import {expect,test} from "@playwright/test";

test("registro conoscenze autore: conferma, rettifica, storico e invalidazione desktop/mobile",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Il segreto della lettera");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara potrebbe conoscere un segreto soltanto nel suo sogno.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const tx=req.result.transaction("books","readwrite"),store=tx.objectStore("books"),
        all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const book=all.result[0] as Record<string,unknown>;
        book.status="paused";book.phase="completed";
        book.remote={owner:"author",repository:"novel",branch:"main",autoSync:true};
        book.chapters=[{id:"ch-knowledge",number:1,title:"La notizia",
          purpose:"Conoscere un segreto",frozenAt:"2026-11-07T10:00:00.000Z",
          scenes:[{id:"s-knowledge",number:1,title:"Il sogno",objective:"Sapere",
            text:"Mara scopre che Elio nasconde la lettera.",status:"canon"}]}];
        store.put(book,book.id as string);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  await board.locator("summary").filter({hasText:"Indice eventi candidati"}).first().click();
  const requests:string[]=[];
  page.on("request",r=>{
    if(r.url().includes("api.openai.com") || r.url().includes("api.github.com"))
      requests.push(r.url());
  });
  await expect(board.getByText("«Mara scopre che Elio nasconde la lettera»")).toBeVisible();
  await board.getByRole("textbox",{name:/Motivazione evento/})
    .fill("L'autore conferma la menzione letterale, non un sapere certo.");
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Annota come avvenuto"}).click();
  await expect(board.getByText(/Interpretazione attuale: annotato come avvenuto/)).toBeVisible();

  const knowledge=board.locator('details[aria-label="Registro conoscenze autore"]');
  await expect(knowledge.locator("> summary")).toContainText("Conoscenze interpretate dall'autore (0)");
  await knowledge.locator("> summary").click();
  await expect(knowledge.getByLabel("Menzione di conoscenza attestata")).toBeVisible();
  const note=knowledge.getByRole("textbox",{name:"Motivazione conoscenza autore"});
  await note.fill("Mara ha sentito parlare del segreto da un testimone inaffidabile.");
  page.once("dialog",d=>d.accept());
  await knowledge.getByRole("button",{name:"Riferita da altri"}).click();
  await expect(knowledge.getByRole("status")).toContainText("registrata");
  await expect(knowledge.locator("> summary")).toContainText("(1 correnti)");
  await expect(knowledge.getByText(/Riferita da altri · cap. 1/)).toBeVisible();

  await note.fill("La rivelazione avviene in un sogno e Mara non conosce ancora il segreto.");
  page.once("dialog",d=>d.accept());
  await knowledge.getByRole("button",{name:"Ancora segreta per il personaggio"}).click();
  await expect(knowledge.getByText(/Non conosciuta \/ ancora segreta · cap. 1/)).toBeVisible();
  await knowledge.locator('details[aria-label="Storico interpretazioni conoscenze"] > summary')
    .click();
  await expect(knowledge.getByText(/Storico interpretazioni conoscenze \(2\)/)).toBeVisible();
  await expect(knowledge.getByText(/Decisioni non correnti: 1/)).toBeVisible();

  const stored=await page.evaluate(()=>new Promise<{
    choices:string[];autoSync:boolean|undefined;frozen:boolean;
    sceneText:string;memory:unknown;
  }>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const all=req.result.transaction("books","readonly").objectStore("books").getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as {
          narrativeKnowledgeDecisions:Array<{verdict:string}>;
          remote?:{autoSync:boolean};
          chapters:Array<{frozenAt?:string;scenes:Array<{text:string}>}>;
          memory:unknown;
        };
        resolve({choices:b.narrativeKnowledgeDecisions.map(x=>x.verdict),
          autoSync:b.remote?.autoSync,
          frozen:!!b.chapters[0]!.frozenAt,
          sceneText:b.chapters[0]!.scenes[0]!.text,
          memory:b.memory,
        });
      };
    };
  }));
  expect(stored.choices).toEqual(["reported_by_other","still_secret"]);
  expect(stored.autoSync).toBe(false);
  expect(stored.frozen).toBe(true);
  expect(stored.sceneText).toBe("Mara scopre che Elio nasconde la lettera.");
  expect((stored.memory as {secrets:unknown}).secrets).toEqual({});
  await page.reload();
  const reopened=page.getByRole("region",{name:"Redazione multi-agente"});
  await reopened.locator("summary").filter({hasText:"Indice eventi candidati"}).first().click();
  const again=reopened.locator('details[aria-label="Registro conoscenze autore"]');
  await expect(again.locator("> summary")).toContainText("(1 correnti)");
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const tx=req.result.transaction("books","readwrite"),store=tx.objectStore("books"),
        all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as {id:string;chapters:Array<{scenes:Array<{text:string}>}>};
        b.chapters[0]!.scenes[0]!.text+=" Una frase modificata.";
        store.put(b,b.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const after=page.getByRole("region",{name:"Redazione multi-agente"});
  await after.locator("summary").filter({hasText:"Indice eventi candidati"}).first().click();
  const stale=after.locator('details[aria-label="Registro conoscenze autore"]');
  await expect(stale.locator("> summary")).toContainText("(0 correnti)");
  await stale.locator("> summary").click();
  await expect(stale.getByText(/Decisioni non correnti: 2/)).toBeVisible();
  expect(requests).toEqual([]);
  const width=await page.evaluate(()=>
    ({scroll:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport+1);
});
