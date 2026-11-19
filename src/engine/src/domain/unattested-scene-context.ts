import type { BookProject,Chapter,Scene } from "./types";
import { retrievePriorContinuityScenes, targetedLiteralWindows } from "./continuity-retrieval";
import { sceneTextStamp } from "./narrative-event-decisions";

/** These excerpts are public PROSE, not affirmed event facts or author decisions. */
export const MAX_UNATTESTED_SCENE_WITNESSES = 3;

export interface UnattestedSceneWitness {
  chapterId:string;
  chapterNumber:number;
  sceneId:string;
  sceneNumber:number;
  sourceFrozenAt:string;
  sourceTextStamp:string;
  offset:number;
  text:string;
  matchTerms:string[];
}
export interface UnattestedSceneContext {
  method:"prior_frozen_scene_lexical_v1";
  witnesses:UnattestedSceneWitness[];
  candidateSceneCount:number;
  scannedSceneCount:number;
  unscannedSceneCount:number;
  omittedMatchedSceneCount:number;
}

/** Reuse the bounded lexical retrieval already designed for retroactive
 * continuity checks. No secret memory, automatic inference, extra AI call,
 * future scenes, unfrozen chapters, or author-only notes are touched. */
export function buildUnattestedSceneContext(
  book:BookProject,chapter:Chapter,currentText:string,
):UnattestedSceneContext {
  const previous=book.chapters.filter(ch=>ch.number<chapter.number &&
    ch.id!==chapter.id && !!ch.frozenAt && ch.scenes.length>0 &&
    ch.scenes.every(sc=>sc.status==="canon" && !!sc.text.trim()));
  if(!previous.length || !currentText.trim())return {
    method:"prior_frozen_scene_lexical_v1",witnesses:[],
    candidateSceneCount:0,scannedSceneCount:0,unscannedSceneCount:0,
    omittedMatchedSceneCount:0,
  };
  const scene:Scene={id:"review-query",number:0,title:"",objective:"",
    text:currentText.slice(0,10000),status:"canon"};
  const origin=[...previous].sort((a,b)=>b.number-a.number)[0]!;
  const ranked=retrievePriorContinuityScenes(previous,origin,chapter,[],scene);
  const matched=ranked.sampled.filter(x=>x.match.score>0);
  const witnesses=matched.slice(0,MAX_UNATTESTED_SCENE_WITNESSES)
    .map(({chapter:ch,scene:source,match}):UnattestedSceneWitness=>{
      const window=targetedLiteralWindows(source.text,[
        ...match.entities,...match.terms,
      ])[0]!;
      return {
        chapterId:ch.id,chapterNumber:ch.number,
        sceneId:source.id,sceneNumber:source.number,
        sourceFrozenAt:ch.frozenAt!,
        sourceTextStamp:sceneTextStamp(source.text),
        offset:window.offset,text:window.text,
        matchTerms:[...match.entities,...match.terms].slice(0,12),
      };
    });
  return {
    method:"prior_frozen_scene_lexical_v1",witnesses,
    candidateSceneCount:ranked.candidateSceneCount,
    scannedSceneCount:ranked.scannedSceneCount,
    unscannedSceneCount:ranked.unscannedSceneCount,
    omittedMatchedSceneCount:Math.max(0,matched.length-witnesses.length),
  };
}

export interface UnattestedSourceAnchor {
  chapterId:string;
  sceneId:string;
  sourceFrozenAt:string;
  sourceTextStamp:string;
  offset:number;
  quote:string;
}

/** Recompute EXACTLY the bounded pack the reviewer was shown. This verifies
 * provenance only; a quoted line can be a lie, flashback or dream. */
export function isUnattestedSourceCurrent(
  book:BookProject,chapter:Chapter,currentText:string,anchor:UnattestedSourceAnchor,
):boolean {
  if(!Number.isSafeInteger(anchor.offset)||anchor.offset<0 ||
    anchor.quote.length<12||anchor.quote.length>500)return false;
  const selected=buildUnattestedSceneContext(book,chapter,currentText);
  const witness=selected.witnesses.find(w=>
    w.chapterId===anchor.chapterId && w.sceneId===anchor.sceneId &&
    w.sourceFrozenAt===anchor.sourceFrozenAt &&
    w.sourceTextStamp===anchor.sourceTextStamp &&
    anchor.offset>=w.offset &&
    anchor.offset+anchor.quote.length<=w.offset+w.text.length);
  if(!witness)return false;
  const source=book.chapters.find(ch=>ch.id===anchor.chapterId &&
    ch.number<chapter.number)?.scenes.find(sc=>sc.id===anchor.sceneId);
  return !!source && source.status==="canon" &&
    source.text.slice(anchor.offset,anchor.offset+anchor.quote.length)===anchor.quote;
}
