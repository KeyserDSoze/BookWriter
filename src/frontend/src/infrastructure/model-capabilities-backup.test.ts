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
    baseUrl:"http://localhost:1234/v1",authMode:"none",
    models:["chat-model","voice-model","embed-model"],modelCapabilities:{
      "chat-model":["chat","tools"],
      "voice-model":["voice"],
      "embed-model":["embedding"],
    }};
  settings.defaultRoute={endpointId:"openai",modelId:"chat-model"};
  settings.capabilityRoutes={
    tools:{endpointId:"openai",modelId:"chat-model"},
    voice:{endpointId:"openai",modelId:"voice-model"},
    embedding:{endpointId:"openai",modelId:"embed-model"},
  };
  await saveSettings(settings);
  await saveBook(newBook("Trama","Locale","Prosa","Adulti"),false);
});
function tamper(zip:Uint8Array,alter:(settings:Record<string,unknown>)=>void):File{
  const entries=unzipSync(zip);
  const data=JSON.parse(strFromU8(entries["vault.json"]!)) as {settings:Record<string,unknown>};
  alter(data.settings);
  return new Blob([new Uint8Array(zipSync({
    "manifest.json":entries["manifest.json"]!,
    "vault.json":strToU8(JSON.stringify(data)),
  },{level:6}))]) as File;
}
describe("ZIP full per tag e predefiniti dei modelli",()=>{
  it("esporta i tag e le route solo nel full, con round-trip IndexedDB",async()=>{
    const content=await readBackup(await createBackup("content") as File);
    expect(content.settings).toBeUndefined();
    const full=await readBackup(await createBackup("full",undefined,true) as File);
    expect(full.settings?.endpoints[0]?.modelCapabilities).toEqual({
      "chat-model":["chat","tools"],"voice-model":["voice"],"embed-model":["embedding"],
    });
    expect(full.settings?.capabilityRoutes?.voice).toEqual({
      endpointId:"openai",modelId:"voice-model",
    });
    await importBackup(full,true);
    const loaded=await loadSettings();
    expect(loaded.capabilityRoutes?.embedding?.modelId).toBe("embed-model");
    expect(loaded.endpoints[0]?.modelCapabilities?.["chat-model"]).toEqual(["chat","tools"]);
    expect(loaded.endpoints[0]?.secret).toBeNull();
  });
  it("rifiuta role manomessi, duplicati e default non compatibili",async()=>{
    const zip=new Uint8Array(await (await createBackup("full",undefined,true)).arrayBuffer());
    for(const mutation of [
      (settings:Record<string,unknown>)=>{
        (settings.endpoints as Array<Record<string,unknown>>)[0]!.modelCapabilities={
          "voice-model":["voice","voice"],
        };
      },
      (settings:Record<string,unknown>)=>{
        (settings.endpoints as Array<Record<string,unknown>>)[0]!.modelCapabilities={
          "voice-model":["internet"],
        };
      },
      (settings:Record<string,unknown>)=>{
        settings.capabilityRoutes={...(settings.capabilityRoutes as object),
          embedding:{endpointId:"openai",modelId:"voice-model"}};
      },
      (settings:Record<string,unknown>)=>{
        settings.capabilityRoutes={...settings.capabilityRoutes as object,
          unknown:{endpointId:"openai",modelId:"chat-model"}};
      },
    ]) {
      await expect(readBackup(tamper(zip,mutation)))
        .rejects.toThrow(/Schema backup non valido/);
    }
  });
  it("backup legacy senza tag né route mantiene la compatibilità",async()=>{
    const zip=new Uint8Array(await (await createBackup("full",undefined,true)).arrayBuffer());
    const legacy=await readBackup(tamper(zip,settings=>{
      delete settings.capabilityRoutes;
      delete (settings.endpoints as Array<Record<string,unknown>>)[0]!.modelCapabilities;
    }));
    expect(legacy.settings?.capabilityRoutes).toBeUndefined();
    expect(legacy.settings?.endpoints[0]?.modelCapabilities).toBeUndefined();
    await importBackup(legacy,true);
    expect((await loadSettings()).endpoints[0]?.modelCapabilities).toBeUndefined();
  });
});
