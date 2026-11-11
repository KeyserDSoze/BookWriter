import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DEFAULT_SETTINGS, newBook } from "../domain/types";
import { createBackup, importBackup, readBackup } from "./backup";
import { encryptLocal } from "./crypto";
import { getDb, loadSettings, saveBook, saveSettings } from "./db";

beforeEach(async () => {
  const db=await getDb();
  for (const store of ["books","activities","mergeDrafts","outbox"] as const)
    await db.clear(store);
  const settings=structuredClone(DEFAULT_SETTINGS);
  settings.endpoints[0]!.secret=await encryptLocal("sk-fixture-for-export-only");
  settings.endpoints[0]!.outputTokenParameter="max_completion_tokens";
  await saveSettings(settings);
  await saveBook(newBook("Trama", "Archivio test", "Narrativo", "Adulti"),false);
});
function mutateZip(zip: Uint8Array, mutation:(data:Record<string,unknown>)=>void): File {
  const entries=unzipSync(zip);
  const data=JSON.parse(strFromU8(entries["vault.json"]!)) as Record<string,unknown>;
  mutation(data);
  const modified=zipSync({
    "manifest.json":entries["manifest.json"]!,
    "vault.json":strToU8(JSON.stringify(data)),
  },{level:6});
  return new Blob([new Uint8Array(modified)]) as File;
}
describe("ZIP full: parametro output Chat Completions",()=>{
  it("esporta la scelta solo nel full e la ripristina dopo import con credenziali nuovamente cifrate",async()=>{
    const content=await readBackup(await createBackup("content") as File);
    expect(content.settings).toBeUndefined();
    const zip=await createBackup("full",undefined,true);
    const parsed=await readBackup(zip as File);
    expect(parsed.settings?.endpoints[0]?.outputTokenParameter).toBe("max_completion_tokens");
    expect(parsed.settings?.endpoints[0]?.apiKey).toBe("sk-fixture-for-export-only");
    await importBackup(parsed,true);
    const loaded=await loadSettings();
    expect(loaded.endpoints[0]?.outputTokenParameter).toBe("max_completion_tokens");
    expect(loaded.endpoints[0]?.secret?.data).not.toBe("sk-fixture-for-export-only");
    expect(JSON.stringify(loaded)).not.toContain("sk-fixture-for-export-only");
  });

  it("rifiuta valori ostili, ma accetta i full ZIP legacy senza nuovo campo",async()=>{
    const zip=new Uint8Array(await (await createBackup("full",undefined,true)).arrayBuffer());
    const change=(value:unknown,legacy=false)=>mutateZip(zip,data=>{
      const settings=data.settings as {endpoints:Array<Record<string,unknown>>};
      if(legacy) delete settings.endpoints[0]!.outputTokenParameter;
      else settings.endpoints[0]!.outputTokenParameter=value;
    });
    const old=await readBackup(change(undefined,true));
    expect(old.settings?.endpoints[0]?.outputTokenParameter).toBeUndefined();
    await importBackup(old,true);
    expect((await loadSettings()).endpoints[0]?.outputTokenParameter).toBeUndefined();
    for(const invalid of [null,"", "max_output_tokens","MAX_TOKENS",42,{}]) {
      await expect(readBackup(change(invalid))).rejects.toThrow(/Schema backup non valido/);
    }
    const updated=await readBackup(change("max_tokens"));
    expect(updated.settings?.endpoints[0]?.outputTokenParameter).toBe("max_tokens");
  });
});
