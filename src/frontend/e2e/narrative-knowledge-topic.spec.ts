import {expect,test} from "@playwright/test";

test("confronto autore fra due persone: stesso tema, rettifica e fonte stale desktop/mobile",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Lettere condivise");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara ed Elio parlano della lettera senza sapere chi ha detto cosa.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open("bookwriter");request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const tx=request.result.transaction("books","readwrite"),store=tx.objectStore("books"),
        all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as Record<string,unknown>;
        b.status="paused";b.phase="completed";
        b.remote={owner:"author",repository:"novel",branch:"main",autoSync:true};
        b.chapters=[
          {id:"c1",number:1,title:"Mara",purpose:"Lettera",
            frozenAt:"2026-11-08T08:00:00.000Z",
            scenes:[{id:"s1",number:1,title:"Mara",objective:"Conoscenza",
              text:"Mara scopre che la lettera è falsa.",status:"canon"}]},
          {id:"c2",number:2,title:"Elio",purpose:"Lettera",
            frozenAt:"2026-11-08T08:30:00.000Z",
            scenes:[{id:"s2",number:1,title:"Elio",objective:"Conoscenza",
              text:"Elio apprende che la lettera è falsa.",status:"canon"}]},
        ];
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

  for(const quote of ["Mara scopre che la lettera è falsa","Elio apprende che la lettera è falsa"]){
    const item=board.getByText("«"+quote+"»",{exact:true}).first().locator("..");
    await item.getByRole("textbox",{name:/Motivazione evento/})
      .fill("L'autore conferma la menzione, senza certificare il contenuto.");
    page.once("dialog",dialog=>dialog.accept());
    await item.getByRole("button",{name:"Annota come avvenuto"}).click();
    await expect(item.getByText(/Interpretazione attuale: annotato come avvenuto/))
      .toBeVisible();
  }
  const knowledge=board.locator('details[aria-label="Registro conoscenze autore"]');
  await knowledge.locator("> summary").click();
  const source=knowledge.getByRole("combobox",{name:"Menzione di conoscenza attestata"});
  const note=knowledge.getByRole("textbox",{name:"Motivazione conoscenza autore"});
  for(let i=0;i<2;i++){
    await source.selectOption({index:i});
    await note.fill("L'autore ha rilevato una notizia riferita, ma non ne attesta la verità.");
    page.once("dialog",dialog=>dialog.accept());
    await knowledge.getByRole("button",{name:"Riferita da altri"}).click();
    await expect(knowledge.locator("> summary")).toContainText("("+(i+1)+" correnti)");
  }

  const topics=knowledge.locator('details[aria-label="Relazioni conoscenze autore"]');
  await expect(topics.locator("> summary")).toContainText("(0 relazioni correnti)");
  await topics.locator("> summary").click();
  const comparison=topics.getByRole("group",{name:"Confronta due conoscenze"});
  await expect(comparison.getByLabel("Prima conoscenza da confrontare")).toBeVisible();
  await expect(comparison.getByLabel("Seconda conoscenza da confrontare")).toBeVisible();
  await expect(comparison.getByText(/Fonte A/)).toBeVisible();
  await expect(comparison.getByText(/Fonte B/)).toBeVisible();
  const explanation=comparison.getByRole("textbox",{name:"Motivazione relazione conoscenze"});
  await explanation.fill("L'autore riconosce due menzioni della medesima lettera, non un dialogo.");
  page.once("dialog",dialog=>dialog.accept());
  await comparison.getByRole("button",{name:"Conferma stessa informazione"}).click();
  await expect(topics.locator("> summary")).toContainText("(1 relazioni correnti)");
  await expect(topics.getByLabel("Confronti correnti fra personaggi")
    .getByText("Stessa informazione secondo l'autore")).toBeVisible();
  await explanation.fill("L'autore rettifica: le due frasi non descrivono una notizia identica.");
  page.once("dialog",dialog=>dialog.accept());
  await comparison.getByRole("button",{name:"Conferma informazioni differenti"}).click();
  await expect(topics.getByLabel("Confronti correnti fra personaggi")
    .getByText("Informazioni distinte secondo l'autore")).toBeVisible();
  await topics.locator('details[aria-label="Storico relazioni conoscenze"] > summary')
    .click();
  await expect(topics.getByText(/Non correnti o superate: 1/)).toBeVisible();

  const state=await page.evaluate(()=>new Promise<{
    verdicts:string[];autoSync:boolean;secrets:unknown;scene:string;
    shareDecisions:unknown;
  }>((resolve,reject)=>{
    const request=indexedDB.open("bookwriter");request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const all=request.result.transaction("books","readonly").objectStore("books").getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as {
          narrativeKnowledgeTopicDecisions:Array<{verdict:string}>;
          narrativeKnowledgeShareDecisions?:unknown;
          remote:{autoSync:boolean};
          chapters:Array<{scenes:Array<{text:string}>}>;memory:{secrets:unknown};
        };
        resolve({
          verdicts:b.narrativeKnowledgeTopicDecisions.map(d=>d.verdict),
          autoSync:b.remote.autoSync,shareDecisions:b.narrativeKnowledgeShareDecisions??null,
          secrets:b.memory.secrets,scene:b.chapters[0]!.scenes[0]!.text,
        });
      };
    };
  }));
  expect(state).toEqual({
    verdicts:["same_information","different_information"],autoSync:false,
    shareDecisions:null,secrets:{},scene:"Mara scopre che la lettera è falsa.",
  });
  await page.reload();
  const loaded=page.getByRole("region",{name:"Redazione multi-agente"});
  await loaded.locator("summary").filter({hasText:"Indice eventi candidati"}).first().click();
  const k2=loaded.locator('details[aria-label="Registro conoscenze autore"]');
  await k2.locator("> summary").click();
  const topics2=k2.locator('details[aria-label="Relazioni conoscenze autore"]');
  await expect(topics2.locator("> summary")).toContainText("(1 relazioni correnti)");

  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open("bookwriter");request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const tx=request.result.transaction("books","readwrite"),store=tx.objectStore("books"),
        all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const book=all.result[0] as {id:string;chapters:Array<{scenes:Array<{text:string}>}>};
        book.chapters[1]!.scenes[0]!.text+=" Una frase modificata.";
        store.put(book,book.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const staleBoard=page.getByRole("region",{name:"Redazione multi-agente"});
  await staleBoard.locator("summary").filter({hasText:"Indice eventi candidati"}).first().click();
  const staleKnowledge=staleBoard.locator('details[aria-label="Registro conoscenze autore"]');
  await staleKnowledge.locator("> summary").click();
  const stale=staleKnowledge.locator('details[aria-label="Relazioni conoscenze autore"]');
  await expect(stale.locator("> summary")).toContainText("(0 relazioni correnti)");
  await stale.locator("> summary").click();
  await stale.locator('details[aria-label="Storico relazioni conoscenze"] > summary')
    .click();
  await expect(stale.getByText(/Non correnti o superate: 2/)).toBeVisible();
  expect(outgoing).toEqual([]);
  const widths=await page.evaluate(()=>
    ({content:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport+1);
});
