import { afterEach, describe, expect, it, vi } from "vitest";
import { searchLibraryOfCongress } from "./library-of-congress";

const results={results:[
  {id:"https://www.loc.gov/item/2020123456/",title:"Telegraph history",
    date:"1848",description:["Historical letters relating to telegraphs."]},
  {id:"https://www.loc.gov.attacker.com/item/evil/",title:"Host spoofed"},
  {id:"https://www.loc.gov/item/another123/",title:"Archive image"},
]};
const ok=(data:unknown=results)=>new Response(JSON.stringify(data),{status:200});
afterEach(()=>vi.unstubAllGlobals());
describe("Adapter Library of Congress read-only",()=>{
  it("invia soltanto la query approvata al provider fisso senza credenziali",async()=>{
    const f=vi.fn(async(_url:string,_options:RequestInit)=>ok());
    vi.stubGlobal("fetch",f);
    const items=await searchLibraryOfCongress(["telegraph communications 1848"]);
    expect(items).toHaveLength(2);
    expect(items[0]?.url).toBe("https://www.loc.gov/item/2020123456/");
    expect(items[0]?.description).toContain("Historical letters");
    const u=new URL(f.mock.calls[0]![0]);
    expect(u.origin).toBe("https://www.loc.gov");
    expect(u.pathname).toBe("/search/");
    expect(u.searchParams.get("q")).toBe("telegraph communications 1848");
    expect(u.searchParams.get("fo")).toBe("json");
    expect(u.searchParams.get("c")).toBe("3");
    const init=f.mock.calls[0]![1];
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.headers).toBeUndefined();
  });
  it("filtra link ostili e non salva percorsi da risorse arbitrarie",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>ok({results:[
      {id:"https://www.loc.gov/item/2020123456/?token=private",title:"Untrusted"},
      {id:"https://www.loc.gov/resource/xyz/",title:"Not an item"},
      {id:"http://www.loc.gov/item/2020123456/",title:"Canonicalized institutional item"},
    ]})));
    const items=await searchLibraryOfCongress(["telegraph communications 1848"]);
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe("https://www.loc.gov/item/2020123456/");
  });
  it("fail closed su 429, payload non valido o troppo grande, senza risultati parziali",async()=>{
    const f=vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(new Response("",{status:429}));
    vi.stubGlobal("fetch",f);
    await expect(searchLibraryOfCongress(["telegraph communications 1848","railroad photography 1860"]))
      .rejects.toThrow(/429/);
    vi.stubGlobal("fetch",vi.fn(async()=>ok({results:"not-an-array"})));
    await expect(searchLibraryOfCongress(["telegraph communications 1848"]))
      .rejects.toThrow(/Formato/);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("x".repeat(240001),{status:200})));
    await expect(searchLibraryOfCongress(["telegraph communications 1848"]))
      .rejects.toThrow(/troppo grande/);
  });
  it("non effettua alcuna chiamata per credenziali, URL o query non valide",async()=>{
    const mock=vi.fn();vi.stubGlobal("fetch",mock);
    await expect(searchLibraryOfCongress(["https://attacker.example/private"]))
      .rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
});
