import { afterEach,describe,expect,it,vi } from "vitest";
import { inspectLocItem } from "./loc-item-inspection";
const at="2026-11-06T11:00:00.000Z";
const catalogItemId="loc:2020123456:"+Date.parse(at);
const response={
  item:{id:"https://www.loc.gov/item/2020123456/",
    digitized:true,access_restricted:true,
    rights_advisory:["Rights and access advisory: permission may be required."],
    access_advisory:["Onsite consultation may be required."],
    description:["Descriptions are NOT document text."]},
  resources:[{fulltext_file:"https://tile.loc.gov/private-path.txt"}],
};
const ok=(data:unknown=response,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json"},
});
afterEach(()=>vi.unstubAllGlobals());
describe("LoC specific item access and rights: bounded anonymous metadata request",()=>{
  it("invia unicamente ID pubblico, mai query/libro o credenziali; non scarica OCR",async()=>{
    const spy=vi.fn(async(_url:string,_init:RequestInit)=>ok());
    vi.stubGlobal("fetch",spy);
    const item=await inspectLocItem("2020123456",catalogItemId);
    expect(spy).toHaveBeenCalledTimes(1);
    const url=new URL(spy.mock.calls[0]![0]);
    expect(url.origin).toBe("https://www.loc.gov");
    expect(url.pathname).toBe("/item/2020123456/");
    expect(url.searchParams.get("fo")).toBe("json");
    expect(url.href).not.toContain("secret");
    expect(url.href).not.toContain("telegraph communications");
    expect(url.href).not.toContain("tile.loc.gov");
    const init=spy.mock.calls[0]![1];
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.headers).toBeUndefined();
    expect(item.accessRestricted).toBe(true);
    expect(item.digitized).toBe(true);
    expect(item.hasTextResourceLink).toBe(true);
    expect(item.rightsAdvisory[0]).toContain("permission");
    expect(item.rightsStatus).toBe("undetermined");
    expect(item.evidenceStatus).toBe("catalog_metadata_only");
    expect(JSON.stringify(item)).not.toContain("tile.loc.gov");
  });
  it("non interpreta un diritto assente o un flag sconosciuto come permesso",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>ok({item:{id:response.item.id}})));
    const out=await inspectLocItem("2020123456",catalogItemId);
    expect(out.digitized).toBeNull();
    expect(out.accessRestricted).toBeNull();
    expect(out.rightsAdvisory).toEqual([]);
    expect(out.hasTextResourceLink).toBe(false);
    expect(out.rightsStatus).toBe("undetermined");
  });
  it("fail-closed su id/host contraffatti, access flag non boolean e risposte malformate",async()=>{
    for(const id of [
      "https://www.loc.gov.evil.invalid/item/2020123456/",
      "https://www.loc.gov/item/other123/",
      "https://www.loc.gov/item/2020123456/?token=bad",
    ]){
      vi.stubGlobal("fetch",vi.fn(async()=>ok({item:{...response.item,id}})));
      await expect(inspectLocItem("2020123456",catalogItemId)).rejects.toThrow(/Identità/);
    }
    vi.stubGlobal("fetch",vi.fn(async()=>ok({item:{...response.item,access_restricted:"false"}})));
    await expect(inspectLocItem("2020123456",catalogItemId)).rejects.toThrow(/Flag/);
    vi.stubGlobal("fetch",vi.fn(async()=>ok({results:[]})));
    await expect(inspectLocItem("2020123456",catalogItemId)).rejects.toThrow(/oggetto richiesto/);
  });
  it("rifiuta URL item non validi prima di chiamare la rete",async()=>{
    const spy=vi.fn();vi.stubGlobal("fetch",spy);
    await expect(inspectLocItem("../evil",catalogItemId)).rejects.toThrow();
    await expect(inspectLocItem("2020123456","loc:evil:123")).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
  it("errori CORS, HTTP 429, JSON invalido e payload eccessivo non producono snapshot",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new TypeError("Failed to fetch");}));
    await expect(inspectLocItem("2020123456",catalogItemId)).rejects.toThrow(/Failed to fetch/);
    vi.stubGlobal("fetch",vi.fn(async()=>ok({},429)));
    await expect(inspectLocItem("2020123456",catalogItemId)).rejects.toThrow(/429/);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("<html/>",{
      headers:{"content-type":"text/html"}})));
    await expect(inspectLocItem("2020123456",catalogItemId)).rejects.toThrow(/non contiene JSON/);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("x".repeat(240_001),{
      headers:{"content-type":"application/json"}})));
    await expect(inspectLocItem("2020123456",catalogItemId)).rejects.toThrow(/troppo grande/);
  });
});
