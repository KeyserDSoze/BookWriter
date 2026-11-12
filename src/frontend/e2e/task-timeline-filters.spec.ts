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
  await expect(impact).toContainText("le versioni testuali canoniche esistono solo con opt-in locale");
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

test("copia sicurezza del solo libro: ZIP scaricato e riletto con SHA-256, desktop/mobile",async({page})=>{
  await page.goto("/");
  const bookA=await createBook(page,"Libro A sicurezza prima rewind");
  const bookB=await page.evaluate(async()=>{
    const {newBook}=await import("/src/domain/types.ts");
    const {saveBook}=await import("/src/infrastructure/db.ts");
    const other=newBook("Brief secondo libro","Libro B non esportare","Narrativo","Adulti");
    await saveBook(other,false);
    return other.id;
  });
  await page.reload();
  await page.getByRole("combobox",{name:"Libro attivo"}).selectOption(bookA);
  await page.evaluate(async(id)=>{
    const {getBook,saveBookAndActivity}=await import("/src/infrastructure/db.ts");
    const old=await getBook(id);
    if(!old)throw Error("Libro selezionato non trovato");
    const now=structuredClone(old);
    now.chapters=[{id:"safe-ch",number:1,title:"Titolo privato",purpose:"Narrativa",
      scenes:[{id:"safe-sc",number:1,title:"Scena",objective:"Continuare",
        text:"MANOSCRITTO_PRIVATO_COPIA_DI_SICUREZZA",status:"canon"}]}];
    await saveBookAndActivity(now,{
      id:"safe-task-"+id,bookId:id,runId:"safety-session",
      phase:"prose",title:"Task di riferimento sicurezza",
      reason:"Ripartenza futura",nextStep:"Valuta",
      status:"succeeded",createdAt:"2026-11-12T10:00:00Z",
      output:"OUTPUT_PRIVATO_ARCHIVIO",
    },old.updatedAt);
  },bookA);
  await page.reload();
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Attività"}).click();
  const timeline=page.getByRole("region",{name:"Timeline task AI"});
  await timeline.getByRole("button",{name:"Apri scheda task"}).click();
  const focus=timeline.getByRole("region",{name:"Scheda task dedicata"});
  const panel=focus.getByRole("region",{name:"Copia di sicurezza prima del rewind"});
  await expect(panel).toContainText("solo libro selezionato nello stato attuale");
  await expect(panel).toContainText("non contiene password, API key");
  const trigger=panel.getByRole("button",{
    name:"Genera e scarica ZIP di sicurezza del libro corrente",
  });
  const [download]=await Promise.all([page.waitForEvent("download"),trigger.click()]);
  expect(download.suggestedFilename()).toMatch(/^bookwriter-sicurezza-.*\.zip$/);
  const evidence=panel.getByLabel("Dati della copia di sicurezza");
  await expect(evidence).toContainText("Attività: 1");
  await expect(evidence).toContainText("bozze di fusione: 0");
  await expect(evidence.getByText(/^[a-f0-9]{64}$/)).toBeVisible();
  await expect(panel.getByLabel("Stato verifica file scaricato"))
    .toContainText("non ancora verificato");
  const savedPath=await download.path();
  expect(savedPath).not.toBeNull();
  await panel.getByLabel("Verifica ZIP scaricato").setInputFiles(savedPath!);
  await expect(panel.getByLabel("Stato verifica file scaricato"))
    .toContainText("File scaricato verificato");
  await expect(panel.getByRole("status")).toContainText("SHA-256");
  const fork=panel.getByRole("region",{name:"Fork locale supervisionato"});
  const prepare=fork.getByRole("button",{name:"Prepara fork locale da ZIP verificato"});
  await expect(prepare).toBeVisible();
  // No implicit fork: downloading and verifying do not create another book.
  const beforeFork=await page.evaluate(async()=>{
    const {listBooks}=await import("/src/infrastructure/db.ts");
    return (await listBooks()).length;
  });
  expect(beforeFork).toBe(2);
  await prepare.click();
  await expect(fork).toContainText("non la destinazione temporale");
  await fork.getByRole("button",{name:"Annulla fork locale"}).click();
  await expect(fork.getByRole("button",{name:"Conferma creazione fork locale separato"}))
    .toHaveCount(0);
  expect(await page.evaluate(async()=>{
    const {listBooks}=await import("/src/infrastructure/db.ts");
    return (await listBooks()).length;
  })).toBe(2);
  await prepare.click();
  await fork.getByRole("button",{name:"Conferma creazione fork locale separato"}).click();
  await expect(page.getByRole("status")
    .filter({hasText:"Fork locale separato creato"})).toBeVisible();
  const selectedForkId=await page.getByRole("combobox",{name:"Libro attivo"})
    .inputValue();
  expect(selectedForkId).not.toBe(bookA);
  expect(selectedForkId).not.toBe(bookB);
  const books=await page.evaluate(async()=>{
    const {listBooks}=await import("/src/infrastructure/db.ts");
    return listBooks();
  });
  expect(books).toHaveLength(3);
  const newFork=books.find(x=>x.id===selectedForkId);
  expect(newFork?.title).toContain("(fork locale)");
  expect(newFork?.status).toBe("paused");
  expect(newFork?.remote).toBeUndefined();
  expect(newFork?.chapters[0]?.scenes[0]?.text)
    .toBe("MANOSCRITTO_PRIVATO_COPIA_DI_SICUREZZA");
  expect(books.find(x=>x.id===bookA)?.chapters[0]?.scenes[0]?.text)
    .toBe("MANOSCRITTO_PRIVATO_COPIA_DI_SICUREZZA");
  expect(books.find(x=>x.id===bookB)?.chapters).toHaveLength(0);
  await page.getByRole("combobox",{name:"Libro attivo"}).selectOption(bookB);
  await expect(panel).toHaveCount(0);
  await expect(page.getByText(/File scaricato verificato/)).toHaveCount(0);
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

test("checkpoint narrativo integrale opt-in: capture locale, metadati e revoca, desktop/mobile",async({page})=>{
  await page.goto("/");
  const bookId=await createBook(page,"Libro checkpoint narrativo privato");
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Attività"}).click();
  const panel=page.getByRole("region",{name:"Checkpoint narrativi integrali per rewind"});
  await expect(panel).toContainText("Stato consenso integrale: disattivato");
  await expect(panel).toContainText("32.00 MiB");
  await expect(panel).toContainText("128.00 MiB");
  await panel.getByRole("button",{
    name:"Attiva checkpoint narrativi integrali per questo libro",
  }).click();
  await expect(panel).toContainText("Stato consenso integrale: attivo");
  await page.evaluate(async id=>{
    const {getBook,saveBook,saveBookAndActivity}=await import("/src/infrastructure/db.ts");
    const current=await getBook(id);
    if(!current)throw Error("Libro mancante");
    const prepared=structuredClone(current);
    prepared.memory.secrets["rivelazione"]="SEGRETO_INTEGRALE_MEMORIA_PRIVATA";
    prepared.chapters=[{id:"chapter-full",number:1,title:"Capitolo",
      purpose:"Trama",frozenAt:"2026-11-12T10:00:00.000Z",
      scenes:[{id:"canon-full",number:1,title:"Scena",
        objective:"Continuità",text:"TESTO_PRIVATO_CANON_PRE",status:"canon"},
      {id:"draft-full",number:2,title:"Bozza",objective:"Alternativa",
        text:"TESTO_PRIVATO_DRAFT_PRE",status:"draft"}]}];
    await saveBook(prepared,false,current.updatedAt);
    const before=await getBook(id);
    if(!before)throw Error("Nessuna revisione");
    const after=structuredClone(before);
    after.chapters[0].scenes[0].text="TESTO_PRIVATO_CANON_POST";
    after.chapters[0].scenes[1].text="TESTO_PRIVATO_DRAFT_POST";
    after.chapters[0].frozenAt=undefined;
    after.memory.secrets["rivelazione"]="SEGRETO_INTEGRALE_POST";
    await saveBookAndActivity(after,{
      id:"task-book-snap-"+id,bookId:id,runId:"run",
      phase:"prose",status:"succeeded",title:"Scrittura snapshot completa",
      reason:"Test",nextStep:"Rilettura",createdAt:"2026-11-12T11:00:00.000Z",
      output:"OUTPUT_AI_PRIVATO_NO_SNAPSHOT",
    },before.updatedAt);
  },bookId);
  await page.reload();
  await nav.getByRole("button",{name:"Attività"}).click();
  await expect(panel).toContainText("Stato consenso integrale: attivo");
  await panel.getByRole("button",{name:"Aggiorna spazio checkpoint narrativi"}).click();
  await expect(panel.getByLabel("Inventario checkpoint narrativi"))
    .toContainText("Coppie conservate: 1");
  const timeline=page.getByRole("region",{name:"Timeline task AI"});
  await timeline.getByRole("button",{name:"Apri scheda task"}).click();
  await panel.getByRole("button",{
    name:"Verifica checkpoint narrativo integrale del task",
  }).click();
  const summary=panel.getByRole("region",{
    name:"Metadati checkpoint narrativo integrale",
  });
  await expect(summary).toContainText("Checkpoint integrale locale presente");
  await expect(summary).toContainText("Scene (incluse bozze): 2 prima, 2 dopo");
  await expect(summary).toContainText("Capitoli congelati: 1 prima, 0 dopo");
  const impactButton=panel.getByRole("button",{
    name:"Analizza differenze narrative storiche",
  });
  const impact=panel.getByRole("region",{name:"Anteprima impatto narrativo storico"});
  await expect(impact).toHaveCount(0);
  await impactButton.click();
  await expect(impact).toContainText("Differenze storiche del task");
  await expect(impact).toContainText("Capitoli aggiunti: 0; rimossi: 0; modificati: 1");
  await expect(impact).toContainText("Scene (anche bozze) aggiunte: 0; rimosse: 0; modificate: 2");
  await expect(impact).toContainText("Freeze aggiunti: 0; rimossi: 1");
  await expect(impact).toContainText("memoria cambiata: sì");
  await expect(impact).toContainText("Capitoli correnti candidati a revisione: 1");
  await expect(impact).toContainText("non un grafo");
  for(const secret of ["SEGRETO_INTEGRALE","TESTO_PRIVATO",
    "OUTPUT_AI_PRIVATO_NO_SNAPSHOT"])
    await expect(panel).not.toContainText(secret);
  await panel.getByRole("button",{
    name:"Richiedi revoca checkpoint narrativi integrali",
  }).click();
  await expect(panel.getByLabel("Conferma revoca checkpoint narrativi"))
    .toContainText("Confermi?");
  await panel.getByRole("button",{
    name:"Annulla revoca integrale",
  }).click();
  await expect(summary).toBeVisible();
  await panel.getByRole("button",{
    name:"Richiedi revoca checkpoint narrativi integrali",
  }).click();
  await panel.getByRole("button",{
    name:"Conferma revoca ed elimina checkpoint integrali",
  }).click();
  await expect(panel).toContainText("Stato consenso integrale: disattivato");
  await expect(summary).toHaveCount(0);
  await expect(impact).toHaveCount(0);
  const persisted=await page.evaluate(async(id)=>{
    const {getDb,getBook}=await import("/src/infrastructure/db.ts");
    const db=await getDb();
    const taskId="task-book-snap-"+id;
    return {
      snapshot:await db.get("meta","task-book:v1:"+id+":"+taskId),
      structural:await db.get("meta","task-structure:v1:"+taskId),
      activity:await db.get("activities",taskId),
      text:(await getBook(id))?.chapters[0]?.scenes[0]?.text,
    };
  },bookId);
  expect(persisted.snapshot).toBeUndefined();
  expect(persisted.structural).toBeDefined();
  expect(persisted.activity).toBeDefined();
  expect(persisted.text).toBe("TESTO_PRIVATO_CANON_POST");
});

test("analisi narrativa: cambio task e libro nasconde i metadati storici, desktop/mobile",async({page})=>{
  await page.goto("/");
  const bookA=await createBook(page,"Storico differenze per task");
  const bookB=await page.evaluate(async()=>{
    const {newBook}=await import("/src/domain/types.ts");
    const {saveBook}=await import("/src/infrastructure/db.ts");
    const book=newBook("Altro libro sintetico","Altro libro","Narrativo","Adulti");
    await saveBook(book,false);
    return book.id;
  });
  await page.reload();
  await page.getByRole("combobox",{name:"Libro attivo"}).selectOption(bookA);
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Attività"}).click();
  const panel=page.getByRole("region",{name:"Checkpoint narrativi integrali per rewind"});
  await panel.getByRole("button",{
    name:"Attiva checkpoint narrativi integrali per questo libro",
  }).click();
  await expect(panel).toContainText("Stato consenso integrale: attivo");
  await page.evaluate(async id=>{
    const {getBook,saveBook,saveBookAndActivity}=await import("/src/infrastructure/db.ts");
    const original=await getBook(id);
    if(!original)throw Error("Libro iniziale mancante");
    const prepared=structuredClone(original);
    prepared.chapters=[{id:"chapter-history",number:1,title:"Prima",
      purpose:"Test",scenes:[{id:"scene-history",number:1,title:"Scena",
        objective:"Confronto",status:"draft",text:"TESTO_STORICO_SEGRETO_PRIMA"}]}];
    await saveBook(prepared,false,original.updatedAt);
    let current=await getBook(id);
    if(!current)throw Error("Non salvato");
    for(const [index,value] of [
      "TESTO_STORICO_SEGRETO_DOPO_PRIMO",
      "TESTO_STORICO_SEGRETO_DOPO_SECONDO",
    ].entries()){
      const updated=structuredClone(current);
      updated.chapters[0].scenes[0].text=value;
      await saveBookAndActivity(updated,{
        id:"task-history-"+index+"-"+id,bookId:id,runId:"test-run",
        phase:"prose",title:"Storico "+index,reason:"Prova",
        nextStep:"Rivedi",status:"succeeded",
        createdAt:index===0?"2026-11-12T10:00:00.000Z":"2026-11-12T10:01:00.000Z",
      },current.updatedAt);
      current=await getBook(id);
      if(!current)throw Error("Perso canone");
    }
  },bookA);
  await page.reload();
  await nav.getByRole("button",{name:"Attività"}).click();
  const timeline=page.getByRole("region",{name:"Timeline task AI"});
  await expect(timeline.getByRole("list",{name:"Storico task"}).getByRole("listitem"))
    .toHaveCount(2);
  await timeline.getByRole("button",{name:"Apri scheda task"}).first().click();
  const focused=timeline.getByRole("region",{name:"Scheda task dedicata"});
  const impact=panel.getByRole("region",{name:"Anteprima impatto narrativo storico"});
  await expect(impact).toHaveCount(0);
  await panel.getByRole("button",{name:"Analizza differenze narrative storiche"}).click();
  await expect(impact).toContainText("Capitoli correnti candidati a revisione: 1");
  await expect(panel).not.toContainText("TESTO_STORICO_SEGRETO");
  await focused.getByRole("button",{name:"Task successivo"}).click();
  await expect(impact).toHaveCount(0);
  await panel.getByRole("button",{name:"Analizza differenze narrative storiche"}).click();
  await expect(impact).toContainText("Differenze storiche del task");
  await page.getByRole("combobox",{name:"Libro attivo"}).selectOption(bookB);
  await expect(impact).toHaveCount(0);
  await expect(panel).toContainText("Stato consenso integrale: disattivato");
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
  const editorial=diff.getByRole("region",{name:"Confronto editoriale per scena"});
  await expect(editorial).toContainText("Confronto editoriale dei paragrafi");
  await expect(editorial.getByRole("region",{name:"Anteprima privata confronto paragrafi"}))
    .toHaveCount(0);
  await editorial.getByRole("button",{
    name:/Seleziona scena chapter-optin \/ scene-optin/,
  }).click();
  // Even after scene selection, the author must explicitly reveal the prose.
  await expect(page.getByText("PROSA_ANTE_OPERAZIONE_PRIVATA")).toHaveCount(0);
  await editorial.getByRole("button",{name:"Mostra anteprima privata dei paragrafi"}).click();
  const preview=editorial.getByRole("region",{name:"Anteprima privata confronto paragrafi"});
  await expect(preview).toContainText("PROSA_ANTE_OPERAZIONE_PRIVATA");
  await expect(preview).toContainText("PROSA_DOPO_OPERAZIONE_PRIVATA");
  await editorial.getByRole("button",{name:"Nascondi anteprima privata"}).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByText("PROSA_ANTE_OPERAZIONE_PRIVATA")).toHaveCount(0);
  await expect(prose).not.toContainText("PROSA_ANTE_OPERAZIONE_PRIVATA");
  await expect(prose).not.toContainText("PROSA_DOPO_OPERAZIONE_PRIVATA");
  await focus.getByRole("button",{name:"Torna al registro dei task"}).click();
  const storage=consent.getByLabel("Gestione spazio snapshot testuali");
  await storage.getByRole("button",{name:"Aggiorna stima spazio locale"}).click();
  await expect(storage.getByLabel("Riepilogo archivio locale"))
    .toContainText("Copie conservate: 1");
  await expect(storage).toContainText("non lo spazio effettivo IndexedDB");
  await storage.getByRole("spinbutton",{name:"Limite copie testuali MiB"}).fill("1");
  await storage.getByRole("button",{name:"Applica limite copie testuali"}).click();
  await expect(storage.getByLabel("Riepilogo archivio locale")).toContainText(
    "Limite applicativo: 1 MiB",
  );
  const selected=storage.getByRole("checkbox",{name:/Seleziona copia task/});
  await selected.check();
  await storage.getByRole("button",{
    name:"Richiedi cancellazione copie selezionate (1)",
  }).click();
  await expect(storage).toContainText("cancellazione irreversibile di 1 copie");
  await storage.getByRole("button",{name:"Conferma cancellazione copie selezionate"}).click();
  await expect(storage.getByLabel("Riepilogo archivio locale"))
    .toContainText("Copie conservate: 0");
  await timeline.getByRole("button",{name:"Apri scheda task"}).click();
  await prose.getByRole("button",{name:"Carica confronto della prosa canonica"}).click();
  await expect(prose).toContainText("Copia testuale cancellata manualmente");
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

test("diff privato: cambio task e libro elimina il testo già rivelato, desktop/mobile",async({page})=>{
  await page.goto("/");
  const bookA=await createBook(page,"Libro A con confronto privato");
  await page.getByRole("combobox",{name:"Libro attivo"}).selectOption("");
  const bookB=await createBook(page,"Libro B senza confronto");
  await page.getByRole("combobox",{name:"Libro attivo"}).selectOption(bookA);
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Attività"}).click();
  const consent=page.getByRole("region",{name:"Consenso copie testuali per il rewind"});
  await consent.getByRole("button",{name:"Attiva copie testuali locali per questo libro"}).click();
  await expect(consent).toContainText("Stato per questo libro: attivo");
  await page.evaluate(async id=>{
    const {getBook,saveBook,saveBookAndActivity}=await import("/src/infrastructure/db.ts");
    const initial=await getBook(id);
    if(!initial)throw Error("Libro A mancante");
    const prepared=structuredClone(initial);
    prepared.chapters=[{
      id:"chapter-private",number:1,title:"Scena test",purpose:"Confronto",
      scenes:[{id:"scene-private",number:1,title:"Scena",
        objective:"Controllare",text:"TESTO_SINTETICO_INIZIALE",status:"canon"}],
    }];
    await saveBook(prepared,false,initial.updatedAt);
    let current=await getBook(id);
    if(!current)throw Error("Canone mancante");
    for(const [index,value] of ["PROSA_PRIVATA_PRIMA_SCELTA",
      "PROSA_PRIVATA_SECONDA_SCELTA"].entries()){
      const updated=structuredClone(current);
      updated.chapters[0].scenes[0].text=value;
      await saveBookAndActivity(updated,{
        id:"private-task-"+index+"-"+id,bookId:id,runId:"private-session",
        phase:"prose",status:"succeeded",title:"Cambio editoriale "+index,
        reason:"Prova",nextStep:"Controlla",
        createdAt:index===0?"2026-11-12T10:00:00.000Z":"2026-11-12T10:01:00.000Z",
      },current.updatedAt);
      current=await getBook(id);
      if(!current)throw Error("Canone perso");
    }
  },bookA);
  await page.reload();
  await nav.getByRole("button",{name:"Attività"}).click();
  const timeline=page.getByRole("region",{name:"Timeline task AI"});
  await expect(timeline.getByRole("list",{name:"Storico task"})
    .getByRole("listitem")).toHaveCount(2);
  await timeline.getByRole("button",{name:"Apri scheda task"}).first().click();
  const focus=timeline.getByRole("region",{name:"Scheda task dedicata"});
  const prose=focus.getByRole("region",{name:"Confronto prosa canonica locale"});
  await prose.getByRole("button",{name:"Carica confronto della prosa canonica"}).click();
  const editorial=prose.getByRole("region",{name:"Confronto editoriale per scena"});
  await editorial.getByRole("button",{name:/Seleziona scena chapter-private \/ scene-private/}).click();
  await editorial.getByRole("button",{name:"Mostra anteprima privata dei paragrafi"}).click();
  const preview=editorial.getByRole("region",{name:"Anteprima privata confronto paragrafi"});
  await expect(preview).toContainText("PROSA_PRIVATA_SECONDA_SCELTA");
  await focus.getByRole("button",{name:"Task successivo"}).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByText("PROSA_PRIVATA_SECONDA_SCELTA")).toHaveCount(0);
  // New task never inherits the previously revealed prose or scene selection.
  await prose.getByRole("button",{name:"Carica confronto della prosa canonica"}).click();
  await expect(prose.getByText(/Scena selezionata: capitolo/)).toHaveCount(0);
  await page.getByRole("combobox",{name:"Libro attivo"}).selectOption(bookB);
  await expect(focus).toHaveCount(0);
  await expect(page.getByText("PROSA_PRIVATA_PRIMA_SCELTA")).toHaveCount(0);
  await expect(page.getByText("PROSA_PRIVATA_SECONDA_SCELTA")).toHaveCount(0);
  await expect(consent).toContainText("Stato per questo libro: disattivato");
});

test("limite copie testuali: il task oltre quota non canonizza nulla, desktop/mobile",async({page})=>{
  await page.goto("/");
  const bookId=await createBook(page,"Libro prova soglia locale");
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Attività"}).click();
  const consent=page.getByRole("region",{name:"Consenso copie testuali per il rewind"});
  await consent.getByRole("button",{name:"Attiva copie testuali locali per questo libro"}).click();
  const storage=consent.getByLabel("Gestione spazio snapshot testuali");
  await storage.getByRole("button",{name:"Aggiorna stima spazio locale"}).click();
  await storage.getByRole("spinbutton",{name:"Limite copie testuali MiB"}).fill("1");
  await storage.getByRole("button",{name:"Applica limite copie testuali"}).click();
  const outcome=await page.evaluate(async(id)=>{
    const {getDb,getBook,saveBook,saveBookAndActivity}=await import("/src/infrastructure/db.ts");
    const original=await getBook(id);
    if(!original)throw Error("Libro mancante");
    const canon=structuredClone(original);
    canon.chapters=[{id:"large-ch",number:1,title:"Sintetico",purpose:"Prova",
      scenes:[{id:"large-sc",number:1,title:"Scena",objective:"Quota",
        status:"canon",text:"Q".repeat(600_000)}]}];
    await saveBook(canon,false,original.updatedAt);
    const before=await getBook(id);
    if(!before)throw Error("Book absent");
    const proposed=structuredClone(before);
    proposed.chapters[0].scenes[0].text="R".repeat(600_000);
    const taskId="blocked-quota-"+id;
    let errorName="";
    try{
      await saveBookAndActivity(proposed,{
        id:taskId,bookId:id,runId:"run",phase:"prose",title:"Tentativo oltre quota",
        reason:"Test",nextStep:"Interrompere",status:"succeeded",
        createdAt:"2026-11-12T10:00:00.000Z",
      },before.updatedAt);
    }catch(error){errorName=error instanceof Error?error.name:"unknown";}
    const db=await getDb();
    const after=await getBook(id);
    return {
      errorName,
      sameRevision:after?.updatedAt===before.updatedAt,
      sameText:after?.chapters[0]?.scenes[0]?.text===before.chapters[0].scenes[0].text,
      activityAbsent:(await db.get("activities",taskId))===undefined,
      structureAbsent:(await db.get("meta","task-structure:v1:"+taskId))===undefined,
      proseAbsent:(await db.get("meta","task-prose:v1:"+id+":"+taskId))===undefined,
    };
  },bookId);
  expect(outcome).toEqual({
    errorName:"TaskProseQuotaExceeded",sameRevision:true,sameText:true,
    activityAbsent:true,structureAbsent:true,proseAbsent:true,
  });
  await storage.getByRole("button",{name:"Aggiorna stima spazio locale"}).click();
  await expect(storage.getByLabel("Riepilogo archivio locale"))
    .toContainText("Copie conservate: 0");
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
