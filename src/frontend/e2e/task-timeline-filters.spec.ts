import {expect,test,type Page} from "@playwright/test";

type FixtureActivity = {
  id:string;bookId:string;runId:string;phase:string;title:string;reason:string;
  nextStep:string;status:string;createdAt:string;endedAt:string;
  endpointId:string;modelId:string;aiRequested:boolean;
  inputTokens?:number;outputTokens?:number;
  priceRateSnapshot?:{endpointId:string;modelId:string;inputEurPerMillion:number;outputEurPerMillion:number};
  output?:string;
};
async function openStore(page:Page,bookId:string){
  await page.evaluate(async(id)=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const req=indexedDB.open("bookwriter");
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
    const activities:FixtureActivity[]=[
      {id:"task-old",bookId:id,runId:"run-one",phase:"brainstorm",title:"Brainstorming iniziale",
        reason:"Cercare alternative",nextStep:"Validare",status:"succeeded",
        createdAt:"2026-11-12T07:00:00.000Z",endedAt:"2026-11-12T07:01:01.000Z",
        endpointId:"local",modelId:"meta/muse-glimmer",aiRequested:true,
        inputTokens:100,outputTokens:50,
        priceRateSnapshot:{endpointId:"local",modelId:"meta/muse-glimmer",
          inputEurPerMillion:2,outputEurPerMillion:4},
        output:"SEGRETO-DA-NON-USARE-NELLA-RICERCA"},
      {id:"task-middle",bookId:id,runId:"run-one",phase:"prose",title:"Scrittura scena",
        reason:"Scrivere una scena",nextStep:"Controllo",status:"failed",
        createdAt:"2026-11-12T08:00:00.000Z",endedAt:"2026-11-12T08:00:50.000Z",
        endpointId:"local",modelId:"meta/muse-glimmer",aiRequested:true},
      {id:"task-new",bookId:id,runId:"run-three",phase:"revision",title:"Revisione conclusiva",
        reason:"Pulire la trama",nextStep:"Rileggere",status:"cancelled",
        createdAt:"2026-11-12T09:00:00.000Z",endedAt:"2026-11-12T09:00:05.000Z",
        endpointId:"local",modelId:"meta/muse-glimmer",aiRequested:true},
    ];
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(["activities","books"],"readwrite");
      for(const activity of activities)tx.objectStore("activities").put(activity,activity.id);
      const bookRequest=tx.objectStore("books").get(id);
      bookRequest.onsuccess=()=>{
        const book=bookRequest.result as {
          id:string;chapters:Array<unknown>;editorialReviewSceneIds?:string[];
        }|undefined;
        if(!book){tx.abort();return;}
        book.chapters=[{
          id:"chapter-one",number:1,title:"Capitolo uno",purpose:"Introduzione",
          frozenAt:"2026-11-12T08:30:00.000Z",
          scenes:[{id:"scene-one",number:1,title:"Scena canonica",
            objective:"Introduzione",text:"Una scena canonica sintetica.",status:"canon"}],
        }];
        tx.objectStore("books").put(book,id);
      };
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
    db.close();
  },bookId);
}
async function createBook(page:Page,title:string){
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill(title);
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Un libro per bambini con tre capitoli e due scimmie.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  return page.evaluate(async(title)=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const req=indexedDB.open("bookwriter");
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
    const records=await new Promise<Array<{id:string;title:string}>>((resolve,reject)=>{
      const tx=db.transaction("books","readonly");
      const req=tx.objectStore("books").getAll();
      req.onsuccess=()=>resolve(req.result as Array<{id:string;title:string}>);
      req.onerror=()=>reject(req.error);
    });
    db.close();
    return records.find(x=>x.title===title)!.id;
  },title);
}
test("timeline filtrabile e stime parziali verificate, desktop/mobile",async({page})=>{
  await page.goto("/");
  const bookId=await createBook(page,"Il libro dei tre task");
  await openStore(page,bookId);
  await page.reload();
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Dashboard"}).click();
  await expect(page.getByRole("region",{name:"Timeline task AI"})).toBeVisible();
  await page.getByRole("button",{name:"Apri registro completo e filtri"}).click();
  const timeline=page.getByRole("region",{name:"Timeline task AI"});
  const list=timeline.getByRole("list",{name:"Storico task"}).getByRole("listitem");
  await expect(list).toHaveCount(3);
  await expect(list.first()).toContainText("Revisione conclusiva");
  await expect(timeline.getByLabel("Riepilogo dei task")).toContainText("0,0004");
  await expect(timeline.getByLabel("Riepilogo dei task")).toContainText("Completati");
  await timeline.getByRole("combobox",{name:"Filtra stato task"}).selectOption("failed");
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText("Scrittura scena");
  await timeline.getByRole("combobox",{name:"Filtra stato task"}).selectOption("all");
  await timeline.getByRole("combobox",{name:"Filtra fase task"}).selectOption("brainstorm");
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText("Brainstorming iniziale");
  await list.first().locator("details").first()
    .evaluate((element:HTMLDetailsElement)=>{element.open=true;});
  await expect(list.first()).toContainText("1 min 1 s");
  await expect(list.first()).toContainText("0,0004 €");
  await timeline.getByRole("combobox",{name:"Filtra fase task"}).selectOption("");
  await timeline.getByRole("searchbox",{name:"Cerca nei task"}).fill("SEGRETO-DA-NON-USARE");
  await expect(list).toHaveCount(0);
  await expect(timeline.getByText("Nessun task corrisponde ai filtri attivi.")).toBeVisible();
  await timeline.getByRole("button",{name:"Azzera filtri"}).click();
  await timeline.getByRole("combobox",{name:"Ordina task"}).selectOption("oldest");
  await expect(list.first()).toContainText("Brainstorming iniziale");
  await timeline.getByRole("searchbox",{name:"Cerca nei task"}).fill("meta/muse-glimmer");
  await expect(list).toHaveCount(3);
  await timeline.getByRole("checkbox",{name:"Raggruppa task per sessione"}).check();
  const one=timeline.getByRole("group",{name:"Sessione run-one"});
  const three=timeline.getByRole("group",{name:"Sessione run-three"});
  await expect(one).toContainText("2 task");
  await expect(one).toContainText("tentativi incerti");
  await expect(one).toContainText("0,0004");
  await expect(three).toContainText("1 task");
  await expect(list).toHaveCount(3);
  await expect(list.nth(1)).toContainText("Scrittura scena");
  await timeline.getByRole("button",{name:"Azzera filtri"}).click();
  await expect(timeline.getByRole("group",{name:"Sessione run-one"})).toHaveCount(0);

  await list.first().getByRole("button",{name:"Apri scheda task"}).click();
  const focus=timeline.getByRole("region",{name:"Scheda task dedicata"});
  const impact=focus.getByRole("region",{name:"Valutazione preliminare di ripartenza"});
  await focus.getByRole("button",{name:"Carica confronto strutturale"}).click();
  await expect(focus.getByText(/Nessun checkpoint strutturale valido/)).toBeVisible();
  await expect(focus).toContainText("1 di 3");
  await expect(impact).toContainText("Attività registrate con orario successivo: 0");
  await expect(impact).toContainText("1 capitoli congelati");
  await expect(impact).toContainText("1 scene canoniche");
  await expect(impact).toContainText("Non esistono snapshot storiche");
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText("Revisione conclusiva");
  await expect(focus.getByRole("button",{name:"Task precedente"})).toBeDisabled();
  await focus.getByRole("button",{name:"Task successivo"}).click();
  await expect(focus).toContainText("2 di 3");
  await expect(impact).toContainText("Attività registrate con orario successivo: 1");
  await expect(impact).toContainText("Revisione conclusiva");
  await expect(list.first()).toContainText("Scrittura scena");
  await focus.getByRole("button",{name:"Task successivo"}).click();
  await expect(list.first()).toContainText("Brainstorming iniziale");
  await expect(impact).toContainText("Attività registrate con orario successivo: 2");
  await expect(impact).toContainText("Scrittura scena");
  await expect(impact).toContainText("Revisione conclusiva");
  await expect(focus.getByRole("button",{name:"Task successivo"})).toBeDisabled();
  await focus.getByRole("button",{name:"Torna al registro dei task"}).click();
  await expect(focus).toHaveCount(0);
  await expect(impact).toHaveCount(0);
  await expect(list).toHaveCount(3);
});

test("checkpoint strutturale salvato insieme al task: confronto locale e nessun replay, desktop/mobile",async({page})=>{
  await page.goto("/");
  const bookId=await createBook(page,"Libro con checkpoint strutturale");
  await page.evaluate(async(id)=>{
    const {getBook,saveBookAndActivity}=await import("/src/infrastructure/db.ts");
    const original=await getBook(id);
    if(!original)throw Error("Libro non trovato");
    const updated=structuredClone(original);
    updated.status="paused";updated.phase="prose";
    updated.chapters=[{id:"chapter-struct",number:1,title:"Capitolo sintetico",
      purpose:"Mostrare il test",frozenAt:"2026-11-12T11:00:00.000Z",
      scenes:[{id:"scene-struct",number:1,title:"Scena sintetica",
        objective:"Controllare",text:"PROSA_CANONICA_NON_DA_ESPORRE_NEL_CHECKPOINT",
        status:"canon"}]}];
    await saveBookAndActivity(updated,{
      id:"completed-struct-"+id,bookId:id,runId:"session-test",
      phase:"prose",title:"Scrittura con checkpoint",reason:"Completamento task",
      nextStep:"Revisione",status:"succeeded",
      createdAt:"2026-11-12T10:00:00.000Z",endedAt:"2026-11-12T10:00:05.000Z",
      output:"OUTPUT_PRIVATO_NON_IN_CHECKPOINT",
    },original.updatedAt);
  },bookId);
  await page.reload();
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Attività"}).click();
  const timeline=page.getByRole("region",{name:"Timeline task AI"});
  await timeline.getByRole("button",{name:"Apri scheda task"}).click();
  const panel=timeline.getByRole("region",{name:"Scheda task dedicata"});
  const section=panel.getByRole("region",{name:"Confronto strutturale salvato"});
  await section.getByRole("button",{name:"Carica confronto strutturale"}).click();
  await expect(section.getByLabel("Differenze strutturali registrate"))
    .toContainText("Capitoli: 0 prima, 1 dopo");
  await expect(section.getByLabel("Differenze strutturali registrate"))
    .toContainText("1 aggiunte");
  await expect(section.getByLabel("Differenze strutturali registrate"))
    .toContainText("Anche con zero differenze strutturali");
  await expect(section).not.toContainText("PROSA_CANONICA_NON_DA_ESPORRE");
  await expect(section).not.toContainText("OUTPUT_PRIVATO_NON_IN_CHECKPOINT");
  await panel.getByRole("button",{name:"Torna al registro dei task"}).click();
  await expect(section).toHaveCount(0);
  const saved=await page.evaluate(async(id)=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const req=indexedDB.open("bookwriter");
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    const book=await new Promise<{phase:string}>((resolve,reject)=>{
      const tx=db.transaction("books","readonly");
      const req=tx.objectStore("books").get(id);
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    db.close();
    return book.phase;
  },bookId);
  expect(saved).toBe("prose");
});

test("copie canoniche opt-in: confronto esatto e revoca locale, desktop/mobile",async({page})=>{
  await page.goto("/");
  const bookId=await createBook(page,"Libro con copie canoniche consensuali");
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Attività"}).click();
  const timeline=page.getByRole("region",{name:"Timeline task AI"});
  const consent=timeline.getByRole("region",{name:"Consenso copie testuali per il rewind"});
  await expect(consent).toContainText("Stato per questo libro: disattivato");
  await consent.getByRole("button",{name:"Attiva copie testuali locali per questo libro"}).click();
  await expect(consent).toContainText("Stato per questo libro: attivo");
  await page.evaluate(async(id)=>{
    const {getBook,saveBook,saveBookAndActivity}=await import("/src/infrastructure/db.ts");
    const initial=await getBook(id);
    if(!initial)throw Error("Libro mancante");
    const withCanon=structuredClone(initial);
    withCanon.chapters=[{id:"chapter-optin",number:1,title:"Soggetto sintetico",
      purpose:"Scena",scenes:[{id:"scene-optin",number:1,
        title:"Scena",objective:"Raccontare",status:"canon",
        text:"PROSA_ANTE_OPERAZIONE_PRIVATA"}]}];
    await saveBook(withCanon,false,initial.updatedAt);
    const before=await getBook(id);
    if(!before)throw Error("Libro non salvato");
    const after=structuredClone(before);
    after.chapters[0].scenes[0].text="PROSA_DOPO_OPERAZIONE_PRIVATA";
    await saveBookAndActivity(after,{
      id:"task-optin-"+id,bookId:id,runId:"session-optin",
      phase:"prose",title:"Task con prosa consentita",reason:"Scrivi",
      nextStep:"Verifica",status:"succeeded",
      createdAt:"2026-11-12T10:00:00.000Z",
      endedAt:"2026-11-12T10:00:05.000Z",
      output:"OUTPUT_AI_PRIVATO_NON_COPIATO",
    },before.updatedAt);
  },bookId);
  await page.reload();
  await nav.getByRole("button",{name:"Attività"}).click();
  await expect(consent).toContainText("Stato per questo libro: attivo");
  await timeline.getByRole("button",{name:"Apri scheda task"}).click();
  const focus=timeline.getByRole("region",{name:"Scheda task dedicata"});
  const prose=focus.getByRole("region",{name:"Confronto prosa canonica locale"});
  await prose.getByRole("button",{name:"Carica confronto della prosa canonica"}).click();
  const diff=prose.getByLabel("Differenze della prosa canonica");
  await expect(diff).toContainText("Scene canoniche: 1 prima, 1 dopo");
  await expect(diff).toContainText("1 con testo modificato");
  await expect(prose).not.toContainText("PROSA_ANTE_OPERAZIONE_PRIVATA");
  await expect(prose).not.toContainText("PROSA_DOPO_OPERAZIONE_PRIVATA");
  await focus.getByRole("button",{name:"Torna al registro dei task"}).click();
  await consent.getByRole("button",{
    name:"Revoca consenso ed elimina tutte le copie testuali del libro",
  }).click();
  await expect(consent).toContainText("Stato per questo libro: disattivato");
  await timeline.getByRole("button",{name:"Apri scheda task"}).click();
  await expect(prose.getByRole("button",{
    name:"Carica confronto della prosa canonica",
  })).toBeDisabled();
  const local=await page.evaluate(async(id)=>{
    const {getDb}=await import("/src/infrastructure/db.ts");
    const db=await getDb();
    return {
      prose:await db.get("meta","task-prose:v1:"+id+":task-optin-"+id),
      structural:await db.get("meta","task-structure:v1:task-optin-"+id),
      book:await db.get("books",id),
    };
  },bookId);
  expect(local.prose).toBeUndefined();
  expect(local.structural).toBeDefined();
  expect(local.book.chapters[0].scenes[0].text).toBe("PROSA_DOPO_OPERAZIONE_PRIVATA");
});

test("traccia opt-in non rimane visibile cambiando libro",async({page})=>{
  await page.goto("/");
  const bookA=await createBook(page,"Libro A privato");
  // The new-book form is hidden while an existing book is selected.
  await page.getByRole("combobox",{name:"Libro attivo"}).selectOption("");
  const bookB=await createBook(page,"Libro B pubblico");
  await page.getByRole("combobox",{name:"Libro attivo"}).selectOption(bookA);
  await page.evaluate(async({id})=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const req=indexedDB.open("bookwriter");
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(["activities","meta"],"readwrite");
      tx.objectStore("activities").put({
        id:"sensitive-activity",bookId:id,runId:"sensitive-run",
        title:"Task riservato",reason:"Verifica",nextStep:"Conclusione",
        phase:"brainstorm",status:"succeeded",createdAt:"2026-11-12T09:00:00.000Z",
        endedAt:"2026-11-12T09:00:02.000Z",
      },"sensitive-activity");
      tx.objectStore("meta").put({
        activityId:"sensitive-activity",bookId:id,createdAt:"2026-11-12T09:00:00.000Z",
        endpointId:"local",modelId:"muse",systemPrompt:"SEGRETO_SYSTEM_LIBRO_A",
        userPrompt:"SEGRETO_USER_LIBRO_A",response:"Risposta privata",truncated:false,
      },"ai-trace:sensitive-activity");
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
    db.close();
  },{id:bookA});
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await page.getByRole("checkbox",{name:/Ispezione locale richieste AI/}).check();
  await nav.getByRole("button",{name:"Attività"}).click();
  const list=page.getByRole("list",{name:"Storico task"}).getByRole("listitem");
  await expect(list).toHaveCount(1);
  await list.first().locator("details").first()
    .evaluate((element:HTMLDetailsElement)=>{element.open=true;});
  await list.first().getByRole("button",{name:"Ispeziona richiesta e risposta"}).click();
  await expect(list.first().getByText("Messaggio system inviato")).toBeVisible();
  await list.first().getByText("Messaggio system inviato").click();
  await expect(list.first()).toContainText("SEGRETO_SYSTEM_LIBRO_A");
  await list.first().getByRole("button",{name:"Apri scheda task"}).click();
  await expect(page.getByRole("region",{name:"Scheda task dedicata"})).toBeVisible();
  // Focus changes revoke the previously loaded private trace: no automatic read.
  await expect(page.getByText("SEGRETO_SYSTEM_LIBRO_A")).toHaveCount(0);
  await list.first().getByRole("button",{name:"Ispeziona richiesta e risposta"}).click();
  await list.first().getByText("Messaggio system inviato").click();
  await expect(list.first()).toContainText("SEGRETO_SYSTEM_LIBRO_A");
  await page.getByRole("combobox",{name:"Libro attivo"}).selectOption(bookB);
  await expect(page.getByRole("list",{name:"Storico task"}).getByRole("listitem")).toHaveCount(0);
  await expect(page.getByText("SEGRETO_SYSTEM_LIBRO_A")).toHaveCount(0);
});
