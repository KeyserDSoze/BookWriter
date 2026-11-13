import { expect, test } from "@playwright/test";

test("un summary solo-spazi non congela un capitolo approvato (desktop/mobile)",async({page})=>{
  test.setTimeout(90_000);
  let providerCalls=0;
  await page.route("https://api.openai.com/v1/chat/completions",async route=>{
    providerCalls++;
    await route.fulfill({
      status:200,headers:{"access-control-allow-origin":"*",
        "content-type":"application/json"},
      body:JSON.stringify({
        choices:[{message:{content:JSON.stringify({
          chapterSummary:" ".repeat(60),
          bookSummary:"  \n\t".repeat(35),
        })}}],
        usage:{prompt_tokens:243,completion_tokens:72},
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"})
    .fill("Mara incontra il guardiano");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Un romanzo con un guardiano e una porta segreta.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const opened=indexedDB.open("bookwriter");
    opened.onerror=()=>reject(opened.error);
    opened.onsuccess=()=>{
      const db=opened.result,tx=db.transaction("books","readwrite");
      const store=tx.objectStore("books"),request=store.getAll();
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const book=request.result[0] as Record<string,unknown>;
        const narrative="Mara incontra il guardiano davanti al portone del castello.";
        let hash=2166136261;
        for(let i=0;i<narrative.length;i++)
          hash=Math.imul(hash ^ narrative.charCodeAt(i),16777619);
        const stamp=narrative.length+":"+(hash>>>0).toString(16).padStart(8,"0");
        const roles=["continuity","secrets","timeline","historical",
          "characterVoice","style","narrative","readerGenre","readerCasual",
          "readerSkeptic","readerCharacters","readerMystery"];
        book.status="paused";
        book.phase="chapterReview";
        book.bookSummary="Mara custodisce un segreto non ancora rivelato.";
        book.chapters=[{id:"chapter-1",number:1,title:"Il portone",
          purpose:"Aprire il mistero del castello",
          scenes:[{id:"scene-1",number:1,title:"L'incontro",
            objective:"Mostrare il guardiano",text:narrative,status:"canon"}]}];
        book.editorialCycle={
          chapterId:"chapter-1",round:1,stage:"summary",
          reports:roles.map(role=>({
            role,segmentIndex:0,segmentCount:1,segmentTextStamp:stamp,
            verdict:"pass",summary:"Nessuna contraddizione narrativa dimostrata.",
            memoryNote:"",createdAt:"2026-11-10T09:00:00.000Z",findings:[],
          })),
          repairCursor:0,summaryCursor:0,priorRounds:[],
          judgment:{
            reasoning:"Tutti i dodici revisori hanno esaminato il segmento senza criticità provate.",
            decisions:[],verdict:"freeze",createdAt:"2026-11-10T09:30:00.000Z",
          },
        };
        store.put(book,book.id as string);
      };
      tx.onerror=()=>reject(tx.error);
      tx.oncomplete=()=>{db.close();resolve();};
    };
  }));
  await page.reload();
  await page.evaluate(() => { location.hash = "#/dashboard"; });
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?
      "Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await page.getByLabel("API key").fill("sk-test-whitespace-summary-only");
  await page.getByRole("textbox",{name:"Modello predefinito"})
    .fill("mock-summary-whitespace");
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();
  await page.evaluate(() => { location.hash = "#/dashboard"; });
  const panel=page.getByRole("region",{name:"Redazione multi-agente"});
  await expect(panel.getByText(/Tornata 1\/3/)).toBeVisible();
  await page.getByRole("button",{name:"Riprendi"}).click();

  const snapshot=()=>page.evaluate(()=>new Promise<{
    status:string;phase:string;stage:string;reports:number;
    frozen:boolean;chapterSummary?:string;bookSummary?:string;scene:string;
    attempts:number;failedSummaries:number;input?:number;output?:number;
  }>((resolve,reject)=>{
    const opened=indexedDB.open("bookwriter");
    opened.onerror=()=>reject(opened.error);
    opened.onsuccess=()=>{
      const db=opened.result;
      const tx=db.transaction(["books","activities"],"readonly");
      const br=tx.objectStore("books").getAll();
      const ar=tx.objectStore("activities").getAll();
      tx.onerror=()=>reject(tx.error);
      tx.oncomplete=()=>{
        const b=br.result[0] as {
          phase:string;status:string;bookSummary?:string;
          editorialCycle:{stage:string;reports:unknown[]};
          chapters:Array<{frozenAt?:string;summary?:string;
            scenes:Array<{text:string}>}>;
        };
        const activities=ar.result as Array<{aiRequested?:boolean;
          title:string;status:string;inputTokens?:number;outputTokens?:number}>;
        const attempted=activities.filter(x=>x.aiRequested);
        const summary=attempted.find(x=>x.title.includes("Sinossi"));
        resolve({status:b.status,phase:b.phase,stage:b.editorialCycle.stage,
          reports:b.editorialCycle.reports.length,
          frozen:!!b.chapters[0]!.frozenAt,
          chapterSummary:b.chapters[0]!.summary,
          bookSummary:b.bookSummary,scene:b.chapters[0]!.scenes[0]!.text,
          attempts:attempted.length,
          failedSummaries:attempted.filter(x=>x.title.includes("Sinossi")&&
            x.status==="failed").length,
          input:summary?.inputTokens,output:summary?.outputTokens});
        db.close();
      };
    };
  }));
  await expect.poll(async()=>(await snapshot()).status,{timeout:30_000}).toBe("error");
  expect(await snapshot()).toMatchObject({
    status:"error",phase:"chapterReview",stage:"summary",reports:12,
    frozen:false,bookSummary:"Mara custodisce un segreto non ancora rivelato.",
    scene:"Mara incontra il guardiano davanti al portone del castello.",
    attempts:1,failedSummaries:1,input:243,output:72,
  });
  expect((await snapshot()).chapterSummary).toBeUndefined();
  expect(providerCalls).toBe(1);
});
