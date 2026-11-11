import { expect, test } from "@playwright/test";

test("catalogo LM Studio: assegna chat/tools, voce e embedding con predefiniti persistenti (desktop/mobile)",async({page})=>{
  test.setTimeout(90_000);
  await page.addInitScript(()=>{
    const old=window.fetch.bind(window);
    window.fetch=async(input:RequestInfo|URL, init?:RequestInit)=>{
      const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
      if(url!=="http://localhost:1234/v1/models")return old(input,init);
      return new Response(JSON.stringify({data:[
        {id:"meta/muse-glimmer"},
        {id:"phonon-40m-multilingual"},
        {id:"text-embedding-nomic"},
      ]}),{headers:{"content-type":"application/json"}});
    };
  });
  await page.route("http://localhost:1234/v1/**",route=>route.abort());
  await page.goto("/");
  const nav=page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?
      "Navigazione mobile":"Navigazione principale",
  });
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  await page.getByRole("textbox",{name:"Base URL"}).fill("http://localhost:1234/v1");
  await page.getByRole("combobox",{name:"Autenticazione AI"}).selectOption("none");
  await page.getByRole("button",{name:"Leggi /models"}).click();
  await expect(page.getByText("Trovati 3 modelli. Premi Salva impostazioni per conservarli.")).toBeVisible();
  const catalog=page.getByRole("region",{name:"Ruoli dei modelli AI"});
  const chat=catalog.getByRole("group",{name:"Ruoli per meta/muse-glimmer (OpenAI)"});
  const voice=catalog.getByRole("group",{name:"Ruoli per phonon-40m-multilingual (OpenAI)"});
  const embedding=catalog.getByRole("group",{name:"Ruoli per text-embedding-nomic (OpenAI)"});
  await expect(chat.getByRole("checkbox",{name:"Chat / scrittura"})).not.toBeChecked();
  await expect(voice.getByRole("checkbox",{name:"Voce"})).not.toBeChecked();
  await chat.getByRole("checkbox",{name:"Chat / scrittura"}).check();
  await chat.getByRole("checkbox",{name:"Tool calling"}).check();
  await voice.getByRole("checkbox",{name:"Voce"}).check();
  await embedding.getByRole("checkbox",{name:"Embedding"}).check();
  await chat.getByRole("button",{name:"Usa come predefinito Chat"}).click();
  await catalog.getByRole("combobox",{name:"Predefinito Tool calling"})
    .selectOption({label:"OpenAI: meta/muse-glimmer"});
  await catalog.getByRole("combobox",{name:"Predefinito Voce"})
    .selectOption({label:"OpenAI: phonon-40m-multilingual"});
  await catalog.getByRole("combobox",{name:"Predefinito Embedding"})
    .selectOption({label:"OpenAI: text-embedding-nomic"});
  await expect(page.getByRole("textbox",{name:"Modello predefinito"})).toHaveValue("meta/muse-glimmer");
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();
  await nav.getByRole("button",{name:"Impostazioni"}).click();
  const restored=page.getByRole("region",{name:"Ruoli dei modelli AI"});
  await expect(restored.getByRole("group",{name:"Ruoli per meta/muse-glimmer (OpenAI)"})
    .getByRole("checkbox",{name:"Tool calling"})).toBeChecked();
  await expect(restored.getByRole("group",{name:"Ruoli per phonon-40m-multilingual (OpenAI)"})
    .getByRole("checkbox",{name:"Voce"})).toBeChecked();
  await expect(restored.getByRole("group",{name:"Ruoli per text-embedding-nomic (OpenAI)"})
    .getByRole("checkbox",{name:"Embedding"})).toBeChecked();
  await expect(restored.getByRole("combobox",{name:"Predefinito Voce"}))
    .toHaveValue(JSON.stringify(["openai","phonon-40m-multilingual"]));
  await expect(restored.getByRole("combobox",{name:"Predefinito Embedding"}))
    .toHaveValue(JSON.stringify(["openai","text-embedding-nomic"]));
  await expect(page.getByRole("textbox",{name:"Modello predefinito"})).toHaveValue("meta/muse-glimmer");
  // Unsetting a role clears only that role's default. It must not rewrite Chat.
  await restored.getByRole("group",{name:"Ruoli per phonon-40m-multilingual (OpenAI)"})
    .getByRole("checkbox",{name:"Voce"}).uncheck();
  await expect(restored.getByRole("combobox",{name:"Predefinito Voce"})).toHaveValue("");
  await expect(page.getByRole("textbox",{name:"Modello predefinito"})).toHaveValue("meta/muse-glimmer");
  const layout=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  expect(layout.scroll).toBeLessThanOrEqual(layout.viewport+1);
});
