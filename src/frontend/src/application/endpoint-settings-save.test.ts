import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings, type EncryptedSecret } from "../domain/types";
import { EndpointSettingsSaveCoordinator, StaleEndpointSettingsSave } from "./endpoint-settings-save";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return {promise,resolve};
}
function fixture() {
  let settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  let drafts: Record<string,string> = {[settings.endpoints[0]!.id]:"new-private-key"};
  const read = () => ({settings,keyDrafts:drafts});
  const snapshot = read();
  const update = (next:Partial<{settings:AppSettings;drafts:Record<string,string>}>) => {
    settings=next.settings??settings;
    drafts=next.drafts??drafts;
  };
  return {snapshot,read,update,get:()=>({settings,drafts})};
}
const encrypted = (tag:string): EncryptedSecret => ({iv:"iv-"+tag,data:"cipher-"+tag});
function storage() {
  const writes:AppSettings[]=[];
  const persist = async (next:AppSettings,isCurrent:()=>boolean) => {
    await Promise.resolve();
    if(!isCurrent())throw Error("Commit obsoleto rifiutato");
    writes.push(structuredClone(next));
  };
  return {writes,persist};
}
describe("Salvataggio impostazioni endpoint protetto da snapshot",()=>{
  it("salva normalmente URL normalizzato e solo chiavi cifrate",async()=>{
    const f=fixture(),db=storage(),coordinator=new EndpointSettingsSaveCoordinator();
    let saved=0;
    await coordinator.save(f.snapshot,f.read,async value=>encrypted(value),db.persist,next=>{
      saved++;f.update({settings:next,drafts:{}});
    });
    expect(saved).toBe(1);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]!.endpoints[0]!.secret).toEqual(encrypted("new-private-key"));
    expect(JSON.stringify(db.writes)).not.toContain('"new-private-key"');
    expect(f.get().drafts).toEqual({});
  });
  it("blocca la vecchia scrittura dopo URL, modelli o endpoint rimossi durante cifratura",async()=>{
    for(const change of [
      (s:AppSettings)=>({...s,endpoints:s.endpoints.map(e=>({...e,baseUrl:"https://changed.invalid/v1"}))}),
      (s:AppSettings)=>({...s,endpoints:s.endpoints.map(e=>({...e,models:["manual-after-click"]}))}),
      (s:AppSettings)=>({...s,endpoints:[]}),
    ]){
      const f=fixture(),db=storage(),coordinator=new EndpointSettingsSaveCoordinator();
      const blocked=deferred<EncryptedSecret>();
      let saved=0;
      const task=coordinator.save(f.snapshot,f.read,()=>blocked.promise,db.persist,()=>{saved++;});
      f.update({settings:change(f.get().settings)});
      blocked.resolve(encrypted("old"));
      await expect(task).rejects.toBeInstanceOf(StaleEndpointSettingsSave);
      expect(db.writes).toHaveLength(0);
      expect(saved).toBe(0);
      expect(f.get().drafts[f.snapshot.settings.endpoints[0]!.id]).toBe("new-private-key");
    }
  });
  it("preserva nuove chiavi draft anche se il testo reinserito è identico",async()=>{
    const f=fixture(),db=storage(),coordinator=new EndpointSettingsSaveCoordinator();
    const blocked=deferred<EncryptedSecret>();
    const task=coordinator.save(f.snapshot,f.read,()=>blocked.promise,db.persist,()=>{throw Error("never");});
    f.update({drafts:{...f.get().drafts}});
    blocked.resolve(encrypted("old"));
    await expect(task).rejects.toThrow(/non salvata/);
    expect(db.writes).toHaveLength(0);
    expect(f.get().drafts).toEqual(f.snapshot.keyDrafts);
  });
  it("un secondo salvataggio invalida il primo e vince anche se la cifratura del primo finisce dopo",async()=>{
    const f=fixture(),db=storage(),coordinator=new EndpointSettingsSaveCoordinator();
    const slow=deferred<EncryptedSecret>();
    let saved=0;
    const first=coordinator.save(f.snapshot,f.read,()=>slow.promise,db.persist,()=>{saved++;});
    const second=coordinator.save(f.read(),f.read,async()=>encrypted("second"),db.persist,
      next=>{saved++;f.update({settings:next,drafts:{}});});
    await second; slow.resolve(encrypted("first"));
    await expect(first).rejects.toMatchObject({superseded:true});
    expect(saved).toBe(1);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]!.endpoints[0]!.secret).toEqual(encrypted("second"));
  });
  it("blocca il commit se un draft cambia durante l'apertura del database",async()=>{
    const f=fixture(),coordinator=new EndpointSettingsSaveCoordinator();
    const entered=deferred<void>(),release=deferred<void>();
    let committed=false,saved=false;
    const task=coordinator.save(f.snapshot,f.read,async()=>encrypted("attempt"),async(_next,current)=>{
      entered.resolve(); await release.promise;
      if(!current())throw Error("Commit fenced");
      committed=true;
    },()=>{saved=true;});
    await entered.promise;
    f.update({drafts:{...f.get().drafts,[f.snapshot.settings.endpoints[0]!.id]:"changed"}});
    release.resolve();
    await expect(task).rejects.toMatchObject({superseded:false});
    expect(committed).toBe(false);expect(saved).toBe(false);
    expect(Object.values(f.get().drafts)).toEqual(["changed"]);
  });
  it("salva la scelta max_completion_tokens nel profilo cifrato e la mantiene dopo Save", async () => {
    const f=fixture(),db=storage(),coordinator=new EndpointSettingsSaveCoordinator();
    const endpoints=f.get().settings.endpoints.map(e=>({
      ...e,outputTokenParameter:"max_completion_tokens" as const,
    }));
    f.update({settings:{...f.get().settings,endpoints}});
    const snapshot=f.read();
    await coordinator.save(snapshot,f.read,async value=>encrypted(value),
      db.persist,next=>f.update({settings:next,drafts:{}}));
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]!.endpoints[0]!.outputTokenParameter).toBe("max_completion_tokens");
    expect(db.writes[0]!.endpoints[0]!.secret).toEqual(encrypted("new-private-key"));
    expect(JSON.stringify(db.writes)).not.toContain("new-private-key");
  });

  it("rifiuta ogni valore sconosciuto prima di cifrare qualunque chiave o scrivere IndexedDB",async()=>{
    for (const bad of [null,"","max_output_tokens","MAX_TOKENS",{},34]) {
      const f=fixture(),db=storage(),coordinator=new EndpointSettingsSaveCoordinator();
      const endpoints=[
        {...f.get().settings.endpoints[0]!,id:"other-endpoint"},
        {...f.get().settings.endpoints[0]!,id:"corrupt",outputTokenParameter:bad as "max_tokens"},
      ];
      f.update({settings:{...f.get().settings,endpoints}});
      const encrypt=async (_key:string):Promise<EncryptedSecret>=>{throw new Error("NON CIFRARE");};
      await expect(coordinator.save(f.read(),f.read,encrypt,db.persist,()=>{throw Error("NON SALVARE");}))
        .rejects.toThrow(/Parametro limite output AI/);
      expect(db.writes).toHaveLength(0);
    }
  });

  it("un errore WebCrypto non salva le impostazioni",async()=>{
    const f=fixture(),db=storage(),coordinator=new EndpointSettingsSaveCoordinator();
    await expect(coordinator.save(f.snapshot,f.read,async()=>{throw Error("Cifratura non disponibile");},
      db.persist,()=>{throw Error("never");})).rejects.toThrow("Cifratura non disponibile");
    expect(db.writes).toEqual([]);
  });
});
