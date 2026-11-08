import {expect,test} from "@playwright/test";

test("capitolo congelato: annotazione storica privata, reset e refreeze desktop/mobile",
  async({page})=>{
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"})
    .fill("Mara e la lettera");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Una scena ha ricevuto consigli divergenti dai revisori.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as Record<string,unknown>;
        const at="2026-11-08T15:45:00.000Z";
        const text="Nel corridoio Mara trova una lettera sul pavimento. La piega con cautela.";
        const quote="Mara trova una lettera";
        const offset=text.indexOf(quote);
        const anchor={segmentIndex:0,offset,quote,occurrences:1,
          context:text.slice(Math.max(0,offset-100),
            Math.min(text.length,offset+quote.length+100))};
        const finding=(role:string,proposal:string)=>({
          id:"1:"+role+":0:0",sceneId:"s1",category:"ritmo",severity:"major",
          evidence:quote,evidenceAnchor:anchor,
          reason:"Il passaggio presenta un dettaglio che può essere letto in modi diversi.",
          remediation:proposal,
        });
        b.status="paused";b.phase="chapterReview";
        b.chapters=[{id:"c1",number:1,title:"La scoperta",
          purpose:"Rivelazione",scenes:[{id:"s1",number:1,title:"La lettera",
            objective:"Mantenere il mistero",text,status:"canon"}]}];
        b.editorialCycle={
          chapterId:"c1",round:1,stage:"blocked",repairCursor:0,priorRounds:[],
          reports:[
            {role:"style",segmentIndex:0,segmentCount:1,verdict:"issues",
              summary:"Serve valutare il ritmo.",memoryNote:"",createdAt:at,
              findings:[finding("style","Accorciare la frase per ottenere maggiore rapidità.")]},
            {role:"narrative",segmentIndex:0,segmentCount:1,verdict:"issues",
              summary:"Serve valutare la suspense.",memoryNote:"",createdAt:at,
              findings:[finding("narrative","Conservare la pausa per aumentare l'incertezza.")]},
          ],
          judgment:{reasoning:"Le raccomandazioni sono alternative, ma la prosa non mostra una contraddizione certa.",
            decisions:[
              {findingId:"1:style:0:0",action:"reject",
                rationale:"Il dettaglio può restare senza modifiche obbligatorie.",remediation:""},
              {findingId:"1:narrative:0:0",action:"reject",
                rationale:"Il dettaglio non giustifica una seconda correzione.",remediation:""},
            ],
            recommendationReconciliations:[{
              findingIds:["1:narrative:0:0","1:style:0:0"],
              resolution:"reject_all",evidenceAssessment:"unresolved",
              rationale:"I revisori vedono la stessa citazione, ma offrono soluzioni artistiche differenti.",
              missingEvidence:"Non sappiamo se l'effetto desiderato sia velocità oppure suspense crescente.",
              nextCheck:"Chiedere all'autore quale ritmo narrativo intende ottenere in questa scena.",
            }],
            verdict:"freeze",createdAt:at,
          },
        };
        store.put(b,b.id as string);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
      };
    };
  }));


  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite");
      const store=tx.objectStore("books"),q=store.getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const book=q.result[0] as {
          id:string;editorialCycle?:{
            round:number;reports:unknown[];judgment:unknown;
          };
          chapters:Array<{frozenAt?:string;editorialRounds?:unknown[]}>;
        };
        const cycle=book.editorialCycle!;
        book.chapters[0]!.frozenAt="2026-11-08T16:00:00.000Z";
        book.chapters[0]!.editorialRounds=[{
          round:cycle.round,reports:cycle.reports,judgment:cycle.judgment,
        }];
        delete book.editorialCycle;
        store.put(book,book.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const openArchive=async()=>{
    const board=page.getByRole("region",{name:"Redazione multi-agente"});
    await board.locator("summary").filter({hasText:"Giudizi archiviati (1)"}).click();
    const plan=board.getByRole("region",{name:"Piano verifiche editoriali"});
    await expect(plan.getByText(/1 storici/)).toBeVisible();
    const item=plan.locator("details").first();
    await expect(item.locator(":scope > summary")).toContainText("Storico:");
    await item.locator(":scope > summary").click();
    const control=item.locator('details[aria-label="Scelta autore sul controllo editoriale"]');
    await expect(control).toHaveCount(1);
    return {plan,item,control};
  };
  let {control}=await openArchive();
  await expect(control.locator(":scope > summary"))
    .toContainText("Annotazione storica dell'autore");
  await control.locator(":scope > summary").click();
  const note=control.getByRole("textbox",{name:"Motivazione scelta controllo editoriale"});
  await note.fill("NOTA_PRIVATA_ARCHIVIO: approfondirò manualmente il ritmo della scena.");
  page.once("dialog",dialog=>dialog.accept());
  await control.getByRole("button",{name:"Prendi in carico"}).click();
  await expect(control.locator(":scope > summary")).toContainText("presa in carico");
  await note.fill("NOTA_PRIVATA_ARCHIVIO: non ritengo necessario seguire il vecchio controllo.");
  page.once("dialog",dialog=>dialog.accept());
  await control.getByRole("button",{name:"Respingi suggerimento"}).click();
  await expect(control.locator(":scope > summary")).toContainText("respinta");
  await note.fill("NOTA_PRIVATA_ARCHIVIO: azzero la scelta mantenendo lo storico.");
  page.once("dialog",dialog=>dialog.accept());
  await control.getByRole("button",{name:"Azzera scelta"}).click();
  await expect(control.locator(":scope > summary")).toContainText("nessuna scelta attiva");
  await expect(control.getByText(/Storico delle scelte \(3\)/)).toBeVisible();
  const stored=await page.evaluate(()=>new Promise<{
    statuses:string[];frozenAt:string|undefined;hasCycle:boolean;text:string;
  }>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readonly"),q=tx.objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          editorialVerificationChoices?:Array<{status:string}>;
          editorialCycle?:unknown;
          chapters:Array<{frozenAt?:string;scenes:Array<{text:string}>}>;
        };
        resolve({
          statuses:(b.editorialVerificationChoices??[]).map(x=>x.status),
          frozenAt:b.chapters[0]!.frozenAt,hasCycle:!!b.editorialCycle,
          text:b.chapters[0]!.scenes[0]!.text,
        });
      };
    };
  }));
  expect(stored.statuses).toEqual(["taken_on","dismissed","reset"]);
  expect(stored.frozenAt).toBe("2026-11-08T16:00:00.000Z");
  expect(stored.hasCycle).toBe(false);
  expect(stored.text).toContain("Mara trova una lettera");
  await page.reload();
  ({control}=await openArchive());
  await expect(control.locator(":scope > summary")).toContainText("nessuna scelta attiva");
  await control.locator(":scope > summary").click();
  await control.getByRole("textbox",{name:"Motivazione scelta controllo editoriale"})
    .fill("NOTA_PRIVATA_ARCHIVIO: ho nuovamente preso in carico il controllo.");
  page.once("dialog",dialog=>dialog.accept());
  await control.getByRole("button",{name:"Prendi in carico"}).click();
  await expect(control.locator(":scope > summary")).toContainText("presa in carico");
  // A subsequent freeze stamp means a DIFFERENT historical context.
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {id:string;chapters:Array<{frozenAt?:string}>};
        b.chapters[0]!.frozenAt="2026-11-08T18:00:00.000Z";
        store.put(b,b.id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  ({control}=await openArchive());
  await expect(control.locator(":scope > summary")).toContainText("nessuna scelta attiva");
  const width=await page.evaluate(()=>({
    full:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(width.full).toBeLessThanOrEqual(width.viewport+1);
});
