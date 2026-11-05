import { afterEach, describe, expect, it, vi } from "vitest";
import { searchHistoricalWikipedia } from "./historical-sources";

function reply(pages: unknown[]): Response {
  return new Response(JSON.stringify({query:{pages}}),{status:200,headers:{"content-type":"application/json"}});
}
const page={pageid:42,title:"Telegrafo",canonicalurl:"https://it.wikipedia.org/wiki/Telegrafo",
  extract:"Il telegrafo elettrico è una tecnologia storica del XIX secolo.",
  revisions:[{revid:321}]};
afterEach(()=>vi.unstubAllGlobals());
describe("Ricerca storica senza segreti tramite MediaWiki",()=>{
  it("invia solo la query approvata a host fisso, senza cookies o intero romanzo",async()=>{
    const fetchMock=vi.fn(async(_url:string,_init:RequestInit)=>reply([page]));
    vi.stubGlobal("fetch",fetchMock);
    const result=await searchHistoricalWikipedia(["  Telegrafo elettrico 1848  "]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("itwiki:42:321");
    expect(result[0]?.url).toBe("https://it.wikipedia.org/wiki/Telegrafo");
    const url=new URL(fetchMock.mock.calls[0]![0]);
    expect(url.origin).toBe("https://it.wikipedia.org");
    expect(url.pathname).toBe("/w/api.php");
    expect(url.searchParams.get("gsrsearch")).toBe("Telegrafo elettrico 1848");
    expect(url.searchParams.get("origin")).toBe("*");
    expect(url.searchParams.get("gsrlimit")).toBe("3");
    expect(url.href).not.toContain("segreto");
    const options=fetchMock.mock.calls[0]![1];
    expect(options.credentials).toBe("omit");
    expect(options.redirect).toBe("error");
    expect(options.referrerPolicy).toBe("no-referrer");
    expect(options.method).toBe("GET");
    expect(options.headers).toBeUndefined();
  });
  it("scarta falsi host e pagine senza estratti, senza seguire link forniti dal servizio",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>reply([
      {...page, pageid:4, canonicalurl:"https://it.wikipedia.org.attacker.tld/wiki/Telegrafo"},
      {...page, pageid:5, canonicalurl:"http://it.wikipedia.org/wiki/Telegrafo"},
      {...page,pageid:6,extract:""},
      page,
    ])));
    const result=await searchHistoricalWikipedia(["Telegrafo elettrico 1848"]);
    expect(result).toHaveLength(1);
    expect(result[0]?.pageId).toBe(42);
  });
  it("un errore della seconda query non restituisce un dossier parziale",async()=>{
    const fetchMock=vi.fn(async()=>reply([page]))
      .mockResolvedValueOnce(reply([page]))
      .mockResolvedValueOnce(new Response("",{status:503}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(searchHistoricalWikipedia(["Telegrafo elettrico 1848","Ferrovie europee 1848"]))
      .rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("rifiuta risposte non JSON o contenuti eccessivi",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("test invalid")));
    await expect(searchHistoricalWikipedia(["Telegrafo elettrico 1848"]))
      .rejects.toThrow(/JSON/);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("a".repeat(170_001))));
    await expect(searchHistoricalWikipedia(["Telegrafo elettrico 1848"]))
      .rejects.toThrow(/troppo grande/);
  });
  it("senza risultati non presume che un argomento sia verificato",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>reply([])));
    expect(await searchHistoricalWikipedia(["Telegrafo elettrico 1848"])).toEqual([]);
  });
  it("non effettua chiamate se le query contengono credenziali",async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    await expect(searchHistoricalWikipedia(["https://privato.example/token"]))
      .rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
