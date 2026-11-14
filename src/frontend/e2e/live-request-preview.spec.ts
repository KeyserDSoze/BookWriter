import { expect, test, type Page } from "@playwright/test";

type StreamProbe=Window&{
  emit:(text:string,reasoning?:boolean)=>void;
  finish:()=>void;
  requests:number;
};

async function prepare(page:Page){
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
  await page.evaluate(async()=>{
    const dbPath="/src/infrastructure/db.ts",typesPath="/src/domain/types.ts";
    const {saveBook,saveSettings}=await import(/* @vite-ignore */dbPath);
    const {newBook,DEFAULT_SETTINGS}=await import(/* @vite-ignore */typesPath);
    const settings=structuredClone(DEFAULT_SETTINGS);
    settings.endpoints=[{id:"openai",name:"Modello sintetico",baseUrl:"http://localhost:1234/v1",
      authMode:"none",secret:null,models:["test-stream"],streamMode:"sse",localAutoRetry:false,autoRetry:false}];
    settings.defaultRoute={endpointId:"openai",modelId:"test-stream"};
    await saveSettings(settings);
    const book=newBook("BRIEF_SINTETICO_DA_ISPEZIONARE","Anteprima streaming","Sobrio","Adulti");
    book.status="paused";
    await saveBook(book,false);
  });
  await page.reload();
  await page.getByRole("button",{name:"Riprendi",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>typeof(window as StreamProbe).emit)).toBe("function");
  // Keep the test on a single request without racing the next autopilot task.
  await page.getByRole("button",{name:"Ferma a fine task",exact:true}).click();
}

test("Attività segue la risposta completa; il riquadro sfuma cinque righe e la traccia rimane dopo reload",async({page})=>{
  test.setTimeout(90_000);
  await prepare(page);
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
        endpointId:"openai",modelId:"test-stream"});
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

test("senza alcuna impostazione il testo in arrivo si vede subito e la conversazione resta come temporanea",async({page})=>{
  test.setTimeout(60_000);
  await prepare(page);
  await page.evaluate(()=>{
    (window as StreamProbe).emit("REASONING_SENZA_OPZIONI",true);
    (window as StreamProbe).emit("RISPOSTA_SENZA_OPZIONI");
  });
  const toast=page.getByRole("complementary",{name:"Lavoro in background"});
  await expect(toast).toContainText("RISPOSTA_SENZA_OPZIONI");
  await expect(toast.getByLabel("Contatori streaming compatti")).toContainText(/Output: [1-9]/);
  // Nothing asks the author to enable anything to watch the text.
  await expect(toast.getByRole("button",{name:/Abilita l'ispezione/})).toHaveCount(0);
  await expect(page.getByText(/Abilita l'ispezione/)).toHaveCount(0);
  await page.evaluate(()=>(window as StreamProbe).finish());
  await expect(toast).toHaveCount(0);
  const nav=page.getByRole("navigation",{name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale"});
  await nav.getByRole("button",{name:"Attività"}).click();
  await expect(page.getByText(/richiesta e risposta di ogni task restano consultabili qui \(ultimi 20 task, non più vecchi di 10 giorni\)/)).toBeVisible();
  await page.getByRole("list",{name:"Storico task"}).locator("details").first().evaluate((e:HTMLDetailsElement)=>{e.open=true;});
  await page.getByRole("button",{name:"Ispeziona richiesta e risposta",exact:true}).click();
  const inspector=page.getByRole("region",{name:"Richiesta e risposta private del task"});
  await expect(inspector).toContainText("Conservata in modo temporaneo");
  await expect(inspector.getByLabel("Risposta della richiesta selezionata")).toContainText("RISPOSTA_SENZA_OPZIONI");
  const saved=await page.evaluate(async()=>{
    const path="/src/infrastructure/db.ts";
    const db=await(await import(/* @vite-ignore */path)).getDb();
    const keys=(await db.getAllKeys("meta")) as string[];
    const meta=keys.find(key=>typeof key==="string"&&key.startsWith("ai-trace-meta:"));
    return meta?await db.get("meta",meta):null;
  });
  expect(saved).toMatchObject({kept:false});
});

test("cancellare le conversazioni durante lo stream svuota il testo già arrivato e non salva nulla di nuovo; il testo nuovo ricompare",async({page})=>{
  test.setTimeout(60_000);
  await prepare(page);
  await page.evaluate(()=>(window as StreamProbe).emit("PRIMA_DELLA_CANCELLAZIONE"));
  const toast=page.getByRole("complementary",{name:"Lavoro in background"});
  await expect(toast).toContainText("PRIMA_DELLA_CANCELLAZIONE");
  const nav=page.getByRole("navigation",{name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale"});
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  page.once("dialog",dialog=>void dialog.accept());
  await page.getByRole("button",{name:"Cancella tutte le conversazioni salvate in questo browser"}).click();
  await expect(page.getByText(/Eliminate \d+ conversazioni AI salvate in questo browser/)).toBeVisible();
  await expect(page.getByText("PRIMA_DELLA_CANCELLAZIONE",{exact:true})).toHaveCount(0);
  await page.evaluate(()=>(window as StreamProbe).emit("DOPO_LA_CANCELLAZIONE"));
  await expect(toast).toContainText("DOPO_LA_CANCELLAZIONE");
  await page.evaluate(()=>(window as StreamProbe).finish());
  await expect(toast).toHaveCount(0);
  const stored=await page.evaluate(async()=>{
    const path="/src/infrastructure/db.ts";
    const db=await(await import(/* @vite-ignore */path)).getDb();
    return ((await db.getAllKeys("meta")) as string[]).filter(key=>typeof key==="string"&&key.startsWith("ai-trace"));
  });
  expect(stored).toEqual([]);
});

test("conservazione impostabile: tempo e numero di task, poi senza scadenza e GitHub in due passi",async({page})=>{
  test.setTimeout(60_000);
  await page.goto("/");
  // One old and one fresh temporary conversation, seeded as the app itself would have stored them.
  await page.evaluate(async()=>{
    const path="/src/infrastructure/ai-observability.ts";
    const {saveAiTrace}=await import(/* @vite-ignore */path);
    const make=(id:string,minutes:number)=>saveAiTrace({activityId:id,bookId:"libro",
      createdAt:new Date(Date.now()-minutes*60_000).toISOString(),endpointId:"e",modelId:"m",
      systemPrompt:"S",userPrompt:"U",truncated:false,kept:false});
    await make("vecchia",120);await make("recente",5);
  });
  const nav=page.getByRole("navigation",{name:test.info().project.name==="mobile-chromium"?"Navigazione mobile":"Navigazione principale"});
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  const section=page.locator("section").filter({has:page.getByRole("heading",{name:"Richieste e risposte dell'AI"})});
  await expect(section.getByText(/Il testo che il modello sta scrivendo si vede sempre/)).toBeVisible();
  await expect(section.getByText("Salvate ora: 2 temporanee, 0 senza scadenza.")).toBeVisible();
  const age=section.getByLabel("Cancella quelli più vecchi di");
  await expect(age).toHaveValue("14400"); // 10 days by default
  await expect(section.getByLabel("Tieni gli ultimi (task)")).toHaveValue("20");
  // Half an hour: the two-hour-old conversation goes away at once, the fresh one stays.
  await age.selectOption("30");
  await expect(page.getByText("Preferenza salvata su questo dispositivo.")).toBeVisible();
  await expect(section.getByText("Salvate ora: 1 temporanee, 0 senza scadenza.")).toBeVisible();
  await section.getByLabel("Tieni gli ultimi (task)").fill("7");
  await expect.poll(()=>page.evaluate(async()=>{
    const path="/src/infrastructure/db.ts";
    return ((await(await import(/* @vite-ignore */path)).loadSettings()).aiTraceRetention);
  })).toEqual({maxTasks:7,maxMinutes:30});
  await page.reload();
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await expect(section.getByLabel("Cancella quelli più vecchi di")).toHaveValue("30");
  await expect(section.getByLabel("Tieni gli ultimi (task)")).toHaveValue("7");

  // GitHub is a second choice: it cannot be turned on before «keep forever».
  const keep=section.getByRole("checkbox",{name:/Conserva richieste e risposte senza scadenza/});
  const github=section.getByRole("checkbox",{name:/Scrivi le conversazioni conservate anche su GitHub/});
  await expect(keep).not.toBeChecked();
  await expect(github).toBeDisabled();
  await keep.check();
  await expect(github).toBeEnabled();
  page.once("dialog",dialog=>{expect(dialog.message()).toContain("repository private");void dialog.accept();});
  await github.check();
  await expect.poll(()=>page.evaluate(async()=>{
    const path="/src/infrastructure/db.ts";
    const settings=await(await import(/* @vite-ignore */path)).loadSettings();
    return [settings.keepAiConversations,settings.syncAiConversationsToGitHub];
  })).toEqual([true,true]);
  // Turning the first one off turns the dependent one off as well.
  await keep.uncheck();
  await expect(github).toBeDisabled();
  await expect(github).not.toBeChecked();
  await expect.poll(()=>page.evaluate(async()=>{
    const path="/src/infrastructure/db.ts";
    const settings=await(await import(/* @vite-ignore */path)).loadSettings();
    return [settings.keepAiConversations,settings.syncAiConversationsToGitHub];
  })).toEqual([false,false]);
  await keep.check();
  await section.screenshot({path:test.info().outputPath("conservazione-conversazioni.png")});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("mostra le azioni mentre il modello scrive: ultime due schede, quella in corso e il testo che scorre",async({page})=>{
  test.setTimeout(60_000);
  await prepare(page);
  const toast=page.getByRole("complementary",{name:"Lavoro in background"});
  const feed=toast.getByRole("region",{name:"Azioni del modello"});
  const emit=(text:string)=>page.evaluate(piece=>(window as StreamProbe).emit(piece),text);

  // The verdict is complete, the summary is still being typed.
  await emit('{"verdict":"issues","summary":"Due problemi: un clich');
  await expect(feed.getByLabel("Ultime azioni completate")).toContainText("Esito: ha trovato dei problemi");
  await expect(feed.getByLabel("Azione in corso")).toContainText("Sta scrivendo la sintesi del rapporto");
  await expect(feed.getByLabel("Azione in corso")).toContainText("Due problemi: un clich");

  // The summary is complete; the first finding is half written: its text is shown as it arrives.
  await emit('é e una svista.","findings":[{"sceneId":"scene:001:002","category":"Cliché","severity":"minor","evidence":"Il sole tramontava","reason":"Immagine abu');
  const writing=feed.getByLabel("Azione in corso");
  await expect(writing).toContainText("Sta scrivendo il rilievo 1 · motivo");
  await expect(writing).toContainText("Minore");
  await expect(writing).toContainText("Immagine abu");
  await expect(feed.getByLabel("Ultime azioni completate").getByRole("listitem")).toHaveCount(2);

  // Finding 1 is complete and finding 2 begins: only the LAST TWO completed actions stay as cards.
  await emit('sata.","remediation":"Variare."},{"sceneId":"scene:001:003","category":"Cronologia","severity":"critical","evidence":"Alle tre","reason":"Contrad');
  const cards=feed.getByLabel("Ultime azioni completate").getByRole("listitem");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Sintesi del revisore");
  await expect(cards.nth(1)).toContainText("Cliché");
  await expect(cards.nth(1)).toContainText("Immagine abusata");
  await expect(feed.getByLabel("Esito: ha trovato dei problemi")).toHaveCount(0);
  await expect(writing).toContainText("Sta scrivendo il rilievo 2");
  await expect(writing).toContainText("Critico");
  await expect(feed.getByLabel("Conteggi")).toContainText("1 Rilievo");

  // The scrolling text is still there, with the raw reply.
  await expect(toast.getByLabel("Ultime cinque righe ricevute")).toContainText("Contrad");
  await toast.screenshot({path:test.info().outputPath("azioni-riquadro.png")});

  // The rest of the reply: finding 2 and the memory note become cards, nothing is being written any more.
  await emit('azione.","remediation":"Spostare l\'ora."}],"memoryNote":"Mara non sa della lettera."}');
  await expect(cards.nth(0)).toContainText("Cronologia");
  await expect(cards.nth(1)).toContainText("Nota per i prossimi segmenti");
  await expect(feed.getByLabel("Azione in corso")).toHaveCount(0);
  await expect(feed.getByLabel("Conteggi")).toContainText("2 Rilievi");
  await expect(feed.getByLabel("Conteggi")).toContainText("1 critici");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

  // The dashboard shows the same actions in full, with the scene and every action so far.
  // On a phone the floating card covers the page: reduce it first, as an author would.
  await toast.getByRole("button",{name:"Riduci anteprima streaming"}).click();
  const stream=page.getByRole("region",{name:"Streaming task corrente"}).first();
  const full=stream.getByRole("region",{name:"Azioni del modello"});
  await expect(full.getByLabel("Ultime azioni completate").getByRole("listitem").nth(0)).toContainText("capitolo 1 · scena 3");
  await full.getByText(/Tutte le azioni fatte finora \(5\)/).click();
  await expect(full.getByLabel("Tutte le azioni completate")).toContainText("Esito: ha trovato dei problemi");
  await expect(full.getByLabel("Tutte le azioni completate").getByRole("listitem")).toHaveCount(5);
  await stream.screenshot({path:test.info().outputPath("azioni-completo.png")});
  await page.evaluate(()=>(window as StreamProbe).finish());
  await expect(toast).toHaveCount(0);
});
