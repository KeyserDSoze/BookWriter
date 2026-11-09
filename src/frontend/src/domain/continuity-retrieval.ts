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
/** Current-chapter QUERY coverage, separate from sampled prior witnesses.
 * This is NOT a statement that the director read the omitted current scenes. */
export interface CurrentQueryCoverage {
  scope: "single_scene" | "chapter_sample";
  writtenSceneCount: number;
  queriedSceneIds: string[];
  omittedSceneCount: number;
}
export interface TargetedContinuityResult {
  method: "local_structured_lexical_v1";
  currentQuery: CurrentQueryCoverage;
  candidateSceneCount: number;
  scannedSceneCount: number;
  unscannedSceneCount: number;
  sampled: RankedPriorScene[];
}

/** A slice carries the original characters immediately outside its ends.
 * A cut inside "vivo", "Ivoz" or a combining grapheme is not a word break. */
interface ScanSlice { text:string; before:string; after:string }
function scanSlices(s:string):ScanSlice[] {
  const width=Math.floor(MAX_SCAN_CHARS/3);
  const mid=Math.floor((s.length-width)/2);
  const ranges: Array<[number,number]> = s.length<=MAX_SCAN_CHARS
    ? [[0,s.length]]
    : [[0,width],[mid,mid+width],[s.length-width,s.length]];
  return ranges.map(([start,end])=>({
    text:s.slice(start,end),
    before:start>0?s[start-1]??"":"",
    after:end<s.length?s[end]??"":"",
  }));
}
function wordChar(ch:string):boolean {
  // Treat surrogate halves conservatively as word continuation when a
  // bounded slice happens to split a non-BMP character.
  return /[\p{L}\p{N}\p{M}_\uD800-\uDFFF]/u.test(ch);
}
/** Only complete lexical tokens from the ORIGINAL sampled portions count.
 * Keep the established lower-case/stopword ranking and the 16k scan cap. */
function scanWords(s:string):string[] {
  return scanSlices(s).flatMap(({text,before,after})=>{
    const lower=text.toLocaleLowerCase("it");
    return [...lower.matchAll(/[\p{L}\p{N}]{4,}/gu)]
      .filter(m=>{
        const at=m.index;
        return !(at===0&&wordChar(before)) &&
          !(at+m[0].length===lower.length&&wordChar(after));
      })
      .map(m=>m[0]).filter(w=>!STOP_WORDS.has(w));
  });
}

/** Match a complete literal name, including multi-word names, on each original
 * scan slice separately. Never create a false mention across sampled gaps or
 * within a longer word ("Ivo" is not part of "vivo"). */
function containsWholeLiteral(lowerText:string,rawName:string,
  beforeSlice:string,afterSlice:string):boolean {
  const name=rawName.normalize("NFC").toLocaleLowerCase("it");
  let at=lowerText.indexOf(name);
  while(at!==-1){
    const before=at?lowerText[at-1]??"":beforeSlice;
    const after=at+name.length<lowerText.length
      ? lowerText[at+name.length]??"":afterSlice;
    if(!wordChar(before)&&!wordChar(after))return true;
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
const MAX_QUERY_SCENES = 6;
/** The director receives the same fixed-size chapter query even for long
 * chapters. Beyond six nonempty scenes, cover both ends and four evenly
 * spaced positions in narrative order; never claim complete inspection.
 * Single-scene specialists and chapters with <=6 scenes are unchanged. */
function queryScenes(chapter:Chapter,currentScene?:Scene):Scene[] {
  if(currentScene)return [currentScene];
  const written=chapter.scenes.filter(s=>s.text.trim());
  if(written.length<=MAX_QUERY_SCENES)return written;
  const ordered=[...written].sort((a,b)=>
    a.number-b.number || a.id.localeCompare(b.id));
  return Array.from({length:MAX_QUERY_SCENES},(_,i)=>
    ordered[Math.round(i*(ordered.length-1)/(MAX_QUERY_SCENES-1))]!);
}

/** The chapter-level untagged-name query has only 16 slots. Spread them
 * across up to six current scenes rather than exhausting them on the first
 * scene's character list. Single-scene queries keep the original order.
 * Only explicit public scene metadata is used, never author-only aliases. */
function balancedLiteralNames(scenes:readonly Scene[]):string[] {
  const batches=scenes.map(scene=>referenced(scene)
    .filter(name=>name.length>=3&&name.length<=80));
  const names:string[]=[];
  const seen=new Set<string>();
  for(let position=0;position<30&&names.length<MAX_LITERAL_NAME_QUERIES;position++){
    let found=false;
    for(const batch of batches){
      const name=batch[position];
      if(name===undefined)continue;
      found=true;
      if(seen.has(name))continue;
      seen.add(name);
      names.push(name);
      if(names.length===MAX_LITERAL_NAME_QUERIES)break;
    }
    if(!found)break;
  }
  return names;
}

/** Bound the chapter-level lexical query without letting the first long scene
 * occupy all 48 slots. One term per current scene per round, in scene order;
 * preserve the previous order when reviewing one specific scene. Words remain
 * literal, unverified and drawn only from public current-scene text/metadata. */
function balancedQueryTerms(scenes:readonly Scene[]):string[] {
  const batches=scenes.map(s=>
    scanWords(s.text+" "+s.title+" "+s.objective).slice(0,96));
  const chosen:string[]=[];
  const seen=new Set<string>();
  for(let position=0;position<96&&chosen.length<MAX_TERMS;position++){
    let found=false;
    for(const terms of batches){
      const term=terms[position];
      if(term===undefined)continue;
      found=true;
      if(seen.has(term))continue;
      seen.add(term);
      chosen.push(term);
      if(chosen.length===MAX_TERMS)break;
    }
    if(!found)break;
  }
  return chosen;
}

/** Ranking never invokes a model or network service. No index is persisted. */
export function retrievePriorContinuityScenes(prior:readonly Chapter[],
  origin:Chapter,chapter:Chapter,originSceneIds:readonly string[],
  currentScene?:Scene):TargetedContinuityResult {
  const all=prior.flatMap(ch=>ch.scenes.map(scene=>({chapter:ch,scene})));
  const selectedQuery=queryScenes(chapter,currentScene);
  const written=chapter.scenes.filter(s=>s.text.trim());
  const queriedSceneIds=selectedQuery.map(s=>s.id);
  const queriedIds=new Set(queriedSceneIds);
  const currentQuery:CurrentQueryCoverage={
    scope:currentScene?"single_scene":"chapter_sample",
    writtenSceneCount:written.length,
    queriedSceneIds,
    omittedSceneCount:written.filter(s=>!queriedIds.has(s.id)).length,
  };
  const entityQuery=new Set(selectedQuery.flatMap(referenced));
  // Only explicit scene entity labels (no secret/alias inference).
  // Balance the 16 prose-name slots over current scenes for chapter review.
  // Keep the full entityQuery for structured metadata overlaps as before.
  const literalQuery=balancedLiteralNames(selectedQuery);
  const dateQuery=new Set(selectedQuery.map(s=>s.date?.trim())
    .filter((x):x is string=>!!x&&x.length<=80));
  // Preserve bounded 16k sampling and max 96 words per current scene.
  // Round-robin ensures that late scenes contribute to the chapter review.
  const termQuery=balancedQueryTerms(selectedQuery);
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
    const literalSlices=scanSlices(scene.text).map(part=>({
      ...part,text:part.text.normalize("NFC").toLocaleLowerCase("it"),
    }));
    const literalEntities=literalQuery.filter(name=>
      !entityOverlap.includes(name)&&
      literalSlices.some(part=>containsWholeLiteral(
        part.text,name,part.before,part.after)))
      .slice(0,MAX_LITERAL_NAME_MATCHES);
    const tokens=new Set(scanWords(scene.text+" "+scene.title+" "+scene.objective));
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
    currentQuery,
    candidateSceneCount:all.length,
    scannedSceneCount:scanned.length,
    unscannedSceneCount:Math.max(0,all.length-scanned.length),
    sampled,
  };
}

/** Locate whole literal words in the ORIGINAL UTF-16 string. Never search a
 * lowercased/normalized copy for offsets: Unicode case folding can change its
 * length. The escaped regex cannot interpret manuscript text as code. */
function originalWholeWordOffset(text:string,term:string,
  from=0,until=text.length):number {
  const query=term.trim();
  if(query.length<3||query.length>100)return -1;
  const escaped=query.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const pattern=new RegExp(escaped,"giu");
  const isWord=(ch:string)=>/[\p{L}\p{N}\p{M}_]/u.test(ch);
  // Search on the ORIGINAL string from an absolute UTF-16 offset. In
  // particular, do not rebuild offsets from sliced or normalized text.
  pattern.lastIndex=from;
  let hit:RegExpExecArray|null;
  while((hit=pattern.exec(text))!==null){
    const offset=hit.index;
    if(offset>=until)break;
    if(offset+hit[0].length>until)continue;
    const before=offset>0 ? (text[offset-1] ?? "") : "";
    const after=text[offset+hit[0].length]??"";
    if(!isWord(before)&&!isWord(after))return offset;
  }
  return -1;
}

/** Exact original-text windows, preferring the caller's ranked signals.
 * Prefer a different whole-word witness outside the first excerpt. If none
 * exists, a distant repeat of the primary term is more useful than unrelated
 * fallback context. No inferred semantic identities or stitched quotes. */
export function targetedLiteralWindows(text:string,matchedTerms:readonly string[]):
  Array<{offset:number;text:string}> {
  if(text.length<=2800)return [{offset:0,text}];
  const maxStart=text.length-WINDOW_CHARS;
  const windowStart=(at:number)=>Math.min(maxStart,
    Math.max(0,at-Math.floor(WINDOW_CHARS/2)));
  const terms=matchedTerms.slice(0,48);
  let primaryTerm="";
  let primaryStart=0;
  for(const term of terms){
    const hit=originalWholeWordOffset(text,term);
    if(hit<0)continue;
    primaryTerm=term;
    primaryStart=windowStart(hit);
    break;
  }
  const outside=(term:string):number=>{
    // The first occurrence of a second name may be WITHIN the primary
    // window, yet a later occurrence may be far away. Search both
    // uncovered ranges, without scanning the already displayed excerpt.
    const earlier=originalWholeWordOffset(text,term,0,primaryStart);
    return earlier>=0?earlier:
      originalWholeWordOffset(text,term,primaryStart+WINDOW_CHARS);
  };
  let secondHit=-1;
  if(primaryTerm){
    for(const term of terms){
      if(term.trim().toLocaleLowerCase("it")===
        primaryTerm.trim().toLocaleLowerCase("it"))continue;
      secondHit=outside(term);
      if(secondHit>=0)break;
    }
    // Do not discard a repeated witness when a long scene has just one
    // matching name; still present it as a literal mention, not a fact.
    if(secondHit<0)secondHit=outside(primaryTerm);
  }
  const fallback=primaryStart>=maxStart/2?0:maxStart;
  const secondary=secondHit>=0?windowStart(secondHit):fallback;
  const offsets=[...new Set([primaryStart,secondary])];
  if(offsets.length===1)offsets.push(primaryStart===0?maxStart:0);
  return offsets.sort((a,b)=>a-b).map(offset=>({
    offset,text:text.slice(offset,offset+WINDOW_CHARS),
  }));
}
