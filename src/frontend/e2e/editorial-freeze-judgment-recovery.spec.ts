import { expect, test } from "@playwright/test";

test("freeze importato senza decisioni: stop e recupero supervisionato, nessun AI (desktop/mobile)",async({page})=>{
  test.setTimeout(90_000);
  let providerCalls=0;
  await page.route("https://api.openai.com/v1/chat/completions",async route=>{
    providerCalls++;
    await route.fulfill({status:500,body:"{}"});
  });
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"})
    .fill("Mara davanti al portone");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara incontrerà un guardiano misterioso.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const opened=indexedDB.open("bookwriter");
    opened.onerror=()=>reject(opened.error);
    opened.onsuccess=()=>{
      const db=opened.result,tx=db.transaction("books","readwrite"),
        request=tx.objectStore("books").getAll();
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const book=request.result[0] as Record<string,unknown>;
        const narrative="Mara incontra il guardiano davanti al portone del castello.";
        const quote="Mara incontra il guardiano";
        let hash=2166136261;
        for(let i=0;i<narrative.length;i++)
          hash=Math.imul(hash ^ narrative.charCodeAt(i),16777619);
        const stamp=narrative.length+":"+(hash>>>0).toString(16).padStart(8,"0");
        book.phase="chapterReview";book.status="paused";
        book.chapters=[{id:"c1",number:1,title:"Il portone",
          purpose:"Incontrare il guardiano",scenes:[{id:"s1",number:1,
            title:"L'arrivo",objective:"Aprire il mistero",
            text:narrative,status:"canon"}]}];
        const roles=["continuity","secrets","timeline","historical",
          "characterVoice","style","narrative","readerGenre","readerCasual",
          "readerSkeptic","readerCharacters","readerMystery"];
        const reports=roles.map(role=>({
          role,segmentIndex:0,segmentCount:1,segmentTextStamp:stamp,
          verdict:role==="style"?"issues":"pass",
          summary:"Controllo indipendente della scena completato.",
          memoryNote:"",createdAt:"2026-11-10T00:15:00.000Z",
          findings:role==="style"?[{
            id:"1:style:0:0",sceneId:"s1",category:"stile",severity:"minor",
            evidence:quote,reason:"L'incipit può richiedere un ritmo più attento.",
            remediation:"Riformulare il ritmo dell'incontro senza cambiare la scena.",
            evidenceAnchor:{segmentIndex:0,offset:0,quote,
              occurrences:1,context:narrative},
          }]:[],
        }));
        book.editorialCycle={chapterId:"c1",round:1,stage:"summary",
          reports,repairCursor:0,summaryCursor:0,priorRounds:[],
          judgment:{
            reasoning:"Il direttore dichiara un freeze senza aver valutato il rilievo.",
            decisions:[],verdict:"freeze",createdAt:"2026-11-10T00:20:00.000Z",
          }};
        tx.objectStore("books").put(book,book.id as string);
      };
      tx.onerror=()=>reject(tx.error);
      tx.oncomplete=()=>{db.close();resolve();};
    };
  }));
  await page.reload();
  const panel=page.getByRole("region",{name:"Redazione multi-agente"});
  await expect(panel.getByLabel("Checkpoint editoriale da recuperare")).toBeVisible();
  await expect(panel.getByText(/non ha valutato tutti/)).toBeVisible();
  await page.getByRole("button",{name:"Riprendi"}).click();
  const state=()=>page.evaluate(()=>new Promise<{
    status:string;stage:string;reports:number;frozen:boolean;scene:string;
    archives:number;oldVerdict?:string;
  }>((resolve,reject)=>{
    const opened=indexedDB.open("bookwriter");
    opened.onerror=()=>reject(opened.error);
    opened.onsuccess=()=>{
      const db=opened.result;
      const request=db.transaction("books","readonly").objectStore("books").getAll();
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const b=request.result[0] as {
          status:string;editorialCycle:{stage:string;reports:unknown[]};
          editorialRecoveryArchives?:Array<{cycle:{judgment?:{verdict:string}}}>;
          chapters:Array<{frozenAt?:string;scenes:Array<{text:string}>}>;
        };
        resolve({status:b.status,stage:b.editorialCycle.stage,
          reports:b.editorialCycle.reports.length,
          frozen:!!b.chapters[0]?.frozenAt,
          scene:b.chapters[0]!.scenes[0]!.text,
          archives:b.editorialRecoveryArchives?.length??0,
          oldVerdict:b.editorialRecoveryArchives?.[0]?.cycle.judgment?.verdict});
        db.close();
      };
    };
  }));
  await expect.poll(async()=>(await state()).status,{timeout:30_000}).toBe("error");
  expect(await state()).toMatchObject({
    status:"error",stage:"summary",reports:12,frozen:false,archives:0,
    scene:"Mara incontra il guardiano davanti al portone del castello.",
  });
  expect(providerCalls).toBe(0);
  const recover=panel.getByRole("button",{name:"Recupera checkpoint e ricomincia"});
  await expect(recover).toBeEnabled();
  page.once("dialog",d=>void d.dismiss());
  await recover.click();
  expect((await state()).archives).toBe(0);
  page.once("dialog",d=>void d.accept());
  await recover.click();
  await expect(panel.getByText(/Checkpoint archiviato/)).toBeVisible();
  expect(await state()).toMatchObject({
    status:"paused",stage:"review",reports:0,frozen:false,archives:1,
    oldVerdict:"freeze",
    scene:"Mara incontra il guardiano davanti al portone del castello.",
  });
  expect(providerCalls).toBe(0);
});
