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
  await expect(preview.getByText(/non è una prova.*assenza di comunicazione/))
    .toBeVisible();
  await expect(preview.getByText(/Scene esaminate:/)).toHaveCount(2);
  await expect(preview.getByText(/Nina rivela/)).toHaveCount(0);
  const candidateButton=preview.getByRole("button",{name:"Valuta questa pista"});
  await expect(candidateButton).toHaveCount(1);
  await candidateButton.click();
  const assessment=preview.getByRole("group",{name:"Valutazione autore della pista"});
  await assessment.getByRole("combobox",{name:"Valutazione della pista"})
    .selectOption("possible_path");
  await assessment.getByRole("textbox",{name:"Motivazione pista comunicativa"})
    .fill("L'autore sospetta che il narratore stia riportando soltanto una voce.");
  page.once("dialog",dialog=>dialog.accept());
  await assessment.getByRole("button",{name:"Registra giudizio sulla pista"}).click();
  await expect(preview.getByText(/Giudizio corrente:/)).toContainText("Pista possibile");
  const shares=preview.locator('details[aria-label="Consenso AI pista comunicativa"]');
  await expect(shares).toHaveCount(1);
  await expect(shares.locator("> summary")).toContainText("nessun consenso attivo");
  await shares.locator("> summary").click();
  await expect(shares.getByRole("checkbox")).toHaveCount(5);
  for(const checkbox of await shares.getByRole("checkbox").all())
    expect(await checkbox.isChecked()).toBe(false);
  await shares.getByRole("checkbox",{name:"Autorizza Continuità"}).check();
  await shares.getByRole("checkbox",{name:"Autorizza Giudice critico"}).check();
  await shares.getByRole("textbox",{name:"Motivazione consenso pista comunicativa"})
    .fill("L'autore autorizza solo due destinatari a esaminare la citazione letterale.");
  page.once("dialog",dialog=>dialog.accept());
  await shares.getByRole("button",{name:"Autorizza ruoli selezionati"}).click();
  await expect(shares.locator("> summary")).toContainText("attiva");
  await expect(shares.getByText(/Destinatari già autorizzati/))
    .toContainText("Continuità, Giudice critico");
  await shares.getByRole("textbox",{name:"Motivazione consenso pista comunicativa"})
    .fill("L'autore revoca il consenso prima delle prossime chiamate.");
  page.once("dialog",dialog=>dialog.accept());
  await shares.getByRole("button",{name:"Revoca autorizzazione"}).click();
  await expect(shares.locator("> summary")).toContainText("nessun consenso attivo");
  await candidateButton.click();
  await assessment.getByRole("combobox",{name:"Valutazione della pista"})
    .selectOption("dismissed");
  await assessment.getByRole("textbox",{name:"Motivazione pista comunicativa"})
    .fill("L'autore rilegge la scena e respinge la comunicazione come pista.");
  page.once("dialog",dialog=>dialog.accept());
  await assessment.getByRole("button",{name:"Registra giudizio sulla pista"}).click();
  await expect(preview.getByText(/Giudizio corrente:/)).toContainText("Pista respinta");
  await preview.locator('details[aria-label="Storico valutazioni comunicative"] > summary')
    .click();
  await expect(preview.getByText(/Non correnti o rettificate: 1/)).toBeVisible();
  const decisions=await page.evaluate(()=>new Promise<string[]>((resolve,reject)=>{
    const request=indexedDB.open("bookwriter");
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const all=request.result.transaction("books","readonly").objectStore("books").getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as {narrativeTransferAssessments?:Array<{verdict:string}>};
        resolve((b.narrativeTransferAssessments??[]).map(x=>x.verdict));
      };
    };
  }));
  expect(decisions).toEqual(["possible_path","dismissed"]);
  const permissionAudit=await page.evaluate(()=>new Promise<{
    statuses:string[];recipients:string[][];
  }>((resolve,reject)=>{
    const request=indexedDB.open("bookwriter");
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const all=request.result.transaction("books","readonly").objectStore("books").getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as {
          narrativeTransferShareDecisions?:Array<{status:string;recipients:string[]}>;
        };
        resolve({statuses:(b.narrativeTransferShareDecisions??[]).map(x=>x.status),
          recipients:(b.narrativeTransferShareDecisions??[]).map(x=>x.recipients)});
      };
    };
  }));
  expect(permissionAudit).toEqual({
    statuses:["allowed","revoked"],recipients:[["continuity","judge"],[]],
  });
  await expect(shares.locator("> summary")).toContainText("nessun consenso attivo");
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
