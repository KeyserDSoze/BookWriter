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


  it("finestre a parola intera: Ivo non deve puntare su vivo; offset del testo invariati",()=>{
    const source="Un uomo vivo cerca la chiave. ".repeat(130)+
      "Nel corridoio Ivo apre il plico sigillato. "+
      "Il rumore si attenua. ".repeat(80);
    const windows=targetedLiteralWindows(source,["Ivo"]);
    expect(windows).toHaveLength(2);
    expect(windows.some(w=>w.text.includes("Ivo apre il plico"))).toBe(true);
    expect(windows.every(w=>source.slice(w.offset,w.offset+w.text.length)===w.text))
      .toBe(true);
  });

  it("priorità ai nomi attestati e non alla parola generica più lunga",()=>{
    const source="La chiave resta nella torre. ".repeat(160)+
      "Donna Alba racconta la storia a Ivo. "+
      "La chiave è nascosta. ".repeat(90);
    const windows=targetedLiteralWindows(source,["Donna Alba","chiave"]);
    expect(windows.some(w=>w.text.includes("Donna Alba racconta"))).toBe(true);
    const onlySubstring="La donna Albareda saluta. ".repeat(140)+
      "Donna Alba saluta Ivo. "+
      "Il cortile è deserto. ".repeat(100);
    expect(targetedLiteralWindows(onlySubstring,["donna alba"]).some(w=>
      w.text.includes("Donna Alba saluta Ivo"))).toBe(true);
  });

  it("offset UTF-16 dal testo originale, non da una copia casefold più lunga",()=>{
    const source="İ".repeat(1900)+" Ivo guarda il manoscritto. "+
      "L'archivio è vuoto. ".repeat(100);
    const windows=targetedLiteralWindows(source,["Ivo"]);
    expect(windows.some(w=>w.text.includes("Ivo guarda il manoscritto"))).toBe(true);
    for(const window of windows)
      expect(source.slice(window.offset,window.offset+window.text.length)).toBe(window.text);
  });

  it("pacchetto di continuità: nomi nella prosa senza tag ricevono una finestra pertinente",()=>{
    const b=fixture(),origin=b.chapters[0]!,current=b.chapters[5]!;
    const prior=b.chapters[1]!.scenes[0]!;
    prior.characters=[];prior.locations=[];prior.items=[];
    prior.title="";prior.objective="";
    prior.text="Un uomo vivo cammina in silenzio. ".repeat(130)+
      "Ivo nasconde la pergamena dietro un pannello. "+
      "Il corridoio resta buio. ".repeat(100);
    const now=current.scenes[0]!;
    now.characters=["Ivo"];now.items=[];now.locations=[];
    now.title="";now.objective="";now.text="Il temporale oscura la città.";
    markDownstreamContinuity(b,origin,"author_reopen",["origin"]);
    const before=JSON.stringify(b);
    const pack=buildContinuityEvidence(b,current,now)!;
    expect(pack.scenes.find(x=>x.sceneId==="key")?.matchSignals.literalEntities)
      .toEqual(["ivo"]);
    const windows=pack.scenes.find(x=>x.sceneId==="key")!.windows;
    expect(windows.some(w=>w.text.includes("Ivo nasconde la pergamena"))).toBe(true);
    expect(windows.every(w=>prior.text.slice(w.offset,w.offset+w.text.length)===w.text))
      .toBe(true);
    expect(JSON.stringify(pack)).not.toContain("PRIVATO:");
    expect(JSON.stringify(b)).toBe(before);
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
    expect(result.sampled.some(s=>s.chapter.id===prior.at(-1)!.id)).toBe(true);
    markDownstreamContinuity(b,origin,"author_reopen");
    const pack=buildContinuityEvidence(b,target,target.scenes[0])!;
    expect(pack.retrieval.unscannedSceneCount).toBeGreaterThan(0);
    expect(pack.omittedSceneCount).toBe(pack.retrieval.candidateSceneCount-pack.scenes.length);
  });

  it("cap 1.600 bilanciato: un capitolo origine enorme non oscura l'ultimo e il capitolo intermedio",()=>{
    const b=fixture(),origin=b.chapters[0]!,middle=b.chapters[1]!,
      latest=b.chapters[4]!,current=b.chapters[5]!;
    origin.scenes=Array.from({length:1705},(_,i)=>
      scene("origin-"+i,"Il vento muove le fronde del giardino.",
        {number:i+1,title:"",objective:"",characters:[]}));
    origin.scenes.at(-1)!.text="La porta murata viene riaperta.";
    middle.scenes=[scene("intermedio-Ivo","Ivo custodisce la pergamena.",
      {title:"",objective:"",characters:["Ivo"]})];
    latest.scenes=Array.from({length:1705},(_,i)=>
      scene("latest-"+i,"La notte scende sul villaggio.",
        {number:i+1,title:"",objective:"",characters:[]}));
    const now=current.scenes[0]!;
    now.characters=["Ivo"];now.items=[];now.locations=[];
    now.title="";now.objective="";now.text="Ivo osserva il cielo.";
    markDownstreamContinuity(b,origin,"author_reopen",["origin-1704"]);
    const before=JSON.stringify(b);
    const prior=b.chapters.filter(ch=>ch.number<current.number);
    const result=retrievePriorContinuityScenes(prior,origin,current,
      ["origin-1704"],now);
    expect(result.candidateSceneCount).toBe(3413);
    expect(result.scannedSceneCount).toBe(1600);
    expect(result.unscannedSceneCount).toBe(1813);
    expect(result.sampled.find(s=>s.selectionReason==="origin_anchor")?.scene.id)
      .toBe("origin-1704");
    expect(result.sampled.find(s=>s.selectionReason==="latest_anchor")?.chapter.id)
      .toBe(latest.id);
    expect(result.sampled.find(s=>s.scene.id==="intermedio-Ivo")?.selectionReason)
      .toBe("targeted_match");
    expect(result.sampled.length).toBeLessThanOrEqual(4);
    expect(result.sampled.filter(s=>s.chapter.id===origin.id).length)
      .toBeLessThanOrEqual(2);
    const pack=buildContinuityEvidence(b,current,now)!;
    expect(pack.retrieval.scannedSceneCount).toBe(1600);
    expect(pack.scenes.some(s=>s.sceneId==="intermedio-Ivo")).toBe(true);
    expect(JSON.stringify(pack)).not.toContain("PRIVATO:");
    expect(JSON.stringify(b)).toBe(before);
  });

  it("oltre 1.600 capitoli conserva origine e ultimo e dichiara gli esclusi",()=>{
    const previous=Array.from({length:1602},(_,i)=>
      chapter(i+1,[scene("s"+i,"Il ponte non è ancora stato varcato.",
        {title:"",objective:""})]));
    const next=chapter(1603,[scene("current","L'alba giunge.",
      {title:"",objective:""})]);
    const origin=previous[0]!;
    const first=retrievePriorContinuityScenes(previous,origin,next,[],next.scenes[0]);
    const reverse=retrievePriorContinuityScenes([...previous].reverse(),
      origin,next,[],next.scenes[0]);
    expect(first.scannedSceneCount).toBe(1600);
    expect(first.unscannedSceneCount).toBe(2);
    expect(first.sampled.find(s=>s.selectionReason==="origin_anchor")?.chapter.id)
      .toBe(origin.id);
    expect(first.sampled.find(s=>s.selectionReason==="latest_anchor")?.chapter.id)
      .toBe(previous.at(-1)!.id);
    expect(first.sampled.map(s=>[s.chapter.id,s.scene.id,s.selectionReason]))
      .toEqual(reverse.sampled.map(s=>[s.chapter.id,s.scene.id,s.selectionReason]));
    expect(first.sampled.every(s=>s.chapter.number<next.number)).toBe(true);
  });

  it("recupera nomi letterali nella prosa precedente anche senza tag, senza esporre segreti ai lettori",()=>{
    const b=fixture(),origin=b.chapters[0]!,current=b.chapters[5]!;
    const untagged=b.chapters[1]!.scenes[0]!;
    untagged.characters=[];untagged.locations=[];untagged.items=[];
    untagged.text="Nella stanza, Ivo nasconde un plico sigillato.";
    current.scenes[0]!.characters=["Ivo"];
    current.scenes[0]!.locations=[];current.scenes[0]!.items=[];
    current.scenes[0]!.text="La pioggia cancella i sentieri della città.";
    markDownstreamContinuity(b,origin,"author_reopen",["origin"]);
    const pack=buildContinuityEvidence(b,current,current.scenes[0])!;
    const found=pack.scenes.find(s=>s.sceneId==="key")!;
    expect(found.selectionReason).toBe("targeted_match");
    expect(found.matchSignals.entities).toEqual([]);
    expect(found.matchSignals.literalEntities).toEqual(["ivo"]);
    expect(found.matchSignals.score).toBeGreaterThan(0);
    expect(found.windows.some(w=>w.text.includes("Ivo nasconde"))).toBe(true);
    expect(JSON.stringify(pack)).not.toContain("PRIVATO:");
    expect(JSON.stringify(pack)).not.toContain("vera discendenza");
    const cycle=createEditorialCycle(current.id),seg=chapterSegments(current)[0]!;
    const continuity=reviewerPrompt(b,cycle,"continuity",seg,1);
    const blind=reviewerPrompt(b,cycle,"readerMystery",seg,1);
    const judge=adjudicationPrompt(b,cycle);
    expect(continuity.prompt).toContain("literalEntities");
    expect(continuity.prompt).toContain("Ivo nasconde");
    expect(judge.prompt).toContain("literalEntities");
    expect(blind.prompt).not.toContain("Ivo nasconde");
    expect(blind.prompt).not.toContain("literalEntities");
    expect(blind.prompt).not.toContain("PRIVATO:");
  });

  it("richiede nome intero, accetta nomi composti e non deduce alias",()=>{
    const p=[
      chapter(1,[scene("origin","L'archivio è vuoto.",{title:"",objective:""})]),
      chapter(2,[scene("false","Un uomo vivo osserva l'albarello.",{
        title:"",objective:"",characters:[],
      })]),
      chapter(3,[scene("exact","Donna Alba scrive e Ivo ascolta.",{
        title:"",objective:"",characters:[],
      })]),
      chapter(4,[scene("latest","Lungo il fiume cala la notte.",{
        title:"",objective:"",characters:[],
      })]),
    ];
    const now=chapter(5,[scene("current","Piove.",{
      title:"",objective:"",characters:["Ivo","Donna Alba"],
    })]);
    const result=retrievePriorContinuityScenes(p,p[0]!,now,[],now.scenes[0]);
    const exact=result.sampled.find(s=>s.scene.id==="exact")!;
    const falseHit=result.sampled.find(s=>s.scene.id==="false")!;
    expect(exact.selectionReason).toBe("targeted_match");
    expect(exact.match.literalEntities).toEqual(["ivo","donna alba"]);
    expect(falseHit.match.literalEntities).toBeUndefined();
    expect(falseHit.match.score).toBe(0);
    now.scenes[0]!.characters=["Ombra"];
    const noAlias=retrievePriorContinuityScenes(p,p[0]!,now,[],now.scenes[0]);
    expect(noAlias.sampled.find(s=>s.scene.id==="exact")?.match.literalEntities)
      .toBeUndefined();
  });

  it("non attribuisce corrispondenze a nomi fuori dalle porzioni di prosa scansionate",()=>{
    const huge="x".repeat(9000)+"Ivo"+"z".repeat(24000);
    const p=[
      chapter(1,[scene("origin","A",{title:"",objective:""})]),
      chapter(2,[scene("large",huge,{title:"",objective:"",characters:[]})]),
      chapter(3,[scene("latest","B",{title:"",objective:""})]),
    ];
    const now=chapter(4,[scene("current","C",{title:"",objective:"",characters:["Ivo"]})]);
    const result=retrievePriorContinuityScenes(p,p[0]!,now,[],now.scenes[0]);
    const candidate=result.sampled.find(s=>s.scene.id==="large")!;
    expect(candidate.match.literalEntities).toBeUndefined();
    expect(candidate.match.score).toBe(0);
    expect(candidate.selectionReason).toBe("coverage_fallback");
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
