import { expect, test } from "@playwright/test";

test("proposte storiche locali desktop/mobile: bozza, riservatezza e consenso prima della rete", async ({page})=>{
  const wikiCalls:string[]=[];
  const aiCalls:string[]=[];
  await page.route(/https:\/\/it\.wikipedia\.org\/w\/api\.php\?/,async route=>{
    wikiCalls.push(route.request().url());
    await route.fulfill({status:200,headers:{
      "content-type":"application/json","access-control-allow-origin":"*",
    },body:JSON.stringify({query:{pages:[{
      pageid:42,title:"Telegrafo",canonicalurl:"https://it.wikipedia.org/wiki/Telegrafo",
      extract:"Il telegrafo elettrico si diffuse in Europa durante il XIX secolo.",
      revisions:[{revid:321}],
    }]}})});
  });
  page.on("request",req=>{
    if(req.url().includes("api.openai.com"))aiCalls.push(req.url());
  });
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Cronache del XIX secolo");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Una storia sull'arrivo delle prime tecnologie.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const request=store.getAll();
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const book=request.result[0] as Record<string,unknown>;
        book.status="paused"; book.phase="prose";
        book.chapters=[{
          id:"historical-hint",number:1,title:"Il dispaccio",purpose:"Far emergere il dubbio",
          scenes:[{
            id:"scene-hint",number:1,title:"Messaggio",objective:"Informare",
            status:"canon",
            text:"Nel 1848 Mara usa il telegrafo elettrico. " +
              "Il segreto di Alina è custodito sotto la scala, nessuno deve scoprirlo.",
          }],
        }];
        (book.memory as {secrets:Record<string,string>}).secrets.chiave=
          "La chiave apre la camera nascosta dove si trova Alina.";
        store.put(book,book.id as string);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const editorial=page.getByRole("region",{name:"Redazione multi-agente"});
  await editorial.locator("summary").filter({hasText:"Dossier storico"}).click();
  const draft=editorial.getByRole("textbox",{name:"Ricerche storiche capitolo 1"});
  await expect(draft).toHaveValue("");
  await editorial.getByRole("button",{name:"Genera proposte locali"}).click();
  const local=editorial.locator('[aria-label="Proposte di ricerca solo locali"]');
  await expect(local.getByText("Telegrafo elettrico 1848")).toBeVisible();
  await expect(draft).toHaveValue("");
  expect(wikiCalls).toHaveLength(0);
  expect(aiCalls).toHaveLength(0);
  expect(await local.innerText()).not.toMatch(/Mara|Alina|segreto|chiave|scala/i);
  await local.getByRole("button",{name:"Aggiungi alla bozza: Telegrafo elettrico 1848"}).click();
  await expect(draft).toHaveValue("Telegrafo elettrico 1848");
  expect(wikiCalls).toHaveLength(0);
  page.once("dialog",dialog=>{
    expect(dialog.message()).toContain("Telegrafo elettrico 1848");
    expect(dialog.message()).not.toMatch(/Mara|Alina|chiave|scala/i);
    return dialog.dismiss();
  });
  await editorial.getByRole("button",{name:"Cerca fonti pubbliche"}).click();
  expect(wikiCalls).toHaveLength(0);
  await expect(draft).toHaveValue("Telegrafo elettrico 1848");
  page.once("dialog",dialog=>{
    expect(dialog.message()).toContain("CONSENSO ALLA RICERCA ESTERNA");
    expect(dialog.message()).toContain("Telegrafo elettrico 1848");
    expect(dialog.message()).not.toMatch(/Mara|Alina|scala/i);
    return dialog.accept();
  });
  await editorial.getByRole("button",{name:"Cerca fonti pubbliche"}).click();
  await expect(editorial.getByRole("link",{name:/Telegrafo/})).toBeVisible({timeout:15_000});
  expect(wikiCalls).toHaveLength(1);
  const sent=new URL(wikiCalls[0]!);
  expect(sent.toString()).not.toMatch(/Mara|Alina|chiave|scala/i);
  expect(sent.searchParams.toString()).toContain("Telegrafo");
  expect(aiCalls).toHaveLength(0);
  const width=await page.evaluate(()=>({
    actual:document.documentElement.scrollWidth, expected:window.innerWidth,
  }));
  expect(width.actual).toBeLessThanOrEqual(width.expected+1);
});
