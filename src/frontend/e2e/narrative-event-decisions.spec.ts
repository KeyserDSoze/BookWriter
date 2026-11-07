import { expect, test } from "@playwright/test";

test("decisioni autore desktop/mobile: conferma, rettifica, audit e invalidazione senza AI",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("La chiave");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara consegna la chiave a Elio.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open("bookwriter");
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const tx=request.result.transaction("books","readwrite");
      const store=tx.objectStore("books"), all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as Record<string,unknown>;
        b.status="paused"; b.phase="completed";
        b.remote={owner:"author",repository:"novel",branch:"main",autoSync:true};
        b.chapters=[{id:"ch1",number:1,title:"Capitolo",purpose:"Passaggio di mano",
          frozenAt:"2026-11-07T10:00:00.000Z",scenes:[
            {id:"s1",number:1,title:"Scena",objective:"Trasferire",
              text:"Mara consegna la chiave a Elio.",status:"canon"}]}];
        store.put(b,b.id as string);
        tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  await board.locator("summary").filter({hasText:"Indice eventi candidati"}).click();
  await expect(board.getByText("«Mara consegna la chiave a Elio»")).toBeVisible();
  const note=board.getByRole("textbox",{name:/Motivazione evento/});
  await note.fill("Nel mondo del romanzo la consegna è avvenuta.");
  const outbound:string[]=[];
  page.on("request",r=>{
    if(r.url().includes("api.openai.com")||r.url().includes("api.github.com"))
      outbound.push(r.url());
  });
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Annota come avvenuto"}).click();
  await expect(board.getByText(/Interpretazione attuale: annotato come avvenuto/)).toBeVisible();
  await board.locator("summary").filter({hasText:"Registro attestazioni correnti"}).click();
  await expect(board.getByText(/Registro attestazioni correnti \(1\)/)).toBeVisible();
  await expect(board.getByText(/Solo dichiarazioni dell'autore ancora ancorate/)).toBeVisible();
  await note.fill("Il guardiano ha mentito: non è un fatto del romanzo.");
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Respingi menzione"}).click();
  await expect(board.getByText(/Interpretazione attuale: menzione respinta/)).toBeVisible();
  await board.locator("summary").filter({hasText:"Storico decisioni autore"}).click();
  await expect(board.getByText(/Storico decisioni autore \(2\)/)).toBeVisible();
  const saved=await page.evaluate(()=>new Promise<{
    decisions:number;autosync?:boolean;text:string;frozen:boolean;secrets:unknown;
  }>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const q=req.result.transaction("books","readonly").objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          narrativeEventDecisions:unknown[];remote?:{autoSync?:boolean};
          chapters:Array<{frozenAt?:string;scenes:Array<{text:string}>}>;
          memory:{secrets:unknown};
        };
        resolve({decisions:b.narrativeEventDecisions.length,autosync:b.remote?.autoSync,
          text:b.chapters[0]!.scenes[0]!.text,frozen:!!b.chapters[0]!.frozenAt,
          secrets:b.memory.secrets});
      };
    };
  }));
  expect(saved).toEqual({decisions:2,autosync:false,
    text:"Mara consegna la chiave a Elio.",frozen:true,secrets:{}});
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const tx=req.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {id:string;chapters:Array<{scenes:Array<{text:string}>}>};
        b.chapters[0]!.scenes[0]!.text+=" Un dettaglio è cambiato.";
        store.put(b,b.id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const after=page.getByRole("region",{name:"Redazione multi-agente"});
  await after.locator("summary").filter({hasText:"Indice eventi candidati"}).click();
  await expect(after.getByText(/Interpretazione attuale:/)).toHaveCount(0);
  await after.locator("summary").filter({hasText:"Storico decisioni autore"}).click();
  await expect(after.getByText(/storico\/non corrente/)).toHaveCount(2);
  expect(outbound).toEqual([]);
  const width=await page.evaluate(()=>({
    scroll:document.documentElement.scrollWidth,width:window.innerWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.width+1);
});

test("indice paginato desktop/mobile: la menzione 31 è raggiungibile senza nuova rete",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Trentuno scene");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Il romanzo contiene più di trenta menzioni.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");
    req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const tx=req.result.transaction("books","readwrite");
      const store=tx.objectStore("books"),get=store.getAll();
      get.onerror=()=>reject(get.error);
      get.onsuccess=()=>{
        const b=get.result[0] as {id:string;status:string;phase:string;chapters:unknown[]};
        b.status="paused";b.phase="completed";
        b.chapters=[{id:"ch1",number:1,title:"Capitolo",purpose:"Tracce",
          frozenAt:"2026-11-07T10:00:00Z",
          scenes:Array.from({length:31},(_,i)=>({
            id:"s"+(i+1),number:i+1,title:"Scena",objective:"Traccia",
            text:"Mara scompare.",status:"canon",
          }))}];
        store.put(b,b.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  await board.locator("summary").filter({hasText:"Indice eventi candidati"}).click();
  await expect(board.getByText(/Menzioni 1–30 di 31/)).toBeVisible();
  await expect(board.getByText("Cap. 1 · scena 31 · state_change_mention")).toHaveCount(0);
  await board.getByRole("button",{name:"Pagina successiva"}).click();
  await expect(board.getByText(/Menzioni 31–31 di 31/)).toBeVisible();
  await expect(board.getByText("Cap. 1 · scena 31 · state_change_mention")).toBeVisible();
  await board.getByRole("button",{name:"Pagina precedente"}).click();
  await expect(board.getByText(/Menzioni 1–30 di 31/)).toBeVisible();
  const dimensions=await page.evaluate(()=>({
    content:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport+1);
});

test("segnali consultivi desktop/mobile: due attestazioni, date e nessuna scrittura automatica",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Cronologia fragile");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara muore nel primo capitolo, poi riappare.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const request=indexedDB.open("bookwriter");
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const tx=request.result.transaction("books","readwrite");
      const store=tx.objectStore("books"),all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as {id:string;status:string;phase:string;chapters:unknown[]};
        b.status="paused";b.phase="completed";
        b.chapters=[
          {id:"chapter1",number:1,title:"Primo",purpose:"Inizio",
            frozenAt:"2026-11-07T10:00:00Z",
            scenes:[{id:"scene1",number:1,title:"Scomparsa",objective:"Morte",
              text:"Mara muore.",status:"canon",date:"2030-03-04"}]},
          {id:"chapter2",number:2,title:"Secondo",purpose:"Svolta",
            frozenAt:"2026-11-07T11:00:00Z",
            scenes:[{id:"scene2",number:1,title:"Viaggio",objective:"Viaggio",
              text:"Mara parte.",status:"canon",date:"2030-02-28"}]},
        ];
        store.put(b,b.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  await board.locator("summary").filter({hasText:"Indice eventi candidati"}).click();
  const notes=board.getByRole("textbox",{name:/Motivazione evento/});
  const outbound:string[]=[];
  page.on("request",r=>{
    if(r.url().includes("api.openai.com")||r.url().includes("api.github.com"))
      outbound.push(r.url());
  });
  await notes.nth(0).fill("Morte reale nella versione narrata.");
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Annota come avvenuto"}).nth(0).click();
  await expect(board.getByText(/Interpretazione attuale: annotato come avvenuto/)).toHaveCount(1);
  await notes.nth(1).fill("La partenza è avvenuta secondo l'autore.");
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Annota come avvenuto"}).nth(1).click();
  const hints=board.locator('details[aria-label="Tracce di continuità da verificare"]');
  await hints.locator("summary").first().click();
  await expect(hints.getByText(/Tracce di continuità da verificare \(2\)/)).toBeVisible();
  await expect(hints.getByText(/Azione dopo menzione di morte/)).toBeVisible();
  await expect(hints.getByText(/Date dichiarate in ordine inverso/)).toBeVisible();
  await expect(hints.getByText(/«Mara muore»/)).toHaveCount(2);
  await expect(hints.getByText(/«Mara parte»/)).toHaveCount(2);
  await page.reload();
  const after=page.getByRole("region",{name:"Redazione multi-agente"});
  await after.locator("summary").filter({hasText:"Indice eventi candidati"}).click();
  await expect(after.locator('details[aria-label="Tracce di continuità da verificare"] summary'))
    .toContainText("Tracce di continuità da verificare (2)");
  const stored=await page.evaluate(()=>new Promise<{
    decisions:number;frozen:number;texts:string[];secrets:unknown;
  }>((resolve,reject)=>{
    const request=indexedDB.open("bookwriter");
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const q=request.result.transaction("books","readonly").objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          narrativeEventDecisions:unknown[];
          chapters:Array<{frozenAt?:string;scenes:Array<{text:string}>}>;
          memory:{secrets:unknown};
        };
        resolve({decisions:b.narrativeEventDecisions.length,
          frozen:b.chapters.filter(ch=>!!ch.frozenAt).length,
          texts:b.chapters.map(ch=>ch.scenes[0]!.text),secrets:b.memory.secrets});
      };
    };
  }));
  expect(stored).toEqual({decisions:2,frozen:2,
    texts:["Mara muore.","Mara parte."],secrets:{}});
  expect(outbound).toEqual([]);
  const dimensions=await page.evaluate(()=>({
    content:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport+1);
});


test("anteprima alias esplicita e non persistita su desktop e mobile",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("L'ombra di Mara");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Il nome Ombra potrebbe essere un soprannome di Mara.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");
    req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const tx=req.result.transaction("books","readwrite");
      const store=tx.objectStore("books"),get=store.getAll();
      get.onerror=()=>reject(get.error);
      get.onsuccess=()=>{
        const book=get.result[0] as {id:string;status:string;phase:string;chapters:unknown[]};
        book.status="paused";book.phase="completed";
        book.chapters=[
          {id:"c1",number:1,title:"Primo",purpose:"Morte",
            frozenAt:"2026-11-07T10:00:00Z",
            scenes:[{id:"s1",number:1,title:"Morte",objective:"Svolta",
              text:"Mara muore.",status:"canon"}]},
          {id:"c2",number:2,title:"Secondo",purpose:"Viaggio",
            frozenAt:"2026-11-07T11:00:00Z",
            scenes:[{id:"s2",number:1,title:"Partenza",objective:"Svolta",
              text:"Ombra parte.",status:"canon"}]},
        ];
        store.put(book,book.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  await board.locator("summary").filter({hasText:"Indice eventi candidati"}).click();
  const notes=board.getByRole("textbox",{name:/Motivazione evento/});
  const outbound:string[]=[];
  page.on("request",r=>{
    if(r.url().includes("api.openai.com")||r.url().includes("api.github.com"))
      outbound.push(r.url());
  });
  await notes.nth(0).fill("L'autore conferma il primo evento narrativo.");
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Annota come avvenuto"}).nth(0).click();
  await notes.nth(1).fill("L'autore conferma il secondo evento narrativo.");
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Annota come avvenuto"}).nth(1).click();

  const hints=board.locator('details[aria-label="Tracce di continuità da verificare"]');
  await hints.locator("summary").first().click();
  await expect(hints.locator("summary").first()).toContainText("(0)");
  await hints.getByRole("combobox",{name:"Primo nome del confronto"}).selectOption("Mara");
  await hints.getByRole("combobox",{name:"Secondo nome del confronto"}).selectOption("Ombra");
  page.once("dialog",d=>d.accept());
  await hints.getByRole("button",{name:"Confronta temporaneamente"}).click();
  await expect(hints.locator("summary").first()).toContainText("(1)");
  await expect(hints.getByText(/Anteprima attiva: Mara ↔ Ombra/)).toBeVisible();
  await expect(hints.getByText(/Solo anteprima alias:/)).toBeVisible();
  await hints.getByRole("button",{name:"Azzera confronto"}).click();
  await expect(hints.locator("summary").first()).toContainText("(0)");
  page.once("dialog",d=>d.accept());
  await hints.getByRole("button",{name:"Confronta temporaneamente"}).click();
  await expect(hints.locator("summary").first()).toContainText("(1)");
  await page.reload();
  const reopened=page.getByRole("region",{name:"Redazione multi-agente"});
  await reopened.locator("summary").filter({hasText:"Indice eventi candidati"}).click();
  const again=reopened.locator('details[aria-label="Tracce di continuità da verificare"]');
  await expect(again.locator("summary")).toContainText("(0)");
  const stored=await page.evaluate(()=>new Promise<{
    decisions:number;texts:string[];frozen:number;secrets:unknown;aliasStored:boolean;
  }>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");
    req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const q=req.result.transaction("books","readonly").objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          narrativeEventDecisions:unknown[];chapters:Array<{frozenAt?:string;scenes:Array<{text:string}>}>;
          memory:{secrets:unknown};aliasPreview?:unknown;
        };
        resolve({decisions:b.narrativeEventDecisions.length,
          texts:b.chapters.map(ch=>ch.scenes[0]!.text),
          frozen:b.chapters.filter(ch=>!!ch.frozenAt).length,
          secrets:b.memory.secrets,aliasStored:"aliasPreview" in b});
      };
    };
  }));
  expect(stored).toEqual({decisions:2,texts:["Mara muore.","Ombra parte."],
    frozen:2,secrets:{},aliasStored:false});
  expect(outbound).toEqual([]);
  const dimensions=await page.evaluate(()=>({
    content:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport+1);
});


test("alias motivati desktop/mobile: salva, riapri, rettifica e isola canone e rete",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Alias persistenti");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Il nome Ombra compare dopo la morte di Mara.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const tx=req.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {id:string;status:string;phase:string;chapters:unknown[];
          remote?:unknown};
        b.status="paused";b.phase="completed";
        b.remote={owner:"writer",repository:"novel",branch:"main",autoSync:true};
        b.chapters=[
          {id:"ac1",number:1,title:"Prima",purpose:"Morte",
            frozenAt:"2026-11-07T10:00:00Z",
            scenes:[{id:"as1",number:1,title:"Scena",objective:"Trama",
              text:"Mara muore.",status:"canon"}]},
          {id:"ac2",number:2,title:"Seconda",purpose:"Viaggio",
            frozenAt:"2026-11-07T11:00:00Z",
            scenes:[{id:"as2",number:1,title:"Scena",objective:"Trama",
              text:"Ombra parte.",status:"canon"}]},
        ];
        store.put(b,b.id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  await board.locator("summary").filter({hasText:"Indice eventi candidati"}).click();
  const notes=board.getByRole("textbox",{name:/Motivazione evento/});
  const outbound:string[]=[];
  page.on("request",r=>{
    if(r.url().includes("api.openai.com")||r.url().includes("api.github.com"))
      outbound.push(r.url());
  });
  await notes.nth(0).fill("L'autore attesta la prima menzione.");
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Annota come avvenuto"}).nth(0).click();
  await notes.nth(1).fill("L'autore attesta la seconda menzione.");
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Annota come avvenuto"}).nth(1).click();
  const hints=board.locator('details[aria-label="Tracce di continuità da verificare"]');
  await hints.locator("summary").first().click();
  await hints.getByRole("combobox",{name:"Primo nome del confronto"}).selectOption("Mara");
  await hints.getByRole("combobox",{name:"Secondo nome del confronto"}).selectOption("Ombra");
  await hints.getByRole("textbox",{name:"Motivazione decisione alias"})
    .fill("Ombra è il soprannome di Mara nella versione attuale.");
  page.once("dialog",d=>d.accept());
  await hints.getByRole("button",{name:"Registra legame motivato"}).click();
  await expect(hints.locator("summary").first()).toContainText("(1)");
  await expect(hints.getByText(/Alias motivato in registro:/)).toBeVisible();
  await expect(hints.locator("p").filter({hasText:"Motivazione del legame:"}).first()).toBeVisible();
  await page.reload();
  const reopened=page.getByRole("region",{name:"Redazione multi-agente"});
  await reopened.locator("summary").filter({hasText:"Indice eventi candidati"}).click();
  const restored=reopened.locator('details[aria-label="Tracce di continuità da verificare"]');
  await expect(restored.locator("summary").first()).toContainText("(1)");
  await restored.locator("summary").first().click();
  await expect(restored.getByText(/Alias motivato in registro:/)).toBeVisible();
  await restored.getByRole("combobox",{name:"Primo nome del confronto"}).selectOption("Mara");
  await restored.getByRole("combobox",{name:"Secondo nome del confronto"}).selectOption("Ombra");
  await restored.getByRole("textbox",{name:"Motivazione decisione alias"})
    .fill("L'autore ha rettificato il collegamento: sono distinti.");
  page.once("dialog",d=>d.accept());
  await restored.getByRole("button",{name:"Escludi legame motivato"}).click();
  await expect(restored.locator("summary").first()).toContainText("(0)");
  const audit=restored.locator('details[aria-label="Storico decisioni alias"]');
  await audit.locator("summary").click();
  await expect(audit.locator("summary")).toContainText("(0 legami correnti)");
  await expect(audit.getByText(/storico\/non corrente/)).toHaveCount(1);
  await page.reload();
  const after=page.getByRole("region",{name:"Redazione multi-agente"});
  await after.locator("summary").filter({hasText:"Indice eventi candidati"}).click();
  await expect(after.locator('details[aria-label="Tracce di continuità da verificare"] summary').first())
    .toContainText("(0)");
  const stored=await page.evaluate(()=>new Promise<{
    aliases:number;events:number;autosync:boolean|undefined;texts:string[];frozen:number;secrets:unknown;
  }>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const q=req.result.transaction("books","readonly").objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          narrativeAliasDecisions:unknown[];narrativeEventDecisions:unknown[];
          remote?:{autoSync?:boolean};memory:{secrets:unknown};
          chapters:Array<{frozenAt?:string;scenes:Array<{text:string}>}>;
        };
        resolve({aliases:b.narrativeAliasDecisions.length,events:b.narrativeEventDecisions.length,
          autosync:b.remote?.autoSync,
          texts:b.chapters.map(ch=>ch.scenes[0]!.text),
          frozen:b.chapters.filter(ch=>!!ch.frozenAt).length,secrets:b.memory.secrets});
      };
    };
  }));
  expect(stored).toEqual({aliases:2,events:2,autosync:false,
    texts:["Mara muore.","Ombra parte."],frozen:2,secrets:{}});
  expect(outbound).toEqual([]);
  const dimensions=await page.evaluate(()=>({
    content:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport+1);
});
