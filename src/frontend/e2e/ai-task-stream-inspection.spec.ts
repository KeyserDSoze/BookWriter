import { expect, test } from "@playwright/test";

type Probe = Window & { sent?: Array<{url:string;body:Record<string,unknown>;authorization:boolean}> };
test("SSE locale, reasoning opzionale, timeline per task e richieste solo con consenso (desktop/mobile)",async({page})=>{
  test.setTimeout(90_000);
  await page.addInitScript(()=>{
    const probe=window as Probe, original=window.fetch.bind(window);
    probe.sent=[];
    window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
      if(!url.endsWith("/v1/chat/completions"))return original(input,init);
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      probe.sent!.push({url,body,
        authorization:JSON.stringify(init?.headers??{}).toLowerCase().includes("authorization")});
      const encoder=new TextEncoder();
      const chunk=(delta:Record<string,unknown>)=>
        encoder.encode("data: "+JSON.stringify({choices:[{index:0,delta}]})+"\n\n");
      let complete=false;
      const stream=new ReadableStream<Uint8Array>({
        start(controller){
          controller.enqueue(chunk({reasoning_content:"Sto valutando la storia. "}));
          window.setTimeout(()=>{
            if(complete)return;
            try{controller.enqueue(chunk({content:"Idee LONG MID SHORT per le due scimmie e il leone."}));}
            catch{/* cancelled by browser */ }
          },600);
          window.setTimeout(()=>{
            if(complete)return;
            try{
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();complete=true;
            }catch{/* cancelled by browser */}
          },4000);
        },
        cancel(){complete=true;},
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
  await page.getByRole("combobox",{name:"Streaming Chat Completions"}).selectOption("sse");
  await page.getByRole("combobox",{name:"Reasoning effort AI"}).selectOption("high");
  await page.getByRole("checkbox",{name:/Ispezione locale richieste AI/}).check();
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await nav.getByRole("button",{name:"Dashboard"}).click();
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Le scimmie e il leone");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Due scimmie rubano il cibo al leone, libro per bambini.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.getByRole("button",{name:"Autopilot"}).click();
  const current=page.getByRole("region",{name:"Streaming task corrente"});
  await expect(current).toBeVisible();
  await expect(current).toContainText("meta/muse-glimmer");
  await expect(current).toContainText("Sto valutando la storia.");
  await expect(current).toContainText("Risposta in streaming");
  await expect(current).toContainText("Idee LONG MID SHORT");
  const sent=await page.evaluate(()=>(window as Probe).sent??[]);
  expect(sent.length).toBeGreaterThan(0);
  expect(sent[0]?.url).toBe("http://localhost:1234/v1/chat/completions");
  expect(sent[0]?.authorization).toBe(false);
  expect(sent[0]?.body).toMatchObject({stream:true,reasoning_effort:"high",
    stream_options:{include_usage:true},model:"meta/muse-glimmer"});
  await page.getByRole("button",{name:"Pausa"}).click();
  await expect(page.getByRole("region",{name:"Timeline task AI"})).toBeVisible();
  await nav.getByRole("button",{name:"Attività"}).click();
  const tasks=page.getByRole("list",{name:"Storico task"}).getByRole("listitem");
  const brainstorm=tasks.filter({hasText:"Brainstorming"}).first();
  await expect(brainstorm).toBeVisible();
  await brainstorm.locator("details").first().evaluate((details:HTMLDetailsElement)=>{details.open=true;});
  await brainstorm.getByRole("button",{name:"Ispeziona richiesta e risposta"}).click();
  await expect(brainstorm.getByText("Messaggio user inviato")).toBeVisible();
  await brainstorm.getByText("Messaggio user inviato").click();
  await expect(brainstorm).toContainText("Due scimmie");
  await brainstorm.getByRole("button",{name:"Prepara revisione da questo task"}).click();
  await expect(page.getByRole("textbox",{name:"Il tuo intervento"}))
    .toHaveValue(/Brainstorming/);
});
