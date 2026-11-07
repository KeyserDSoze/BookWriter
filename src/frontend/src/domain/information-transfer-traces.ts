import type {BookProject,Chapter} from "./types";
import {sceneTextStamp} from "./narrative-event-decisions";

/** Literal reports of information passing between names are NOT facts.
 * This deliberately bounded lexical scan never reads private memory. */
export const MAX_TRANSFER_SCAN_SCENES=240;
export const MAX_TRANSFER_TRACE_CANDIDATES=4;
const MAX_SCENE_CHARS=6000;
const MAX_QUERY_CHARS=10000;
const STOP=new Set(["della","delle","degli","dello","dalla","dalle",
  "dopo","durante","prima","mentre","quella","questo","anche","nella",
  "nelle","sulla","sulle","hanno","detto","sapere","conosce","conoscere",
  "dichiara","spiega","racconta","letteralmente","qualcosa","allora",
  "essere","stato","nella","quello","senza","dentro","fuori"]);

export interface InformationTransferCandidate {
  id:string;
  chapterId:string;
  chapterNumber:number;
  sceneId:string;
  sceneNumber:number;
  frozenAt:string;
  sourceTextStamp:string;
  offset:number;
  quote:string;
  sender:string;
  recipient:string;
  topicTerms:string[];
  /** The query and previous phrase share one or more lexical topic words. */
  matchedTopicTerms:string[];
  evidenceStatus:"unverified_literal_report";
}
export interface InformationTransferTrace {
  method:"bounded_frozen_dialogue_mentions_v1";
  candidates:InformationTransferCandidate[];
  candidateSceneCount:number;
  scannedSceneCount:number;
  unscannedSceneCount:number;
  matchedCandidateCount:number;
  omittedCandidateCount:number;
}
function tokens(text:string):string[]{
  return [...new Set([...text.toLocaleLowerCase("it")
    .matchAll(/[\p{L}]{4,}/gu)].map(m=>m[0])
    .filter(w=>!STOP.has(w)))].slice(0,80);
}
function mentions(text:string,name:string):boolean {
  return new RegExp("(^|[^\\p{L}])"+name+"(?=$|[^\\p{L}])","iu").test(text);
}
const transferPattern=/([\p{Lu}][\p{L}]{1,29})\s+(?:racconta|raccontò|rivela|rivelò|dice|disse|spiega|spiegò|confida|confidò|informa|informò)\s+(?:ad?\s+)?([\p{Lu}][\p{L}]{1,29})\s+che\s+([^\n.!?]{8,160})/gu;

/** Return at most 4 *possible* information-transfer mentions from
 * previously frozen public prose. No transitive graph, identity inference
 * or automatic promotion to knowledge/canon. */
export function buildInformationTransferTrace(
  book:BookProject,chapter:Chapter,currentText:string,
):InformationTransferTrace {
  const all=book.chapters.filter(ch=>ch.id!==chapter.id &&
    ch.number<chapter.number && !!ch.frozenAt && ch.scenes.length>0 &&
    ch.scenes.every(sc=>sc.status==="canon" && !!sc.text.trim()))
    .flatMap(ch=>ch.scenes.map(scene=>({ch,scene})))
    .sort((a,b)=>b.ch.number-a.ch.number ||
      b.scene.number-a.scene.number || a.scene.id.localeCompare(b.scene.id));
  const scanned=all.slice(0,MAX_TRANSFER_SCAN_SCENES);
  const query=currentText.slice(0,MAX_QUERY_CHARS);
  const queryTerms=new Set(tokens(query));
  const found:InformationTransferCandidate[]=[];
  if(query.trim()){
    for(const {ch,scene} of scanned){
      if(ch.id.length>120||scene.id.length>120)continue;
      const text=scene.text.slice(0,MAX_SCENE_CHARS);
      let seen=0;
      transferPattern.lastIndex=0;
      for(const match of text.matchAll(transferPattern)){
        if(seen++>=12)break;
        const sender=match[1]!,recipient=match[2]!,clause=match[3]!;
        if(sender.toLocaleLowerCase("it")===recipient.toLocaleLowerCase("it") ||
          !mentions(query,recipient))continue;
        const topic=tokens(clause).filter(t=>
          t!==sender.toLocaleLowerCase("it")&&t!==recipient.toLocaleLowerCase("it"));
        const common=topic.filter(t=>queryTerms.has(t));
        if(!common.length)continue;
        const offset=match.index;
        const stamp=sceneTextStamp(scene.text);
        found.push({
          id:[ch.id,scene.id,offset,stamp].join("::"),
          chapterId:ch.id,chapterNumber:ch.number,
          sceneId:scene.id,sceneNumber:scene.number,
          frozenAt:ch.frozenAt!,sourceTextStamp:stamp,
          offset,quote:match[0]!,
          sender,recipient,topicTerms:topic.slice(0,12),
          matchedTopicTerms:common.slice(0,8),
          evidenceStatus:"unverified_literal_report",
        });
      }
    }
  }
  // Most recent bounded prose first. A match is never an instruction or
  // demonstration that a message was heard, believed, or understood.
  return {
    method:"bounded_frozen_dialogue_mentions_v1",
    candidates:found.slice(0,MAX_TRANSFER_TRACE_CANDIDATES),
    candidateSceneCount:all.length,
    scannedSceneCount:scanned.length,
    unscannedSceneCount:Math.max(0,all.length-scanned.length),
    matchedCandidateCount:found.length,
    omittedCandidateCount:Math.max(0,found.length-MAX_TRANSFER_TRACE_CANDIDATES),
  };
}
