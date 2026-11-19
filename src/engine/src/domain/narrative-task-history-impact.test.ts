import { describe, expect, it } from "vitest";
import { newBook, type Activity, type BookProject, type Chapter } from "./types";
import { createTaskBookCheckpoint } from "./task-book-checkpoint";
import { compareNarrativeTaskHistory } from "./narrative-task-history-impact";

function fixture(chapters=3):BookProject{
  const book=newBook("BRIEF_PRIVATO_🚫","Libro prova","Stile","Adulti");
  book.status="paused";
  book.updatedAt="2026-11-12T08:00:00.000Z";
  book.memory.secrets["chiave"]="SEGRETO_ORIGINALE 🔐";
  book.chapters=Array.from({length:chapters},(_,i):Chapter=>({
    id:"chapter-"+(i+1),number:i+1,title:"TITOLO_PRIVATO_"+(i+1),
    purpose:"SCOPO_PRIVATO",scenes:[{
      id:"shared",number:1,title:"SCENA_PRIVATA",objective:"Test",
      text:"PROSA_PRIVATA_"+(i+1),status:i===0?"draft":"canon",
    }],
  }));
  book.remote={owner:"account-privato",repository:"private-book",branch:"main",autoSync:true};
  return book;
}
function snapshot(before:BookProject,after:BookProject){
  const activity:Activity={
    id:"task-diff",bookId:before.id,runId:"r",phase:"prose",title:"Diff",
    reason:"Test",nextStep:"Verifica",status:"succeeded",
    createdAt:"2026-11-12T08:00:01.000Z",
  };
  return createTaskBookCheckpoint(before,after,activity);
}
const compare=(before:BookProject,after:BookProject,current=after)=>
  compareNarrativeTaskHistory(snapshot(before,after),before.id,"task-diff",current);

describe("Preflight differenze narrative metadata-only #173",()=>{
  it("rileva draft, freeze e memoria senza rivelare prosa/titoli/segreti",()=>{
    const before=fixture(),after=structuredClone(before);
    after.updatedAt="2026-11-12T09:00:00.000Z";
    after.chapters[0]!.scenes[0]!.text="PROSA_PRIVATA_MODIFICATA 🔐";
    after.chapters[1]!.frozenAt="2026-11-12T09:00:00.000Z";
    after.memory.secrets["chiave"]="SEGRETO_MODIFICATO";
    const checkpoint=snapshot(before,after);
    const original=JSON.stringify(checkpoint);
    const result=compareNarrativeTaskHistory(checkpoint,before.id,"task-diff",after);
    expect(result).toMatchObject({
      chaptersAdded:0,chaptersRemoved:0,chaptersChanged:2,
      scenesAdded:0,scenesRemoved:0,scenesChanged:1,
      frozenAdded:1,frozenRemoved:0,phaseChanged:false,
      memoryChanged:true,globalNarrativeChange:true,
      candidateChapterCount:3,candidateChapterNumbers:[1,2,3],
      candidateChapterNumbersOmitted:0,
      currentRevisionEqualsRecordedAfter:true,
      chapterOrderChanged:false,sceneOrderChangedChapters:0,
    });
    expect(result?.narrativeFieldsChanged).toBeGreaterThanOrEqual(1);
    for(const secret of ["PROSA_PRIVATA","TITOLO_PRIVATO","SCOPO_PRIVATO",
      "SEGRETO","account-privato","private-book","BRIEF_PRIVATO"])
      expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(checkpoint)).toBe(original);
    expect(checkpoint.before.remote).toBeUndefined();
    expect(checkpoint.after.remote).toBeUndefined();
  });
  it("scene con stesso ID in capitoli diversi non vengono confuse",()=>{
    const before=fixture(),after=structuredClone(before);
    after.chapters[1]!.scenes[0]!.text="solo seconda scena";
    const result=compare(before,after);
    expect(result).toMatchObject({
      chaptersChanged:1,scenesChanged:1,firstChangedChapterNumber:2,
      candidateChapterNumbers:[2,3],candidateChapterCount:2,
      globalNarrativeChange:false,
    });
  });
  it("aggiunte, rimozioni e riordini di capitoli sono marcati conservativamente",()=>{
    const before=fixture(),after=structuredClone(before);
    after.chapters.splice(1,1);
    after.chapters.push({id:"chapter-4",number:4,title:"NUOVO_PRIVATO",
      purpose:"Nuovo",scenes:[{id:"new-scene",number:1,title:"Nuova",
      objective:"Test",text:"NUOVA_PROSA",status:"draft"}]});
    const result=compare(before,after);
    expect(result).toMatchObject({
      chaptersAdded:1,chaptersRemoved:1,scenesAdded:1,scenesRemoved:1,
      chapterOrderChanged:true,firstChangedChapterNumber:2,
      candidateChapterNumbers:[3,4],candidateChapterCount:2,
    });
    const reordered=structuredClone(before);
    reordered.chapters.reverse();
    const orderOnly=compare(before,reordered);
    expect(orderOnly).toMatchObject({
      chaptersAdded:0,chaptersRemoved:0,chaptersChanged:0,
      chapterOrderChanged:true,firstChangedChapterNumber:1,
      candidateChapterNumbers:[1,2,3],
    });
  });
  it("riordino delle scene si distingue dalla modifica del loro contenuto",()=>{
    const before=fixture(),after=structuredClone(before);
    before.chapters[0]!.scenes.push({
      id:"second",number:2,title:"Secondo",objective:"Test",text:"DUE",status:"draft",
    });
    after.chapters[0]!.scenes=structuredClone(before.chapters[0]!.scenes).reverse();
    const result=compare(before,after);
    expect(result).toMatchObject({
      chaptersChanged:1,scenesChanged:0,sceneOrderChangedChapters:1,
      firstChangedChapterNumber:1,candidateChapterCount:3,
    });
  });
  it("variazione globale rende tutti i capitoli candidati, ma limita la visualizzazione",()=>{
    const before=fixture(26),after=structuredClone(before);
    after.brief="NUOVO_BRIEF_PRIVATO";
    const result=compare(before,after);
    expect(result).toMatchObject({
      chaptersChanged:0,scenesChanged:0,narrativeFieldsChanged:1,
      globalNarrativeChange:true,firstChangedChapterNumber:null,
      candidateChapterCount:26,candidateChapterNumbersOmitted:6,
    });
    expect(result?.candidateChapterNumbers).toEqual(
      Array.from({length:20},(_,i)=>i+1));
    expect(JSON.stringify(result)).not.toContain("NUOVO_BRIEF_PRIVATO");
  });
  it("fase/operatività non sono spacciate per alterazioni narrative",()=>{
    const before=fixture(),after=structuredClone(before);
    after.phase="review";
    after.status="running";
    after.previousError="Errore non narrativo";
    after.updatedAt="2026-11-12T10:00:00.000Z";
    const result=compare(before,after);
    expect(result).toMatchObject({
      phaseChanged:true,narrativeFieldsChanged:0,chaptersChanged:0,
      candidateChapterCount:0,candidateChapterNumbers:[],
    });
    const later=structuredClone(after);
    later.updatedAt="2026-11-12T11:00:00.000Z";
    expect(compare(before,after,later)?.currentRevisionEqualsRecordedAfter).toBe(false);
  });
  it("ID/numero duplicati o checkpoint cross-book rifiutati, senza risultato parziale",()=>{
    const before=fixture(),after=structuredClone(before);
    after.chapters[1]!.number=1;
    expect(compare(before,after)).toBeNull();
    const duplicate=structuredClone(before);
    duplicate.chapters[1]!.id=duplicate.chapters[0]!.id;
    expect(compare(before,duplicate)).toBeNull();
    const repeated=structuredClone(before);
    repeated.chapters[0]!.scenes.push(structuredClone(repeated.chapters[0]!.scenes[0]!));
    expect(compare(before,repeated)).toBeNull();
    const good=snapshot(before,before);
    expect(compareNarrativeTaskHistory(good,"other-book","task-diff",before)).toBeNull();
    expect(compareNarrativeTaskHistory(good,before.id,"other-task",before)).toBeNull();
    expect(compareNarrativeTaskHistory(null,before.id,"task-diff",before)).toBeNull();
    const malformed=snapshot(before,before);
    malformed.before.updatedAt="SEGRETO_AL_POSTO_DELLA_REVISIONE";
    expect(compareNarrativeTaskHistory(malformed,before.id,"task-diff",before)).toBeNull();
    const invalidCurrent=structuredClone(before);
    invalidCurrent.updatedAt="DATI_PRIVATI_IN_REVISIONE";
    expect(compareNarrativeTaskHistory(good,before.id,"task-diff",invalidCurrent)).toBeNull();
  });
});
