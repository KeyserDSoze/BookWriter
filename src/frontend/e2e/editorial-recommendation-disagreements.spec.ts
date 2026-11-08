import {expect,test} from "@playwright/test";

test("divergenze editoriale: proposte alternative e verifica mancante desktop/mobile",
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
          chapterId:"c1",round:1,stage:"adjudicate",repairCursor:0,priorRounds:[],
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
  await expect(plan.getByText(/Piano verifiche editoriali · capitolo 1/)).toBeVisible();
  await expect(plan.getByText(/1 da verificare/)).toBeVisible();
  const planEntry=plan.locator("details").first();
  await expect(planEntry.locator(":scope > summary")).toContainText(
    "Da approfondire: prove insufficienti");
  await planEntry.locator(":scope > summary").click();
  await expect(planEntry.getByText(/Non sappiamo se l'effetto desiderato/))
    .toBeVisible();
  await expect(planEntry.getByText(/Chiedere all'autore quale ritmo narrativo/))
    .toBeVisible();
  await expect(planEntry.getByText(/non eseguito/)).toBeVisible();
  await plan.getByRole("combobox",{name:"Filtra piano verifiche editoriali"})
    .selectOption("approved");
  await expect(plan.getByText("Nessuna voce in questa sezione del piano."))
    .toBeVisible();
  await plan.getByRole("combobox",{name:"Filtra piano verifiche editoriali"})
    .selectOption("pending");
  const discussions=board.getByRole("region",{name:"Divergenze tra raccomandazioni"});
  await expect(discussions.getByText("Correzioni alternative sulla stessa citazione"))
    .toBeVisible();
  const group=discussions.locator("details").first();
  await expect(group.locator("summary")).toContainText("2 proposte");
  await group.locator("summary").click();
  await expect(group.getByText(/Accorciare la frase per ottenere/)).toBeVisible();
  await expect(group.getByText(/Conservare la pausa per aumentare/)).toBeVisible();
  await expect(group.getByText(/nessuna modifica/)).toBeVisible();
  await expect(group.getByText(/Non sappiamo se l'effetto desiderato/)).toBeVisible();
  await expect(group.getByText(/Chiedere all'autore quale ritmo narrativo/)).toBeVisible();
  await expect(group.getByText(/non viene eseguito automaticamente/)).toBeVisible();
  const width=await page.evaluate(()=>({
    full:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(width.full).toBeLessThanOrEqual(width.viewport+1);
  // An edited source must remain visible as historical context, NOT as a
  // current approval or a newly generated verification instruction.
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          id:string;chapters:Array<{scenes:Array<{text:string}>}>;
        };
        b.chapters[0]!.scenes[0]!.text="Mara nasconde la lettera nel cassetto.";
        store.put(b,b.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const stale=page.getByRole("region",{name:"Piano verifiche editoriali"});
  await expect(stale.getByText(/1 da verificare/)).toBeVisible();
  const staleEntry=stale.locator("details").first();
  await expect(staleEntry.locator(":scope > summary")).toContainText("Da rivalidare");
  await staleEntry.locator(":scope > summary").click();
  await expect(staleEntry.getByText(/non usare questo estratto per avviare una riparazione/))
    .toBeVisible();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          id:string;editorialCycle?:{round:number;reports:unknown[];judgment:unknown};
          chapters:Array<{frozenAt?:string;editorialRounds?:unknown[]}>;
        };
        const old=b.editorialCycle!;
        b.chapters[0]!.frozenAt="2026-11-08T16:00:00.000Z";
        b.chapters[0]!.editorialRounds=[{
          round:old.round,reports:old.reports,judgment:old.judgment,
        }];
        delete b.editorialCycle;
        store.put(b,b.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const archivedBoard=page.getByRole("region",{name:"Redazione multi-agente"});
  await archivedBoard.locator("summary").filter({hasText:"Giudizi archiviati (1)"})
    .click();
  const archivePlan=archivedBoard.getByRole("region",{name:"Piano verifiche editoriali"});
  await expect(archivePlan.getByText(/1 storici/)).toBeVisible();
  const archiveEntry=archivePlan.locator("details").first();
  await expect(archiveEntry.locator(":scope > summary")).toContainText("Storico:");
  await archiveEntry.locator(":scope > summary").click();
  await expect(archiveEntry.getByText(/Non è un permesso corrente/)).toBeVisible();
});
