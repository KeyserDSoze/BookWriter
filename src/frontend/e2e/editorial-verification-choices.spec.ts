import {expect,test} from "@playwright/test";

test("scelta autore sul controllo: grant privato, rifiuto, reset e fonte stale desktop/mobile",
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

  await page.reload();
  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  const plan=board.getByRole("region",{name:"Piano verifiche editoriali"});
  const item=plan.locator("details").first();
  await expect(item.locator("> summary")).toContainText("Da approfondire");
  await item.locator("> summary").click();
  const choice=item.getByRole("group",{name:"Scelta autore sul controllo editoriale"});
  await expect(choice).toHaveCount(1);
  await choice.locator("> summary").click();
  const note=choice.getByRole("textbox",{name:"Motivazione scelta controllo editoriale"});
  const privateNote="NOTA_AUTORE_PRIVATA: ho deciso di approfondire il problema narrativo.";
  await note.fill(privateNote);
  page.once("dialog",dialog=>dialog.accept());
  await choice.getByRole("button",{name:"Prendi in carico"}).click();
  await expect(choice.locator("> summary")).toContainText("presa in carico");
  await note.fill("NOTA_AUTORE_PRIVATA: il controllo non è una priorità e lo respingo.");
  page.once("dialog",dialog=>dialog.accept());
  await choice.getByRole("button",{name:"Respingi suggerimento"}).click();
  await expect(choice.locator("> summary")).toContainText("respinta");
  await note.fill("NOTA_AUTORE_PRIVATA: elimino la mia scelta per rivalutare il dettaglio.");
  page.once("dialog",dialog=>dialog.accept());
  await choice.getByRole("button",{name:"Azzera scelta"}).click();
  await expect(choice.locator("> summary")).toContainText("nessuna scelta attiva");
  await expect(choice.getByText(/Storico delle scelte \(3\)/)).toBeVisible();
  const persisted=await page.evaluate(()=>new Promise<{
    statuses:string[],autoSync:boolean|undefined,
    chapterText:string,judgment:string,
  }>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readonly"),q=tx.objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          editorialVerificationChoices?:Array<{status:string}>;
          remote?:{autoSync:boolean};
          chapters:Array<{scenes:Array<{text:string}>}>;
          editorialCycle?:{judgment:{reasoning:string}};
        };
        resolve({
          statuses:(b.editorialVerificationChoices??[]).map(x=>x.status),
          autoSync:b.remote?.autoSync,
          chapterText:b.chapters[0]!.scenes[0]!.text,
          judgment:b.editorialCycle!.judgment.reasoning,
        });
      };
    };
  }));
  expect(persisted.statuses).toEqual(["taken_on","dismissed","reset"]);
  expect(persisted.chapterText).toContain("Mara trova una lettera");
  expect(persisted.judgment).toContain("raccomandazioni sono alternative");
  await page.reload();
  const resumed=page.getByRole("region",{name:"Piano verifiche editoriali"})
    .locator("details").first();
  await resumed.locator("> summary").click();
  const again=resumed.getByRole("group",{name:"Scelta autore sul controllo editoriale"});
  await expect(again.locator("> summary")).toContainText("nessuna scelta attiva");
  await again.locator("> summary").click();
  await again.getByRole("textbox",{name:"Motivazione scelta controllo editoriale"})
    .fill("NOTA_AUTORE_PRIVATA: riprendo la verifica sul passaggio rimasto aperto.");
  page.once("dialog",dialog=>dialog.accept());
  await again.getByRole("button",{name:"Prendi in carico"}).click();
  await expect(again.locator("> summary")).toContainText("presa in carico");
  // A revised judge suggestion invalidates the previous exact-source choice,
  // without silently carrying it over to another verification.
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          id:string;editorialCycle:{
            judgment:{recommendationReconciliations:Array<{nextCheck:string}>};
          };
        };
        b.editorialCycle.judgment.recommendationReconciliations[0]!.nextCheck=
          "Chiedere all'autore se intende cambiare il punto di vista della scena.";
        store.put(b,b.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const stale=page.getByRole("region",{name:"Piano verifiche editoriali"})
    .locator("details").first();
  await stale.locator("> summary").click();
  const staleChoice=stale.getByRole("group",{name:"Scelta autore sul controllo editoriale"});
  await expect(staleChoice.locator("> summary")).toContainText("nessuna scelta attiva");
  const width=await page.evaluate(()=>({
    full:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(width.full).toBeLessThanOrEqual(width.viewport+1);
});
