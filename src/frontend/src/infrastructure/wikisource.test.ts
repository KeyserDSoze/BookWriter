import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWikisource, selectLiteralWikisourceExcerpt } from "./wikisource";

const query="Telegrafo e lettere nel 1848";
const revisionAt="2025-06-18T09:30:00Z";
const raw=`{{Intestazione|autore=anonimo|titolo=Lettere}}
<pages index="Numero sconosciuto"/>
La stazione telegrafica inviava dispacci durante tutto l'inverno del 1848.
Una seconda frase nella trascrizione collaborative riguarda la corrispondenza pubblica.`;
const searchPage={pageid:42,ns:0,title:"Lettere del 1848",
  extract:"ESTRATTO DELLA PAGINA CORRENTE CHE NON VA CITATO",
  revisions:[{revid:321,timestamp:revisionAt}]};
const revisionPage={pageid:42,ns:0,title:"Lettere del 1848",
  revisions:[{revid:321,timestamp:revisionAt,slots:{main:{contentmodel:"wikitext",content:raw}}}]};
function reply(pages:unknown[],status=200):Response{
  return new Response(JSON.stringify({query:{pages}}),{
    status,headers:{"content-type":"application/json"},
  });
}
function mockBoth(searchPages:unknown[]=[searchPage],revisionPages:unknown[]=[revisionPage]){
  const spy=vi.fn(async(url:string,_options:RequestInit)=>{
    const params=new URL(url).searchParams;
    return params.has("revids")?reply(revisionPages):reply(searchPages);
  });
  vi.stubGlobal("fetch",spy);
  return spy;
}
afterEach(()=>vi.unstubAllGlobals());
describe("Wikisource: il frammento appartiene alla revisione esatta",()=>{
  it("fa ricerca pubblica e LETTURA separata per revid, senza TextExtracts, credenziali o redirezioni",async()=>{
    const spy=mockBoth();
    const found=await searchWikisource([query]);
    expect(found).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
    const search=new URL(spy.mock.calls[0]![0]);
    const exact=new URL(spy.mock.calls[1]![0]);
    expect(search.origin).toBe("https://it.wikisource.org");
    expect(exact.origin).toBe("https://it.wikisource.org");
    expect(search.pathname).toBe("/w/api.php");
    expect(exact.pathname).toBe("/w/api.php");
    expect(search.searchParams.get("gsrsearch")).toBe(query);
    expect(search.searchParams.get("prop")).toBe("revisions");
    expect(search.searchParams.has("exchars")).toBe(false);
    expect(search.searchParams.get("origin")).toBe("*");
    expect(exact.searchParams.get("revids")).toBe("321");
    expect(exact.searchParams.get("rvprop")).toBe("ids|timestamp|content");
    expect(exact.searchParams.get("rvslots")).toBe("main");
    expect(exact.searchParams.get("origin")).toBe("*");
    expect(exact.href).not.toContain(query);
    expect(exact.href).not.toContain("segreto");
    for(const [,init]of spy.mock.calls){
      expect(init.method).toBe("GET");
      expect(init.credentials).toBe("omit");
      expect(init.redirect).toBe("error");
      expect(init.referrerPolicy).toBe("no-referrer");
      expect(init.headers).toBeUndefined();
    }
    const item=found[0]!;
    expect(item.id).toMatch(/^itwsr:42:321:[0-9a-f]{16}$/);
    expect(item.revisionProof?.method).toBe("exact_revid_wikitext");
    expect(item.revisionProof?.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(item.revisionProof?.contentLength).toBe(raw.length);
    expect(raw.slice(item.revisionProof!.excerptOffset,
      item.revisionProof!.excerptOffset+item.excerpt.length)).toBe(item.excerpt);
    expect(item.excerpt).toContain("stazione telegrafica");
    expect(item.excerpt).not.toContain("PAGINA CORRENTE");
    expect(item.rightsStatus).toBe("work_rights_not_verified");
  });
  it("non finge di aver letto prose: salta template e testo solo trascluso",async()=>{
    expect(selectLiteralWikisourceExcerpt("{{Intestazione|x=y}}\n<pages index=\"a\"/>\n")).toBeUndefined();
    expect(selectLiteralWikisourceExcerpt(raw)?.excerpt).toContain("La stazione");
    mockBoth([searchPage],[{...revisionPage,revisions:[{
      revid:321,timestamp:revisionAt,
      slots:{main:{contentmodel:"wikitext",content:"{{Intestazione|autore=a}}\n<pages index=\"a\"/>"}},
    }]}]);
    expect(await searchWikisource([query])).toEqual([]);
  });
  it("non segue URL server e scarta candidati falsi o senza revisione",async()=>{
    const candidates=[
      {...searchPage,pageid:99,ns:2},
      {...searchPage,pageid:97,title:"https://attacker.invalid"},
      {...searchPage,pageid:96,title:"../evil"},
      {...searchPage,pageid:98,revisions:[{revid:0,timestamp:revisionAt}]},
      {...searchPage,pageid:95,revisions:[{revid:312,timestamp:"bad-date"}]},
      searchPage,
    ];
    const spy=mockBoth(candidates);
    const found=await searchWikisource([query]);
    expect(found).toHaveLength(1);
    expect(found[0]?.url).toBe("https://it.wikisource.org/wiki/Lettere_del_1848");
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it("blocca mismatch di pagina, ID revisione, timestamp e contenuto revisionato nascosto",async()=>{
    for(const wrong of [
      {...revisionPage,pageid:999},
      {...revisionPage,title:"Altra pagina"},
      {...revisionPage,revisions:[{...revisionPage.revisions[0],revid:322}]},
      {...revisionPage,revisions:[{...revisionPage.revisions[0],timestamp:"2022-01-01T00:00:00Z"}]},
    ]){
      mockBoth([searchPage],[wrong]);
      await expect(searchWikisource([query])).rejects.toThrow(/non coincidente/);
    }
    mockBoth([searchPage],[{...revisionPage,revisions:[{
      revid:321,timestamp:revisionAt,slots:{main:{contentmodel:"wikitext"}},
    }]}]);
    await expect(searchWikisource([query])).rejects.toThrow(/wikitext/);
    mockBoth([searchPage],[{...revisionPage,revisions:[{
      revid:321,timestamp:revisionAt,slots:{main:{contentmodel:"json",content:raw}},
    }]}]);
    await expect(searchWikisource([query])).rejects.toThrow(/wikitext/);
    mockBoth([searchPage],[]);
    await expect(searchWikisource([query])).rejects.toThrow(/non è disponibile/);
  });
  it("fallisce atomicamente se una query successiva fallisce, anche con fonte precedente valida",async()=>{
    let n=0;
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
      n++;
      if(n===3)return new Response("Service Unavailable",{status:503});
      return new URL(url).searchParams.has("revids")?reply([revisionPage]):reply([searchPage]);
    }));
    await expect(searchWikisource([query,"Lettere e trasporti nel 1848"])).rejects.toThrow(/503/);
    expect(n).toBe(3);
  });
  it("gestisce CORS, JSON malformati, payload eccessivi e HTTP 429 senza simulare prove",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new TypeError("Failed to fetch");}));
    await expect(searchWikisource([query])).rejects.toThrow(/Failed to fetch/);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("<html/>",{headers:{"content-type":"text/html"}})));
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
  it("query private bloccate prima del fetch, nessun risultato non equivale a assenza storica",async()=>{
    const spy=vi.fn();vi.stubGlobal("fetch",spy);
    await expect(searchWikisource(["https://private.example/token"])).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
    vi.stubGlobal("fetch",vi.fn(async()=>reply([])));
    expect(await searchWikisource([query])).toEqual([]);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({batchcomplete:true,query:{}}),{
      headers:{"content-type":"application/json"}})));
    expect(await searchWikisource([query])).toEqual([]);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({query:{}}),{
      headers:{"content-type":"application/json"}})));
    await expect(searchWikisource([query])).rejects.toThrow(/non valido/);
  });
});
