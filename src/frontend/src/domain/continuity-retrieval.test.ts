import {describe,expect,it} from "vitest";
import {newBook,type BookProject,type Chapter,type Scene} from "./types";
import {buildContinuityEvidence,completeContinuityRecheck,markDownstreamContinuity}
  from "./cross-chapter-continuity";
import {retrievePriorContinuityScenes,targetedLiteralWindows}
  from "./continuity-retrieval";
import {adjudicationPrompt,chapterSegments,createEditorialCycle,reviewerPrompt}
  from "./editorial-board";

const stamp="2026-11-06T12:00:00.000Z";
const scene=(id:string,text:string,props:Partial<Scene>={}):Scene=>({
  id,number:1,title:"Incontro",objective:"Avanzare",text,status:"canon",...props,
});
const chapter=(n:number,scenes:Scene[]):Chapter=>({
  id:"ch-"+n,number:n,title:"Capitolo "+n,purpose:"Svolgimento",
  frozenAt:stamp,scenes,
});
function fixture():BookProject{
  const b=newBook("Il segreto di Elio","Libro","Sobrio","Adulti");
  b.memory.secrets.retroattivo="PRIVATO: La lettera nasconde la vera discendenza di Elio.";
  b.chapters=[
    chapter(1,[scene("origin","Il guardiano chiude la porta e annota il suo nome.",
      {characters:["Guardiano"],date:"1847"})]),
    chapter(2,[scene("key","Nella torre, Elio consegna la chiave d'argento a Mara nel 1848.",
      {characters:["Elio","Mara"],items:["chiave"],locations:["torre"],date:"1848"})]),
    chapter(3,[scene("noise-3","La neve sommerge l'accampamento a mezzanotte.",
      {characters:["Nora"],date:"1843"})]),
    chapter(4,[scene("noise-4","Il cavallo rimane davanti alla stalla.",
      {characters:["Vito"],date:"1840"})]),
    chapter(5,[scene("latest","La carovana raggiunge la città dopo il tramonto.",
      {characters:["Nora"],date:"1850"})]),
    chapter(6,[scene("current","Elio cerca la chiave d'argento nella torre durante il 1848.",
      {characters:["Elio"],items:["chiave"],locations:["torre"],date:"1848"})]),
  ];
  return b;
}

describe("Recupero mirato locale della continuità",()=>{
  it("trova una scena pertinente nel capitolo INTERMEDIO, conserva origine e ultimo predecessore",()=>{
    const b=fixture(),origin=b.chapters[0]!,current=b.chapters[5]!;
    markDownstreamContinuity(b,origin,"author_reopen",["origin"]);
    const pack=buildContinuityEvidence(b,current,current.scenes[0])!;
    expect(pack.retrieval).toEqual({
      method:"local_structured_lexical_v1",
      candidateSceneCount:5,scannedSceneCount:5,unscannedSceneCount:0,maxSelectedScenes:4,
    });
    expect(pack.scenes.length).toBeLessThanOrEqual(4);
    expect(pack.scenes.map(s=>s.sceneId)).toEqual(expect.arrayContaining(["origin","key","latest"]));
    const match=pack.scenes.find(s=>s.sceneId==="key")!;
    expect(match.selectionReason).toBe("targeted_match");
    expect(match.matchSignals.entities).toContain("chiave");
    expect(match.matchSignals.terms).toContain("chiave");
    expect(match.matchSignals.sameDate).toBe(true);
    expect(pack.omittedSceneCount).toBeGreaterThan(0);
    expect(JSON.stringify(pack)).not.toContain("PRIVATO:");
    expect(JSON.stringify(pack)).not.toContain("Elio cerca la chiave");
    expect(pack.scenes.every(s=>s.chapterNumber<current.number)).toBe(true);
    expect(buildContinuityEvidence(b,current,current.scenes[0])).toEqual(pack);
  });

  it("le finestre lunghe centrano i termini rilevanti anche nel mezzo e mantengono OFFSET esatti",()=>{
    const text="A".repeat(3400)+" Elio nasconde l'orologio antico nella torre di pietra. "+
      "B".repeat(3600);
    const win=targetedLiteralWindows(text,["orologio","torre"]);
    expect(win).toHaveLength(2);
    expect(win.some(w=>w.text.includes("l'orologio antico"))).toBe(true);
    expect(win.some(w=>w.offset>0&&w.offset<text.length-1250)).toBe(true);
    expect(win.map(w=>w.offset)).toEqual([...win.map(w=>w.offset)].sort((a,b)=>a-b));
    for(const w of win)expect(text.slice(w.offset,w.offset+w.text.length)).toBe(w.text);
    expect(win.every(w=>w.text.length===1250)).toBe(true);
    const b=fixture();
    b.chapters[1]!.scenes[0]!.text=text;
    b.chapters[5]!.scenes[0]!.text="Elio cerca l'orologio antico nella torre.";
    markDownstreamContinuity(b,b.chapters[0]!,"retroactive_revision",["origin"]);
    const pack=buildContinuityEvidence(b,b.chapters[5]!,b.chapters[5]!.scenes[0])!;
    expect(pack.scenes.find(s=>s.sceneId==="key")?.windows.some(w=>
      w.text.includes("l'orologio antico"))).toBe(true);
    expect(pack.scenes.find(s=>s.sceneId==="key")?.coverage).toBe("partial");
  });

  it("separa gli indizi lessicali dal merito dei rilievi e protegge i cinque lettori ciechi",()=>{
    const b=fixture(),chapter=b.chapters[5]!;
    markDownstreamContinuity(b,b.chapters[0]!,"historical_evidence");
    const cy=createEditorialCycle(chapter.id),seg=chapterSegments(chapter)[0]!;
    const continuity=reviewerPrompt(b,cy,"continuity",seg,1);
    const historical=reviewerPrompt(b,cy,"historical",seg,1);
    const blind=reviewerPrompt(b,cy,"readerMystery",seg,1);
    const style=reviewerPrompt(b,cy,"style",seg,1);
    const judge=adjudicationPrompt(b,cy);
    for(const prompt of [continuity.prompt,historical.prompt,judge.prompt]){
      expect(prompt).toContain("local_structured_lexical_v1");
      expect(prompt).toContain("ch-2");
    }
    expect(blind.prompt).not.toContain("local_structured_lexical_v1");
    expect(blind.prompt).not.toContain("PRIVATO:");
    expect(blind.prompt).not.toContain("Nella torre, Elio consegna la chiave");
    expect(style.prompt).not.toContain("local_structured_lexical_v1");
    expect(judge.prompt).toContain("NON dimostra contraddizioni");
    expect(continuity.prompt).toContain("NON prove di errore");
  });

  it("include limiti documentati quando il numero di scene supera il cap operativo",()=>{
    const b=fixture();
    const origin=b.chapters[0]!,latest=b.chapters[4]!,current=b.chapters[5]!;
    b.chapters=[origin,
      ...Array.from({length:20},(_,i)=>chapter(i+2,
        Array.from({length:83},(_,j)=>scene("bulk-"+i+"-"+j,
          "La lettera sigillata attraversa il ponte con una carovana.")))),
      {...latest,number:22,id:"last-ch"}, {...current,number:23,id:"now-ch"}];
    const prior=b.chapters.slice(0,-1),target=b.chapters.at(-1)!;
    const result=retrievePriorContinuityScenes(prior,origin,target,[],target.scenes[0]);
    expect(result.candidateSceneCount).toBeGreaterThan(1600);
    expect(result.scannedSceneCount).toBe(1600);
    expect(result.unscannedSceneCount).toBe(result.candidateSceneCount-1600);
    expect(result.sampled.some(s=>s.chapter.id===origin.id)).toBe(true);
    expect(result.sampled.some(s=>s.chapter.id===latest.id)).toBe(true);
    markDownstreamContinuity(b,origin,"author_reopen");
    const pack=buildContinuityEvidence(b,target,target.scenes[0])!;
    expect(pack.retrieval.unscannedSceneCount).toBeGreaterThan(0);
    expect(pack.omittedSceneCount).toBe(pack.retrieval.candidateSceneCount-pack.scenes.length);
  });

  it("registra nel freeze la copertura quantitativa, senza certificare coerenza",()=>{
    const b=fixture(),target=b.chapters[5]!;
    markDownstreamContinuity(b,b.chapters[0]!,"author_reopen");
    completeContinuityRecheck(b,target,stamp);
    expect(target.lastContinuityReview).toMatchObject({
      retrievalMethod:"local_structured_lexical_v1",
      candidateSceneCount:5,scannedSceneCount:5,unscannedSceneCount:0,
      partialCoverage:true,
    });
    expect(target.lastContinuityReview?.sampledSceneIds).toContain("key");
    expect(target.continuityRecheck).toBeUndefined();
  });
});
