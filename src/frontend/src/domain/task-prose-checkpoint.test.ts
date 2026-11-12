import { describe, expect, it } from "vitest";
import { newBook, type Activity } from "./types";
import {
  captureCanonProse, createTaskProseCheckpoint,
  compareCanonProse, validatedTaskProseCheckpoint,
} from "./task-prose-checkpoint";

const scene=(id:string,text:string,status:"canon"|"draft"|"planned"="canon")=>({
  id,number:1,title:"Titolo-SEGRETO",objective:"Segreto",text,status,
});
const activity=(id:string,bookId:string):Activity=>({
  id,bookId,runId:"run",phase:"prose",title:"Scrittura",reason:"Scena",
  nextStep:"Revisione",status:"succeeded",createdAt:"2026-11-12T10:00:00Z",
  output:"OUTPUT_AI_PRIVATO",
});
describe("Prosa canonica opt-in: pura, completa, mai restore (#167)",()=>{
  it("copia soltanto scene canoniche intere e non il resto del libro",()=>{
    const before=newBook("BRIEF_SEGRETO","Titolo","Narrativo","Adulti");
    before.memory.secrets.foo="SEGRETO_MEMORIA";
    before.chapters=[{
      id:"ch",number:1,title:"CAPITOLO_SEGRETO",purpose:"Segreto",
      scenes:[scene("one","PROSA_LUNGA_"+ "ø".repeat(7500)),
        scene("draft","BOZZA_RISERVATA","draft"),scene("planned","","planned")],
    }];
    const after=structuredClone(before);
    after.chapters[0]!.scenes[0]!.text+=" fine";
    after.chapters[0]!.scenes.push(scene("new","ALTRA_PROSA"));
    const cp=createTaskProseCheckpoint(before,after,activity("task",before.id));
    expect(cp.before.scenes).toHaveLength(1);
    expect(cp.before.scenes[0]!.text).toHaveLength(7512);
    expect(cp.after.scenes).toHaveLength(2);
    expect(compareCanonProse(cp)).toMatchObject({
      beforeCount:1,afterCount:2,added:[{chapterId:"ch",sceneId:"new"}],
      removed:[],modified:[{chapterId:"ch",sceneId:"one"}],
    });
    for(const forbidden of ["BOZZA_RISERVATA","CAPITOLO_SEGRETO",
      "SEGRETO_MEMORIA","BRIEF_SEGRETO","OUTPUT_AI_PRIVATO"])
      expect(JSON.stringify(cp)).not.toContain(forbidden);
    expect(before.chapters[0]!.scenes[0]!.text.endsWith("ø")).toBe(true);
  });
  it("rileva scene che escono dal canone e non confonde gli ID di capitoli differenti",()=>{
    const book=newBook("b","t","w","a");
    book.chapters=[{id:"first",number:1,title:"",purpose:"",
      scenes:[scene("shared","Testo")]}];
    const after=structuredClone(book);
    after.chapters[0]!.scenes[0]!.status="draft";
    after.chapters.push({id:"second",number:2,title:"",purpose:"",
      scenes:[scene("shared","Testo")]});
    const cp=createTaskProseCheckpoint(book,after,activity("task",book.id));
    expect(compareCanonProse(cp)).toEqual({
      beforeCount:1,afterCount:1,added:[{chapterId:"second",sceneId:"shared"}],
      removed:[{chapterId:"first",sceneId:"shared"}],modified:[],
    });
  });
  it("rifiuta identità e versioni ostili, duplicati e record contaminati",()=>{
    const book=newBook("b","t","w","a");
    const cp=createTaskProseCheckpoint(book,book,activity("task",book.id));
    expect(validatedTaskProseCheckpoint(cp,book.id,"task")).toEqual(cp);
    expect(validatedTaskProseCheckpoint(cp,"wrong","task")).toBeNull();
    expect(validatedTaskProseCheckpoint({...cp,schemaVersion:2},book.id,"task")).toBeNull();
    expect(validatedTaskProseCheckpoint({...cp,after:{revision:"x",
      scenes:[{chapterId:"ch",sceneId:"id",text:"t"},
        {chapterId:"ch",sceneId:"id",text:"s"}]}},book.id,"task")).toBeNull();
    expect(validatedTaskProseCheckpoint({...cp,before:{revision:"x",
      scenes:[{chapterId:"ch",sceneId:"id",text:42}]}},book.id,"task")).toBeNull();
    expect(()=>createTaskProseCheckpoint(book,book,{
      ...activity("task",book.id),status:"failed",
    })).toThrow(/non valida/);
    expect(captureCanonProse(book).scenes).toHaveLength(0);
  });
});
