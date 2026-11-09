import { expect, test } from "@playwright/test";

test("rivalidazione di valle desktop/mobile: origine, rewind, messaggio e nessuna rete",async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Il segreto torna");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara cambia una decisione e le conseguenze nei capitoli seguenti.");
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
        const at="2026-11-06T12:00:00.000Z";
        book.status="paused";book.phase="completed";
        book.bookSummary="Mara conserva la chiave attraverso tre capitoli.";
        book.chapters=[1,2,3].map(number=>({
          id:"ch-"+number,number,title:"Capitolo "+number,purpose:"Mostrare le conseguenze",
          frozenAt:at,summary:"Sinossi del capitolo "+number,
          bookSummaryAtFreeze:"Sinossi completa fino al capitolo "+number,
          scenes:[{id:"s-"+number,number:1,title:"Scena",objective:"Proseguire",
            text:number===1?"Mara consegna la chiave a Elio.":"Mara incontra un guardiano mentre custodisce una chiave.",status:"canon",
            characters:["Mara"],items:["chiave"]}],
        }));
        store.put(book,book.id as string);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  const eventSummary=board.locator("summary").filter({hasText:"Indice eventi candidati"});
  await expect(eventSummary).toContainText("(1)");
  await eventSummary.click();
  await expect(board.getByText("«Mara consegna la chiave a Elio»")).toBeVisible();
  await expect(board.getByText(/Testo letterale a offset 0/)).toBeVisible();
  const outbound:string[]=[];
  page.on("request",req=>{
    if(req.url().includes("api.openai.com")||req.url().includes("it.wikipedia.org"))
      outbound.push(req.url());
  });
  page.once("dialog",dialog=>{
    expect(dialog.message()).toContain("capitolo e i successivi");
    return dialog.accept();
  });
  await board.getByRole("button",{name:"Rivaluta"}).first().click();
  await expect(board.locator('[aria-label="Rivalidazione capitolo 2"]'))
    .toContainText("modifica a monte nel capitolo 1");
  await expect(board.locator('[aria-label="Rivalidazione capitolo 2"]'))
    .toContainText("scene pertinenti anche nei capitoli intermedi");
  await expect(board.locator('[aria-label="Rivalidazione capitolo 2"]'))
    .toContainText("letteralmente nella prosa precedente senza tag");
  await expect(board.locator('[aria-label="Rivalidazione capitolo 2"]'))
    .toContainText("non prova una contraddizione");
  await expect(board.locator('[aria-label="Rivalidazione capitolo 2"]'))
    .toContainText("priorità a nomi e parole intere, con offset della prosa originale");
  await expect(board.locator('[aria-label="Rivalidazione capitolo 2"]'))
    .toContainText("il limite di 1.600 viene");
  await expect(board.locator('[aria-label="Rivalidazione capitolo 2"]'))
    .toContainText("due riferimenti distanti ricevono");
  await expect(board.locator('[aria-label="Rivalidazione capitolo 2"]'))
    .toContainText("anche se un nome viene ripetuto più avanti");
  await expect(board.locator('[aria-label="Rivalidazione capitolo 3"]'))
    .toContainText("altrimenti resta un frammento di contesto");
  await expect(board.locator('[aria-label="Rivalidazione capitolo 2"]'))
    .toContainText("evita riscontri di nomi e parole");
  await expect(board.locator('[aria-label="Rivalidazione capitolo 3"]'))
    .toContainText("spezzati artificialmente dai confini degli estratti");
  await expect(board.locator('[aria-label="Rivalidazione capitolo 3"]'))
    .toContainText("distribuito tra capitoli per conservare origine e ultimo predecessore");
  await expect(board.locator('[aria-label="Rivalidazione capitolo 3"]'))
    .toContainText("modifica a monte nel capitolo 1");
  await expect(board.getByText(/Capitolo riaperto. Premi Riprendi/)).toBeVisible();
  const actual=await page.evaluate(()=>new Promise<{
    frozen:boolean[];pending:Array<string|null>;cycle:string|null;status:string;
  }>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const q=open.result.transaction("books","readonly").objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          chapters:Array<{frozenAt?:string;continuityRecheck?:{originChapterId:string}}>;
          editorialCycle?:{chapterId:string};status:string;
        };
        resolve({frozen:b.chapters.map(ch=>!!ch.frozenAt),
          pending:b.chapters.map(ch=>ch.continuityRecheck?.originChapterId??null),
          cycle:b.editorialCycle?.chapterId??null,status:b.status});
      };
    };
  }));
  expect(actual).toEqual({
    frozen:[false,false,false],pending:[null,"ch-1","ch-1"],
    cycle:"ch-1",status:"paused",
  });
  expect(outbound).toEqual([]);
  const size=await page.evaluate(()=>({
    scroll:document.documentElement.scrollWidth,width:window.innerWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.width+1);
});
