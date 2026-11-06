import { describe, expect, it } from "vitest";
import { newBook, type BookProject } from "./types";
import { adjudicationPrompt, chapterSegments, createEditorialCycle, reviewerPrompt } from "./editorial-board";
import {
  assertPriorChaptersFrozen, buildContinuityEvidence, completeContinuityRecheck,
  markDownstreamContinuity,
} from "./cross-chapter-continuity";

const frozenAt="2026-11-06T12:00:00.000Z";
function sample(): BookProject {
  const b=newBook("Romanzo sulle conseguenze di un segreto.","Cronaca","Stile sobrio","Adulti");
  b.memory.secrets.chiave="PRIVATO: Mara porta una chiave che apre la camera proibita.";
  b.memory.characters.Mara="L'autore vuole un personaggio esitante.";
  b.chapters=[1,2,3,4].map(n=>({
    id:"ch-"+n,number:n,title:"Capitolo "+n,purpose:"Sviluppo della tensione.",
    frozenAt,summary:"Riassunto pubblico del capitolo "+n,
    bookSummaryAtFreeze:"Riassunto cumulativo fino al capitolo "+n,
    scenes:[{id:"s-"+n+"-1",number:1,title:"Scena "+n,objective:"Avanzare",
      status:"canon" as const,characters:["Mara"],items:["chiave"],
      date:"1848",text:n===1
        ? "Mara custodisce la chiave e nel 1848 non la mostra a nessuno."
        : n===2
          ? "Nel corridoio Mara consegna la chiave al guardiano."
          : n===3
            ? "Mara parla al guardiano: la chiave è già scomparsa."
            : "La chiave appare nella stanza, ma nessuno sa come."
    }],
  }));
  return b;
}

describe("Catena di rivalidazione narrativa fra capitoli",()=>{
  it("marca soltanto i successivi già scritti e conserva la modifica a monte più antica",()=>{
    const b=sample();
    const n=markDownstreamContinuity(b,b.chapters[1]!,"retroactive_revision",["s-2-1"]);
    expect(n).toBe(2);
    expect(b.chapters[0]?.continuityRecheck).toBeUndefined();
    expect(b.chapters[1]?.continuityRecheck).toBeUndefined();
    expect(b.chapters[2]?.continuityRecheck).toMatchObject({
      originChapterId:"ch-2",originChapterNumber:2,trigger:"retroactive_revision",
      originSceneIds:["s-2-1"],
    });
    markDownstreamContinuity(b,b.chapters[0]!,"author_reopen",["s-1-1"]);
    expect(b.chapters[2]?.continuityRecheck?.originChapterNumber).toBe(1);
    expect(b.chapters[3]?.continuityRecheck?.originChapterId).toBe("ch-1");
    markDownstreamContinuity(b,b.chapters[2]!,"retroactive_revision",["not-a-scene"]);
    expect(b.chapters[3]?.continuityRecheck?.originChapterId).toBe("ch-1");
    expect(b.chapters[3]?.lastContinuityReview).toBeUndefined();
  });

  it("blocca la rivalidazione di valle fino al congelamento dei predecessori",()=>{
    const b=sample();
    markDownstreamContinuity(b,b.chapters[0]!,"author_reopen");
    b.chapters[0]!.frozenAt=undefined;
    expect(()=>assertPriorChaptersFrozen(b,b.chapters[1]!)).toThrow(/capitolo 1.*congelato/);
    expect(()=>buildContinuityEvidence(b,b.chapters[1]!)).toThrow(/capitolo 1/);
    const cy=createEditorialCycle("ch-2"),segment=chapterSegments(b.chapters[1]!)[0]!;
    expect(()=>reviewerPrompt(b,cy,"continuity",segment,1)).toThrow(/capitolo 1/);
    b.chapters[0]!.frozenAt=frozenAt;
    expect(()=>assertPriorChaptersFrozen(b,b.chapters[1]!)).not.toThrow();
  });

  it("prepara finestre LETTERALI con offset e copertura dichiarata, senza scene future o canone privato",()=>{
    const b=sample();
    b.chapters[0]!.scenes.push({id:"s-1-2",number:2,title:"Seconda prova",objective:"Indizio",
      status:"canon",characters:["Mara"],text:"Z".repeat(3100)+"La chiave di Mara è importante."});
    b.chapters[0]!.scenes.push({id:"s-1-3",number:3,title:"Terza prova",objective:"Indizio",
      status:"canon",text:"La finestra si chiude e nessuno parla."});
    markDownstreamContinuity(b,b.chapters[0]!,"retroactive_revision",["s-1-2"]);
    const pack=buildContinuityEvidence(b,b.chapters[2]!,b.chapters[2]!.scenes[0])!;
    expect(pack.originChapterId).toBe("ch-1");
    expect(pack.examinedChapterIds).toEqual(["ch-1","ch-2"]);
    expect(pack.scenes.map(s=>s.sceneId)).toContain("s-1-2");
    expect(pack.omittedSceneCount).toBeGreaterThan(0);
    expect(pack.scenes.find(s=>s.sceneId==="s-1-2")?.coverage).toBe("partial");
    const prior=b.chapters.flatMap(ch=>ch.scenes);
    for(const s of pack.scenes)for(const window of s.windows){
      const original=prior.find(x=>x.id===s.sceneId)!.text;
      expect(original.slice(window.offset,window.offset+window.text.length)).toBe(window.text);
    }
    expect(JSON.stringify(pack)).not.toContain("PRIVATO:");
    expect(JSON.stringify(pack)).not.toContain("La chiave appare nella stanza");
    expect(JSON.stringify(pack)).not.toContain("chapter:004");
  });

  it("indirizza prove pubbliche ai quattro specialisti e al giudice, mai ai lettori ciechi",()=>{
    const b=sample();
    markDownstreamContinuity(b,b.chapters[0]!,"author_reopen",["s-1-1"]);
    const cy=createEditorialCycle("ch-2"),seg=chapterSegments(b.chapters[1]!)[0]!;
    const continuity=reviewerPrompt(b,cy,"continuity",seg,1);
    const timeline=reviewerPrompt(b,cy,"timeline",seg,1);
    const secrets=reviewerPrompt(b,cy,"secrets",seg,1);
    const voice=reviewerPrompt(b,cy,"characterVoice",seg,1);
    const blind=reviewerPrompt(b,cy,"readerMystery",seg,1);
    const other=reviewerPrompt(b,cy,"style",seg,1);
    for(const p of [continuity,timeline,secrets,voice]){
      expect(p.prompt).toContain("RIVALIDAZIONE DI CONTINUITÀ");
      expect(p.prompt).toContain("Mara custodisce la chiave");
      expect(p.prompt).toContain("coverage");
    }
    expect(blind.prompt).not.toContain("RIVALIDAZIONE DI CONTINUITÀ");
    expect(blind.prompt).not.toContain("Mara custodisce la chiave");
    expect(blind.prompt).not.toContain("PRIVATO:");
    expect(other.prompt).not.toContain("RIVALIDAZIONE DI CONTINUITÀ");
    const judge=adjudicationPrompt(b,cy);
    expect(judge.prompt).toContain("RIVALIDAZIONE CROSS-CHAPTER");
    expect(judge.prompt).toContain("Mara custodisce la chiave");
  });

  it("archivia la provenienza del campione senza inventare una certificazione semantica",()=>{
    const b=sample();
    markDownstreamContinuity(b,b.chapters[0]!,"author_reopen",["s-1-1"]);
    const ch=b.chapters[2]!;
    completeContinuityRecheck(b,ch,"2026-11-06T14:00:00.000Z");
    expect(ch.continuityRecheck).toBeUndefined();
    expect(ch.lastContinuityReview).toMatchObject({
      originChapterNumber:1,originChapterId:"ch-1",
      completedAt:"2026-11-06T14:00:00.000Z",
      partialCoverage:false,
    });
    expect(ch.lastContinuityReview!.sampledSceneIds).toContain("s-1-1");
  });

  it("rifiuta un'origine inventata anziché considerare la validazione eseguita",()=>{
    const b=sample();
    b.chapters[2]!.continuityRecheck={
      originChapterId:"sorgente-assente",originChapterNumber:1,
      requestedAt:frozenAt,trigger:"author_reopen",originSceneIds:[],
    };
    expect(()=>buildContinuityEvidence(b,b.chapters[2]!)).toThrow(/Origine della rivalidazione/);
    expect(()=>completeContinuityRecheck(b,b.chapters[2]!,frozenAt))
      .toThrow(/Origine della rivalidazione/);
    expect(b.chapters[2]!.continuityRecheck).toBeDefined();
  });
});
