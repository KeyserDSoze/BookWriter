import {expect,test} from "@playwright/test";

test("aggiornare la provenienza storica rivalida i capitoli successivi senza inviare prosa",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("La cronaca");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Un messaggio storico altera le interpretazioni della storia.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books"),all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const book=all.result[0] as Record<string,unknown>;
        const at="2026-11-06T12:00:00.000Z";
        const sources=[42,43].map(pageId=>({
          id:"itwiki:"+pageId+":210",provider:"it.wikipedia.org",
          pageId,revisionId:210,title:"Telegrafo "+pageId,
          url:"https://it.wikipedia.org/wiki/Telegrafo",
          query:"Telegrafo elettrico nel 1848",retrievedAt:at,
          excerpt:"Un resoconto descrive l'uso del telegrafo nel secolo XIX.",
        }));
        book.status="paused";book.phase="completed";book.bookSummary="Mara invia la lettera e prosegue.";
        book.chapters=[1,2].map(number=>({
          id:"ch-"+number,number,title:"Capitolo "+number,purpose:"Una scoperta",
          frozenAt:at,summary:"Sinossi pubblica "+number,
          bookSummaryAtFreeze:"Sintesi cumulativa "+number,
          scenes:[{id:"s-"+number,number:1,title:"Il dispaccio",objective:"Trasmettere",
            text:number===1?"Mara invia un messaggio attraverso il telegrafo.":"Mara porta la risposta al castello.",
            status:"canon",characters:["Mara"]}],
          ...(number===1?{historicalDossier:{
            queries:["Telegrafo elettrico nel 1848"],sources,
            activeSourceIds:sources.map(s=>s.id),
            searchedAt:at,unansweredQueries:[],
          }}:{}),
        }));
        store.put(book,book.id as string);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const panel=page.getByRole("region",{name:"Redazione multi-agente"});
  await panel.locator("summary").filter({hasText:"Provenienza e dipendenze fra fonti"}).first().click();
  await panel.getByRole("combobox",{name:"Prima fonte relazione capitolo 1"})
    .selectOption("itwiki:42:210");
  await panel.getByRole("combobox",{name:"Seconda fonte relazione capitolo 1"})
    .selectOption("itwiki:43:210");
  await panel.getByRole("combobox",{name:"Tipo relazione capitolo 1"}).selectOption("derived");
  await panel.getByRole("textbox",{name:"Motivazione relazione capitolo 1"})
    .fill("Dopo il confronto, questa pagina riprende il contenuto documentale della precedente.");
  const outbound:string[]=[];
  page.on("request",r=>{
    if(["it.wikipedia.org","it.wikisource.org","www.loc.gov","api.openai.com"]
      .some(host=>r.url().includes(host)))outbound.push(r.url());
  });
  page.once("dialog",dialog=>{
    expect(dialog.message()).toContain("DICHIARAZIONE LOCALE DI PROVENIENZA");
    return dialog.accept();
  });
  await panel.getByRole("button",{name:"Registra relazione di provenienza"}).click();
  await expect(panel.getByText(/Dichiarazione salvata. Capitolo e successivi riaperti/))
    .toBeVisible();
  await expect(panel.locator('[aria-label="Rivalidazione capitolo 2"]'))
    .toContainText("dossier storico modificato nel capitolo 1");
  const saved=await page.evaluate(()=>new Promise<{
    frozen:boolean[],origin:string|null,trigger:string|null,scenes:number,stage:string|null,
  }>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const q=open.result.transaction("books","readonly").objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          chapters:Array<{frozenAt?:string;scenes:unknown[];
            continuityRecheck?:{originChapterId:string;trigger:string}}>;
          editorialCycle?:{stage:string};
        };
        resolve({frozen:b.chapters.map(x=>!!x.frozenAt),
          origin:b.chapters[1]?.continuityRecheck?.originChapterId??null,
          trigger:b.chapters[1]?.continuityRecheck?.trigger??null,
          scenes:b.chapters[1]?.scenes.length??0,stage:b.editorialCycle?.stage??null});
      };
    };
  }));
  expect(saved).toEqual({
    frozen:[false,false],origin:"ch-1",trigger:"historical_evidence",scenes:1,stage:"review",
  });
  expect(outbound).toEqual([]);
  const bounds=await page.evaluate(()=>({
    content:document.documentElement.scrollWidth,viewport:innerWidth,
  }));
  expect(bounds.content).toBeLessThanOrEqual(bounds.viewport+1);
});
