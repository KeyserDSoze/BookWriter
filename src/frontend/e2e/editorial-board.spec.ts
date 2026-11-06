import { expect, test } from "@playwright/test";

test("redazione capitolo desktop/mobile: 12 agenti separati, giudice, freeze e riapertura", async ({page}) => {
  test.setTimeout(120_000); // 12 sequential network calls plus a judge and summary.
  const calls: Array<{system:string;prompt:string;model:string}> = [];
  const reports = JSON.stringify({
    verdict:"pass",summary:"Controllo editoriale indipendente superato senza criticità.",
    findings:[],memoryNote:"Nessun problema nel segmento letto.",
  });
  await page.route("https://api.openai.com/v1/chat/completions",async route=>{
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization,content-type",
        "access-control-allow-methods": "POST,OPTIONS",
      }}); return;
    }
    const body=route.request().postDataJSON() as {
      model:string;messages:Array<{role:string;content:string}>;
    };
    const system=body.messages.find(m=>m.role==="system")?.content ?? "";
    const prompt=body.messages.find(m=>m.role==="user")?.content ?? "";
    calls.push({system,prompt,model:body.model});
    const content=system.includes("direttore editoriale CRITICO")?
      JSON.stringify({reasoning:"Le dodici verifiche non hanno prodotto rilievi. Il capitolo rispetta la coerenza narrativa e può essere congelato.",decisions:[]}) :
      prompt.includes("chapterSummary")?
        JSON.stringify({chapterSummary:"Mara arriva al castello incontrando il guardiano alla porta principale.",
          bookSummary:"All'inizio del romanzo Mara raggiunge il castello e incontra il guardiano."}) : reports;
    await route.fulfill({status:200,headers:{
      "content-type":"application/json","access-control-allow-origin":"*",
      "access-control-allow-headers":"authorization,content-type",
    },body:JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:100,completion_tokens:20}})});
  });

  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Castello in revisione");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara custodisce una chiave e arriva al castello.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(async()=>await new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite");
      const store=tx.objectStore("books");
      const request=store.getAll();
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const book=request.result[0] as Record<string,unknown>;
        book.status="paused";book.phase="prose";
        book.chapters=[{id:"ch-1",number:1,title:"Il castello",
          purpose:"Mostrare il mistero",scenes:[{
            id:"scene-1",number:1,title:"Il guardiano",objective:"Presentare il conflitto",
            text:"Mara incontra il guardiano e attraversa il portone.",summary:"Mara entra.",
            status:"canon",
          }]}];
        (book.memory as {secrets:Record<string,string>}).secrets.chiave=
          "La chiave apre il passaggio segreto del castello.";
        store.put(book,book.id as string);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  const nav=page.getByRole("navigation",{name:test.info().project.name==="mobile-chromium"?
    "Navigazione mobile":"Navigazione principale"});
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await page.getByLabel("API key").fill("sk-test-editorial-not-real");
  await page.getByRole("textbox",{name:"Modello predefinito"}).fill("mock-review-editorial");
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();
  const panel=page.getByRole("region",{name:"Redazione multi-agente"});
  await expect(panel.getByText("Non ancora congelato")).toBeVisible();
  await page.getByRole("button",{name:"Riprendi"}).click();
  await expect.poll(async () => {
    const current = await page.evaluate(async () => await new Promise<{
      status: string; frozen: boolean; previousError?: string;
    }>((resolve, reject) => {
      const open = indexedDB.open("bookwriter");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("books", "readonly");
        const query = tx.objectStore("books").getAll();
        query.onerror = () => reject(query.error);
        query.onsuccess = () => {
          const b = query.result[0] as {
            status: string; previousError?: string;
            chapters: Array<{ frozenAt?: string }>;
          };
          resolve({ status: b.status, frozen: !!b.chapters[0]?.frozenAt,
            previousError: b.previousError });
        };
      };
    }));
    if (current.status === "error") {
      throw new Error("Redazione fallita: " + current.previousError);
    }
    return current.frozen ? "frozen" : "pending (" + current.status + ", " + calls.length + " richieste)";
  }, { timeout: 90_000 }).toBe("frozen");
  await expect(panel.getByText(/Congelato il/)).toBeVisible({timeout:15_000});
  expect(calls).toHaveLength(14);
  expect(calls.every(x=>x.model==="mock-review-editorial")).toBe(true);
  expect(calls.filter(x=>x.system.includes("revisore letterario INDIPENDENTE"))).toHaveLength(12);
  expect(calls.filter(x=>x.system.includes("direttore editoriale CRITICO"))).toHaveLength(1);
  expect(calls.filter(x=>x.prompt.includes("chapterSummary"))).toHaveLength(1);
  const readers=calls.filter(x=>x.system.includes("Lettore ")||x.system.includes("Lettura"));
  expect(readers).toHaveLength(5);
  expect(readers.every(x=>!x.prompt.includes("passaggio segreto del castello"))).toBe(true);
  const specialists=calls.filter(x=>x.system.includes("Segreti, indizi"));
  expect(specialists).toHaveLength(1);
  expect(specialists[0]?.prompt).toContain("passaggio segreto");
  await panel.getByText(/Giudizi archiviati \(1\)/).click();
  await expect(panel.getByText(/Tornata 1 · 12 verifiche/)).toBeVisible();
  page.once("dialog",dialog=>dialog.accept());
  await panel.getByRole("button",{name:"Rivaluta"}).click();
  await expect(panel.getByText(/In review/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Riprendi"})).toBeEnabled();
  const width=await page.evaluate(()=>({
    actual:document.documentElement.scrollWidth,expected:window.innerWidth,
  }));
  expect(width.actual).toBeLessThanOrEqual(width.expected+1);
});


test("divergenze documentali desktop/mobile: il report distingue posizioni e prove",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Cronache in contrasto");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Romanzo storico su una linea telegrafica controversa.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite");
      const store=tx.objectStore("books");
      const all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const book=all.result[0] as Record<string,unknown>;
        const t="2026-11-06T12:00:00.000Z";
        const a={id:"itwiki:42:210",provider:"it.wikipedia.org",pageId:42,revisionId:210,
          title:"Prima cronaca",url:"https://it.wikipedia.org/wiki/Telegrafo",
          query:"Telegrafo elettrico nel 1848",retrievedAt:t,
          excerpt:"La linea telegrafica cittadina entrò in servizio nel 1848."};
        const b={id:"itwiki:44:311",provider:"it.wikipedia.org",pageId:44,revisionId:311,
          title:"Seconda cronaca",url:"https://it.wikipedia.org/wiki/Telegrafo_elettrico",
          query:"Telegrafo elettrico nel 1848",retrievedAt:t,
          excerpt:"Un'altra cronaca colloca l'apertura della stessa linea nel 1853."};
        const historical={
          claim:"La linea cittadina era già operativa nel 1848.",
          assessment:"conflicting_excerpts",sourceIds:[a.id,b.id],
          sourceEvidence:[
            {sourceId:a.id,quote:"La linea telegrafica cittadina entrò in servizio nel 1848"},
            {sourceId:b.id,quote:"Un'altra cronaca colloca l'apertura della stessa linea nel 1853"},
          ],
          sourcePositions:[
            {sourceId:a.id,position:"supports",
              rationale:"La prima cronaca colloca il servizio nell'anno 1848."},
            {sourceId:b.id,position:"disputes",
              rationale:"La seconda cronaca riferisce una data di apertura diversa."},
          ],
          conflictContext:{
            sources:[
              {sourceId:a.id,subject:"Inizio del servizio telegrafico",
                period:"Anno 1848",place:null,edition:null,
                uncertainty:"La località precisa non risulta dall'estratto."},
              {sourceId:b.id,subject:"Apertura della linea telegrafica",
                period:"Anno 1853",place:null,edition:null,
                uncertainty:"Non è certo che sia la stessa fase operativa."},
            ],
            comparison:{eventIdentity:"unknown",
              rationale:"La concordanza dell'evento non è determinabile dalle sole frasi citate."},
          },
        };
        book.status="paused";book.phase="chapterReview";
        book.chapters=[{id:"ch-1",number:1,title:"Il dispaccio",purpose:"Contesto",
          scenes:[{id:"scene-1",number:1,title:"Telegramma",objective:"Informare",
            text:"Mara invia il telegramma nel 1848.",status:"canon"}],
          historicalDossier:{queries:["Telegrafo elettrico nel 1848"],
            sources:[a,b],activeSourceIds:[a.id,b.id],searchedAt:t,unansweredQueries:[]},
        }];
        book.editorialCycle={chapterId:"ch-1",round:1,stage:"adjudicate",reports:[{
          role:"historical",segmentIndex:0,segmentCount:1,verdict:"issues",
          summary:"Le cronache sembrano discordanti.",memoryNote:"",createdAt:t,
          findings:[{id:"1:historical:0:0",sceneId:"scene-1",category:"storia",
            severity:"major",evidence:"Mara invia il telegramma",
            reason:"Le fonti sembrano indicare date diverse per la linea.",
            remediation:"Verificare luogo, edizione e data prima di modificare la scena.",
            historical}],
        }],repairCursor:0,priorRounds:[],
          judgment:{
            reasoning:"Il direttore confronta data, luogo ed edizione prima di accettare un'eventuale correzione.",
            verdict:"freeze",createdAt:t,
            decisions:[{findingId:"1:historical:0:0",action:"reject",
              rationale:"Le fonti non consentono di stabilire che sia la stessa linea.",
              remediation:"",
              conflictReview:{
                eventIdentity:"different",
                chronology:"I due anni possono descrivere fasi operative differenti.",
                geography:"La città non è identificata in nessuna delle due citazioni.",
                edition:"Non conosciamo data e versione dell'edizione originaria.",
                independence:"Due pagine distinte non provano due testimonianze originarie indipendenti.",
                conclusion:"Questo conflitto non giustifica modifiche al romanzo.",
              }}],
          },
        };
        store.put(book,book.id as string);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const panel=page.getByRole("region",{name:"Redazione multi-agente"});
  await panel.locator("summary").filter({hasText:"Plausibilità e accuratezza storica"}).first().click();
  await expect(panel.getByText("Possibile divergenza fra fonti (interpretazione NON certificata)"))
    .toBeVisible();
  await expect(panel.getByText(/Interpretazione itwiki:42:210/)).toBeVisible();
  await expect(panel.getByText(/Interpretazione itwiki:44:311/)).toBeVisible();
  await expect(panel.getByText(/una citazione letterale non dimostra/)).toBeVisible();
  await expect(panel.getByText(/La prima cronaca colloca il servizio/)).toBeVisible();
  await expect(panel.getByText(/Confronto di evento, periodo, luogo ed edizione/)).toBeVisible();
  await expect(panel.getByText(/La località precisa non risulta/)).toBeVisible();
  await expect(panel.getByText(/Identità dell'evento proposta/)).toBeVisible();
  await expect(panel.getByText(/Verifica critica del direttore/)).toBeVisible();
  await expect(panel.getByText(/Due pagine distinte non provano/)).toBeVisible();
  const width=await page.evaluate(()=>({
    actual:document.documentElement.scrollWidth,expected:window.innerWidth,
  }));
  expect(width.actual).toBeLessThanOrEqual(width.expected+1);
});


test("relazioni tra fonti desktop/mobile: consenso, audit e riapertura capitoli",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Le cronache");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Romanzo ambientato nel periodo del telegrafo.");
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
        const t="2026-11-06T12:00:00.000Z";
        const sources=[42,43].map(pageId=>({
          id:"itwiki:"+pageId+":210",provider:"it.wikipedia.org",
          pageId,revisionId:210,title:"Telegrafo "+pageId,
          url:"https://it.wikipedia.org/wiki/Telegrafo",
          query:"Telegrafo elettrico nel 1848",
          retrievedAt:t,excerpt:"Un resoconto descrive l'uso del telegrafo nel secolo XIX.",
        }));
        book.status="paused";book.phase="prose";
        book.chapters=[{id:"ch-relation",number:1,title:"Il dispaccio",purpose:"Fatto narrativo",
          frozenAt:t,summary:"Una cronaca apparentemente affidabile.",bookSummaryAtFreeze:"Sintesi.",
          scenes:[{id:"scene-1",number:1,title:"Messaggio",objective:"Avvisare",
            text:"Mara invia un messaggio attraverso il telegrafo.",status:"canon"}],
          historicalDossier:{queries:["Telegrafo elettrico nel 1848"],
            sources,activeSourceIds:sources.map(s=>s.id),
            searchedAt:t,unansweredQueries:[]},
        }];
        book.bookSummary="Sintesi.";
        store.put(book,book.id as string);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const panel=page.getByRole("region",{name:"Redazione multi-agente"});
  await panel.locator("summary").filter({hasText:"Provenienza e dipendenze fra fonti"}).click();
  await panel.getByRole("combobox",{name:"Prima fonte relazione capitolo 1"})
    .selectOption("itwiki:42:210");
  await panel.getByRole("combobox",{name:"Seconda fonte relazione capitolo 1"})
    .selectOption("itwiki:43:210");
  await panel.getByRole("combobox",{name:"Tipo relazione capitolo 1"}).selectOption("derived");
  await panel.getByRole("textbox",{name:"Motivazione relazione capitolo 1"})
    .fill("L'autore ha confrontato i riferimenti: la seconda voce riprende l'originale della prima.");
  const external:string[]=[];
  page.on("request",req=>{
    if (["it.wikipedia.org","www.loc.gov","it.wikisource.org"].some(host => req.url().includes(host)))
      external.push(req.url());
  });
  page.once("dialog",async dialog=>{
    expect(dialog.message()).toContain("DICHIARAZIONE LOCALE DI PROVENIENZA");
    expect(dialog.message()).toContain("itwiki:42:210");
    expect(dialog.message()).toContain("itwiki:43:210");
    expect(dialog.message()).not.toContain("Mara invia");
    await dialog.accept();
  });
  await panel.getByRole("button",{name:"Registra relazione di provenienza"}).click();
  await expect(panel.getByText(/Dichiarazione salvata. Capitolo e successivi riaperti/))
    .toBeVisible();
  await expect(panel.getByText(/Una fonte deriva dall'altra/)).toBeVisible();
  const state=await page.evaluate(()=>new Promise<{
    frozen:boolean;stage:string;sourceRelations:number;autosync:boolean|undefined;
  }>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readonly"),q=tx.objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const book=q.result[0] as {
          chapters:Array<{frozenAt?:string;historicalDossier:{sourceRelations:Array<{relation:string}>}}>;
          editorialCycle?:{stage:string};remote?:{autoSync?:boolean};
        };
        resolve({frozen:!!book.chapters[0]?.frozenAt,
          stage:book.editorialCycle?.stage??"none",
          sourceRelations:book.chapters[0]!.historicalDossier.sourceRelations.length,
          autosync:book.remote?.autoSync});
      };
    };
  }));
  expect(state.frozen).toBe(false);
  expect(state.stage).toBe("review");
  expect(state.sourceRelations).toBe(1);
  expect(external).toEqual([]);
  const width=await page.evaluate(()=>({
    actual:document.documentElement.scrollWidth,expected:window.innerWidth,
  }));
  expect(width.actual).toBeLessThanOrEqual(width.expected+1);
});
