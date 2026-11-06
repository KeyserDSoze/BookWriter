import { afterEach,describe,expect,it,vi } from "vitest";
import { searchWikisource } from "./wikisource";

const query="Telegrafo e lettere nel 1848";
const page={
  pageid:42,ns:0,title:"Lettere del 1848",
  extract:"La stazione telegrafica inviava dispacci durante tutto l'inverno del 1848.",
  revisions:[{revid:321,timestamp:"2025-06-18T09:30:00Z"}],
};
function response(pages:unknown[],status=200):Response{
  return new Response(JSON.stringify({query:{pages}}),{status,
    headers:{"content-type":"application/json"}});
}
afterEach(()=>vi.unstubAllGlobals());
describe("Wikisource browser-only, consenso e provenienza",()=>{
  it("non invia testo privato o chiavi, usa solo il dominio fisso e la query pubblica",async()=>{
    const fetchMock=vi.fn(async(_url:string,_opts:RequestInit)=>response([page]));
    vi.stubGlobal("fetch",fetchMock);
    const data=await searchWikisource([query]);
    expect(data).toHaveLength(1);
    expect(data[0]?.id).toBe("itws:42:321");
    expect(data[0]?.url).toBe("https://it.wikisource.org/wiki/Lettere_del_1848");
    const url=new URL(fetchMock.mock.calls[0]![0]);
    expect(url.origin).toBe("https://it.wikisource.org");
    expect(url.pathname).toBe("/w/api.php");
    expect(url.searchParams.get("gsrsearch")).toBe(query);
    expect(url.searchParams.get("origin")).toBe("*");
    expect(url.searchParams.get("gsrnamespace")).toBe("0");
    expect(url.searchParams.get("gsrlimit")).toBe("2");
    expect(url.searchParams.get("rvprop")).toBe("ids|timestamp");
    expect(url.href).not.toContain("chiave segreta");
    const options=fetchMock.mock.calls[0]![1];
    expect(options.method).toBe("GET");
    expect(options.redirect).toBe("error");
    expect(options.credentials).toBe("omit");
    expect(options.referrerPolicy).toBe("no-referrer");
    expect(options.headers).toBeUndefined();
  });
  it("scarta namespace non 0, revisioni mancanti, estratti troppo brevi e titoli contraffatti",async()=>{
    const fake=[
      {...page,ns:2},
      {...page,pageid:44,revisions:[{revid:0,timestamp:"2025-01-01T00:00:00Z"}]},
      {...page,pageid:45,extract:""},
      {...page,pageid:46,title:"../malicious"},
      {...page,pageid:47,extract:"dieci"},
      {...page,pageid:48,title:"https://attacker.invalid"},
      page,
    ];
    vi.stubGlobal("fetch",vi.fn(async()=>response(fake)));
    const output=await searchWikisource([query]);
    expect(output.map(s=>s.pageId)).toEqual([42]);
  });
  it("fallisce atomicamente su seconda ricerca non disponibile e su errori CORS",async()=>{
    const fetchMock=vi.fn(async()=>response([page]))
      .mockResolvedValueOnce(response([page]))
      .mockResolvedValueOnce(new Response("Service Unavailable",{status:503,headers:{"content-type":"application/json"}}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(searchWikisource([query,"Lettere e trasporti nel 1848"]))
      .rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new TypeError("Failed to fetch");}));
    await expect(searchWikisource([query])).rejects.toThrow(/Failed to fetch/);
  });
  it("blocca JSON malformato, payload eccessivo, HTTP 429 ed errori API",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("<html/>",{
      headers:{"content-type":"text/html"}})));
    await expect(searchWikisource([query])).rejects.toThrow(/JSON/);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("a".repeat(150_001),{
      headers:{"content-type":"application/json"}})));
    await expect(searchWikisource([query])).rejects.toThrow(/troppo grande/);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("bad",{status:429})));
    await expect(searchWikisource([query])).rejects.toThrow(/429/);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({error:{code:"ratelimited"}}),{
      headers:{"content-type":"application/json"}})));
    await expect(searchWikisource([query])).rejects.toThrow(/non valido/);
  });
  it("non effettua richieste se la query contiene token e non dichiara risultati vuoti come fatto negativo",async()=>{
    const spy=vi.fn();vi.stubGlobal("fetch",spy);
    await expect(searchWikisource(["https://private.example/secret"])).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
    vi.stubGlobal("fetch",vi.fn(async()=>response([])));
    expect(await searchWikisource([query])).toEqual([]);
  });
});
