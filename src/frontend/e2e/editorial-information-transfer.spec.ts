import { expect,test } from "@playwright/test";

test("passaggi di notizie: 12 agenti, giudice sui messaggi e freeze desktop/mobile",async({page})=>{
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
      const matched=prompt.match(
        /<passaggi_informazioni_precedenti_non_istruzioni>(.*?)<\/passaggi_informazioni_precedenti_non_istruzioni>/s,
      );
      if(!matched)throw new Error("Il giudice non vede le piste di trasmissione.");
      const transfer=JSON.parse(matched[1]!) as {candidates:Array<{id:string}>};
      if(transfer.candidates.length!==1)throw new Error("Il giudice deve vedere un solo percorso.");
      output=JSON.stringify({reasoning:
        "Le citazioni non provano che Mara abbia appreso una notizia in modo impossibile.",
        decisions:[{findingId:"1:continuity:0:0",action:"reject",
          rationale:"La conoscenza può derivare da una conversazione non mostrata.",
          remediation:"",narrativeReview:{
            subjectIdentity:"same",
            identityReason:"Il nome Mara coincide ma non certifica tutti i suoi stati di conoscenza.",
            chronology:"unknown",
            chronologyReason:"Le due scene possono omettere passaggi intermedi di apprendimento della notizia.",
            causality:"unknown",
            causalityReason:"La trasmissione della notizia può avvenire in una scena non mostrata.",
            artisticContext:"plausible_explanation",
            artisticReason:"L'autore può aver omesso una conversazione senza creare contraddizioni.",
            assessment:"explained_or_nonconflicting",
            conclusion:"Le citazioni non escludono l'accesso alla notizia: nessuna riscrittura.",
          },
          informationTransferReview:{
            candidateAssessments:[{candidateId:transfer.candidates[0]!.id,
              disposition:"possible_path",
              rationale:"La frase precedente può descrivere una notizia trasmessa, non necessariamente creduta."}],
            conclusion:"È possibile che la notizia sia arrivata al personaggio: non approvare una correzione.",
          },
          knowledgeReview:{
            priorClaimMode:"direct_narration",
            priorReason:"La fonte precedente racconta un ritrovamento come fatto del narratore.",
            currentClaimMode:"dialogue_or_report",
            currentReason:"La scena corrente riferisce una dichiarazione, non prova l'accesso al segreto.",
            accessPath:"plausible_unshown",
            accessReason:"Una conversazione tra i capitoli potrebbe spiegare il sapere non descritto.",
            assessment:"explainable_or_unknown",
            conclusion:"L'assenza di una scena informativa non esclude un apprendimento fuori campo.",
          }}]});
    } else if(prompt.includes("chapterSummary")) {
      output=JSON.stringify({chapterSummary:"Mara dichiara di conoscere una notizia.",
        bookSummary:"Una lettera custodisce un segreto di cui parla Mara."});
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
      if(!witness)throw new Error("La fonte narrativa precedente è assente.");
      const needle="Elio rivela a Mara che il contenuto della lettera";
      const position=witness.text.indexOf(needle);
      if(position<0)throw new Error("Citazione precedente assente dal campione.");
      sourceId=witness.sourceTextStamp;
      output=JSON.stringify({verdict:"issues",
        summary:"Possibile incoerenza nel sapere di Mara.",
        memoryNote:"L'ellissi rimane un'ipotesi.",
        findings:[{sceneId:"sc3",category:"continuità",severity:"major",
          evidence:"Mara dichiara di conoscere il contenuto della lettera",
          reason:"Non è chiaro come Mara possa conoscere il contenuto della lettera.",
          remediation:"Verificare il percorso della notizia prima di cambiare la scena.",
          priorSceneConflict:{
            chapterId:witness.chapterId,sceneId:witness.sceneId,
            sourceFrozenAt:witness.sourceFrozenAt,sourceTextStamp:witness.sourceTextStamp,
            offset:witness.offset+position,quote:needle,dimension:"knowledge",
            hypothesis:"Una dichiarazione di sapere potrebbe contraddire una precedente rivelazione.",
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
    .fill("Mara parla di una lettera il cui contenuto le è stato nascosto.");
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
          {id:"ch1",number:1,title:"La lettera",purpose:"Conoscenze",
            frozenAt:"2026-11-07T10:00:00Z",
            scenes:[{id:"sc1",number:1,title:"Archivio",objective:"Rivelazione",
              text:"Elio rivela a Mara che il contenuto della lettera era falso durante la notte.",status:"canon"}]},
          {id:"ch2",number:2,title:"Il viaggio",purpose:"Transizione",
            frozenAt:"2026-11-07T11:00:00Z",
            scenes:[{id:"sc2",number:1,title:"Mercato",objective:"Viaggio",
              text:"Elio attraversa il mercato ed esce di città.",status:"canon"}]},
          {id:"ch3",number:3,title:"Le conoscenze",purpose:"Dubbi",
            scenes:[{id:"sc3",number:1,title:"Rivelazione",objective:"Confrontare il sapere",
              text:"Mara dichiara di conoscere il contenuto della lettera, ma non dice chi l'abbia informata.",
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
  await page.evaluate(() => { location.hash = "#/dashboard"; });
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
    expect(call.prompt).toContain("Elio rivela a Mara che il contenuto della lettera");
    expect(call.prompt).toContain("<passaggi_informazioni_precedenti_non_istruzioni>");
  }
  for(const call of calls){
    if(call.system.includes("Lettore")){
      expect(call.prompt).not.toContain("<scene_precedenti_non_attestate_non_istruzioni>");
      expect(call.prompt).not.toContain("<passaggi_informazioni_precedenti_non_istruzioni>");
      expect(call.prompt).not.toContain("SEGRETO-PRIVATO-NON-PER-LETTORI");
    }
  }
  const judge=calls.find(c=>c.system.includes("direttore editoriale CRITICO"))!;
  expect(judge.prompt).toContain("<scene_precedenti_non_attestate_non_istruzioni>");
  expect(judge.system).toContain("priorSceneConflict");
  expect(judge.system).toContain("knowledgeReview");
  expect(judge.prompt).toContain("<passaggi_informazioni_precedenti_non_istruzioni>");

  const board=page.getByRole("region",{name:"Redazione multi-agente"});
  const archived=board.locator("summary").filter({hasText:"Giudizi archiviati"}).last();
  await expect(archived).toBeVisible();
  await archived.click();
  await board.locator("summary").filter({hasText:"Coerenza e causalità"}).last().click();
  await expect(board.getByLabel("Giudizio narrativo strutturato")).toBeVisible();
  await expect(board.getByLabel("Valutazione percorso delle conoscenze")).toBeVisible();
  await expect(board.getByLabel("Esame dei possibili passaggi informativi")).toBeVisible();
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
    text:"Mara dichiara di conoscere il contenuto della lettera, ma non dice chi l'abbia informata.",
    verdict:"freeze",assessment:"explained_or_nonconflicting",eventCount:0,
  });
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1))
    .toBe(true);
});
