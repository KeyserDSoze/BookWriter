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

  it("due riferimenti distanti danno due finestre focalizzate, senza aumentare gli estratti",()=>{
    const text="x".repeat(3000)+" Ivo ripone la mappa sul tavolo. "+
      "y".repeat(3000)+" La chiave passa di mano all'alba. "+
      "z".repeat(3000);
    const windows=targetedLiteralWindows(text,["Ivo","chiave"]);
    expect(windows).toHaveLength(2);
    expect(windows.some(w=>w.text.includes("Ivo ripone la mappa"))).toBe(true);
    expect(windows.some(w=>w.text.includes("La chiave passa di mano"))).toBe(true);
    expect(windows.map(w=>w.offset)).toEqual(windows.map(w=>w.offset).sort((a,b)=>a-b));
    for(const w of windows){
      expect(w.text.length).toBe(1250);
      expect(text.slice(w.offset,w.offset+w.text.length)).toBe(w.text);
    }
    expect(targetedLiteralWindows(text,["Ivo","chiave"])).toEqual(windows);
  });

  it("quando due segnali sono vicini, mantiene il contesto distante anziché duplicare l'estratto",()=>{
    const text="A".repeat(3000)+" Ivo custodisce la chiave. "+"B".repeat(4000);
    const windows=targetedLiteralWindows(text,["Ivo","chiave"]);
    expect(windows).toHaveLength(2);
    expect(windows.some(w=>w.text.includes("Ivo custodisce la chiave"))).toBe(true);
    expect(windows.some(w=>w.offset===0||w.offset===text.length-1250)).toBe(true);
    const missing=targetedLiteralWindows(text,["persona inesistente"]);
    expect(missing.map(w=>w.offset)).toEqual([0,text.length-1250]);
    expect(missing.every(w=>text.slice(w.offset,w.offset+w.text.length)===w.text)).toBe(true);
  });

  it("i nomi con caratteri regex sono cercati letteralmente nel secondo estratto",()=>{
    const text="x".repeat(3000)+" Ivo scrive una nota. "+
      "y".repeat(3000)+" Anna (la Rossa) trova il plico. "+
      "z".repeat(3000);
    const windows=targetedLiteralWindows(text,["Ivo","Anna (la Rossa)"]);
    expect(windows.some(w=>w.text.includes("Ivo scrive"))).toBe(true);
    expect(windows.some(w=>w.text.includes("Anna (la Rossa) trova"))).toBe(true);
    expect(targetedLiteralWindows(text,["Ivo","Anna (la Rossa)"])).toEqual(windows);
  });

  it("le due prove di prosa non taggate raggiungono soltanto i revisori autorizzati",()=>{
    const b=fixture(),origin=b.chapters[0]!,current=b.chapters[5]!;
    const previous=b.chapters[1]!.scenes[0]!;
    previous.title="";previous.objective="";
    previous.characters=[];previous.items=[];previous.locations=[];
    previous.text="x".repeat(3000)+" Ivo apre il portone. "+
      "y".repeat(3000)+" La chiave viene nascosta nel pozzo. "+
      "z".repeat(3000);
    const now=current.scenes[0]!;
    now.characters=["Ivo"];now.items=["chiave"];now.locations=[];
    now.title="";now.objective="";
    now.text="Il cielo diventa grigio.";
    markDownstreamContinuity(b,origin,"author_reopen",["origin"]);
    const snapshot=JSON.stringify(b);
    const pack=buildContinuityEvidence(b,current,now)!;
    const scene=pack.scenes.find(x=>x.sceneId==="key")!;
    expect(scene.matchSignals.literalEntities).toEqual(["ivo","chiave"]);
    expect(scene.windows).toHaveLength(2);
    expect(scene.windows.some(w=>w.text.includes("Ivo apre il portone"))).toBe(true);
    expect(scene.windows.some(w=>w.text.includes("La chiave viene nascosta"))).toBe(true);
    expect(scene.windows.every(w=>
      previous.text.slice(w.offset,w.offset+w.text.length)===w.text)).toBe(true);
    const cycle=createEditorialCycle(current.id),seg=chapterSegments(current)[0]!;
    const reviewer=reviewerPrompt(b,cycle,"continuity",seg,1);
    const reader=reviewerPrompt(b,cycle,"readerMystery",seg,1);
    expect(reviewer.prompt).toContain("Ivo apre il portone");
    expect(reviewer.prompt).toContain("La chiave viene nascosta");
    expect(reader.prompt).not.toContain("Ivo apre il portone");
    expect(reader.prompt).not.toContain("La chiave viene nascosta");
    expect(JSON.stringify(pack)).not.toContain("PRIVATO:");
    expect(JSON.stringify(b)).toBe(snapshot);
  });

  it("trova la seconda occorrenza del termine alternativo se la prima era già coperta",()=>{
    const source="x".repeat(3100)+" Ivo prende la chiave dal tavolo. "+
      "y".repeat(3400)+" La chiave ricompare nel magazzino. "+
      "z".repeat(3200);
    const windows=targetedLiteralWindows(source,["Ivo","chiave"]);
    expect(windows).toHaveLength(2);
    expect(windows.some(w=>w.text.includes("Ivo prende la chiave"))).toBe(true);
    expect(windows.some(w=>w.text.includes("chiave ricompare nel magazzino"))).toBe(true);
    expect(windows.map(w=>w.offset)).toEqual(
      [...windows.map(w=>w.offset)].sort((a,b)=>a-b));
    for(const w of windows)
      expect(source.slice(w.offset,w.offset+w.text.length)).toBe(w.text);
  });

  it("due menzioni lontane dello stesso nome sostituiscono il contesto generico",()=>{
    const source="x".repeat(3100)+" Ivo accende la lanterna. "+
      "y".repeat(3300)+" Ivo spegne la lanterna. "+
      "z".repeat(3100);
    const windows=targetedLiteralWindows(source,["Ivo"]);
    expect(windows).toHaveLength(2);
    expect(windows.some(w=>w.text.includes("Ivo accende la lanterna"))).toBe(true);
    expect(windows.some(w=>w.text.includes("Ivo spegne la lanterna"))).toBe(true);
    expect(windows.every(w=>source.slice(w.offset,w.offset+w.text.length)===w.text))
      .toBe(true);
    expect(targetedLiteralWindows(source,["Ivo"])).toEqual(windows);
  });

  it("un altro segnale distinto ha priorità sulla ripetizione del primo",()=>{
    const source="x".repeat(3100)+" Ivo apre il portone. "+
      "y".repeat(3400)+" Ivo richiude il portone. "+
      "z".repeat(3400)+" La chiave si spezza nella serratura. "+
      "w".repeat(3100);
    const windows=targetedLiteralWindows(source,["Ivo","chiave"]);
    expect(windows.some(w=>w.text.includes("Ivo apre il portone"))).toBe(true);
    expect(windows.some(w=>w.text.includes("chiave si spezza"))).toBe(true);
    expect(windows.some(w=>w.text.includes("Ivo richiude il portone"))).toBe(false);
  });

  it("due menzioni distanti non espongono scene precedenti ai lettori ciechi",()=>{
    const b=fixture(),origin=b.chapters[0]!,current=b.chapters[5]!;
    const previous=b.chapters[1]!.scenes[0]!;
    previous.title="";previous.objective="";
    previous.characters=[];previous.items=[];previous.locations=[];
    previous.text="x".repeat(3100)+" Ivo ascolta una voce. "+
      "y".repeat(3400)+" Ivo interrompe la telefonata. "+
      "z".repeat(3100);
    const now=current.scenes[0]!;
    now.characters=["Ivo"];now.items=[];now.locations=[];
    now.title="";now.objective="";now.text="Le nuvole coprono il sole.";
    markDownstreamContinuity(b,origin,"author_reopen",["origin"]);
    const original=JSON.stringify(b);
    const pack=buildContinuityEvidence(b,current,now)!;
    const source=pack.scenes.find(s=>s.sceneId==="key")!;
    expect(source.matchSignals.literalEntities).toEqual(["ivo"]);
    expect(source.windows).toHaveLength(2);
    expect(source.windows.some(w=>w.text.includes("Ivo ascolta una voce"))).toBe(true);
    expect(source.windows.some(w=>w.text.includes("Ivo interrompe la telefonata")))
      .toBe(true);
    expect(source.windows.every(w=>
      previous.text.slice(w.offset,w.offset+w.text.length)===w.text)).toBe(true);
    const cycle=createEditorialCycle(current.id),seg=chapterSegments(current)[0]!;
    const specialist=reviewerPrompt(b,cycle,"continuity",seg,1);
    const blind=reviewerPrompt(b,cycle,"readerMystery",seg,1);
    expect(specialist.prompt).toContain("Ivo interrompe la telefonata");
    expect(blind.prompt).not.toContain("Ivo interrompe la telefonata");
    expect(JSON.stringify(pack)).not.toContain("PRIVATO:");
    expect(JSON.stringify(b)).toBe(original);
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

  it("rifiuta Ivo tagliato dall'inizio della finestra centrale dentro Vivo",()=>{
    const total=30_000,width=Math.floor(16_000/3);
    const mid=Math.floor((total-width)/2);
    const raw="x".repeat(mid-1)+"Vivo "+"x".repeat(total-mid-4);
    expect(raw.length).toBe(total);
    expect(raw.slice(mid,mid+3)).toBe("ivo");
    const p=[
      chapter(1,[scene("origin","Il ponte è chiuso.",{title:"",objective:""})]),
      chapter(2,[scene("cut-start",raw,{title:"",objective:"",characters:[]})]),
      chapter(3,[scene("latest","Si alza il vento.",{title:"",objective:""})]),
    ];
    const current=chapter(4,[scene("now","Piove.",{
      title:"",objective:"",characters:["Ivo"],
    })]);
    const result=retrievePriorContinuityScenes(p,p[0]!,current,[],current.scenes[0]);
    const found=result.sampled.find(x=>x.scene.id==="cut-start")!;
    expect(found.match.literalEntities).toBeUndefined();
    expect(found.match.score).toBe(0);
    expect(found.selectionReason).toBe("coverage_fallback");
  });

  it("rifiuta un nome tagliato a fine finestra quando è seguito da lettere o segni combinanti",()=>{
    const total=30_000,width=Math.floor(16_000/3);
    const run=(suffix:string)=>{
      const prefix="x".repeat(width-4)+" Ivo"+suffix;
      const raw=prefix+"x".repeat(total-prefix.length);
      expect(raw.slice(width-3,width)).toBe("Ivo");
      const p=[
        chapter(1,[scene("origin","A",{title:"",objective:""})]),
        chapter(2,[scene("cut-end",raw,{title:"",objective:"",characters:[]})]),
        chapter(3,[scene("latest","B",{title:"",objective:""})]),
      ];
      const now=chapter(4,[scene("current","Piove.",{
        title:"",objective:"",characters:["Ivo"],
      })]);
      const ranked=retrievePriorContinuityScenes(p,p[0]!,now,[],now.scenes[0]);
      return ranked.sampled.find(x=>x.scene.id==="cut-end")!;
    };
    for(const next of ["z","\u0301","_","3"]){
      const candidate=run(next);
      expect(candidate.match.literalEntities).toBeUndefined();
      expect(candidate.match.score).toBe(0);
    }
  });

  it("anche i termini lessicali di ranking non possono nascere da tagli interni a parole",()=>{
    const width=Math.floor(16_000/3),total=30_000;
    const prefix="x".repeat(width-9)+" orologiox";
    const raw=prefix+"x".repeat(total-prefix.length);
    expect(raw.slice(width-8,width)).toBe("orologio");
    const p=[
      chapter(1,[scene("origin","A",{title:"",objective:""})]),
      chapter(2,[scene("cut-term",raw,{title:"",objective:"",characters:[]})]),
      chapter(3,[scene("latest","B",{title:"",objective:""})]),
    ];
    const current=chapter(4,[scene("current","L'orologio si è fermato.",{
      title:"",objective:"",items:[],locations:[],characters:[],
    })]);
    const ranked=retrievePriorContinuityScenes(p,p[0]!,current,[],current.scenes[0]);
    const found=ranked.sampled.find(s=>s.scene.id==="cut-term")!;
    expect(found.match.terms).not.toContain("orologio");
    expect(found.match.score).toBe(0);
    expect(found.selectionReason).toBe("coverage_fallback");
  });

  it("conserva veri nomi completi ai confini quando fuori c'è separazione reale",()=>{
    const total=30_000,width=Math.floor(16_000/3),mid=Math.floor((total-width)/2);
    const textStart="x".repeat(mid-1)+" Ivo "+"x".repeat(total-mid-4);
    const prefix="x".repeat(width-4)+" Ivo ";
    const textEnd=prefix+"x".repeat(total-prefix.length);
    const prior=[
      chapter(1,[scene("origin","A",{title:"",objective:""})]),
      chapter(2,[scene("valid-start",textStart,{
        title:"",objective:"",characters:[],
      })]),
      chapter(3,[scene("valid-end",textEnd,{
        title:"",objective:"",characters:[],
      })]),
      chapter(4,[scene("latest","B",{title:"",objective:""})]),
    ];
    const now=chapter(5,[scene("current","Piove.",{
      title:"",objective:"",characters:["Ivo"],
    })]);
    const first=retrievePriorContinuityScenes(prior,prior[0]!,now,[],now.scenes[0]);
    for(const id of ["valid-start","valid-end"]){
      const match=first.sampled.find(x=>x.scene.id===id)!;
      expect(match.match.literalEntities).toEqual(["ivo"]);
      expect(match.selectionReason).toBe("targeted_match");
    }
  });

  it("il campionamento non trasferisce falsi segnali o segreti al giudice e ai lettori ciechi",()=>{
    const b=fixture(),origin=b.chapters[0]!,current=b.chapters[5]!;
    // Keep the target as the latest mandatory anchor, even when its score is
    // correctly zero: other fallback scenes must not crowd out this assertion.
    b.chapters=[origin,b.chapters[1]!,current];
    const total=30_000,width=Math.floor(16_000/3),mid=Math.floor((total-width)/2);
    const prior=b.chapters[1]!.scenes[0]!;
    prior.characters=[];prior.locations=[];prior.items=[];
    prior.title="";prior.objective="";
    prior.text="x".repeat(mid-1)+"Vivo "+"x".repeat(total-mid-4);
    const now=current.scenes[0]!;
    now.text="Piove.";now.title="";now.objective="";now.date=undefined;
    now.characters=["Ivo"];now.locations=[];now.items=[];
    markDownstreamContinuity(b,origin,"author_reopen");
    const snapshot=JSON.stringify(b);
    const pack=buildContinuityEvidence(b,current,now)!;
    const found=pack.scenes.find(x=>x.sceneId==="key")!;
    expect(found.matchSignals.literalEntities).toBeUndefined();
    expect(found.matchSignals.score).toBe(0);
    expect(JSON.stringify(pack)).not.toContain("PRIVATO:");
    expect(JSON.stringify(b)).toBe(snapshot);
    const cycle=createEditorialCycle(current.id),seg=chapterSegments(current)[0]!;
    const blind=reviewerPrompt(b,cycle,"readerMystery",seg,1);
    expect(blind.prompt).not.toContain("literalEntities");
    expect(blind.prompt).not.toContain("PRIVATO:");
  });

  it("bilancia 16 nomi espliciti fra sei scene per recuperare il testimone senza tag",()=>{
    const b=fixture(),origin=b.chapters[0]!,current=b.chapters[5]!;
    const source=b.chapters[1]!.scenes[0]!;
    // Keep the untagged witness in the sample even when testing a query
    // whose 16 name slots do not include its name.
    b.chapters=[origin,b.chapters[1]!,b.chapters[4]!,current];
    source.text="Ivo custodisce un plico sotto una pietra.";
    source.characters=[];source.items=[];source.locations=[];source.factions=[];
    source.title="";source.objective="";source.date=undefined;
    const firstNames=Array.from({length:25},(_,i)=>
      "Personaggio"+String(i).padStart(2,"0"));
    current.scenes=[
      scene("review-1","Piove.",{number:1,title:"",objective:"",
        characters:firstNames,items:[],locations:[],date:undefined}),
      ...Array.from({length:4},(_,i)=>
        scene("review-"+(i+2),"Piove.",{number:i+2,title:"",
          objective:"",characters:[],items:[],locations:[],date:undefined})),
      scene("review-6","Piove.",{number:6,title:"",objective:"",
        characters:["Ivo"],items:[],locations:[],date:undefined}),
    ];
    markDownstreamContinuity(b,origin,"author_reopen");
    const snapshot=JSON.stringify(b);
    const prior=b.chapters.filter(ch=>ch.number<current.number);
    const full=retrievePriorContinuityScenes(prior,origin,current,[]);
    const match=full.sampled.find(x=>x.scene.id==="key")!;
    expect(match.selectionReason).toBe("targeted_match");
    expect(match.match.entities).toEqual([]);
    expect(match.match.literalEntities).toEqual(["ivo"]);
    expect(match.match.score).toBeGreaterThan(0);
    const firstOnly=retrievePriorContinuityScenes(prior,origin,current,[],
      current.scenes[0]);
    const early=firstOnly.sampled.find(x=>x.scene.id==="key")!;
    expect(early.match.literalEntities).toBeUndefined();
    expect(early.match.score).toBe(0);
    const sixthOnly=retrievePriorContinuityScenes(prior,origin,current,[],
      current.scenes[5]);
    expect(sixthOnly.sampled.find(x=>x.scene.id==="key")?.match.literalEntities)
      .toEqual(["ivo"]);
    const pack=buildContinuityEvidence(b,current)!;
    const found=pack.scenes.find(x=>x.sceneId==="key")!;
    expect(found.matchSignals.literalEntities).toEqual(["ivo"]);
    expect(found.windows.some(w=>w.text.includes("Ivo custodisce"))).toBe(true);
    const judge=adjudicationPrompt(b,createEditorialCycle(current.id));
    expect(judge.prompt).toContain("Ivo custodisce");
    const blind=reviewerPrompt(b,createEditorialCycle(current.id),
      "readerMystery",chapterSegments(current)[0]!,6);
    expect(blind.prompt).not.toContain("Ivo custodisce");
    expect(blind.prompt).not.toContain("PRIVATO:");
    expect(JSON.stringify(pack)).not.toContain("PRIVATO:");
    expect(JSON.stringify(b)).toBe(snapshot);
    expect(buildContinuityEvidence(b,current)).toEqual(pack);
  });

  it("non estende la ricerca dei 16 nomi dalla settima scena alla query aggregata",()=>{
    const b=fixture(),origin=b.chapters[0]!,current=b.chapters[5]!;
    const source=b.chapters[1]!.scenes[0]!;
    b.chapters=[origin,b.chapters[1]!,current];
    source.text="Donna Alba conserva un manoscritto nel solaio.";
    source.characters=[];source.items=[];source.locations=[];source.factions=[];
    source.title="";source.objective="";source.date=undefined;
    current.scenes=[
      ...Array.from({length:6},(_,i)=>scene("review-"+i,"Piove.",{
        number:i+1,title:"",objective:"",characters:[],items:[],
        locations:[],date:undefined})),
      scene("review-7","Piove.",{number:7,title:"",objective:"",
        characters:["Donna Alba"],items:[],locations:[],date:undefined}),
    ];
    const prior=b.chapters.filter(ch=>ch.number<current.number);
    const aggregated=retrievePriorContinuityScenes(prior,origin,current,[]);
    const witness=aggregated.sampled.find(x=>x.scene.id==="key")!;
    expect(witness.match.literalEntities).toBeUndefined();
    expect(witness.match.score).toBe(0);
    const targeted=retrievePriorContinuityScenes(prior,origin,current,[],
      current.scenes[6]);
    expect(targeted.sampled.find(x=>x.scene.id==="key")?.match.literalEntities)
      .toEqual(["donna alba"]);
  });

  it("distribuisce 48 termini fra sei scene correnti nella query del direttore",()=>{
    const b=fixture(),origin=b.chapters[0]!,current=b.chapters[5]!;
    const source=b.chapters[1]!.scenes[0]!;
    // Keep this scene in the four-slot sample even for an unmatched single
    // scene query, so the negative assertion tests an actual zero score.
    b.chapters=[origin,b.chapters[1]!,b.chapters[4]!,current];
    source.title="";source.objective="";source.date=undefined;
    source.characters=[];source.items=[];source.locations=[];
    source.text="Sul molo il sigillo scompare sotto il ponte.";
    const first=Array.from({length:70},(_,i)=>
      "codice"+String(i).padStart(3,"0")).join(" ");
    current.scenes=[
      scene("review-1",first,{number:1,title:"",objective:"",date:undefined}),
      ...Array.from({length:4},(_,i)=>scene("review-"+(i+2),
        "Piove piano.",{number:i+2,title:"",objective:"",date:undefined})),
      scene("review-6","Il sigillo affonda nell'acqua.",{
        number:6,title:"",objective:"",date:undefined}),
    ];
    markDownstreamContinuity(b,origin,"author_reopen",["origin"]);
    const snapshot=JSON.stringify(b);
    const prior=b.chapters.filter(ch=>ch.number<current.number);
    const full=retrievePriorContinuityScenes(prior,origin,current,["origin"]);
    const match=full.sampled.find(x=>x.scene.id==="key")!;
    expect(match.selectionReason).toBe("targeted_match");
    expect(match.match.terms).toContain("sigillo");
    expect(match.match.score).toBeGreaterThan(0);
    const firstOnly=retrievePriorContinuityScenes(prior,origin,current,
      ["origin"],current.scenes[0]);
    expect(firstOnly.sampled.find(x=>x.scene.id==="key")?.match.terms)
      .not.toContain("sigillo");
    const sixthOnly=retrievePriorContinuityScenes(prior,origin,current,
      ["origin"],current.scenes[5]);
    expect(sixthOnly.sampled.find(x=>x.scene.id==="key")?.match.terms)
      .toContain("sigillo");
    const pack=buildContinuityEvidence(b,current)!;
    expect(pack.scenes.find(x=>x.sceneId==="key")?.matchSignals.terms)
      .toContain("sigillo");
    const judge=adjudicationPrompt(b,createEditorialCycle(current.id));
    expect(judge.prompt).toContain("Sul molo il sigillo");
    const blind=reviewerPrompt(b,createEditorialCycle(current.id),
      "readerMystery",chapterSegments(current)[0]!,6);
    expect(blind.prompt).not.toContain("Sul molo il sigillo");
    expect(blind.prompt).not.toContain("PRIVATO:");
    expect(JSON.stringify(pack)).not.toContain("PRIVATO:");
    expect(JSON.stringify(b)).toBe(snapshot);
    expect(buildContinuityEvidence(b,current)).toEqual(pack);
  });

  it("rispetta il limite di sei scene nella query di capitolo",()=>{
    const b=fixture(),origin=b.chapters[0]!,current=b.chapters[5]!;
    const source=b.chapters[1]!.scenes[0]!;
    // Keep the source as mandatory latest anchor even with score zero.
    b.chapters=[origin,b.chapters[1]!,current];
    source.title="";source.objective="";source.date=undefined;
    source.characters=[];source.items=[];source.locations=[];
    source.text="La lucerna è rimasta nella soffitta.";
    current.scenes=[
      ...Array.from({length:6},(_,i)=>scene("review-"+i,"Piove piano.",{
        number:i+1,title:"",objective:"",date:undefined})),
      scene("review-7","La lucerna si accende.",{
        number:7,title:"",objective:"",date:undefined}),
    ];
    const prior=b.chapters.filter(ch=>ch.number<current.number);
    const byChapter=retrievePriorContinuityScenes(prior,origin,current,[]);
    const selected=byChapter.sampled.find(x=>x.scene.id==="key")!;
    expect(selected.match.terms).not.toContain("lucerna");
    expect(selected.match.score).toBe(0);
    const targeted=retrievePriorContinuityScenes(prior,origin,current,[],
      current.scenes[6]);
    expect(targeted.sampled.find(x=>x.scene.id==="key")?.match.terms)
      .toContain("lucerna");
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
