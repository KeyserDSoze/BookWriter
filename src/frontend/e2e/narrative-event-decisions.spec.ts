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
  await hints.locator("summary").click();
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
