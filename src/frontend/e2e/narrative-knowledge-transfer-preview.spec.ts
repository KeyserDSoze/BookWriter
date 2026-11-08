import {expect,test} from "@playwright/test";

test("anteprima locale esplicita fra due conoscenze; niente prova né AI desktop/mobile",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("La notizia condivisa");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Elio racconta una notizia a Mara, ma il narratore potrebbe mentire.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open("bookwriter");
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const tx=request.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const book=all.result[0] as Record<string,unknown>;
        book.status="paused";book.phase="completed";
        book.chapters=[
          {id:"c1",number:1,title:"Elio",purpose:"Conoscenza",
            frozenAt:"2026-11-08T08:00:00.000Z",
            scenes:[{id:"s1",number:1,title:"Elio",objective:"Conoscere",
              text:"Elio scopre che la lettera è falsa.",status:"canon"}]},
          {id:"c2",number:2,title:"Dialogo",purpose:"Possibile racconto",
            frozenAt:"2026-11-08T09:00:00.000Z",
            scenes:[{id:"s2",number:1,title:"Rivelazione",objective:"Raccontare",
              text:"Nina rivela a Mara che la lettera è falsa. "+
                "Elio rivela a Mara che la lettera è falsa.",status:"canon"}]},
          {id:"c3",number:3,title:"Mara",purpose:"Conoscenza",
            frozenAt:"2026-11-08T10:00:00.000Z",
            scenes:[{id:"s3",number:1,title:"Mara",objective:"Conoscere",
              text:"Mara apprende che la lettera è falsa.",status:"canon"}]},
        ];
        store.put(book,book.id as string);
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
  for(const quote of ["Elio scopre che la lettera è falsa",
    "Mara apprende che la lettera è falsa"]){
    const item=board.getByText("«"+quote+"»",{exact:true}).first().locator("..");
    await item.getByRole("textbox",{name:/Motivazione evento/})
      .fill("L'autore conferma la menzione senza certificare il suo significato.");
    page.once("dialog",dialog=>dialog.accept());
    await item.getByRole("button",{name:"Annota come avvenuto"}).click();
    await expect(item.getByText(/Interpretazione attuale: annotato come avvenuto/))
      .toBeVisible();
  }
  const knowledge=board.locator('details[aria-label="Registro conoscenze autore"]');
  await knowledge.locator("> summary").click();
  const source=knowledge.getByRole("combobox",{name:"Menzione di conoscenza attestata"});
  const motivation=knowledge.getByRole("textbox",{name:"Motivazione conoscenza autore"});
  for(let i=0;i<2;i++){
    await source.selectOption({index:i});
    await motivation.fill("L'autore nota una possibile conoscenza, non una verità del canone.");
    page.once("dialog",dialog=>dialog.accept());
    await knowledge.getByRole("button",{name:"Riferita da altri"}).click();
    await expect(knowledge.locator("> summary")).toContainText("("+(i+1)+" correnti)");
  }
  const topics=knowledge.locator('details[aria-label="Relazioni conoscenze autore"]');
  await topics.locator("> summary").click();
  const comparison=topics.getByRole("group",{name:"Confronta due conoscenze"});
  await comparison.getByRole("textbox",{name:"Motivazione relazione conoscenze"})
    .fill("La notizia sulla lettera pare uguale, ma non prova un vero messaggio.");
  page.once("dialog",dialog=>dialog.accept());
  await comparison.getByRole("button",{name:"Conferma stessa informazione"}).click();
  const pairs=topics.getByLabel("Confronti correnti fra personaggi");
  await expect(pairs.getByRole("button",{name:"Esamina piste possibili"})).toHaveCount(1);
  const preview=topics.getByRole("region",{name:"Piste comunicative della coppia"});
  await expect(preview).toHaveCount(0);
  await pairs.getByRole("button",{name:"Esamina piste possibili"}).click();
  await expect(preview).toBeVisible();
  await expect(preview.getByText("Elio rivela a Mara che la lettera è falsa",
    {exact:false})).toBeVisible();
  await expect(preview.getByText(/Nessuna frase candidata trovata/)).toBeVisible();
  await expect(preview.getByText(/non è una prova di.*assenza di comunicazione/))
    .toBeVisible();
  await expect(preview.getByText(/Scene esaminate:/)).toHaveCount(2);
  await expect(preview.getByText(/Nina rivela/)).toHaveCount(0);
  await pairs.getByRole("button",{name:"Chiudi piste possibili"}).click();
  await expect(preview).toHaveCount(0);
  await comparison.getByRole("textbox",{name:"Motivazione relazione conoscenze"})
    .fill("Rettifica dell'autore: non sono la stessa informazione.");
  page.once("dialog",dialog=>dialog.accept());
  await comparison.getByRole("button",{name:"Conferma informazioni differenti"}).click();
  await expect(pairs.getByRole("button",{name:"Esamina piste possibili"})).toHaveCount(0);
  await expect(preview).toHaveCount(0);
  await page.reload();
  const again=page.getByRole("region",{name:"Redazione multi-agente"});
  await again.locator("summary").filter({hasText:"Indice eventi candidati"}).first().click();
  const k=again.locator('details[aria-label="Registro conoscenze autore"]');
  await k.locator("> summary").click();
  const p=k.locator('details[aria-label="Relazioni conoscenze autore"]');
  await p.locator("> summary").click();
  await expect(p.getByRole("region",{name:"Piste comunicative della coppia"}))
    .toHaveCount(0);
  expect(outgoing).toEqual([]);
  const dimensions=await page.evaluate(()=>
    ({width:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport+1);
});
