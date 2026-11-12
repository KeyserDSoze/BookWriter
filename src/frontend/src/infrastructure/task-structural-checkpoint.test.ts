import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { newBook, type Activity, type BookProject } from "../domain/types";
import {
  captureBookStructure, compareBookStructure,
  validatedTaskStructuralCheckpoint,
} from "../domain/task-structural-checkpoint";
import { getBook, getDb, saveBook, saveBookAndActivity } from "./db";
import { loadTaskStructuralCheckpoint, taskStructuralCheckpointKey } from "./task-structural-checkpoint";
import { createBackup } from "./backup";

const activity=(book:BookProject,id:string,status:Activity["status"]="succeeded"):Activity=>({
  id,bookId:book.id,runId:"run-a",phase:"outline",title:"Pianificazione",
  reason:"Scrivere",nextStep:"Controllare",status,createdAt:new Date().toISOString(),
  output:"SEGRETO_OUTPUT_NON_ARCHIVIABILE",
});

const arrange=async()=>{
  const book=newBook("SEGRETO_BRIEF","Libro prova checkpoint","Narrativo","Adulti");
  book.memory.secrets.secret="SEGRETO_MEMORIA_NON_ARCHIVIABILE";
  await saveBook(book,false);
  const original=(await getBook(book.id))!;
  const updated=structuredClone(original);
  updated.phase="outline";
  updated.chapters=[{id:"chapter-1",number:1,title:"SEGRETO_TITOLO",
    purpose:"SEGRETO_SCOPO",frozenAt:"2026-11-12T10:00:00Z",scenes:[{
      id:"scene-1",number:1,title:"SEGRETO_SCENA",objective:"SEGRETO_OBIETTIVO",
      text:"SEGRETO_TESTO_NON_ARCHIVIABILE",status:"canon",
    }]}];
  return {original,updated};
};

describe("Checkpoint strutturali atomici dei task — #166",()=>{
  it("salva una coppia immutabile prima/dopo soltanto sul commit riuscito",async()=>{
    const {original,updated}=await arrange();
    const task=activity(updated,crypto.randomUUID());
    await saveBookAndActivity(updated,task,original.updatedAt);
    const stored=await loadTaskStructuralCheckpoint(updated.id,task.id);
    expect(stored).toMatchObject({
      schemaVersion:1,bookId:updated.id,activityId:task.id,
      before:{revision:original.updatedAt,phase:"brainstorm",chapters:[]},
      after:{revision:updated.updatedAt,phase:"outline",chapters:[{
        id:"chapter-1",frozen:true,scenes:[{id:"scene-1",status:"canon"}],
      }]},
    });
    expect(compareBookStructure(stored!)).toMatchObject({
      chaptersBefore:0,chaptersAfter:1,chaptersAdded:1,
      chaptersRemoved:0,scenesAdded:1,scenesRemoved:0,phaseChanged:true,
    });
    for(const forbidden of ["SEGRETO_BRIEF","SEGRETO_OUTPUT","SEGRETO_TESTO",
      "SEGRETO_MEMORIA","SEGRETO_SCENA","SEGRETO_TITOLO","SEGRETO_SCOPO"])
      expect(JSON.stringify(stored)).not.toContain(forbidden);
    expect(await loadTaskStructuralCheckpoint("another-book",task.id)).toBeNull();
    expect(await loadTaskStructuralCheckpoint(updated.id,"not-found")).toBeNull();
    const archive=await createBackup("content");
    const contents=await archive.text().catch(()=>"");
    expect(contents).not.toContain(taskStructuralCheckpointKey(task.id));
  });

  it("differenze di freeze/status senza prosa, cancellazioni o promozioni implicite",()=>{
    const book=newBook("b","x","w","a");
    book.chapters=[{id:"ch",number:1,title:"x",purpose:"y",
      scenes:[{id:"scene",number:1,title:"x",objective:"y",text:"seg",
        status:"draft"},{id:"removed",number:2,title:"x",objective:"y",text:"s",
        status:"canon"}]}];
    const original=captureBookStructure(book);
    book.chapters=[{...book.chapters[0]!,frozenAt:"2026-11-12T10:00:00Z",
      scenes:[{...book.chapters[0]!.scenes[0]!,status:"canon"},
        {id:"added",number:2,title:"nuova",objective:"a",text:"seg",status:"draft"}]}];
    const next=captureBookStructure(book);
    const delta=compareBookStructure({schemaVersion:1,bookId:book.id,activityId:"a",
      before:original,after:next});
    expect(delta).toMatchObject({
      chaptersAdded:0,chaptersRemoved:0,chaptersFrozen:1,
      chaptersUnfrozen:0,scenesAdded:1,scenesRemoved:1,
      sceneStatusesChanged:1,phaseChanged:false,
    });
  });

  it("CAS stantio non registra checkpoint né altera libro e attività",async()=>{
    const {original,updated}=await arrange();
    const task=activity(updated,crypto.randomUUID());
    await expect(saveBookAndActivity(updated,task,"revision-stantia"))
      .rejects.toThrow(/un'altra scheda/);
    expect(await loadTaskStructuralCheckpoint(updated.id,task.id)).toBeNull();
    expect((await getBook(updated.id))!.updatedAt).toBe(original.updatedAt);
    expect(await (await getDb()).get("activities",task.id)).toBeUndefined();
  });

  it("ID del task già acquisito rifiuta il replay con rollback di tutte le scritture",async()=>{
    const {original,updated}=await arrange();
    const task=activity(updated,crypto.randomUUID());
    await saveBookAndActivity(updated,task,original.updatedAt);
    const saved=(await getBook(updated.id))!;
    const repeat=structuredClone(saved);
    repeat.phase="revision";
    await expect(saveBookAndActivity(repeat,task,saved.updatedAt)).rejects.toThrow();
    expect((await getBook(updated.id))!.updatedAt).toBe(saved.updatedAt);
    expect((await getBook(updated.id))!.phase).toBe("outline");
    expect((await (await getDb()).get("activities",task.id)).status).toBe("succeeded");
    expect((await loadTaskStructuralCheckpoint(updated.id,task.id))!.after.phase).toBe("outline");
  });

  it("fallimenti e task incompleti non generano falsi checkpoint",async()=>{
    const {original,updated}=await arrange();
    const task=activity(updated,crypto.randomUUID(),"failed");
    await saveBookAndActivity(updated,task,original.updatedAt);
    expect(await loadTaskStructuralCheckpoint(updated.id,task.id)).toBeNull();
    expect((await getBook(updated.id))!.phase).toBe("outline");
  });

  it("rifiuta dati locali falsificati o di versioni sconosciute",async()=>{
    const {original,updated}=await arrange();
    const task=activity(updated,crypto.randomUUID());
    await saveBookAndActivity(updated,task,original.updatedAt);
    const good=(await loadTaskStructuralCheckpoint(updated.id,task.id))!;
    const db=await getDb();
    await db.put("meta",{...good,schemaVersion:100},taskStructuralCheckpointKey(task.id));
    expect(await loadTaskStructuralCheckpoint(updated.id,task.id)).toBeNull();
    expect(validatedTaskStructuralCheckpoint({...good,after:{...good.after,
      chapters:[{id:"x",frozen:false,scenes:[{id:"x",status:"hacked"}]}]}},
    updated.id,task.id)).toBeNull();
  });
});
