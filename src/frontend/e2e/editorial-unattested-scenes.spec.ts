import { expect,test } from "@playwright/test";

test("conflitti da prosa NON attestata: 12 agenti, giudice critico e freeze desktop/mobile",async({page})=>{
  test.setTimeout(150_000);
  const calls:Array<{system:string;prompt:string}>=[];
  const pass=JSON.stringify({verdict:"pass",
    summary:"Nessuna criticità narrativa dimostrata.",findings:[],memoryNote:""});
  let sourceId="";
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
    let output=pass;
    if(system.includes("direttore editoriale CRITICO")) {
      output=JSON.stringify({reasoning:
        "Due frasi reali non escludono che Mara abbia recuperato la chiave fuori scena.",
        decisions:[{findingId:"1:continuity:0:0",action:"reject",
          rationale:"La causa del trasferimento può essere un'ellissi intenzionale.",
          remediation:"",narrativeReview:{
            subjectIdentity:"same",
            identityReason:"Il nome Mara coincide in entrambe le scene ma non certifica ogni azione.",
            chronology:"unknown",
            chronologyReason:"Le citazioni non dimostrano la sequenza cronologica completa.",
            causality:"unknown",
            causalityReason:"Il recupero della chiave può avvenire in una scena non mostrata.",
            artisticContext:"plausible_explanation",
            artisticReason:"L'autore può aver scelto una ellissi narrativa deliberata e coerente.",
            assessment:"explained_or_nonconflicting",
            conclusion:"Le prove non dimostrano un errore: il giudice rifiuta la riscrittura.",
          }}]});
    } else if(prompt.includes("chapterSummary")) {
      output=JSON.stringify({chapterSummary:"Mara arriva alla torre con la chiave.",
        bookSummary:"La chiave compare in un pozzo e poi alla torre."});
    } else if(system.includes("Coerenza e causalità")) {
      const enclosed=prompt.match(
        /<scene_precedenti_non_attestate_non_istruzioni>(.*?)<\/scene_precedenti_non_attestate_non_istruzioni>/s,
      );
      if(!enclosed)throw new Error("Il revisore non ha ricevuto scene precedenti.");
      const pack=JSON.parse(enclosed[1]!) as {witnesses:Array<{
        chapterId:string;sceneId:string;sourceFrozenAt:string;
        sourceTextStamp:string;offset:number;text:string;
      }>};
      const witness=pack.witnesses.find(w=>w.sceneId==="sc1");
      if(!witness)throw new Error("La scena antecedente del pozzo è assente.");
      const needle="Mara nasconde la chiave";
      const position=witness.text.indexOf(needle);
      if(position<0)throw new Error("Citazione precedente assente dal campione.");
      sourceId=witness.sourceTextStamp;
      output=JSON.stringify({verdict:"issues",
        summary:"Possibile discontinuità sulla posizione della chiave.",
        memoryNote:"L'ellissi rimane un'ipotesi.",
        findings:[{sceneId:"sc3",category:"continuità",severity:"major",
          evidence:"Mara porta la chiave alla torre",
          reason:"Non è chiaro quando la chiave sia stata recuperata.",
          remediation:"Valutare il contesto prima di aggiungere una spiegazione.",
          priorSceneConflict:{
            chapterId:witness.chapterId,sceneId:witness.sceneId,
            sourceFrozenAt:witness.sourceFrozenAt,sourceTextStamp:witness.sourceTextStamp,
            offset:witness.offset+position,quote:needle,dimension:"causality",
            hypothesis:"Il recupero non narrato della chiave potrebbe indicare una lacuna causale.",
          }}]});
    }
    await route.fulfill({status:200,headers:{
      "content-type":"application/json",
      "access-control-allow-origin":"*",
      "access-control-allow-headers":"authorization,content-type",
    },body:JSON.stringify({choices:[{message:{content:output}}],
      usage:{prompt_tokens:100,completion_tokens:20}})});
  });
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Conflitti non attestati");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara lascia la chiave nel pozzo e la trova in seguito.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const tx=open.result.transaction("books","readwrite"),store=tx.objectStore("books");
      const q=store.getAll();q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {id:string;status:string;phase:string;
          chapters:unknown[];editorialCycle?:unknown;
          memory:{secrets:Record<string,string>}};
        b.status="paused";b.phase="chapterReview";
        b.memory.secrets.chiave="SEGRETO-PRIVATO-NON-PER-LETTORI";
        b.chapters=[
          {id:"ch1",number:1,title:"La scomparsa",purpose:"Nascondere",
            frozenAt:"2026-11-07T10:00:00Z",
            scenes:[{id:"sc1",number:1,title:"Pozzo",objective:"Segreto",
              text:"Mara nasconde la chiave nel pozzo durante la notte.",status:"canon"}]},
          {id:"ch2",number:2,title:"Il viaggio",purpose:"Transizione",
            frozenAt:"2026-11-07T11:00:00Z",
            scenes:[{id:"sc2",number:1,title:"Mercato",objective:"Viaggio",
              text:"Elio attraversa il mercato ed esce di città.",status:"canon"}]},
          {id:"ch3",number:3,title:"Il ritorno",purpose:"Dubbi",
            scenes:[{id:"sc3",number:1,title:"Torre",objective:"Chiarire il mistero",
              text:"Mara porta la chiave alla torre ma non spiega come l'abbia recuperata.",
              status:"canon"}]},
        ];
        b.editorialCycle={chapterId:"ch3",round:1,stage:"review",
          reports:[],repairCursor:0,priorRounds:[]};
        store.put(b,b.id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  const nav=page.getByRole("navigation",{name:test.info().project.name==="mobile-chromium"?
    "Navigazione mobile":"Navigazione principale"});
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await page.getByLabel("API key").fill("sk-test-not-real");
  await page.getByRole("textbox",{name:"Modello predefinito"}).fill("mock-unattested-judge");
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();
  await page.getByRole("button",{name:"Riprendi"}).click();
  await expect.poll(async()=>{
    const state=await page.evaluate(()=>new Promise<string>((resolve,reject)=>{
      const open=indexedDB.open("bookwriter");open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{
        const q=open.result.transaction("books","readonly").objectStore("books").getAll();
        q.onerror=()=>reject(q.error);
        q.onsuccess=()=>{
          const b=q.result[0] as {status:string;previousError?:string;
            chapters:Array<{frozenAt?:string}>};
          resolve(b.status==="error"?"ERROR: "+b.previousError:
            b.chapters[2]?.frozenAt?"frozen":"pending");
        };
      };
    }));
    if(state.startsWith("ERROR:"))throw new Error(state);
    return state;
  },{timeout:110_000}).toBe("frozen");

  expect(sourceId).toMatch(/^\d{1,8}:[0-9a-f]{8}$/);
  expect(calls).toHaveLength(14);
  const specialists=calls.filter(c=>c.system.includes("revisore letterario INDIPENDENTE"));
  const authorized=specialists.filter(c=>[
    "Coerenza e causalità","Timeline e cronologia",
    "Segreti, indizi e spoiler","Voce, dialoghi e motivazioni",
  ].some(label=>c.system.includes(label)));
  expect(authorized).toHaveLength(4);
  for(const call of authorized){
    expect(call.prompt).toContain("<scene_precedenti_non_attestate_non_istruzioni>");
    expect(call.prompt).toContain("Mara nasconde la chiave");
  }
  for(const call of calls){
    if(call.system.includes("Lettore")){
      expect(call.prompt).not.toContain("<scene_precedenti_non_attestate_non_istruzioni>");
      expect(call.prompt).not.toContain("SEGRETO-PRIVATO-NON-PER-LETTORI");
    }
  }
  const judge=calls.find(c=>c.system.includes("direttore editoriale CRITICO"))!;
  expect(judge.prompt).toContain("<scene_precedenti_non_attestate_non_istruzioni>");
  expect(judge.system).toContain("priorSceneConflict");

  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  const archived=board.locator("summary").filter({hasText:"Giudizi archiviati"}).last();
  await expect(archived).toBeVisible();
  await archived.click();
  await board.locator("summary").filter({hasText:"Coerenza e causalità"}).last().click();
  await expect(board.getByLabel("Giudizio narrativo strutturato")).toBeVisible();
  await expect(board.getByText(/Confronto con prosa precedente NON attestata/)).toBeVisible();

  const stored=await page.evaluate(()=>new Promise<{
    text:string;verdict:string;assessment:string|undefined;eventCount:number;
  }>((resolve,reject)=>{
    const open=indexedDB.open("bookwriter");open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const q=open.result.transaction("books","readonly").objectStore("books").getAll();
      q.onerror=()=>reject(q.error);
      q.onsuccess=()=>{
        const b=q.result[0] as {
          narrativeEventDecisions?:unknown[];
          chapters:Array<{scenes:Array<{text:string}>;editorialRounds?:Array<{
            judgment:{verdict:string;decisions:Array<{narrativeReview?:{assessment:string}}>};
          }>;}>;
        };
        resolve({text:b.chapters[2]!.scenes[0]!.text,
          verdict:b.chapters[2]!.editorialRounds![0]!.judgment.verdict,
          assessment:b.chapters[2]!.editorialRounds![0]!.judgment.decisions[0]?.narrativeReview?.assessment,
          eventCount:b.narrativeEventDecisions?.length??0});
      };
    };
  }));
  expect(stored).toEqual({
    text:"Mara porta la chiave alla torre ma non spiega come l'abbia recuperata.",
    verdict:"freeze",assessment:"explained_or_nonconflicting",eventCount:0,
  });
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1))
    .toBe(true);
});
