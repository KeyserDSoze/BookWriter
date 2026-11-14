import { expect, test, type Page } from "@playwright/test";

type StreamProbe=Window&{
  emit:(text:string,reasoning?:boolean)=>void;
  finish:()=>void;
  requests:number;
};

async function prepare(page:Page,inspect:boolean){
  await page.addInitScript(()=>{
    const probe=window as StreamProbe,original=window.fetch.bind(window);
    probe.requests=0;
    window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
      if(url.endsWith("/api/v1/models"))return new Response('{"models":[]}',{headers:{"content-type":"application/json"}});
      if(!url.endsWith("/v1/chat/completions"))return original(input,init);
      probe.requests++;
      const encoder=new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({start(controller){
        probe.emit=(text,reasoning=false)=>controller.enqueue(encoder.encode("data: "+JSON.stringify({
          choices:[{index:0,delta:reasoning?{reasoning_content:text}:{content:text}}],
        })+"\n\n"));
        probe.finish=()=>{
          controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":80}}\n\ndata: [DONE]\n\n'));
          controller.close();
        };
      }}),{headers:{"content-type":"text/event-stream"}});
    };
  });
  await page.goto("/");
  await page.evaluate(async inspection=>{
    const dbPath="/src/infrastructure/db.ts",typesPath="/src/domain/types.ts";
    const {saveBook,saveSettings}=await import(/* @vite-ignore */dbPath);
    const {newBook,DEFAULT_SETTINGS}=await import(/* @vite-ignore */typesPath);
    const settings=structuredClone(DEFAULT_SETTINGS);
    settings.inspectAiRequests=inspection;
    settings.endpoints=[{id:"openai",name:"Modello sintetico",baseUrl:"http://localhost:1234/v1",
      authMode:"none",secret:null,models:["test-stream"],streamMode:"sse",localAutoRetry:false,autoRetry:false}];
    settings.defaultRoute={endpointId:"openai",modelId:"test-stream"};
    await saveSettings(settings);
    const book=newBook("BRIEF_SINTETICO_DA_ISPEZIONARE","Anteprima streaming","Sobrio","Adulti");
    book.status="paused";
    await saveBook(book,false);
  },inspect);
  await page.reload();
  await page.getByRole("button",{name:"Riprendi",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>typeof(window as StreamProbe).emit)).toBe("function");
  // Keep the test on a single request without racing the next autopilot task.
  await page.getByRole("button",{name:"Ferma a fine task",exact:true}).click();
}

test("Attività segue la risposta completa; il riquadro sfuma cinque righe e la traccia rimane dopo reload",async({page})=>{
  test.setTimeout(90_000);
  await prepare(page,true);
  const toast=page.getByRole("complementary",{name:"Lavoro in background"});
  await page.evaluate(()=>(window as StreamProbe).emit("REASONING_SINTETICO_INIZIALE",true));
  await expect(toast).toContainText("Reasoning del provider");
  await expect(toast).toContainText("REASONING_SINTETICO_INIZIALE");
  await expect(toast).toContainText("Brainstorming");
  await toast.getByRole("button",{name:"Ispeziona il task in Attività →"}).click();
  await page.getByRole("button",{name:"Ispeziona richiesta e risposta",exact:true}).click();
  const inspector=page.getByRole("region",{name:"Richiesta e risposta private del task"});
  await inspector.getByText("Messaggio user inviato",{exact:true}).click();
  await expect(inspector).toContainText("BRIEF_SINTETICO_DA_ISPEZIONARE");
  await page.evaluate(()=>(window as StreamProbe).emit(Array.from({length:40},(_,i)=>`RIGA_${i+1}: risposta sintetica in arrivo.\n`).join("")));
  const full=inspector.getByLabel("Risposta della richiesta selezionata");
  const tail=toast.getByLabel("Ultime cinque righe ricevute");
  await expect(full).toContainText("RIGA_1:");
  await expect(full).toContainText("RIGA_40:");
  await expect.poll(()=>full.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight)).toBeLessThan(2);
  await expect.poll(()=>tail.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight)).toBeLessThan(2);
  expect(await tail.evaluate(e=>e.clientHeight)).toBeLessThanOrEqual(100);
  expect(await tail.evaluate(e=>getComputedStyle(e).maskImage)).toContain("linear-gradient");
  await expect(toast.getByLabel("Contatori streaming compatti")).toContainText("eventi");

  // Reading earlier passages must not be interrupted by new provider deltas.
  await full.evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event("scroll"));});
  await expect(inspector.getByRole("button",{name:"Segui il testo in arrivo"})).toBeVisible();
  await page.evaluate(()=>(window as StreamProbe).emit("ULTIMA_RIGA_SINTETICA\n"));
  await expect(full).toContainText("ULTIMA_RIGA_SINTETICA");
  expect(await full.evaluate(e=>e.scrollTop)).toBe(0);
  await toast.getByRole("button",{name:"Riduci anteprima streaming"}).click();
  await expect(tail).toHaveCount(0);
  await inspector.getByRole("button",{name:"Segui il testo in arrivo"}).click();
  await expect.poll(()=>full.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight)).toBeLessThan(2);
  await toast.getByRole("button",{name:"Mostra anteprima streaming"}).click();
  await expect(tail).toContainText("ULTIMA_RIGA_SINTETICA");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await toast.screenshot({path:test.info().outputPath("streaming-preview.png")});
  await page.evaluate(()=>(window as StreamProbe).finish());
  await expect(toast).toHaveCount(0);
  await expect(inspector.getByText("Risposta modello restituita",{exact:true})).toBeVisible();
  await page.evaluate(async()=>{
    const path="/src/infrastructure/ai-observability.ts";
    const {startLiveAi,finishLiveAi}=await import(/* @vite-ignore */path);
    // Simulate newer task metadata without any additional model calls. The
    // explicitly opened final response must outlive the bounded volatile cache.
    for(let index=0;index<10;index++){
      const activityId="synthetic-cache-"+index;
      startLiveAi({activityId,bookId:"synthetic-cache",title:"Cache sintetica",
        endpointId:"openai",modelId:"test-stream",inspect:true});
      finishLiveAi(activityId,"completata");
    }
  });
  await expect(full).toContainText("ULTIMA_RIGA_SINTETICA");
  await page.reload();
  await page.getByRole("button",{name:"Ispeziona richiesta e risposta",exact:true}).click();
  await expect(inspector.getByLabel("Risposta della richiesta selezionata")).toContainText("RIGA_1:");
  await expect(inspector.getByLabel("Risposta della richiesta selezionata")).toContainText("ULTIMA_RIGA_SINTETICA");
  await expect(inspector).toContainText("REASONING_SINTETICO_INIZIALE");
});

test("senza consenso mostra solo numeri, offre le impostazioni e non ricostruisce lo stream precedente",async({page})=>{
  test.setTimeout(60_000);
  await prepare(page,false);
  await page.evaluate(()=>{
    (window as StreamProbe).emit("REASONING_DA_NON_MOSTRARE",true);
    (window as StreamProbe).emit("RISPOSTA_DA_NON_MOSTRARE");
  });
  const toast=page.getByRole("complementary",{name:"Lavoro in background"});
  await expect(toast.getByLabel("Contatori streaming compatti")).toContainText(/Output: [1-9]/);
  await expect(page.getByText("RISPOSTA_DA_NON_MOSTRARE",{exact:true})).toHaveCount(0);
  await expect(page.getByText("REASONING_DA_NON_MOSTRARE",{exact:true})).toHaveCount(0);
  await toast.getByRole("button",{name:/Abilita l'ispezione/}).click();
  await page.getByRole("checkbox",{name:/Ispezione locale richieste AI/}).check();
  await expect(page.getByText("Preferenza d'ispezione salvata localmente.")).toBeVisible();
  await page.evaluate(()=>(window as StreamProbe).emit("ANCORA_SENZA_CONSENSO_ALL_AVVIO"));
  await expect(toast.getByLabel("Ultime cinque righe ricevute")).toHaveCount(0);
  await page.evaluate(()=>(window as StreamProbe).finish());
  await expect(toast).toHaveCount(0);
  const nav=page.getByRole("navigation",{name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale"});
  await nav.getByRole("button",{name:"Attività"}).click();
  await page.getByRole("list",{name:"Storico task"}).locator("details").first().evaluate((e:HTMLDetailsElement)=>{e.open=true;});
  await page.getByRole("button",{name:"Ispeziona richiesta e risposta",exact:true}).click();
  await expect(page.getByText(/Nessuna richiesta integrale conservata per questo task/)).toBeVisible();
});

test("revoca durante lo stream nasconde la coda e non conserva nuovi delta nella traccia privata",async({page})=>{
  test.setTimeout(60_000);
  await prepare(page,true);
  await page.evaluate(()=>(window as StreamProbe).emit("PRIMA_DELLA_REVOCA"));
  const toast=page.getByRole("complementary",{name:"Lavoro in background"});
  await expect(toast).toContainText("PRIMA_DELLA_REVOCA");
  const nav=page.getByRole("navigation",{name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale"});
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await page.getByRole("checkbox",{name:/Ispezione locale richieste AI/}).uncheck();
  await expect(page.getByText("Preferenza d'ispezione salvata localmente.")).toBeVisible();
  await page.evaluate(()=>(window as StreamProbe).emit("DOPO_LA_REVOCA"));
  await expect(toast.getByLabel("Ultime cinque righe ricevute")).toHaveCount(0);
  await expect(page.getByText("PRIMA_DELLA_REVOCA",{exact:true})).toHaveCount(0);
  await page.evaluate(()=>(window as StreamProbe).finish());
  await expect(toast).toHaveCount(0);
  const responseStored=await page.evaluate(async()=>{
    const path="/src/infrastructure/db.ts";
    const db=await(await import(/* @vite-ignore */path)).getDb();
    const traces=(await db.getAll("meta")).filter((x:unknown)=>x&&typeof x==="object"&&"systemPrompt" in x);
    return traces.some((x:{response?:string})=>!!x.response);
  });
  expect(responseStored).toBe(false);
});
