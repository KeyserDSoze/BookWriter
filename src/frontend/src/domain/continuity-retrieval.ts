import type { Chapter, Scene } from "./types";

/** Local deterministic matching, NOT semantic comprehension or historical verification.
 * Input comes only from the current manuscript and already frozen earlier scenes. */
const MAX_CANDIDATES = 1600;
const MAX_SELECTED = 4;
const MAX_PER_CHAPTER = 2;
const MAX_TERMS = 48;
const MAX_LITERAL_NAME_QUERIES = 16;
const MAX_LITERAL_NAME_MATCHES = 8;
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
  /** Whole-name mentions in PRIOR prose even when that scene has no entity tags.
   * Never an alias, identity claim or attested narrative fact. */
  literalEntities?: string[];
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
function scanParts(s:string):string[] {
  if(s.length<=MAX_SCAN_CHARS)return [s];
  const width=Math.floor(MAX_SCAN_CHARS/3);
  const mid=Math.floor((s.length-width)/2);
  return [s.slice(0,width),s.slice(mid,mid+width),s.slice(-width)];
}
function scanText(s:string):string {
  return scanParts(s).join(" ");
}

/** Match a complete literal name, including multi-word names, on each original
 * scan slice separately. Never create a false mention across sampled gaps or
 * within a longer word ("Ivo" is not part of "vivo"). */
function containsWholeLiteral(lowerText:string,rawName:string):boolean {
  const name=rawName.normalize("NFC").toLocaleLowerCase("it");
  let at=lowerText.indexOf(name);
  const word=(ch:string)=>/[\p{L}\p{N}_]/u.test(ch);
  while(at!==-1){
    const before=at?lowerText[at-1]??"":"";
    const after=lowerText[at+name.length]??"";
    if(!word(before)&&!word(after))return true;
    at=lowerText.indexOf(name,at+1);
  }
  return false;
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
  // Conservative: only explicit current-scene entity labels. No guesses from
  // secret memory, character descriptions, past author alias decisions, or AI.
  const literalQuery=[...entityQuery]
    .filter(name=>name.length>=3&&name.length<=80)
    .slice(0,MAX_LITERAL_NAME_QUERIES);
  const dateQuery=new Set(selectedQuery.map(s=>s.date?.trim())
    .filter((x):x is string=>!!x&&x.length<=80));
  // Balance the query over scene windows; don't let one enormous scene fill it.
  const termQuery=[...new Set(selectedQuery.flatMap(s=>
    words(scanText(s.text+" "+s.title+" "+s.objective)).slice(0,96)))].slice(0,MAX_TERMS);
  const termSet=new Set(termQuery);
  const latest=[...prior].sort((a,b)=>
    b.number-a.number || a.id.localeCompare(b.id))[0]!;
  const changed=new Set(originSceneIds);
  // A single huge origin chapter used to consume all 1,600 scan slots and
  // silently exclude the latest predecessor. Round-robin over chapters only
  // when the limit is reached: origin, latest, then other chapters newest-first.
  // This preserves one scene per represented chapter before taking a second,
  // and prioritizes explicitly changed scenes within the origin chapter.
  const scanned:(typeof all)=all.length<=MAX_CANDIDATES?all:(()=>{
    const chapters=[...prior].sort((a,b)=>
      Number(b.id===origin.id)-Number(a.id===origin.id) ||
      Number(b.id===latest.id)-Number(a.id===latest.id) ||
      b.number-a.number || a.id.localeCompare(b.id));
    let active=chapters.filter(ch=>ch.scenes.length).map(ch=>({
      chapter:ch,
      scenes:[...ch.scenes].sort((a,b)=>
        (ch.id===origin.id?Number(changed.has(b.id))-Number(changed.has(a.id)):0) ||
        a.number-b.number || a.id.localeCompare(b.id)),
      at:0,
    }));
    const result:typeof all=[];
    while(active.length && result.length<MAX_CANDIDATES){
      const next:typeof active=[];
      for(const group of active){
        if(result.length>=MAX_CANDIDATES)break;
        result.push({chapter:group.chapter,scene:group.scenes[group.at]!});
        group.at++;
        if(group.at<group.scenes.length)next.push(group);
      }
      active=next;
    }
    return result;
  })();
  const rated=scanned.map(({chapter:ch,scene})=>{
    const entityOverlap=referenced(scene).filter(e=>entityQuery.has(e)).slice(0,10);
    // Check original bounded prose windows separately, never stitched snippets.
    // A literal mention is weaker than a matching structured reference.
    const literalSlices=scanParts(scene.text).map(part=>
      part.normalize("NFC").toLocaleLowerCase("it"));
    const literalEntities=literalQuery.filter(name=>
      !entityOverlap.includes(name)&&
      literalSlices.some(part=>containsWholeLiteral(part,name)))
      .slice(0,MAX_LITERAL_NAME_MATCHES);
    const tokens=new Set(words(scanText(scene.text+" "+scene.title+" "+scene.objective)));
    const termOverlap=[...termSet].filter(w=>tokens.has(w)).slice(0,16);
    const sameDate=!!scene.date&&dateQuery.has(scene.date.trim());
    const score=entityOverlap.length*35+literalEntities.length*25+
      termOverlap.length*6+(sameDate?45:0)+
      (changed.has(scene.id)&&ch.id===origin.id?120:0);
    return {chapter:ch,scene,match:{
      entities:entityOverlap,
      ...(literalEntities.length?{literalEntities}:{}),
      terms:termOverlap,sameDate,score,
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

/** Locate whole literal words in the ORIGINAL UTF-16 string. Never search a
 * lowercased/normalized copy for offsets: Unicode case folding can change its
 * length. The escaped regex cannot interpret manuscript text as code. */
function originalWholeWordOffset(text:string,term:string):number {
  const query=term.trim();
  if(query.length<3||query.length>100)return -1;
  const escaped=query.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const pattern=new RegExp(escaped,"giu");
  const isWord=(ch:string)=>/[\p{L}\p{N}\p{M}_]/u.test(ch);
  for(const hit of text.matchAll(pattern)){
    const offset=hit.index;
    if(offset===undefined)continue;
    const before=offset>0 ? (text[offset-1] ?? "") : "";
    const after=text[offset+hit[0].length]??"";
    if(!isWord(before)&&!isWord(after))return offset;
  }
  return -1;
}

/** Exact original-text windows, preferring the caller's ranked signals.
 * First show the strongest whole-word witness, then an uncovered DIFFERENT
 * signal if available. Otherwise preserve the distant-context fallback.
 * Never claim the two literal excerpts are contiguous or complete. */
export function targetedLiteralWindows(text:string,matchedTerms:readonly string[]):
  Array<{offset:number;text:string}> {
  if(text.length<=2800)return [{offset:0,text}];
  const maxStart=text.length-WINDOW_CHARS;
  const windowStart=(at:number)=>Math.min(maxStart,
    Math.max(0,at-Math.floor(WINDOW_CHARS/2)));
  const terms=matchedTerms.slice(0,48);
  let primaryHit=-1;
  let primaryStart=0;
  let secondHit=-1;
  for(const term of terms){
    const hit=originalWholeWordOffset(text,term);
    if(hit<0)continue;
    if(primaryHit<0){
      primaryHit=hit;
      primaryStart=windowStart(hit);
    }else if(hit<primaryStart || hit>=primaryStart+WINDOW_CHARS){
      // This is a separate whole-word witness outside the first excerpt.
      // A second mention inside the first excerpt adds no new coverage.
      secondHit=hit;
      break;
    }
  }
  const fallback=primaryStart>=maxStart/2?0:maxStart;
  const secondary=secondHit>=0?windowStart(secondHit):fallback;
  const offsets=[...new Set([primaryStart,secondary])];
  if(offsets.length===1)offsets.push(primaryStart===0?maxStart:0);
  return offsets.sort((a,b)=>a-b).map(offset=>({
    offset,text:text.slice(offset,offset+WINDOW_CHARS),
  }));
}
