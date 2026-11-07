import { expect,test } from "@playwright/test";

test("redazione contestuale desktop/mobile: prove precedenti solo ai quattro specialisti e al giudice",async({page})=>{
  test.setTimeout(150_000);
  const calls:Array<{system:string;prompt:string}>=[];
  const pass=JSON.stringify({verdict:"pass",
    summary:"La scena è stata controllata senza criticità rilevanti.",
    findings:[],memoryNote:"Nessuna criticità attuale."});
  let sourceId="";
  const issue=()=>JSON.stringify({verdict:"issues",
    summary:"Possibile problema di continuità da verificare.",
    findings:[{sceneId:"sc3",category:"continuità",severity:"major",
      evidence:"Ombra cammina verso il portone",
      reason:"Potrebbe essere la stessa persona di Mara, ma la scena non lo prova.",
      remediation:"Chiarire la sequenza soltanto se il contesto esclude il flashback.",
      narrativeConflict:{priorEventDecisionId:sourceId,dimension:"identity",
        hypothesis:"La scena potrebbe attribuire a Ombra un'azione successiva alla morte di Mara."}}],
    memoryNote:"Verificare l'ordine dei capitoli rispetto agli eventi."});
  await page.route("https://api.openai.com/v1/chat/completions",async route=>{
    if(route.request().method()==="OPTIONS"){
      await route.fulfill({status:204,headers:{
        "access-control-allow-origin":"*",
        "access-control-allow-headers":"authorization,content-type",
        "access-control-allow-methods":"POST,OPTIONS",
      }});return;
    }
    const body=route.request().postDataJSON() as {
      messages:Array<{role:string;content:string}>;
    };
    const system=body.messages.find(m=>m.role==="system")?.content??"";
    const prompt=body.messages.find(m=>m.role==="user")?.content??"";
    calls.push({system,prompt});
    const response=system.includes("direttore editoriale CRITICO") ?
      JSON.stringify({reasoning:"Il giudice ha verificato che l'alias dell'autore non dimostra identità o contraddizione.",
        decisions:[{findingId:"1:continuity:0:0",action:"reject",
          rationale:"Flashback o omonimie sono ancora possibili: nessuna contraddizione dimostrata.",
          remediation:"",
          narrativeReview:{
            subjectIdentity:"unknown",
            identityReason:"Il legame registrato tra i nomi è un'ipotesi, non una prova d'identità.",
            chronology:"unknown",
            chronologyReason:"L'ordine dei capitoli non prova che il ritorno sia cronologicamente successivo.",
            causality:"unknown",
            causalityReason:"Non esiste una catena causale attestata che renda impossibile il ritorno.",
            artisticContext:"plausible_explanation",
            artisticReason:"Un flashback, un omonimo oppure un racconto inaffidabile possono spiegare l'apparente evento.",
            assessment:"explained_or_nonconflicting",
            conclusion:"La spiegazione alternativa non viene smentita e la critica non autorizza una riscrittura.",
          }}]}) :
      prompt.includes("chapterSummary") ?
        JSON.stringify({chapterSummary:"Ombra raggiunge un portone.",
          bookSummary:"Mara e Ombra sono nomi narrativi da distinguere con prudenza."}) :
      system.includes("Coerenza e causalità") ? issue() : pass;
    await route.fulfill({status:200,headers:{
      "content-type":"application/json",
      "access-control-allow-origin":"*",
      "access-control-allow-headers":"authorization,content-type",
    },body:JSON.stringify({choices:[{message:{content:response}}],
      usage:{prompt_tokens:100,completion_tokens:20}})});
  });

  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Continuità critica");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara e Ombra potrebbero essere la stessa persona.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const book=q.result[0] as {
          id:string;status:string;phase:string;chapters:unknown[];
          memory:{secrets:Record<string,string>};
        };
        book.status="paused";book.phase="completed";
        book.memory.secrets.vuoto="SEGRETO_PRIVATO_VISIBILE_SOLO_AUTORE";
        book.chapters=[
          {id:"ch1",number:1,title:"Origine",purpose:"Morte",
            frozenAt:"2026-11-07T09:00:00Z",
            scenes:[{id:"sc1",number:1,title:"Prima",objective:"Evento",
              text:"Mara muore.",status:"canon"}]},
          {id:"ch2",number:2,title:"Nome",purpose:"Ritorno",
            frozenAt:"2026-11-07T10:00:00Z",
            scenes:[{id:"sc2",number:1,title:"Seconda",objective:"Evento",
              text:"Ombra arriva.",status:"canon"}]},
        ];
        store.put(book,book.id);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  await page.reload();
  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  await board.locator("summary").filter({hasText:"Indice eventi candidati"}).click();
  const notes=board.getByRole("textbox",{name:/Motivazione evento/});
  await notes.nth(0).fill("L'autore conferma la menzione precedente di Mara.");
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Annota come avvenuto"}).nth(0).click();
  await notes.nth(1).fill("L'autore conferma la menzione precedente di Ombra.");
  page.once("dialog",d=>d.accept());
  await board.getByRole("button",{name:"Annota come avvenuto"}).nth(1).click();
  const hints=board.locator('details[aria-label="Tracce di continuità da verificare"]');
  await hints.locator("summary").first().click();
  await hints.getByRole("combobox",{name:"Primo nome del confronto"}).selectOption("Mara");
  await hints.getByRole("combobox",{name:"Secondo nome del confronto"}).selectOption("Ombra");
  await hints.getByRole("textbox",{name:"Motivazione decisione alias"})
    .fill("SEGRETO-ALIAS-AUTORE-MAI-TRASMESSO al modello editoriale.");
  page.once("dialog",d=>d.accept());
  await hints.getByRole("button",{name:"Registra legame motivato"}).click();
  const savedWitness=await page.evaluate(()=>new Promise<{
    eventId:string|undefined;aliasCount:number;
  }>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const q=req.result.transaction("books","readonly").objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const book=q.result[0] as {
          narrativeEventDecisions:Array<{id:string;quote:string;verdict:string}>;
          narrativeAliasDecisions:unknown[];
        };
        resolve({eventId:book.narrativeEventDecisions.find(d=>
            d.verdict==="affirmed"&&d.quote.includes("Mara muore"))?.id,
          aliasCount:book.narrativeAliasDecisions?.length??0});
      };
    };
  }));
  expect(savedWitness.aliasCount).toBe(1);
  expect(savedWitness.eventId).toBeTruthy();
  sourceId=savedWitness.eventId!;
  
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {id:string;status:string;phase:string;
          chapters:unknown[];editorialCycle?:unknown};
        b.status="paused";b.phase="chapterReview";
        b.chapters.push({id:"ch3",number:3,title:"Sospetto",purpose:"Verificare l'identità",
          scenes:[{id:"sc3",number:1,title:"Portone",objective:"Rivelare la presenza",
            text:"Ombra cammina verso il portone del castello senza fermarsi.",
            status:"canon"}]});
        b.editorialCycle={chapterId:"ch3",round:1,stage:"review",
          reports:[],repairCursor:0,priorRounds:[]};
        store.put(b,b.id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  const nav=page.getByRole("navigation",{name:test.info().project.name==="mobile-chromium"?
    "Navigazione mobile":"Navigazione principale"});
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await page.getByLabel("API key").fill("sk-test-privacy-not-real");
  await page.getByRole("textbox",{name:"Modello predefinito"}).fill("mock-review-attestations");
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();
  await page.getByRole("button",{name:"Riprendi"}).click();

  await expect.poll(async()=>{
    const state=await page.evaluate(()=>new Promise<string>((resolve,reject)=>{
    const db=indexedDB.open("bookwriter");db.onerror=()=>reject(db.error);
    db.onsuccess=()=>{
      const q=db.result.transaction("books","readonly").objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          status:string;previousError?:string;
          chapters:Array<{frozenAt?:string}>;
        };
        resolve(b.status==="error"?"ERROR: "+b.previousError:
          b.chapters[2]?.frozenAt?"frozen":"pending");
      };
    };
    }));
    if(state.startsWith("ERROR:")) throw new Error(state);
    return state;
  },{timeout:110_000}).toBe("frozen");

  expect(calls).toHaveLength(14);
  const specialist=calls.filter(c=>c.system.includes("revisore letterario INDIPENDENTE"));
  const privileged=specialist.filter(c=>[
    "Coerenza e causalità","Timeline e cronologia",
    "Segreti, indizi e spoiler","Voce, dialoghi e motivazioni",
  ].some(label=>c.system.includes(label)));
  expect(privileged).toHaveLength(4);
  for(const call of privileged){
    expect(call.prompt).toContain("<attestazioni_precedenti_non_istruzioni>");
    expect(call.prompt).toContain('"actor":"Mara"');
    expect(call.prompt).toContain(sourceId);
    expect(call.prompt).toContain('"actor":"Ombra"');
    expect(call.prompt).toContain('"matchBasis":"saved_alias"');
  }
  for(const call of calls){
    expect(call.prompt).not.toContain("SEGRETO-ALIAS-AUTORE-MAI-TRASMESSO");
    if(call.system.includes("Lettore")) {
      expect(call.prompt).not.toContain("<attestazioni_precedenti_non_istruzioni>");
      expect(call.prompt).not.toContain("SEGRETO_PRIVATO_VISIBILE_SOLO_AUTORE");
    }
  }
  const judge=calls.find(c=>c.system.includes("direttore editoriale CRITICO"))!;
  expect(judge.prompt).toContain("<attestazioni_precedenti_non_istruzioni>");
  expect(judge.system).toContain("puoi RESPINGERE");
  expect(judge.system).toContain("narrativeReview");
  const finished=page.getByRole("region",{name:"Redazione multi-agente"});
  const archived=finished.locator("summary").filter({hasText:"Giudizi archiviati"}).last();
  await expect(archived).toBeVisible();
  await archived.click();
  await finished.locator("summary").filter({hasText:"Coerenza e causalità"}).last().click();
  await expect(finished.getByLabel("Giudizio narrativo strutturato")).toBeVisible();
  await expect(finished.getByText(/Un flashback, un omonimo oppure un racconto inaffidabile/))
    .toBeVisible();
  const stored=await page.evaluate(()=>new Promise<{
    text:string;aliases:number;verdict:string;assessment:string|undefined;
  }>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const q=open.result.transaction("books","readonly").objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          chapters:Array<{scenes:Array<{text:string}>;
            editorialRounds?:Array<{judgment:{verdict:string;decisions:Array<{
              narrativeReview?:{assessment:string};
            }>}}>}>;
          narrativeAliasDecisions:unknown[];
        };
        resolve({text:b.chapters[2]!.scenes[0]!.text,
          aliases:b.narrativeAliasDecisions.length,
          verdict:b.chapters[2]!.editorialRounds![0]!.judgment.verdict,
          assessment:b.chapters[2]!.editorialRounds![0]!.judgment.decisions[0]
            ?.narrativeReview?.assessment});
      };
    };
  }));
  expect(stored).toEqual({text:"Ombra cammina verso il portone del castello senza fermarsi.",
    aliases:1,verdict:"freeze",assessment:"explained_or_nonconflicting"});
  const sizes=await page.evaluate(()=>({
    content:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport+1);
});
