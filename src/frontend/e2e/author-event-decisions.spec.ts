import {expect,test} from "@playwright/test";

test("autore conferma menzione congelata, mantiene la fonte e rivalida i capitoli successivi",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Le chiavi di Mara");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara consegna una chiave e la storia continua al castello.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const book=all.result[0] as Record<string,unknown>;
        const at="2026-11-06T12:00:00.000Z";
        book.status="completed";book.phase="completed";
        book.bookSummary="Mara consegna la chiave; Elio cerca di aprire la porta.";
        book.memory={
          characters:{},locations:{},factions:{},items:{},
          secrets:{lettera:"PRIVATO: nessun altro deve leggere questo segreto."},
          timeline:[],currentState:"",
        };
        book.chapters=[1,2].map(number=>({
          id:"ch-"+number,number,title:"Capitolo "+number,purpose:"Trama",
          frozenAt:at,summary:"Sinossi del capitolo "+number,
          bookSummaryAtFreeze:"Sinossi fino al capitolo "+number,
          scenes:[{id:"s-"+number,number:1,title:"La chiave",objective:"Avanzare",
            status:"canon",characters:["Mara","Elio"],items:["chiave"],
            text:number===1?"Mara consegna la chiave a Elio."
              :"Elio cerca la chiave per aprire la porta."}],
        }));
        store.put(book,book.id as string);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const panel=page.getByRole("region",{name:"Redazione multi-agente"});
  await panel.locator("summary").filter({hasText:"Indice eventi candidati"}).click();
  const item=panel.locator("li").filter({hasText:"«Mara consegna la chiave a Elio»"}).first();
  await expect(item).toContainText("Decisione autore: Non valutato");
  await item.locator("summary").filter({hasText:"Decisione autore"}).click();
  await item.getByRole("textbox",{name:"Motivazione evento capitolo 1 scena 1 offset 0"})
    .fill("Confermo come autore: la consegna è avvenuta realmente davanti al guardiano.");
  const external:string[]=[];
  page.on("request",request=>{
    if(["api.openai.com","it.wikipedia.org","www.loc.gov"].some(s=>request.url().includes(s)))
      external.push(request.url());
  });
  page.once("dialog",async dialog=>{
    expect(dialog.message()).toContain("DECISIONE ESPLICITA DELL'AUTORE SULLA TRAMA");
    expect(dialog.message()).toContain("Mara consegna la chiave a Elio");
    expect(dialog.message()).not.toContain("PRIVATO:");
    await dialog.accept();
  });
  await item.getByRole("button",{name:"Conferma fatto narrativo"}).click();
  await expect(panel.getByText(/Decisione autore registrata/)).toBeVisible();
  await expect(panel.locator('[aria-label="Rivalidazione capitolo 2"]'))
    .toContainText("modifica a monte nel capitolo 1");
  await expect(item).toContainText("Confermato dall'autore");
  const saved=await page.evaluate(()=>new Promise<{
    frozen:boolean[];verdict:string|null;count:number;
    trigger:string|null;cycle:string|null;status:string;remote:boolean|undefined;
  }>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const q=open.result.transaction("books","readonly").objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          chapters:Array<{frozenAt?:string;authorEventDecisions?:Array<{verdict:string}>;
            continuityRecheck?:{trigger:string}}>;
          editorialCycle?:{chapterId:string};status:string;remote?:{autoSync?:boolean};
        };
        resolve({frozen:b.chapters.map(ch=>!!ch.frozenAt),
          verdict:b.chapters[0]?.authorEventDecisions?.[0]?.verdict??null,
          count:b.chapters[0]?.authorEventDecisions?.length??0,
          trigger:b.chapters[1]?.continuityRecheck?.trigger??null,
          cycle:b.editorialCycle?.chapterId??null,status:b.status,
          remote:b.remote?.autoSync});
      };
    };
  }));
  expect(saved).toEqual({
    frozen:[true,false],verdict:"confirmed",count:1,
    trigger:"author_event_attestation",cycle:"ch-2",status:"paused",remote:undefined,
  });
  expect(external).toEqual([]);
  const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
  expect(width.scroll).toBeLessThanOrEqual(width.width+1);
});
