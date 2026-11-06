import { expect, test } from "@playwright/test";

test("dossier storico desktop/mobile: consenso e query pubblica, citazione controllata, giudice critico",async({page})=>{
  test.setTimeout(120_000);
  let wikipediaCalls:string[]=[];
  const crossrefCalls:string[]=[];
  const archiveCalls:string[]=[];
  const modelCalls:Array<{system:string;prompt:string}>=[];
  await page.route(/https:\/\/it\.wikipedia\.org\/w\/api\.php\?/,async route=>{
    const url=route.request().url();
    wikipediaCalls.push(url);
    await route.fulfill({status:200,headers:{"content-type":"application/json",
      "access-control-allow-origin":"*"},
      body:JSON.stringify({query:{pages:[{
        pageid:42,title:"Telegrafo",
        canonicalurl:"https://it.wikipedia.org/wiki/Telegrafo",
        revisions:[{revid:321}],
        extract:"Il telegrafo elettrico cominciò a diffondersi in Europa nel XIX secolo.",
      }]}}),
    });
  });
  await page.route(/https:\/\/api\.crossref\.org\/works\//,async route=>{
    crossrefCalls.push(route.request().url());
    await route.fulfill({status:200,headers:{
      "content-type":"application/json","access-control-allow-origin":"*",
    },body:JSON.stringify({status:"ok",message:{
      DOI:"10.1000/xyz123",title:["Storia del telegrafo nell'Europa ottocentesca"],
      author:[{given:"Anna",family:"Rossi"}],
      publisher:"Archivio storico",type:"journal-article",
      "container-title":["Rivista di storia"],
      issued:{"date-parts":[[2015,6,1]]},
      abstract:"TESTO NON LEGGERE COME PROVA",
    }})});
  });
  await page.route(/https:\/\/www\.loc\.gov\/search\/\?/,async route=>{
    archiveCalls.push(route.request().url());
    await route.fulfill({status:200,headers:{
      "content-type":"application/json","access-control-allow-origin":"*",
    },body:JSON.stringify({results:[{
      id:"https://www.loc.gov/item/2020123456/",
      title:"Telegraph correspondence in 1848",date:"1848",
      description:["Historic correspondence digitized by the Library of Congress."],
    }]})});
  });
  await page.route("https://api.openai.com/v1/chat/completions",async route=>{
    if(route.request().method()==="OPTIONS"){
      await route.fulfill({status:204,headers:{
        "access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type",
        "access-control-allow-methods":"POST,OPTIONS",
      }});return;
    }
    const body=route.request().postDataJSON() as {
      messages:Array<{role:string;content:string}>;
    };
    const system=body.messages.find(m=>m.role==="system")?.content??"";
    const prompt=body.messages.find(m=>m.role==="user")?.content??"";
    modelCalls.push({system,prompt});
    const historical=system.includes("Plausibilità e accuratezza storica");
    const judge=system.includes("direttore editoriale CRITICO");
    const text=judge?JSON.stringify({
      reasoning:"La fonte è una voce enciclopedica terziaria, non prova che il testo contenga un errore storico verificato.",
      decisions:[{findingId:"1:historical:0:0",action:"reject",
        rationale:"La fonte non dimostra che nel 1848 la specifica scena sia impossibile; non applicare modifiche speculative.",
        remediation:""}],
    }):prompt.includes("chapterSummary")?JSON.stringify({
      chapterSummary:"Mara invia un messaggio nel castello senza rivelare il segreto.",
      bookSummary:"Il romanzo inizia con Mara che usa il telegrafo in un castello.",
    }):historical?JSON.stringify({
      verdict:"issues",summary:"L'uso storico dell'apparecchio richiede verifica puntuale.",
      memoryNote:"La fonte è terziaria, non definitiva.",
      findings:[{
        sceneId:"scene-history",category:"tecnologia",severity:"minor",
        evidence:"Mara usa il telegrafo",
        reason:"La diffusione della tecnologia nell'anno della scena va verificata localmente.",
        remediation:"Specificare il tipo di apparecchio solo se l'autore verifica una fonte migliore.",
        historical:{
          claim:"Il telegrafo elettrico era noto in Europa nel secolo XIX.",
          assessment:"consistent_with_excerpt",
          sourceIds:["itwiki:42:321"],
          sourceEvidence:[{sourceId:"itwiki:42:321",quote:"Il telegrafo elettrico cominciò a diffondersi"}],
        },
      }],
    }):JSON.stringify({
      verdict:"pass",summary:"Nessuna criticità identificata nel segmento letto.",
      findings:[],memoryNote:"Lettura indipendente senza rilievi.",
    });
    await route.fulfill({status:200,headers:{
      "content-type":"application/json","access-control-allow-origin":"*",
      "access-control-allow-headers":"authorization,content-type",
    },body:JSON.stringify({choices:[{message:{content:text}}],
      usage:{prompt_tokens:110,completion_tokens:40}})});
  });
  await page.goto("/");
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Ricerca storica guidata");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Mara custodisce un segreto e usa un telegrafo nel 1848.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(async()=>new Promise<void>((resolve,reject)=>{
    const req=indexedDB.open("bookwriter");
    req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const tx=req.result.transaction("books","readwrite");
      const store=tx.objectStore("books");
      const all=store.getAll();
      all.onerror=()=>reject(all.error);
      all.onsuccess=()=>{
        const b=all.result[0] as Record<string,unknown>;
        b.status="paused";b.phase="prose";
        b.chapters=[{id:"ch-history",number:1,title:"La notizia",purpose:"Presentare il conflitto",
          scenes:[{id:"scene-history",number:1,title:"Il telegrafo",objective:"Portare il messaggio",
            text:"Nel 1848 Mara usa il telegrafo elettrico per mandare un messaggio.",
            summary:"Mara comunica.",status:"canon"}]}];
        (b.memory as {secrets:Record<string,string>}).secrets.chiave=
          "La chiave apre una stanza segreta non rivelata ai lettori.";
        store.put(b,b.id as string);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
      };
    };
  }));
  const nav=page.getByRole("navigation",{name:test.info().project.name==="mobile-chromium"
    ?"Navigazione mobile":"Navigazione principale"});
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await page.getByLabel("API key").fill("sk-test-historical-only");
  await page.getByRole("textbox",{name:"Modello predefinito"}).fill("historical-mock-model");
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();
  const editorial=page.getByRole("region",{name:"Redazione multi-agente"});
  const dossier=editorial.getByText(/Dossier storico/);
  await dossier.click();
  await editorial.getByRole("textbox",{name:"Ricerche storiche capitolo 1"}).fill("Telegrafo elettrico nel 1848");
  page.once("dialog",dialog=>{
    expect(dialog.message()).toContain("SOLO queste frasi");
    expect(dialog.message()).toContain("Telegrafo elettrico nel 1848");
    expect(dialog.message()).not.toContain("stanza segreta");
    return dialog.accept();
  });
  await editorial.getByRole("button",{name:"Cerca fonti pubbliche"}).click();
  await expect(editorial.getByRole("link",{name:/Telegrafo/})).toBeVisible({timeout:15_000});
  expect(wikipediaCalls).toHaveLength(1);
  const url=new URL(wikipediaCalls[0]!);
  expect(url.searchParams.get("gsrsearch")).toBe("Telegrafo elettrico nel 1848");
  expect(wikipediaCalls[0]).not.toContain("stanza");
  expect(wikipediaCalls[0]).not.toContain("Mara");
  await editorial.getByText(/Bibliografia DOI/).click();
  await editorial.getByRole("textbox",{name:"DOI bibliografici capitolo 1"})
    .fill("https://doi.org/10.1000/XYZ123");
  page.once("dialog",dialog=>{
    expect(dialog.message()).toContain("SOLO questi identificativi DOI");
    expect(dialog.message()).toContain("10.1000/xyz123");
    expect(dialog.message()).not.toContain("stanza segreta");
    return dialog.accept();
  });
  await editorial.getByRole("button",{name:"Recupera metadati DOI"}).click();
  await expect(editorial.getByRole("link",{name:/Storia del telegrafo nell'Europa/}))
    .toBeVisible({timeout:15000});
  expect(crossrefCalls).toHaveLength(1);
  expect(crossrefCalls[0]).toContain("api.crossref.org/works/10.1000/xyz123");
  expect(crossrefCalls[0]).not.toContain("Mara");
  expect(crossrefCalls[0]).not.toContain("stanza");
  await editorial.getByText(/^Archivi istituzionali ·/).click();
  await editorial.getByRole("textbox",{name:"Ricerche archivistiche capitolo 1"})
    .fill("telegraph correspondence 1848");
  page.once("dialog",dialog=>{
    expect(dialog.message()).toContain("www.loc.gov");
    expect(dialog.message()).toContain("telegraph correspondence 1848");
    expect(dialog.message()).not.toContain("stanza segreta");
    return dialog.accept();
  });
  await editorial.getByRole("button",{name:"Cerca schede archivistiche"}).click();
  await expect(editorial.getByRole("link",{name:/Telegraph correspondence in 1848/}))
    .toBeVisible({timeout:15000});
  expect(archiveCalls).toHaveLength(1);
  expect(new URL(archiveCalls[0]!).searchParams.get("q")).toBe("telegraph correspondence 1848");
  expect(archiveCalls[0]).not.toContain("Mara");
  expect(archiveCalls[0]).not.toContain("stanza");
  await editorial.getByText(/Estratti da originali consultati dall'autore/).click();
  await editorial.getByRole("textbox",{name:"Collocazione originale capitolo 1"})
    .fill("Page 12, column 2");
  await editorial.getByRole("textbox",{name:"Data documento originale capitolo 1"})
    .fill("1848 original");
  await editorial.getByRole("textbox",{name:"Trascrizione originale capitolo 1"})
    .fill("The telegraph apparatus was operated at the station during the winter of 1848.");
  await editorial.getByRole("textbox",{name:"Motivazione diritti capitolo 1"})
    .fill("La pagina istituzionale dichiara il testo nel pubblico dominio.");
  await editorial.getByRole("checkbox",{name:/Dichiaro di aver consultato/}).check();
  page.once("dialog",dialog=>{
    expect(dialog.message()).toContain("SALVATAGGIO TRASCRIZIONE");
    expect(dialog.message()).toContain("Page 12, column 2");
    expect(dialog.message()).toContain("The telegraph apparatus");
    expect(dialog.message()).not.toContain("stanza segreta");
    return dialog.accept();
  });
  await editorial.getByRole("button",{name:"Archivia estratto attestato"}).click();
  await expect(editorial.getByText("The telegraph apparatus was operated at the station during the winter of 1848."))
    .toBeVisible({timeout:15000});
  expect(archiveCalls).toHaveLength(1); // The local author submission must NEVER fetch originals.
  await page.getByRole("button",{name:"Riprendi"}).click();
  await expect(editorial.getByText(/Congelato il/)).toBeVisible({timeout:85_000});
  expect(modelCalls.filter(x=>x.system.includes("revisore letterario INDIPENDENTE"))).toHaveLength(12);
  expect(modelCalls.filter(x=>x.system.includes("direttore editoriale CRITICO"))).toHaveLength(1);
  const specialist=modelCalls.find(x=>x.system.includes("Plausibilità e accuratezza storica"));
  expect(specialist?.prompt).toContain("itwiki:42:321");
  expect(specialist?.prompt).toContain("Il telegrafo elettrico");
  expect(specialist?.prompt).toContain("10.1000/xyz123");
  expect(specialist?.prompt).toContain("BIBLIOGRAFIA DOI");
  expect(specialist?.prompt).toContain("loc:2020123456");
  expect(specialist?.prompt).toContain("locex:2020123456");
  expect(specialist?.system).toContain("CIASCUN sourceId");
  const judgeCall=modelCalls.find(x=>x.system.includes("direttore editoriale CRITICO"));
  expect(judgeCall?.prompt).toContain('"quoteMatches":true');
  expect(judgeCall?.prompt).toContain("loc:2020123456");
  expect(judgeCall?.prompt).toContain("locex:2020123456");
  expect(modelCalls.filter(x=>x.system.includes("Lettore ")).every(x=>
    !x.prompt.includes("itwiki:42:321"))).toBe(true);
  expect(modelCalls.filter(x=>x.system.includes("Lettore ")).every(x=>
    !x.prompt.includes("10.1000/xyz123"))).toBe(true);
  expect(modelCalls.filter(x=>x.system.includes("Lettore ")).every(x=>
    !x.prompt.includes("loc:2020123456"))).toBe(true);
  expect(modelCalls.filter(x=>x.system.includes("Lettore ")).every(x=>
    !x.prompt.includes("locex:2020123456"))).toBe(true);
  await editorial.getByText(/Giudizi archiviati \(1\)/).click();
  await editorial.getByText(/Plausibilità e accuratezza storica ·/).click();
  await expect(editorial.getByText(/Citazione associata/)).toBeVisible();
  await expect(editorial.getByText(/La fonte non dimostra/)).toBeVisible();
  const metrics=await page.evaluate(()=>({
    actual:document.documentElement.scrollWidth,expected:window.innerWidth,
  }));
  expect(metrics.actual).toBeLessThanOrEqual(metrics.expected+1);
});
