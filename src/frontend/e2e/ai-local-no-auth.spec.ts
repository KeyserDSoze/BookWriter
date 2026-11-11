import { expect, test } from "@playwright/test";

type LocalProbe = Window & {
  localModels?: Array<{url:string;headers:Record<string,string>}>;
  localPosts?: Array<{url:string;headers:Record<string,string>}>;
};

test("LM Studio localhost: /models, Save/reload e POST senza API key (desktop/mobile)",async({page})=>{
  test.setTimeout(90_000);
  await page.addInitScript(()=>{
    const old=window.fetch.bind(window);
    const probe=window as LocalProbe;
    probe.localModels=[];probe.localPosts=[];
    window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
      if(!url.startsWith("http://localhost:1234/v1/"))return old(input,init);
      const headers=(init?.headers??{}) as Record<string,string>;
      if(url.endsWith("/models")){
        probe.localModels!.push({url,headers});
        return new Response(JSON.stringify({data:[{id:"model-locale"}]}),{
          headers:{"content-type":"application/json"}});
      }
      if(url.endsWith("/chat/completions")){
        probe.localPosts!.push({url,headers});
        return new Response("Risposta simulata", {status:503});
      }
      throw Error("URL inatteso");
    };
  });
  // No request is allowed to reach a developer's actual LM Studio server.
  await page.route("http://localhost:1234/v1/**",route=>route.abort());
  await page.goto("/");
  const navigation=()=>page.getByRole("navigation",{
    name:test.info().project.name==="mobile-chromium"?
      "Navigazione mobile":"Navigazione principale",
  });
  await navigation().getByRole("button",{name:"Impostazioni"}).click();
  await page.getByRole("textbox",{name:"Base URL"}).fill("http://localhost:1234/v1");
  await page.getByRole("combobox",{name:"Autenticazione AI"}).selectOption("none");
  await expect(page.getByLabel("API key",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Leggi /models"}).click();
  await expect(page.getByRole("textbox",{name:"Modelli rilevati / manuali"}))
    .toHaveValue("model-locale");
  const inventory=await page.evaluate(()=>(window as LocalProbe).localModels);
  expect(inventory).toHaveLength(1);
  expect(inventory?.[0]?.headers).toEqual({});
  await page.getByRole("textbox",{name:"Modello predefinito"}).fill("model-locale");
  await page.getByRole("button",{name:"Salva impostazioni"}).click();
  await expect(page.getByText("Impostazioni salvate in IndexedDB.")).toBeVisible();
  await page.reload();
  await navigation().getByRole("button",{name:"Impostazioni"}).click();
  await expect(page.getByRole("combobox",{name:"Autenticazione AI"})).toHaveValue("none");
  await expect(page.getByLabel("API key",{exact:true})).toHaveCount(0);
  await navigation().getByRole("button",{name:"Dashboard"}).click();
  await page.getByRole("textbox",{name:"Titolo provvisorio"}).fill("Romanzo locale");
  await page.getByRole("textbox",{name:"Descrizione iniziale, spunti e vincoli"})
    .fill("Un castello, un segreto e due personaggi.");
  await page.getByRole("button",{name:"Crea libro"}).click();
  await page.getByRole("button",{name:"Autopilot"}).click();
  await expect.poll(()=>page.evaluate(()=>(window as LocalProbe).localPosts?.length??0),
    {timeout:15_000}).toBe(1);
  const posts=await page.evaluate(()=>(window as LocalProbe).localPosts);
  expect(posts).toHaveLength(1);
  expect(posts?.[0]?.headers).toEqual({"Content-Type":"application/json"});
  expect(posts?.[0]?.url).toBe("http://localhost:1234/v1/chat/completions");
  const layout=await page.evaluate(()=>({
    scroll:document.documentElement.scrollWidth,viewport:window.innerWidth,
  }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.viewport+1);
});
