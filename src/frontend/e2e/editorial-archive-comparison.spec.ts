import {expect,test} from "@playwright/test";

test("confronta dubbi storici annotati e nuova revisione senza ereditare scelte desktop/mobile",
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
  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  await board.locator("summary").filter({hasText:"Giudizi archiviati (1)"}).click();
  const oldPlan=board.getByRole("region",{name:"Piano verifiche editoriali"});
  const oldEntry=oldPlan.locator("details").first();
  await oldEntry.locator(":scope > summary").click();
  const author=oldEntry.locator(
    'details[aria-label="Scelta autore sul controllo editoriale"]');
  await author.locator(":scope > summary").click();
  await author.getByRole("textbox",{name:"Motivazione scelta controllo editoriale"})
    .fill("NOTA_STORICA_PRIVATA: voglio verificare personalmente il ritmo narrativo.");
  page.once("dialog",dialog=>dialog.accept());
  await author.getByRole("button",{name:"Prendi in carico"}).click();
  await expect(author.locator(":scope > summary")).toContainText("presa in carico");
  const frozenLedger=board.getByRole("region",{
    name:"Registro differenze editoriali capitolo 1",
  });
  await expect(frozenLedger.getByText(/Registro delle differenze editoriali/))
    .toBeVisible();
  await expect(frozenLedger.getByText(/Solo archivio; nessuna revisione corrente/))
    .toBeVisible();
  // Real reopen clears frozenAt but preserves chapter.editorialRounds. The
  // fixture performs this transition directly, without making any AI call.
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          id:string;status:string;phase:string;
          editorialCycle?:unknown;
          chapters:Array<{
            frozenAt?:string;
            editorialRounds:Array<{
              round:number;reports:unknown[];judgment:unknown;
            }>;
          }>;
        };
        const old=b.chapters[0]!.editorialRounds[0]!;
        b.chapters[0]!.frozenAt=undefined;
        b.editorialCycle={
          chapterId:"c1",round:1,stage:"blocked",repairCursor:0,
          priorRounds:[],reports:structuredClone(old.reports),
          judgment:structuredClone(old.judgment),
        };
        b.status="paused";b.phase="chapterReview";
        store.put(b,b.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const newBoard=page.getByRole("region",{name:"Redazione multi-agente"});
  const ledger=newBoard.getByRole("region",{
    name:"Registro differenze editoriali capitolo 1",
  });
  await expect(ledger.getByText(/1 verifiche storiche con prove insufficienti/))
    .toBeVisible();
  const thread=ledger.locator("details").first();
  await expect(thread.locator(":scope > summary")).toContainText(
    "2 occorrenze");
  await thread.locator(":scope > summary").click();
  await expect(thread.getByText(/Citazione e posizione letterale coincidono/))
    .toBeVisible();
  await expect(thread.getByText(/Prova mancante e controllo con le stesse parole/))
    .toBeVisible();
  // L'autore annotato nello storico NON è stato copiato nella timeline corrente.
  await expect(ledger.getByText("NOTA_STORICA_PRIVATA")).toHaveCount(0);
  const comparison=newBoard.getByRole("region",{name:"Confronto verifiche con archivio"});
  await expect(comparison.getByText("Confronto verifiche storiche e nuova revisione"))
    .toBeVisible();
  await expect(comparison.getByText(/1 controlli irrisolti nell'archivio/))
    .toBeVisible();
  const match=comparison.locator("details").first();
  await expect(match.locator(":scope > summary"))
    .toContainText("Stessa citazione, stessa posizione letterale");
  await match.locator(":scope > summary").click();
  await expect(match.getByText(/Presa in carico nello storico/)).toBeVisible();
  await expect(match.getByText(/NOTA_STORICA_PRIVATA/)).toBeVisible();
  await expect(match.getByText(/stesse parole/)).toBeVisible();
  await expect(match.getByText(/non trasferita alla nuova tornata/)).toBeVisible();
  const currentPlan=newBoard.getByRole("region",{name:"Piano verifiche editoriali"})
    .first();
  const currentEntry=currentPlan.locator("details").first();
  await currentEntry.locator(":scope > summary").click();
  const choice=currentEntry.locator(
    'details[aria-label="Scelta autore sul controllo editoriale"]');
  await expect(choice.locator(":scope > summary")).toContainText("nessuna scelta attiva");
  // Judge changed only the suggested check; the old note cannot become
  // a new author choice even if the literal witness is unchanged.
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
          "Chiedere all'autore se vuole mantenere lo stesso punto di vista della scena.";
        store.put(b,b.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const edited=page.getByRole("region",{name:"Confronto verifiche con archivio"});
  const editedMatch=edited.locator("details").first();
  await editedMatch.locator(":scope > summary").click();
  await expect(editedMatch.getByText(/formulati diversamente/)).toBeVisible();
  await expect(editedMatch.getByText(/NOTA_STORICA_PRIVATA/)).toBeVisible();
  const changedLedger=page.getByRole("region",{
    name:"Registro differenze editoriali capitolo 1",
  });
  const changedThread=changedLedger.locator("details").first();
  await changedThread.locator(":scope > summary").click();
  await expect(changedThread.getByText(/Prova mancante o controllo riformulati/))
    .toBeVisible();
  // If the current literal witness disappears, no automatic "resolved".
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          id:string;chapters:Array<{scenes:Array<{text:string}>}>;
        };
        b.chapters[0]!.scenes[0]!.text="Mara chiude la porta in silenzio.";
        store.put(b,b.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const absent=page.getByRole("region",{name:"Confronto verifiche con archivio"});
  await expect(absent.locator("details").first().locator(":scope > summary"))
    .toContainText("non significa risolto");
  const absentLedger=page.getByRole("region",{
    name:"Registro differenze editoriali capitolo 1",
  });
  await expect(absentLedger.locator("details").first()
    .locator(":scope > summary"))
    .toContainText("non risolta");
  const width=await page.evaluate(()=>({
    full:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(width.full).toBeLessThanOrEqual(width.viewport+1);
});
