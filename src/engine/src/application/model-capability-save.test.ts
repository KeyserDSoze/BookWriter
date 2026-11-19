import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings, type EncryptedSecret } from "../domain/types";
import { EndpointSettingsSaveCoordinator } from "./endpoint-settings-save";

function fixture(){
  let settings:AppSettings=structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0]={...settings.endpoints[0]!,
    baseUrl:"http://localhost:1234/v1",authMode:"none",
    models:["chat","voice"],modelCapabilities:{"chat":["chat","tools"],"voice":["voice"]}};
  settings.defaultRoute={endpointId:"openai",modelId:"chat"};
  settings.capabilityRoutes={tools:{endpointId:"openai",modelId:"chat"},
    voice:{endpointId:"openai",modelId:"voice"}};
  let drafts:Record<string,string>={};
  const read=()=>({settings,keyDrafts:drafts});
  const writes:AppSettings[]=[];
  let encryptCount=0;
  const run=()=>new EndpointSettingsSaveCoordinator().save(read(),read,async()=>{
    encryptCount++;return {iv:"iv",data:"cipher"} satisfies EncryptedSecret;
  },async(next,valid)=>{
    if(!valid())throw Error("Stale");
    writes.push(next);
  },next=>{settings=next;drafts={};});
  return {run,read,writes,encryptCount:()=>encryptCount};
}
describe("Salvataggio dei tag e predefiniti AI",()=>{
  it("preserva tag e route indipendenti senza cifrare in modalità locale",async()=>{
    const f=fixture();await f.run();
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]!.endpoints[0]!.modelCapabilities).toEqual({
      chat:["chat","tools"],voice:["voice"],
    });
    expect(f.writes[0]!.capabilityRoutes?.voice).toEqual({endpointId:"openai",modelId:"voice"});
    expect(f.encryptCount()).toBe(0);
  });
  it("rifiuta un predefinito senza tag e non tocca IndexedDB",async()=>{
    const f=fixture();
    f.read().settings.capabilityRoutes!.voice={endpointId:"openai",modelId:"chat"};
    await expect(f.run()).rejects.toThrow(/non possiede il tag/);
    expect(f.writes).toHaveLength(0);
    expect(f.encryptCount()).toBe(0);
  });
});
