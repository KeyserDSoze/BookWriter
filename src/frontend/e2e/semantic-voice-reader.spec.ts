import { expect, test } from "@playwright/test";

type LocalWindow = Window & {
  embedRequests?: Array<{model:string;input:string[]}>;
  spokenTexts?: string[];
  spokenActions?: string[];
};

test("lettura ad alta voce e ricerca semantica canonical-only con LM Studio mock (desktop/mobile)",async({page})=>{
  test.setTimeout(90_000);
  await page.addInitScript(()=>{
    const original=window.fetch.bind(window);
    const probe=window as LocalWindow;
    probe.embedRequests=[];probe.spokenTexts=[];probe.spokenActions=[];
    Object.defineProperty(window,"SpeechSynthesisUtterance",{configurable:true,
      value:class {
        text:string;
        rate=1;
        lang="";
        voice:SpeechSynthesisVoice|null=null;
        onend?:()=>void;
        onerror?:()=>void;
        constructor(text:string){this.text=text;}
      },
    });
    Object.defineProperty(window,"speechSynthesis",{configurable:true,value:{
      getVoices:()=>[],
      addEventListener:()=>{},removeEventListener:()=>{},
      speak:(utterance:{text:string})=>{probe.spokenTexts!.push(utterance.text);},
      cancel:()=>{probe.spokenActions!.push("cancel");},
      pause:()=>{probe.spokenActions!.push("pause");},
      resume:()=>{probe.spokenActions!.push("resume");},
    }});
    window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
      if(url!=="http://localhost:1234/v1/embeddings")return original(input,init);
      const payload=JSON.parse(String(init?.body)) as {model:string;input:string[]};
      probe.embedRequests!.push(payload);
      const data=payload.input.map((value,index)=>({
        index,embedding:value.toLowerCase().includes("ponte")?[1,0,0]:[0,1,0],
      }));
      return new Response(JSON.stringify({data}),{headers:{"content-type":"application/json"}});
    };
  });
  await page.route("http://localhost:1234/v1/**",route=>route.abort());
  await page.goto("/");
  const navigation=()=>page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?
      "Navigazione mobile":"Navigazione principale",
  });
  await navigation().getByRole("button",{name:"Impostazioni"}).click();
  await page.getByRole("textbox",{name:"Base URL"}).fill("http://localhost:1234/v1");
  await page.getByRole("combobox",{name:"Autenticazione AI"}).selectOption("none");
  await page.getByRole("textbox",{name:"Modelli rilevati / manuali"})
    .fill("text-embedding-nomic-embed-text-v1.5");
  const catalog=page.getByRole("region",{name:"Ruoli dei modelli AI"});
  await catalog.getByRole("group",{name:"Ruoli per text-embedding-nomic-embed-text-v1.5 (OpenAI)"})
    .getByRole("checkbox",{name:"Embedding"}).check();
  await catalog.getByRole("combobox",{name:"Predefinito Embedding"})
    .selectOption({label:"OpenAI: text-embedding-nomic-embed-text-v1.5"});
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await navigation().getByRole("button",{name:"Dashboard"}).click();
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Ricerca narrativa locale");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Una storia sul ponte e sulla foresta.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const opening=indexedDB.open("bookwriter");
    opening.onerror=()=>reject(opening.error);
    opening.onsuccess=()=>{
      const tx=opening.result.transaction("books","readwrite");
      const get=tx.objectStore("books").getAll();
      get.onerror=()=>reject(get.error);
      get.onsuccess=()=>{
        const b=get.result[0] as Record<string,unknown>;
        b.status="paused";b.phase="chapterReview";
        b.chapters=[{id:"ch-one",number:1,title:"Segreti",purpose:"Test",
          scenes:[
            {id:"scene-bridge",number:1,title:"Il ponte",objective:"Contesto",
              status:"canon",text:"Mara incontra il custode sul ponte antico. Il ponte nasconde il segreto."},
            {id:"scene-forest",number:2,title:"La foresta",objective:"Contesto",
              status:"canon",text:"La foresta ricopriva il sentiero di foglie verdi."},
            {id:"scene-draft",number:3,title:"Bozza riservata",objective:"Privato",
              status:"draft",text:"Non inviare il testo di questa bozza segreta."},
          ]}];
        tx.objectStore("books").put(b,b.id as string);
      };
      tx.onerror=()=>reject(tx.error);
      tx.oncomplete=()=>resolve();
    };
  }));
  await page.reload();
  await navigation().getByRole("button",{name:"Libro"}).click();
  const reader=page.getByRole("region",{name:"Ascolta il manoscritto"});
  await expect(reader.getByRole("combobox",{name:"Scena da ascoltare"}))
    .toContainText("Il ponte");
  await reader.getByRole("button",{name:"Ascolta scena"}).click();
  const spoken=await page.evaluate(()=>(window as LocalWindow).spokenTexts ?? []);
  expect(spoken).toHaveLength(1);
  expect(spoken[0]).toContain("ponte antico");
  expect(spoken[0]).not.toContain("bozza segreta");
  await reader.getByRole("button",{name:"Pausa"}).click();
  await reader.getByRole("button",{name:"Riprendi"}).click();
  await reader.getByRole("button",{name:"Ferma"}).click();
  const search=page.getByRole("region",{name:"Ricerca semantica"});
  expect((await page.evaluate(()=>(window as LocalWindow).embedRequests))?.length).toBe(0);
  await search.getByRole("button",{name:"Indicizza scene su localhost"}).click();
  await expect(search.getByText(/Indicizzate 2 scene in memoria volatile/)).toBeVisible();
  await search.getByRole("textbox",{name:"Cerca nel manoscritto"}).fill("ponte segreto");
  await search.getByRole("button",{name:"Cerca scene simili"}).click();
  const matches=search.getByRole("list",{name:"Risultati semantici"}).getByRole("listitem");
  await expect(matches).toHaveCount(2);
  await expect(matches.first()).toContainText("Il ponte");
  await matches.first().getByRole("button",{name:"Vai alla scena"}).click();
  const encoded=await page.evaluate(()=>(window as LocalWindow).embedRequests);
  expect(encoded).toHaveLength(2);
  expect(encoded?.[0]?.input).toHaveLength(2);
  expect(encoded?.[0]?.input[0]).toContain("search_document:");
  expect(encoded?.[1]?.input[0]).toContain("search_query:");
  expect(JSON.stringify(encoded)).not.toContain("Non inviare il testo");
  const layout=await page.evaluate(()=>({
    scroll:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.viewport+1);
});
