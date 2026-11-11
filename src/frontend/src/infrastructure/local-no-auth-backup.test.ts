import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { createBackup, importBackup, readBackup } from "./backup";
import { getDb, loadSettings, saveBook, saveSettings } from "./db";

beforeEach(async()=>{
  const db=await getDb();
  for(const store of ["books","activities","mergeDrafts","outbox"] as const)
    await db.clear(store);
  const settings=structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0]={...settings.endpoints[0]!,
    baseUrl:"http://localhost:1234/v1",authMode:"none",secret:null};
  await saveSettings(settings);
  await saveBook(newBook("Trama","Locale","Stile","Adulti"),false);
});
function tamper(zip:Uint8Array,alter:(endpoint:Record<string,unknown>)=>void):File{
  const items=unzipSync(zip);
  const vault=JSON.parse(strFromU8(items["vault.json"]!)) as {
    settings:{endpoints:Array<Record<string,unknown>>}};
  alter(vault.settings.endpoints[0]!);
  const altered=zipSync({
    "manifest.json":items["manifest.json"]!,
    "vault.json":strToU8(JSON.stringify(vault)),
  },{level:6});
  return new Blob([new Uint8Array(altered)]) as File;
}
describe("Backup ZIP: modalità no-auth localhost",()=>{
  it("salva solo nel ZIP full e ripristina senza cifrare una chiave",async()=>{
    const content=await readBackup(await createBackup("content") as File);
    expect(content.settings).toBeUndefined();
    const full=await readBackup(await createBackup("full",undefined,true) as File);
    expect(full.settings?.endpoints[0]).toMatchObject({
      baseUrl:"http://localhost:1234/v1",authMode:"none",apiKey:null,
    });
    await importBackup(full,true);
    expect((await loadSettings()).endpoints[0]).toMatchObject({
      baseUrl:"http://localhost:1234/v1",authMode:"none",secret:null,
    });
  });
  it("rifiuta host remoti, API key in modalità none e valori non previsti",async()=>{
    const zip=new Uint8Array(await (await createBackup("full",undefined,true)).arrayBuffer());
    for(const patch of [
      {baseUrl:"https://remote.example.test/v1",authMode:"none",apiKey:null},
      {baseUrl:"http://localhost.evil.example/v1",authMode:"none",apiKey:null},
      {baseUrl:"http://localhost:1234/v1",authMode:"anonymous",apiKey:null},
      {baseUrl:"http://localhost:1234/v1",authMode:"none",apiKey:"private-token"},
    ]){
      await expect(readBackup(tamper(zip,e=>Object.assign(e,patch))))
        .rejects.toThrow(/Schema backup non valido/);
    }
  });
  it("importa il legacy senza campo e mantiene il default api_key",async()=>{
    const zip=new Uint8Array(await (await createBackup("full",undefined,true)).arrayBuffer());
    const legacy=await readBackup(tamper(zip,e=>{delete e.authMode;}));
    expect(legacy.settings?.endpoints[0]?.authMode).toBeUndefined();
    await importBackup(legacy,true);
    expect((await loadSettings()).endpoints[0]?.authMode).toBeUndefined();
  });
});
