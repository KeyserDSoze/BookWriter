import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings, type EncryptedSecret } from "../domain/types";
import { EndpointSettingsSaveCoordinator } from "./endpoint-settings-save";

const encrypted: EncryptedSecret = {iv:"previous",data:"cipher"};
function fixture(baseUrl="http://localhost:1234/v1",authMode:unknown="none"){
  let settings:AppSettings=structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0]={...settings.endpoints[0]!,baseUrl,
    authMode:authMode as "none",secret:encrypted};
  let drafts:Record<string,string>={openai:"key-draft"};
  const read=()=>({settings,keyDrafts:drafts});
  const writes:AppSettings[]=[];
  let encryptCalls=0;
  const save=()=>new EndpointSettingsSaveCoordinator().save(read(),read,async()=>{
    encryptCalls++;return encrypted;
  },async(next,isCurrent)=>{
    if(!isCurrent())throw Error("Stale");
    writes.push(next);
  },next=>{settings=next;drafts={};});
  return {save,writes,calls:()=>encryptCalls,settings:()=>settings};
}
describe("Salvataggio impostazioni localhost no-auth",()=>{
  it("rimuove la vecchia chiave e non cifra il draft in modalità no-auth",async()=>{
    const f=fixture();
    await f.save();
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]!.endpoints[0]).toMatchObject({
      baseUrl:"http://localhost:1234/v1",authMode:"none",secret:null,
    });
    expect(f.calls()).toBe(0);
  });
  it("blocca URL remoti e modalità non valide prima di cifrare o scrivere",async()=>{
    for(const [url,mode] of [
      ["https://remote.example.test/v1","none"],
      ["http://localhost.evil.example/v1","none"],
      ["http://localhost:1234/v1","unknown"],
    ]){
      const f=fixture(url,mode);
      await expect(f.save()).rejects.toThrow();
      expect(f.calls()).toBe(0);
      expect(f.writes).toHaveLength(0);
    }
  });
});
