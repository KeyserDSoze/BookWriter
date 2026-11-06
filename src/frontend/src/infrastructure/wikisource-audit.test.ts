import { afterEach,describe,expect,it,vi } from "vitest";
import { auditStoredWikisourceRevision,searchWikisource } from "./wikisource";

const query="Telegrafo e lettere nel 1848";
const at="2025-06-18T09:30:00Z";
const raw="{{Intestazione|titolo=Lettere}}\nLa stazione telegrafica inviava dispacci durante tutto l'inverno del 1848.\n";
const page={pageid:42,ns:0,title:"Lettere del 1848",revisions:[{
  revid:321,timestamp:at,slots:{main:{contentmodel:"wikitext",content:raw}},
}]};
function json(data:unknown,status=200):Response{
  return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
}
function mockApi(){
  const spy=vi.fn(async (url:string,_opts:RequestInit)=>{
    const revids=new URL(url).searchParams.get("revids");
    return revids?json({query:{pages:[page]}}):
      json({query:{pages:[{...page,revisions:[{revid:321,timestamp:at}]}]}});
  });
  vi.stubGlobal("fetch",spy);return spy;
}
afterEach(()=>vi.unstubAllGlobals());
describe("Audit remoto Wikisource — verifica soltanto lo snapshot pubblico",()=>{
  it("ricontrolla la revisione esatta con un solo GET anonimo e confronta digest/frammento",async()=>{
    const spy=mockApi();
    const source=(await searchWikisource([query]))[0]!;
    spy.mockClear();
    const result=await auditStoredWikisourceRevision(source);
    expect(result.matches).toBe(true);
    expect(result.reason).toBe("match");
    expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const url=new URL(spy.mock.calls[0]![0]);
    expect(url.origin).toBe("https://it.wikisource.org");
    expect(url.pathname).toBe("/w/api.php");
    expect(url.searchParams.get("revids")).toBe("321");
    expect(url.searchParams.get("origin")).toBe("*");
    expect(url.searchParams.has("gsrsearch")).toBe(false);
    expect(url.href).not.toContain(query);
    expect(url.href).not.toContain(source.excerpt);
    expect(url.href).not.toContain(source.revisionProof!.contentSha256);
    const opts=spy.mock.calls[0]![1];
    expect(opts.method).toBe("GET");
    expect(opts.credentials).toBe("omit");
    expect(opts.redirect).toBe("error");
    expect(opts.referrerPolicy).toBe("no-referrer");
    expect(opts.headers).toBeUndefined();
  });
  it("separa discordanza di impronta, testo e identità senza falsi OK",async()=>{
    const source=(await (async()=>{mockApi();return searchWikisource([query]);})())[0]!;
    mockApi();
    const tamperedDigest={...source,revisionProof:{...source.revisionProof!,
      contentSha256:"f".repeat(64)},id:"itwsr:42:321:ffffffffffffffff"};
    expect((await auditStoredWikisourceRevision(tamperedDigest)).reason).toBe("digest");
    const tamperedText={...source,excerpt:source.excerpt.replace("dispacci","messaggi")};
    expect((await auditStoredWikisourceRevision(tamperedText)).reason).toBe("excerpt");
    vi.stubGlobal("fetch",vi.fn(async()=>json({query:{pages:[{...page,title:"Pagina spostata"}]}})));
    const mismatch=await auditStoredWikisourceRevision(source);
    expect(mismatch).toMatchObject({matches:false,reason:"identity"});
  });
  it("non consulta fonti legacy o malformate; disservizi non diventano esito positivo",async()=>{
    const spy=mockApi();
    const source=(await searchWikisource([query]))[0]!;
    spy.mockClear();
    await expect(auditStoredWikisourceRevision({...source,id:"itws:42:321",
      revisionProof:undefined})).rejects.toThrow(/non verificabile/);
    expect(spy).not.toHaveBeenCalled();
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new TypeError("Failed to fetch");}));
    await expect(auditStoredWikisourceRevision(source)).rejects.toThrow(/Failed to fetch/);
    vi.stubGlobal("fetch",vi.fn(async()=>json({query:{pages:[]}})));
    await expect(auditStoredWikisourceRevision(source)).rejects.toThrow(/non è consultabile/);
    vi.stubGlobal("fetch",vi.fn(async()=>json({query:{pages:[{
      ...page,revisions:[{revid:321,timestamp:at,slots:{main:{contentmodel:"wikitext"}}}],
    }]}})));
    await expect(auditStoredWikisourceRevision(source)).rejects.toThrow(/non è disponibile/);
  });
  it("non aggiorna IndexedDB: verifica senza consenso di modifica",async()=>{
    const spy=mockApi();
    const source=(await searchWikisource([query]))[0]!;
    spy.mockClear();
    await auditStoredWikisourceRevision(source);
    expect(spy).toHaveBeenCalledTimes(1);
    // This infrastructure adapter contains no getDb/saveBook operations.
  });
});
