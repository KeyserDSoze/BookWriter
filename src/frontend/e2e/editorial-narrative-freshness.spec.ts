import { expect, test } from "@playwright/test";

test("testimone precedente ritirato: blocco del giudice e recupero senza AI (desktop/mobile)", async ({ page }) => {
  let providerCalls = 0;
  await page.route("https://api.openai.com/v1/chat/completions", async route => {
    providerCalls++;
    await route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*",
      "content-type": "application/json" },
      body: JSON.stringify({ error: { message: "Non chiamare il giudice su testimoni non correnti." } }) });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Titolo provvisorio" }).fill("Mara e la chiave");
  await page.getByRole("textbox", { name: "Descrizione iniziale, spunti e vincoli" })
    .fill("La chiave cambia luogo fra due capitoli.");
  await page.getByRole("button", { name: "Crea libro" }).click();

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const opened = indexedDB.open("bookwriter");
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result, tx = db.transaction("books", "readwrite");
      const store = tx.objectStore("books"), req = store.getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const book = req.result[0] as Record<string, unknown>;
        const prior = "Mara nasconde la chiave nel pozzo durante la notte.";
        const narrative = "Mara porta la chiave alla torre e ripensa alle azioni della notte.";
        const quote = "Mara porta la chiave alla torre";
        const stamp = (value: string) => {
          let hash = 2166136261;
          for (let i = 0; i < value.length; i++)
            hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
          return value.length + ":" + (hash >>> 0).toString(16).padStart(8, "0");
        };
        book.phase = "chapterReview";
        book.status = "paused";
        book.chapters = [
          { id:"c1",number:1,title:"Il pozzo",purpose:"Nascondere",
            frozenAt:"2026-11-09T17:00:00.000Z",
            scenes:[{id:"s1",number:1,title:"La notte",objective:"Agire",
              text:prior,status:"canon"}] },
          { id:"c2",number:2,title:"La torre",purpose:"Ritrovare",
            scenes:[{id:"s2",number:1,title:"Il ritorno",objective:"Entrare",
              text:narrative,status:"canon"}] },
        ];
        const roles = [
          "continuity","secrets","timeline","historical","characterVoice","style",
          "narrative","readerGenre","readerCasual","readerSkeptic","readerCharacters","readerMystery",
        ];
        const reports = roles.map(role => ({
          role, segmentIndex:0,segmentCount:1,
          verdict:role==="continuity" ? "issues" : "pass",
          summary:"Controllo del segmento concluso.",memoryNote:"",
          createdAt:"2026-11-09T18:00:00.000Z",
          segmentTextStamp:stamp(narrative),
          findings:role!=="continuity" ? [] : [{
            id:"1:continuity:0:0",sceneId:"s2",category:"continuità",severity:"major",
            evidence:quote,
            reason:"La posizione della chiave richiede un controllo del contesto.",
            remediation:"Chiarire come la chiave sia arrivata nella torre.",
            priorSceneConflict: {
              chapterId:"c1",sceneId:"s1",
              // Il vecchio rapporto citava un freeze ormai ritirato.
              sourceFrozenAt:"2026-11-08T10:00:00.000Z",
              sourceTextStamp:stamp(prior),offset:0,quote:prior.slice(0,32),
              dimension:"causality",
              hypothesis:"La chiave potrebbe trovarsi in posizioni incompatibili fra i capitoli.",
            },
            evidenceAnchor:{segmentIndex:0,offset:narrative.indexOf(quote),
              quote,occurrences:1,context:narrative},
          }],
        }));
        book.editorialCycle = {
          chapterId:"c2",round:1,stage:"adjudicate",
          reports,repairCursor:0,priorRounds:[],
        };
        store.put(book,book.id as string);
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {db.close();resolve();};
    };
  }));

  const nav = page.getByRole("navigation", {
    name: test.info().project.name === "mobile-chromium" ?
      "Navigazione mobile" : "Navigazione principale",
  });
  await nav.getByRole("button", { name:"Impostazioni" }).click();
  await page.getByLabel("API key").fill("sk-test-narrative-freshness-not-real");
  await page.getByRole("textbox", { name:"Modello predefinito" }).fill("mock-narrative-judge");
  await page.getByRole("button", { name:"Salva impostazioni" }).click();
  await page.reload();
  const panel = page.getByRole("region", { name:"Redazione multi-agente" });
  await expect(panel.getByLabel("Checkpoint editoriale da recuperare")).toBeVisible();
  await expect(panel.getByText(/Testimone narrativo precedente non più corrente/)).toBeVisible();
  await expect(panel.getByRole("button",{name:"Recupera checkpoint e ricomincia"})).toBeEnabled();
  await page.getByRole("button",{name:"Riprendi"}).click();
  await expect.poll(() => page.evaluate(() => new Promise<{status:string;frozen:boolean;count:number}>((resolve,reject)=>{
    const opened=indexedDB.open("bookwriter");
    opened.onerror=()=>reject(opened.error);
    opened.onsuccess=()=>{
      const db=opened.result,req=db.transaction("books","readonly").objectStore("books").getAll();
      req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{
        const book=req.result[0] as {
          status:string;editorialCycle:{reports:unknown[]};
          chapters:Array<{frozenAt?:string}>;
        };
        resolve({status:book.status,count:book.editorialCycle.reports.length,
          frozen:!!book.chapters[1]?.frozenAt});
        db.close();
      };
    };
  })),{timeout:30_000}).toMatchObject({status:"error",count:12,frozen:false});
  expect(providerCalls).toBe(0);
});
