import { describe, expect, it } from "vitest";
import type { TaskProseCheckpoint } from "./task-prose-checkpoint";
import {
  MAX_DIFF_PARAGRAPHS, MAX_DIFF_PREVIEW_CHARS,
  MAX_DIFF_PREVIEW_ROWS, MAX_DIFF_SOURCE_CHARS,
  diffProseParagraphs, selectCanonSceneText, splitProseParagraphs,
} from "./canon-prose-paragraph-diff";

const checkpoint: TaskProseCheckpoint = {
  schemaVersion:1,bookId:"libro-a",activityId:"task-a",
  before:{revision:"before",scenes:[
    {chapterId:"ch1",sceneId:"shared",text:"Prima 🔐\n\nFrase vecchia\n\nUltima."},
    {chapterId:"ch2",sceneId:"shared",text:"Identico"},
    {chapterId:"ch1",sceneId:"removed",text:"Scena rimossa"},
  ]},
  after:{revision:"after",scenes:[
    {chapterId:"ch1",sceneId:"shared",text:"Prima 🔐\n\nFrase nuova\n\nUltima."},
    {chapterId:"ch2",sceneId:"shared",text:"Identico"},
    {chapterId:"ch2",sceneId:"added",text:"Scena aggiunta"},
  ]},
};
describe("Confronto editoriale a rivelazione separata #169",()=>{
  it("preserva tutti i caratteri e separatori (Unicode, CRLF, spazi)",()=>{
    const text="Uno 🙂\r\n \r\nDue\n\nTre\r\n\r\n";
    const parts=splitProseParagraphs(text);
    expect(parts.join("")).toBe(text);
    expect(parts).toHaveLength(3);
    expect(splitProseParagraphs("")).toEqual([]);
    expect(splitProseParagraphs("Senza separatori")).toEqual(["Senza separatori"]);
  });
  it("allinea paragrafi stabili e distingue la riscrittura in due blocchi",()=>{
    const selected=selectCanonSceneText(checkpoint,{chapterId:"ch1",sceneId:"shared"});
    expect(selected.kind).toBe("ready");
    if(selected.kind!=="ready")return;
    const before=JSON.stringify(checkpoint);
    const changes=diffProseParagraphs(selected.before,selected.after);
    expect(changes).toMatchObject({
      kind:"ready",beforeParagraphs:3,afterParagraphs:3,
      changes:2,hiddenChanges:0,
    });
    if(changes.kind==="ready"){
      expect(changes.previews.map(row=>[row.kind,row.position,row.text])).toEqual([
        ["after",2,"Frase nuova\n\n"],["before",2,"Frase vecchia\n\n"],
      ]);
      expect(changes.previews.every(p=>!p.shortened)).toBe(true);
    }
    expect(JSON.stringify(checkpoint)).toBe(before);
  });
  it("riconosce scene omonime in capitoli diversi, aggiunte, rimosse e identiche",()=>{
    expect(selectCanonSceneText(checkpoint,{chapterId:"ch2",sceneId:"shared"}))
      .toEqual({kind:"unavailable",reason:"unchanged"});
    expect(selectCanonSceneText(checkpoint,{chapterId:"ch3",sceneId:"shared"}))
      .toEqual({kind:"unavailable",reason:"missing"});
    expect(selectCanonSceneText(checkpoint,{chapterId:"ch1",sceneId:"removed"}))
      .toEqual({kind:"ready",before:"Scena rimossa",after:""});
    expect(selectCanonSceneText(checkpoint,{chapterId:"ch2",sceneId:"added"}))
      .toEqual({kind:"ready",before:"",after:"Scena aggiunta"});
    expect(diffProseParagraphs("","Nuova")).toMatchObject({
      kind:"ready",changes:1,previews:[{kind:"after",position:1,text:"Nuova"}],
    });
    expect(diffProseParagraphs("Vecchia","")).toMatchObject({
      kind:"ready",changes:1,previews:[{kind:"before",position:1,text:"Vecchia"}],
    });
    expect(diffProseParagraphs("Identico","Identico")).toMatchObject({
      kind:"ready",changes:0,previews:[],
    });
    expect(diffProseParagraphs("A\n\nB\n\n","B\n\nA\n\n")).toMatchObject({
      kind:"ready",beforeParagraphs:2,afterParagraphs:2,changes:2,
    });
  });
  it("non seleziona ID duplicati corrotti, anche con testo coincidente",()=>{
    const malformed={...checkpoint,before:{...checkpoint.before,
      scenes:[...checkpoint.before.scenes,checkpoint.before.scenes[0]!]}};
    expect(selectCanonSceneText(malformed,{chapterId:"ch1",sceneId:"shared"}))
      .toEqual({kind:"unavailable",reason:"missing"});
  });
  it("anteprime dei paragrafi abbreviate con conteggio esatto senza toccare sorgenti",()=>{
    const long="Prima-"+ "🍃".repeat(MAX_DIFF_PREVIEW_CHARS);
    const before=long,after=long+"-dopo";
    const result=diffProseParagraphs(before,after);
    expect(result).toMatchObject({kind:"ready",changes:2,hiddenChanges:0});
    if(result.kind==="ready"){
      expect(result.previews[0]).toMatchObject({
        kind:"after",shortened:true,originalCharacters:after.length,
      });
      expect(result.previews[1]).toMatchObject({
        kind:"before",shortened:true,originalCharacters:before.length,
      });
      expect(result.previews[0]!.text).toContain("anteprima abbreviata");
      expect(result.previews[0]!.text).toContain("-dopo");
    }
    expect(before).toBe(long);
  });
  it("limita il rendering e dichiara i cambi omessi invece di nasconderli",()=>{
    const a=Array.from({length:60},(_,i)=>"Prima "+i).join("\n\n");
    const b=Array.from({length:60},(_,i)=>"Dopo "+i).join("\n\n");
    const result=diffProseParagraphs(a,b);
    expect(result).toMatchObject({
      kind:"ready",changes:120,hiddenChanges:120-MAX_DIFF_PREVIEW_ROWS,
    });
    if(result.kind==="ready")expect(result.previews).toHaveLength(MAX_DIFF_PREVIEW_ROWS);
  });
  it("rifiuta confronti troppo grandi, senza fingere il risultato completo",()=>{
    const many=Array.from({length:MAX_DIFF_PARAGRAPHS+1},(_,i)=>"p"+i).join("\n\n");
    expect(diffProseParagraphs(many,"")).toMatchObject({
      kind:"too_large",reason:"paragraphs",
      beforeParagraphs:MAX_DIFF_PARAGRAPHS+1,afterParagraphs:0,
    });
    const large="a".repeat(MAX_DIFF_SOURCE_CHARS+1);
    expect(diffProseParagraphs(large,"")).toMatchObject({
      kind:"too_large",reason:"characters",
      beforeParagraphs:1,afterParagraphs:0,
    });
  });
});
