import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { newBook, type Activity, type BookProject } from "../domain/types";
import { getBook, getDb, saveBook, saveBookAndActivity } from "./db";
import { createBackup } from "./backup";
import {
  loadTaskProseCheckpoint, loadTaskProseConsent, setTaskProseConsent,
  taskProseConsentKey, taskProseKey,
} from "./task-prose-checkpoint";

const task=(book:BookProject,id:string,status:Activity["status"]="succeeded"):Activity=>({
  id,bookId:book.id,runId:"run",phase:"prose",title:"Scrittura",
  reason:"Creare scena",nextStep:"Revisionare",status,
  createdAt:"2026-11-12T10:00:00Z",output:"SEGRETO_OUTPUT_AI",
});
async function arrange(){
  const book=newBook("BRIEF_PRIVATO","Titolo","Stile","Adulti");
  book.memory.secrets.secret="SEGRETO_MEMORIA";
  book.chapters=[{id:"ch",number:1,title:"Titolo privato",purpose:"Scopo",
    scenes:[
      {id:"canon",number:1,title:"Titolo scena",objective:"Sviluppo",
        status:"canon",text:"TESTO_PRECEDENTE_NON_IN_BACKUP"},
      {id:"draft",number:2,title:"Bozza",objective:"Sviluppo",
        status:"draft",text:"BOZZA_PRIVATA_NON_DA_ARCHIVIARE"},
    ]}];
  await saveBook(book,false);
  const before=(await getBook(book.id))!;
  const after=structuredClone(before);
  after.chapters[0]!.scenes[0]!.text="TESTO_CANONICO_ATTUALE";
  return {before,after};
}
describe("Consenso e copie integrali della prosa con commit atomico (#167)",()=>{
  it("predefinito off: nessuna copia, ma checkpoint strutturale regolare",async()=>{
    const {before,after}=await arrange();
    const activity=task(after,crypto.randomUUID());
    expect(await loadTaskProseConsent(after.id)).toBe(false);
    await saveBookAndActivity(after,activity,before.updatedAt);
    expect(await loadTaskProseCheckpoint(after.id,activity.id)).toBeNull();
    expect(await (await getDb()).get("meta","task-structure:v1:"+activity.id))
      .toBeDefined();
  });
  it("opt-in per libro: copie pre/post complete, senza draft/memoria/output e senza ZIP",async()=>{
    const {before,after}=await arrange();
    const activity=task(after,crypto.randomUUID());
    await setTaskProseConsent(after.id,true);
    expect(await loadTaskProseConsent(after.id)).toBe(true);
    await saveBookAndActivity(after,activity,before.updatedAt);
    const stored=(await loadTaskProseCheckpoint(after.id,activity.id))!;
    expect(stored).toMatchObject({schemaVersion:1,bookId:after.id,
      activityId:activity.id,before:{revision:before.updatedAt,
        scenes:[{chapterId:"ch",sceneId:"canon",text:"TESTO_PRECEDENTE_NON_IN_BACKUP"}]},
      after:{revision:after.updatedAt,
        scenes:[{chapterId:"ch",sceneId:"canon",text:"TESTO_CANONICO_ATTUALE"}]},
    });
    for(const forbidden of ["BOZZA_PRIVATA","SEGRETO_MEMORIA","SEGRETO_OUTPUT_AI",
      "BRIEF_PRIVATO","Titolo privato"])
      expect(JSON.stringify(stored)).not.toContain(forbidden);
    expect(await loadTaskProseCheckpoint("altro-libro",activity.id)).toBeNull();
    const archive=await createBackup("content");
    const content=JSON.stringify(JSON.parse(strFromU8(unzipSync(
      new Uint8Array(await archive.arrayBuffer()))["content.json"]!)));
    expect(content).not.toContain("TESTO_PRECEDENTE_NON_IN_BACKUP");
    expect(content).not.toContain(taskProseKey(after.id,activity.id));
    expect(content).not.toContain(taskProseConsentKey(after.id));
  });
  it("revoca: elimina solo copie del libro, conserva manoscritto e altri consensi",async()=>{
    const first=await arrange(),second=await arrange();
    await setTaskProseConsent(first.before.id,true);
    await setTaskProseConsent(second.before.id,true);
    const one=task(first.after,crypto.randomUUID());
    const two=task(second.after,crypto.randomUUID());
    await saveBookAndActivity(first.after,one,first.before.updatedAt);
    await saveBookAndActivity(second.after,two,second.before.updatedAt);
    await setTaskProseConsent(first.after.id,false);
    expect(await loadTaskProseConsent(first.after.id)).toBe(false);
    expect(await loadTaskProseCheckpoint(first.after.id,one.id)).toBeNull();
    expect(await (await getDb()).get("meta",taskProseKey(first.after.id,one.id)))
      .toBeUndefined();
    expect(await loadTaskProseConsent(second.after.id)).toBe(true);
    expect(await loadTaskProseCheckpoint(second.after.id,two.id)).toBeTruthy();
    expect((await getBook(first.after.id))!.chapters[0]!.scenes[0]!.text)
      .toBe("TESTO_CANONICO_ATTUALE");
    await setTaskProseConsent(first.after.id,true);
    expect(await loadTaskProseCheckpoint(first.after.id,one.id)).toBeNull();
    const now=(await getBook(first.after.id))!;
    const next=structuredClone(now);
    next.chapters[0]!.scenes[0]!.text="ALTRO_TESTO";
    const newer=task(next,crypto.randomUUID());
    await saveBookAndActivity(next,newer,now.updatedAt);
    expect(await loadTaskProseCheckpoint(next.id,newer.id)).toBeTruthy();
  });
  it("CAS stantio, duplicato e task fallito non lasciano copie o nuovi canoni",async()=>{
    const {before,after}=await arrange();
    await setTaskProseConsent(after.id,true);
    const succeeded=task(after,crypto.randomUUID());
    await expect(saveBookAndActivity(after,succeeded,"revision-stantia"))
      .rejects.toThrow(/altra scheda/);
    expect(await loadTaskProseCheckpoint(after.id,succeeded.id)).toBeNull();
    expect((await getBook(after.id))!.updatedAt).toBe(before.updatedAt);
    await saveBookAndActivity(after,succeeded,before.updatedAt);
    const stable=(await getBook(after.id))!;
    const replay=structuredClone(stable);
    replay.chapters[0]!.scenes[0]!.text="EVITARE_RISCRITTURA";
    await expect(saveBookAndActivity(replay,succeeded,stable.updatedAt))
      .rejects.toThrow();
    expect((await getBook(stable.id))!.updatedAt).toBe(stable.updatedAt);
    expect((await loadTaskProseCheckpoint(stable.id,succeeded.id))!.after.scenes[0]!.text)
      .toBe("TESTO_CANONICO_ATTUALE");
    const failed=task(stable,crypto.randomUUID(),"failed");
    await saveBookAndActivity(structuredClone(stable),failed,stable.updatedAt);
    expect(await loadTaskProseCheckpoint(stable.id,failed.id)).toBeNull();
    await expect(setTaskProseConsent("nonexistent-book",true)).rejects
      .toThrow(/Libro non trovato/);
  });
});
