import type { Chapter, Scene } from "./types";

/** Local deterministic matching, NOT semantic comprehension or historical verification.
 * Input comes only from the current manuscript and already frozen earlier scenes. */
const MAX_CANDIDATES = 1600;
const MAX_SELECTED = 4;
const MAX_PER_CHAPTER = 2;
const MAX_TERMS = 48;
const MAX_SCAN_CHARS = 16_000;
const WINDOW_CHARS = 1250;
const STOP_WORDS = new Set([
  "anche","ancora","avere","aveva","avevano","dalla","dalle","dello","degli",
  "della","delle","dopo","dove","durante","dentro","essere","erano","erano",
  "fatto","fosse","fuori","hanno","invece","mentre","molto","nella","nelle",
  "nello","negli","niente","oltre","oppure","perché","prima","quando","quella",
  "quelli","quello","queste","questi","questo","senza","sopra","sotto","stata",
  "stato","stessa","stesso","storia","tutta","tutte","tutti","tutto","verso",
  "anche","con","che","sono","alla","dalla","solo","come","cosa","viene",
  "scene","scena","capitolo","guardare","guardava","guardano",
]);

export interface RetrievalMatch {
  /** Transparent lexical/structured signals, not evidence of a contradiction. */
  entities: string[];
  terms: string[];
  sameDate: boolean;
  score: number;
}
export interface RankedPriorScene {
  chapter: Chapter;
  scene: Scene;
  match: RetrievalMatch;
  selectionReason: "origin_anchor" | "latest_anchor" | "targeted_match" | "coverage_fallback";
}
export interface TargetedContinuityResult {
  method: "local_structured_lexical_v1";
  candidateSceneCount: number;
  scannedSceneCount: number;
  unscannedSceneCount: number;
  sampled: RankedPriorScene[];
}

function words(s:string):string[] {
  return [...s.toLocaleLowerCase("it").matchAll(/[\p{L}\p{N}]{4,}/gu)]
    .map(m=>m[0]).filter(w=>!STOP_WORDS.has(w));
}

/** One bounded, reproducible sample from beginning/middle/end for ranking.
 * The eventual displayed windows are always cut from the *original* full text. */
function scanText(s:string):string {
  if(s.length<=MAX_SCAN_CHARS)return s;
  const width=Math.floor(MAX_SCAN_CHARS/3);
  const mid=Math.floor((s.length-width)/2);
  return s.slice(0,width)+" "+s.slice(mid,mid+width)+" "+s.slice(-width);
}

function referenced(scene:Scene):string[] {
  return [...new Set([
    ...(scene.characters??[]),...(scene.locations??[]),
    ...(scene.items??[]),...(scene.factions??[]),
  ].filter((v):v is string=>typeof v==="string"&&v.length>0&&v.length<=100)
    .map(v=>v.trim().toLocaleLowerCase("it")).filter(Boolean))].slice(0,30);
}
function queryScenes(chapter:Chapter,currentScene?:Scene):Scene[] {
  return currentScene?[currentScene]:
    chapter.scenes.filter(s=>s.text.trim()).slice(0,6);
}

/** Ranking never invokes a model or network service. No index is persisted. */
export function retrievePriorContinuityScenes(prior:readonly Chapter[],
  origin:Chapter,chapter:Chapter,originSceneIds:readonly string[],
  currentScene?:Scene):TargetedContinuityResult {
  const all=prior.flatMap(ch=>ch.scenes.map(scene=>({chapter:ch,scene})));
  const selectedQuery=queryScenes(chapter,currentScene);
  const entityQuery=new Set(selectedQuery.flatMap(referenced));
  const dateQuery=new Set(selectedQuery.map(s=>s.date?.trim())
    .filter((x):x is string=>!!x&&x.length<=80));
  // Balance the query over scene windows; don't let one enormous scene fill it.
  const termQuery=[...new Set(selectedQuery.flatMap(s=>
    words(scanText(s.text+" "+s.title+" "+s.objective)).slice(0,96)))].slice(0,MAX_TERMS);
  const termSet=new Set(termQuery);
  const latest=[...prior].sort((a,b)=>b.number-a.number)[0]!;
  // For enormous imports, reserve origin/latest and scan the remaining
  // candidate scenes in a stable most-recent-first order, never silently.
  const prioritized=[...all].sort((a,b)=>
    Number(b.chapter.id===origin.id)-Number(a.chapter.id===origin.id) ||
    Number(b.chapter.id===latest.id)-Number(a.chapter.id===latest.id) ||
    b.chapter.number-a.chapter.number || a.scene.number-b.scene.number ||
    a.scene.id.localeCompare(b.scene.id));
  const scanned=prioritized.slice(0,MAX_CANDIDATES);
  const changed=new Set(originSceneIds);
  const rated=scanned.map(({chapter:ch,scene})=>{
    const entityOverlap=referenced(scene).filter(e=>entityQuery.has(e)).slice(0,10);
    const tokens=new Set(words(scanText(scene.text+" "+scene.title+" "+scene.objective)));
    const termOverlap=[...termSet].filter(w=>tokens.has(w)).slice(0,16);
    const sameDate=!!scene.date&&dateQuery.has(scene.date.trim());
    const score=entityOverlap.length*35+termOverlap.length*6+
      (sameDate?45:0)+(changed.has(scene.id)&&ch.id===origin.id?120:0);
    return {chapter:ch,scene,match:{
      entities:entityOverlap,terms:termOverlap,sameDate,score,
    }};
  });
  const byRelevance=(a:typeof rated[number],b:typeof rated[number])=>
    b.match.score-a.match.score || b.chapter.number-a.chapter.number ||
    a.scene.number-b.scene.number || a.scene.id.localeCompare(b.scene.id);
  const ranked=[...rated].sort(byRelevance);
  const sampled:RankedPriorScene[]=[];
  const perChapter=new Map<string,number>();
  const chosen=new Set<string>();
  const add=(candidate:typeof rated[number]|undefined,
    reason:RankedPriorScene["selectionReason"])=>{
    if(!candidate||sampled.length>=MAX_SELECTED)return false;
    const key=candidate.chapter.id+"\0"+candidate.scene.id;
    if(chosen.has(key)||(perChapter.get(candidate.chapter.id)??0)>=MAX_PER_CHAPTER)return false;
    chosen.add(key);
    perChapter.set(candidate.chapter.id,(perChapter.get(candidate.chapter.id)??0)+1);
    sampled.push({...candidate,selectionReason:reason});
    return true;
  };
  // Always preserve at least one scene from the change origin and nearest
  // predecessor, even if a distant lexical match scores higher.
  add(ranked.find(x=>x.chapter.id===origin.id),"origin_anchor");
  if(latest.id!==origin.id)add(ranked.find(x=>x.chapter.id===latest.id),"latest_anchor");
  for(const c of ranked)if(c.match.score>0)add(c,"targeted_match");
  for(const c of ranked)add(c,"coverage_fallback");
  sampled.sort((a,b)=>a.chapter.number-b.chapter.number ||
    a.scene.number-b.scene.number || a.scene.id.localeCompare(b.scene.id));
  return {
    method:"local_structured_lexical_v1",
    candidateSceneCount:all.length,
    scannedSceneCount:scanned.length,
    unscannedSceneCount:Math.max(0,all.length-scanned.length),
    sampled,
  };
}

/** Exact original-text windows focused on matching words, never stitched
 * quotes or normalized text pretending to be a literal excerpt. */
export function targetedLiteralWindows(text:string,matchedTerms:readonly string[]):
  Array<{offset:number;text:string}> {
  if(text.length<=2800)return [{offset:0,text}];
  const lower=text.toLocaleLowerCase("it");
  const hits=matchedTerms.slice().sort((a,b)=>b.length-a.length)
    .map(term=>lower.indexOf(term.toLocaleLowerCase("it")))
    .filter(at=>at>=0);
  const maxStart=text.length-WINDOW_CHARS;
  const focused=hits.length?Math.min(maxStart,Math.max(0,hits[0]!-Math.floor(WINDOW_CHARS/2))):0;
  const distant=focused>=maxStart/2?0:maxStart;
  const offsets=[...new Set([focused,distant])].sort((a,b)=>a-b);
  if(offsets.length===1)offsets.push(focused===0?maxStart:0);
  return offsets.sort((a,b)=>a-b).map(offset=>({
    offset,text:text.slice(offset,offset+WINDOW_CHARS),
  }));
}
