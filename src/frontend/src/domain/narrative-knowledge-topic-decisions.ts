import type {BookProject} from "./types";
import {buildNarrativeKnowledgeRegistry,type CurrentKnowledgeDecision}
  from "./narrative-knowledge-decisions";
import {buildNarrativeKnowledgeTimingRegistry,type CurrentKnowledgeTiming}
  from "./narrative-knowledge-timing";

/** Explicit author assessment that TWO distinct characters' mentions concern
 * the same subject. This is not a message transfer, chronology or canon fact. */
export interface NarrativeKnowledgeTopicDecision {
  id:string;
  firstKnowledgeDecisionId:string;
  secondKnowledgeDecisionId:string;
  verdict:"same_information"|"different_information";
  rationale:string;
  decidedAt:string;
}
export interface CurrentKnowledgeTopicLink {
  decision:NarrativeKnowledgeTopicDecision;
  first:CurrentKnowledgeDecision;
  second:CurrentKnowledgeDecision;
  firstTiming:CurrentKnowledgeTiming|null;
  secondTiming:CurrentKnowledgeTiming|null;
}
export interface NarrativeKnowledgeTopicRegistry {
  current:CurrentKnowledgeTopicLink[];
  sameInformation:CurrentKnowledgeTopicLink[];
  differentInformation:CurrentKnowledgeTopicLink[];
  nonCurrentCount:number;
  /** This is neither an inferred equivalence class nor a transfer graph. */
  pairwiseOnly:true;
}
export const MAX_KNOWLEDGE_TOPIC_DECISIONS=120;

function normalizedName(name:string):string {
  return name.trim().normalize("NFC").toLocaleLowerCase("it");
}
function key(a:string,b:string):string{
  return JSON.stringify([a,b].sort());
}

/** Two CURRENT author knowledge interpretations with different literal actors
 * are required. Canonical ID ordering eliminates reversed duplicate pairs.
 * The subject relation is explicitly chosen, not inferred from shared words. */
export function createNarrativeKnowledgeTopicDecision(
  book:BookProject,firstId:string,secondId:string,
  verdict:NarrativeKnowledgeTopicDecision["verdict"],rationale:string,
  id:string,decidedAt:string,
):NarrativeKnowledgeTopicDecision {
  if(!["same_information","different_information"].includes(verdict))
    throw new Error("Relazione informativa non valida.");
  const note=rationale.trim();
  if(note.length<20||note.length>650)
    throw new Error("Motiva la relazione fra informazioni con 20–650 caratteri.");
  if((book.narrativeKnowledgeTopicDecisions?.length??0)>=MAX_KNOWLEDGE_TOPIC_DECISIONS)
    throw new Error("Raggiunto il limite di 120 relazioni: esporta un backup.");
  if(!id||id.length>300||!Number.isFinite(Date.parse(decidedAt)))
    throw new Error("Identificativo o data della relazione non validi.");
  if(!firstId||!secondId||firstId===secondId)
    throw new Error("Seleziona due conoscenze distinte e attestate.");
  const current=buildNarrativeKnowledgeRegistry(book).current;
  const first=current.find(x=>x.decision.id===firstId);
  const second=current.find(x=>x.decision.id===secondId);
  if(!first||!second)
    throw new Error("Una delle due conoscenze non è più corrente o attestata.");
  if(normalizedName(first.source.candidate.actor)===
     normalizedName(second.source.candidate.actor))
    throw new Error("Seleziona personaggi diversi; non dedurre alias o identità.");
  const firstKnowledgeDecisionId=firstId<secondId?firstId:secondId;
  const secondKnowledgeDecisionId=firstId<secondId?secondId:firstId;
  return {id,firstKnowledgeDecisionId,secondKnowledgeDecisionId,
    verdict,rationale:note,decidedAt};
}

/** Last saved decision for the EXACT unordered pair wins, including an
 * obsolete one. Never resuscitate older relationships after a revised source.
 * Existing temporal labels are OPTIONAL and must not be treated as events. */
export function buildNarrativeKnowledgeTopicRegistry(
  book:BookProject,
):NarrativeKnowledgeTopicRegistry {
  const history=book.narrativeKnowledgeTopicDecisions??[];
  const latest=new Map<string,NarrativeKnowledgeTopicDecision>();
  for(const decision of history)
    latest.set(key(decision.firstKnowledgeDecisionId,
      decision.secondKnowledgeDecisionId),decision);
  const knowledge=new Map(buildNarrativeKnowledgeRegistry(book).current
    .map(entry=>[entry.decision.id,entry]));
  const timing=new Map(buildNarrativeKnowledgeTimingRegistry(book).current
    .map(entry=>[entry.knowledge.decision.id,entry]));
  const current:CurrentKnowledgeTopicLink[]=[];
  for(const decision of latest.values()){
    if(!["same_information","different_information"].includes(decision.verdict)||
      decision.firstKnowledgeDecisionId===decision.secondKnowledgeDecisionId ||
      decision.firstKnowledgeDecisionId>decision.secondKnowledgeDecisionId)
      continue;
    const first=knowledge.get(decision.firstKnowledgeDecisionId);
    const second=knowledge.get(decision.secondKnowledgeDecisionId);
    if(!first||!second||normalizedName(first.source.candidate.actor)===
      normalizedName(second.source.candidate.actor))continue;
    current.push({
      decision,first,second,
      firstTiming:timing.get(first.decision.id)??null,
      secondTiming:timing.get(second.decision.id)??null,
    });
  }
  current.sort((a,b)=>
    a.first.source.candidate.chapterNumber-b.first.source.candidate.chapterNumber ||
    a.second.source.candidate.chapterNumber-b.second.source.candidate.chapterNumber ||
    a.decision.id.localeCompare(b.decision.id));
  return {
    current,
    sameInformation:current.filter(x=>x.decision.verdict==="same_information"),
    differentInformation:current.filter(x=>x.decision.verdict==="different_information"),
    nonCurrentCount:history.length-current.length,
    pairwiseOnly:true,
  };
}

/** A review-only pattern built from THREE independent, CURRENT author verdicts.
 * It does not add a missing edge, infer topic identity or authorize repairs. */
export interface KnowledgeTopicTriangleWarning {
  first:CurrentKnowledgeDecision;
  middle:CurrentKnowledgeDecision;
  last:CurrentKnowledgeDecision;
  firstSame:CurrentKnowledgeTopicLink;
  secondSame:CurrentKnowledgeTopicLink;
  different:CurrentKnowledgeTopicLink;
}
export interface KnowledgeTopicTriangleReview {
  warnings:KnowledgeTopicTriangleWarning[];
  totalCount:number;
  omittedCount:number;
}
export const MAX_KNOWLEDGE_TOPIC_TRIANGLE_WARNINGS=12;

/** Only show potentially inconsistent CLOSED triangles: A~B, B~C, A!=C.
 * Two links alone never imply the third; no semantic or temporal inference.
 * Bounded output avoids overwhelming the mobile panel with combinatorial
 * evidence. The inputs are the already-validated, last-wins CURRENT links. */
export function reviewNarrativeKnowledgeTopicTriangles(
  registry:NarrativeKnowledgeTopicRegistry,
):KnowledgeTopicTriangleReview {
  const sameByPair=new Map<string,CurrentKnowledgeTopicLink>();
  const neighbors=new Map<string,Array<{id:string;link:CurrentKnowledgeTopicLink}>>();
  for(const link of registry.sameInformation){
    const a=link.decision.firstKnowledgeDecisionId;
    const b=link.decision.secondKnowledgeDecisionId;
    sameByPair.set(key(a,b),link);
    for(const [from,to] of [[a,b],[b,a]] as Array<[string,string]>){
      const next=neighbors.get(from)??[];
      next.push({id:to,link});
      neighbors.set(from,next);
    }
  }
  const warnings:KnowledgeTopicTriangleWarning[]=[];
  let totalCount=0;
  for(const different of registry.differentInformation){
    const a=different.decision.firstKnowledgeDecisionId;
    const c=different.decision.secondKnowledgeDecisionId;
    for(const nearby of neighbors.get(a)??[]){
      const secondSame=sameByPair.get(key(nearby.id,c));
      if(!secondSame)continue;
      totalCount++;
      if(warnings.length>=MAX_KNOWLEDGE_TOPIC_TRIANGLE_WARNINGS)continue;
      const middle=nearby.link.first.decision.id===nearby.id
        ?nearby.link.first:nearby.link.second;
      warnings.push({
        first:different.first,middle,last:different.second,
        firstSame:nearby.link,secondSame,different,
      });
    }
  }
  return {warnings,totalCount,omittedCount:totalCount-warnings.length};
}
