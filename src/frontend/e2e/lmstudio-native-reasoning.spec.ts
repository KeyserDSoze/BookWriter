import {test,expect} from "@playwright/test";

type Probe=Window&{nativeCalls?:Array<{url:string;payload:Record<string,unknown>;hasAuth:boolean}>};
test("LM Studio nativo: progresso vero del prompt, reasoning per task e nessun tool (#160 #161)",async({page})=>{
  test.setTimeout(75_000);
  await page.addInitScript(()=>{
    const win=window as Probe;
    win.nativeCalls=[];
    const original=window.fetch.bind(window);
    window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
      if(url!=="http://localhost:1234/api/v1/chat")return original(input,init);
      const payload=JSON.parse(String(init?.body)) as Record<string,unknown>;
      win.nativeCalls!.push({url,payload,
        hasAuth:JSON.stringify(init?.headers??{}).toLowerCase().includes("authorization")});
      const encode=new TextEncoder();
      let stopped=false;
      const stream=new ReadableStream<Uint8Array>({
        start(ctrl){
          const event=(type:string,rest:Record<string,unknown>={})=>{
            if(stopped)return;
            try{ctrl.enqueue(encode.encode(
              "event: "+type+"\ndata: "+JSON.stringify({type,...rest})+"\n\n"
            ));}catch{/* stopped by author */}
          };
          event("chat.start",{model_instance_id:"meta/muse-glimmer"});
          event("prompt_processing.start");
          event("prompt_processing.progress",{progress:0.45});
          window.setTimeout(()=>event("reasoning.start"),1000);
          window.setTimeout(()=>event("reasoning.delta",{content:"Piano i tre capitoli."}),1200);
          window.setTimeout(()=>event("message.start"),1900);
          window.setTimeout(()=>event("message.delta",{content:"Tre idee per due scimmie e un leone."}),2100);
          window.setTimeout(()=>{
            event("chat.end",{result:{
              model_instance_id:"meta/muse-glimmer",
              output:[{type:"reasoning",content:"Piano i tre capitoli."},
                {type:"message",content:"Tre idee per due scimmie e un leone."}],
              stats:{input_tokens:40,total_output_tokens:16,reasoning_output_tokens:7},
            }});
            if(!stopped){try{ctrl.close();}catch{/* stopped */}}
            stopped=true;
          },5000);
        },
        cancel(){stopped=true;},
      });
      return new Response(stream,{status:200,headers:{"content-type":"text/event-stream"}});
    };
  });
  await page.goto("/");
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await page.getByRole("textbox",{name:"Base URL"}).fill("http://localhost:1234/v1");
  await page.getByRole("combobox",{name:"Autenticazione AI"}).selectOption("none");
  await page.getByRole("textbox",{name:"Modelli rilevati / manuali"}).fill("meta/muse-glimmer");
  await page.getByRole("textbox",{name:"Modello predefinito"}).fill("meta/muse-glimmer");
  await page.getByRole("combobox",{name:"Protocollo AI per le richieste Chat"}).selectOption("lmstudio_native");
  await page.getByRole("combobox",{name:"Reasoning effort AI"}).selectOption("high");
  await page.getByRole("combobox",{name:"Reasoning di Brainstorming"}).selectOption("low");
  await page.getByRole("spinbutton",{name:"Tempo massimo senza dati dallo streaming (secondi)"}).fill("1800");
  await page.getByRole("checkbox",{name:/Ispezione locale richieste AI/}).check();
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await nav.getByRole("button",{name:"Dashboard"}).click();
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Le scimmie della giungla");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Due scimmie rubano cibo al leone, 3 capitoli per bambini.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.getByRole("button",{name:"Autopilot",exact:true}).click();
  const live=page.getByRole("region",{name:"Streaming task corrente"});
  await expect(live).toContainText("Reasoning richiesto: low");
  await expect(live).toContainText("LM Studio: elaborazione del prompt");
  await expect(live).toContainText("45% (dal provider)");
  await expect(live).toContainText("Piano i tre capitoli.");
  await expect(live).toContainText("Tre idee per due scimmie e un leone.");
  const sent=await page.evaluate(()=>(window as Probe).nativeCalls??[]);
  expect(sent.length).toBe(1);
  expect(sent[0]?.hasAuth).toBe(false);
  expect(sent[0]?.payload).toMatchObject({
    model:"meta/muse-glimmer",reasoning:"low",stream:true,store:false,
  });
  expect(sent[0]?.payload).not.toHaveProperty("integrations");
  await page.getByRole("button",{name:"Pausa"}).click();
});
