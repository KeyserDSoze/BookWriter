import { expect, test } from "@playwright/test";

test("prova letterale verificata e report legacy: indicazione chiara desktop/mobile",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"})
    .fill("Il rapporto editoriale");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("La protagonista riceve una lettera misteriosa.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const book=q.result[0] as Record<string,unknown>;
        const t="2026-11-06T16:00:00.000Z";
        const prose="Nel corridoio Mara trova una lettera sul pavimento. La piega con cautela.";
        const evidence="Mara trova una lettera";
        const anchorAt=prose.indexOf(evidence);
        const finding=(id:string,withAnchor:boolean)=>({
          id,sceneId:"scene-1",category:"ritmo",severity:"minor",
          evidence,reason:"La scena richiede un controllo del ritmo narrativo.",
          remediation:"Valutare il passaggio prima di modificare la prosa.",
          ...(withAnchor?{evidenceAnchor:{
            segmentIndex:0,offset:anchorAt,quote:evidence,occurrences:1,
            context:prose.slice(0,Math.min(prose.length,anchorAt+evidence.length+100)),
          }}:{}),
        });
        book.phase="chapterReview";book.status="paused";
        book.chapters=[{id:"ch-1",number:1,title:"La lettera",purpose:"Creare tensione",
          scenes:[{id:"scene-1",number:1,title:"La scoperta",
            objective:"Trovare la lettera",text:prose,status:"canon"}]}];
        book.editorialCycle={
          chapterId:"ch-1",round:1,stage:"review",reports:[
            {role:"style",segmentIndex:0,segmentCount:1,verdict:"issues",
              summary:"Un rilievo sulla prosa.",memoryNote:"",createdAt:t,
              findings:[finding("1:style:0:0",true)]},
            {role:"readerCasual",segmentIndex:0,segmentCount:1,verdict:"issues",
              summary:"Un vecchio rilievo.",memoryNote:"",createdAt:t,
              findings:[finding("1:readerCasual:0:0",false)]},
          ],repairCursor:0,priorRounds:[],
        };
        store.put(book,book.id as string);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  await board.locator("summary").filter({hasText:"Stile e lingua"}).first().click();
  const verified=board.getByLabel("Prova narrativa verificata 1:style:0:0");
  await expect(verified.getByText(/Citazione letterale nel segmento 1/)).toBeVisible();
  await expect(verified.getByText(/Testo trovato:.*Mara trova una lettera/)).toBeVisible();
  await expect(verified.getByText(/Corrispondenza di testo, NON prova/)).toBeVisible();
  await board.locator("summary").filter({hasText:"Lettore generalista"}).first().click();
  await expect(board.getByText(/Report precedente, modificato o senza ancoraggio valido/))
    .toBeVisible();
  const dimensions=await page.evaluate(()=>({
    scroll:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport+1);
});
