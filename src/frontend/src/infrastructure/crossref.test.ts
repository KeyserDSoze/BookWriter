import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupCrossrefDois } from "./crossref";

const message={
  DOI:"10.1000/xyz123",title:["Storia della comunicazione in Europa"],
  author:[{given:"Anna",family:"Rossi"},{given:"Mario",family:"Bianchi"}],
  publisher:"Editore storico","container-title":["Rivista di storia"],
  issued:{"date-parts":[[2020,1,1]]},type:"journal-article",
  abstract:"TESTO PRIVATO NON CARICARE NEL DOSSIER",
};
function ok(doc:unknown=message):Response{
  return new Response(JSON.stringify({status:"ok",message:doc}),{status:200,
    headers:{"content-type":"application/json"}});
}
afterEach(()=>vi.unstubAllGlobals());
describe("Adapter read-only Crossref metadata",()=>{
  it("invia solo DOI canonici al provider fisso, senza prosa o credenziali",async()=>{
    const fetchMock=vi.fn(async (_url:string,_opts:RequestInit)=>ok());
    vi.stubGlobal("fetch",fetchMock);
    const entries=await lookupCrossrefDois(["https://doi.org/10.1000/XYZ123"]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({doi:"10.1000/xyz123",
      title:"Storia della comunicazione in Europa",
      publicationYear:2020,authors:["Anna Rossi","Mario Bianchi"],
      venue:"Rivista di storia",publisher:"Editore storico"});
    expect(JSON.stringify(entries)).not.toContain("TESTO PRIVATO");
    const url=new URL(fetchMock.mock.calls[0]![0]);
    expect(url.origin).toBe("https://api.crossref.org");
    expect(url.pathname).toBe("/works/10.1000/xyz123");
    expect(url.href).not.toContain("Mara");
    const opts=fetchMock.mock.calls[0]![1];
    expect(opts.method).toBe("GET");
    expect(opts.credentials).toBe("omit");
    expect(opts.redirect).toBe("error");
    expect(opts.referrerPolicy).toBe("no-referrer");
    expect(opts.headers).toBeUndefined();
  });
  it("tratta un DOI non censito come assente, non prova dell'inesistenza di un lavoro",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("",{status:404})));
    expect(await lookupCrossrefDois(["10.1000/xyz123"])).toEqual([]);
  });
  it("non conserva risultati parziali se la seconda richiesta fallisce",async()=>{
    const mock=vi.fn(async()=>ok())
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(new Response("",{status:429}));
    vi.stubGlobal("fetch",mock);
    await expect(lookupCrossrefDois(["10.1000/xyz123","10.1000/xyz124"]))
      .rejects.toThrow(/429/);
  });
  it("rigetta record DOI inattesi e JSON eccessivi o non validi",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>ok({...message,DOI:"10.1000/other"})));
    await expect(lookupCrossrefDois(["10.1000/xyz123"])).rejects.toThrow(/diverso/);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("invalid", {status:200})));
    await expect(lookupCrossrefDois(["10.1000/xyz123"])).rejects.toThrow(/JSON/);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("x".repeat(120_001),{status:200})));
    await expect(lookupCrossrefDois(["10.1000/xyz123"])).rejects.toThrow(/troppo grande/);
  });
  it("non effettua fetch per DOI ostili prima del consenso",async()=>{
    const mock=vi.fn();vi.stubGlobal("fetch",mock);
    await expect(lookupCrossrefDois(["https://attacker.example/segreto"])).rejects.toThrow(/DOI/);
    expect(mock).not.toHaveBeenCalled();
  });
});
