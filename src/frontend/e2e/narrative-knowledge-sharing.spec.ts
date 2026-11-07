import {expect,test} from "@playwright/test";

test("consenso conoscenze AI per ruolo: grant, revoca e rettifica desktop/mobile",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("La lettera riservata");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Una notizia conosciuta solo nel sogno di Mara.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const tx=req.result.transaction("books","readwrite"),store=tx.objectStore("books"),
        all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as Record<string,unknown>;
        b.status="paused";b.phase="completed";
        b.remote={owner:"author",repository:"novel",branch:"main",autoSync:true};
        b.chapters=[{id:"ch1",number:1,title:"Il segreto",purpose:"Notizia",
          frozenAt:"2026-11-07T10:00:00.000Z",
          scenes:[{id:"s1",number:1,title:"La scoperta",objective:"Sapere",
            text:"Mara scopre che Elio nasconde la lettera.",status:"canon"}]},
          {id:"ch2",number:2,title:"Il dubbio",purpose:"Scena",
            scenes:[{id:"s2",number:1,title:"Ritorno",objective:"Dubbi",
              text:"Mara osserva la lettera ancora chiusa.",status:"canon"}]}];
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
  await board.getByRole("textbox",{name:/Motivazione evento/})
    .fill("L'autore conferma la presenza della menzione nel romanzo.");
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Annota come avvenuto"}).click();
  await expect(board.getByText(/Interpretazione attuale: annotato come avvenuto/)).toBeVisible();
  const knowledge=board.locator('details[aria-label="Registro conoscenze autore"]');
  await knowledge.locator("> summary").click();
  const note=knowledge.getByRole("textbox",{name:"Motivazione conoscenza autore"});
  await note.fill("La notizia è ancora segreta: Mara sognava soltanto la rivelazione.");
  page.once("dialog",d=>d.accept());
  await knowledge.getByRole("button",{name:"Ancora segreta per il personaggio"}).click();
  await expect(knowledge.locator("> summary")).toContainText("(1 correnti)");

  const shares=knowledge.getByRole("group",{name:"Consenso mirato alle conoscenze"});
  await expect(shares.getByText(/Privato per impostazione predefinita/)).toBeVisible();
  await expect(shares.getByText(/Nessun destinatario attualmente autorizzato/)).toBeVisible();
  expect(await shares.getByRole("checkbox").count()).toBe(5);
  await shares.getByRole("checkbox",{name:"Continuità"}).check();
  await shares.getByRole("checkbox",{name:"Giudice critico"}).check();
  await shares.getByRole("textbox",{name:"Motivazione consenso conoscenza"})
    .fill("Autorizzo solo questi due ruoli al confronto con la menzione precedente.");
  page.once("dialog",d=>d.accept());
  await shares.getByRole("button",{name:"Autorizza destinatari selezionati"}).click();
  await expect(shares.getByText(/Attualmente autorizzati: Continuità, Giudice critico/))
    .toBeVisible();
  await page.reload();
  const reopened=page.getByRole("region",{name:"Redazione multi-agente"});
  await reopened.locator("summary").filter({hasText:"Indice eventi candidati"}).first().click();
  const again=reopened.locator('details[aria-label="Registro conoscenze autore"]');
  await again.locator("> summary").click();
  const shared=again.getByRole("group",{name:"Consenso mirato alle conoscenze"});
  await expect(shared.getByText(/Attualmente autorizzati: Continuità, Giudice critico/))
    .toBeVisible();
  page.once("dialog",d=>d.accept());
  await shared.getByRole("button",{name:"Revoca consenso"}).click();
  await expect(shared.getByText(/Nessun destinatario attualmente autorizzato/)).toBeVisible();

  const selection=await page.evaluate(()=>new Promise<{
    statuses:string[];recipients:string[][];autoSync:boolean;scene:string;secrets:unknown;
  }>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const all=req.result.transaction("books","readonly").objectStore("books").getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as {
          narrativeKnowledgeShareDecisions:Array<{status:string;recipients:string[]}>;
          remote:{autoSync:boolean};
          chapters:Array<{scenes:Array<{text:string}>}>;memory:{secrets:unknown};
        };
        resolve({
          statuses:b.narrativeKnowledgeShareDecisions.map(d=>d.status),
          recipients:b.narrativeKnowledgeShareDecisions.map(d=>d.recipients),
          autoSync:b.remote.autoSync,scene:b.chapters[0]!.scenes[0]!.text,
          secrets:b.memory.secrets,
        });
      };
    };
  }));
  expect(selection).toEqual({
    statuses:["allowed","revoked"],
    recipients:[["continuity","judge"],[]],
    autoSync:false,scene:"Mara scopre che Elio nasconde la lettera.",secrets:{},
  });
  expect(outgoing).toEqual([]);
  const viewport=await page.evaluate(()=>({
    width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width+1);
});
