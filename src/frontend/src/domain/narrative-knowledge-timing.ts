import type {BookProject} from "./types";
import {buildNarrativeKnowledgeRegistry,type CurrentKnowledgeDecision}
  from "./narrative-knowledge-decisions";

/** A human interpretation of when the character has access to one mentioned
 * piece of information. Chapter order is not necessarily fictional time. */
export type KnowledgeAccessMoment =
  "acquired_in_scene"|"known_before_scene"|"not_yet_known"|"uncertain";
export type NarrativeTemporalOrder =
  "chronological"|"flashback_or_reordered"|"undetermined";

export interface NarrativeKnowledgeTimingDecision {
  id:string;
  knowledgeDecisionId:string;
  accessMoment:KnowledgeAccessMoment;
  narrativeOrder:NarrativeTemporalOrder;
  rationale:string;
  decidedAt:string;
}
export interface CurrentKnowledgeTiming {
  decision:NarrativeKnowledgeTimingDecision;
  knowledge:CurrentKnowledgeDecision;
}
export interface KnowledgeCharacterTimeline {
  actorName:string;
  /** Sorted by location in the MANUSCRIPT, not by fictional chronology. */
  entries:CurrentKnowledgeTiming[];
}
export interface NarrativeKnowledgeTimingRegistry {
  current:CurrentKnowledgeTiming[];
  byCharacter:KnowledgeCharacterTimeline[];
  nonCurrentCount:number;
  manuscriptOrderOnly:true;
}
export const MAX_KNOWLEDGE_TIMING_DECISIONS=200;

const ACCESS_MOMENTS:readonly KnowledgeAccessMoment[]=[
  "acquired_in_scene","known_before_scene","not_yet_known","uncertain",
];
const NARRATIVE_ORDERS:readonly NarrativeTemporalOrder[]=[
  "chronological","flashback_or_reordered","undetermined",
];

/** A timeline interpretation needs an explicit current author knowledge
 * decision; it may never be attached to a stale or unverified textual clue.
 * No AI, canonical memory or secret updates are performed here. */
export function createNarrativeKnowledgeTimingDecision(
  book:BookProject,knowledgeDecisionId:string,accessMoment:KnowledgeAccessMoment,
  narrativeOrder:NarrativeTemporalOrder,rationale:string,id:string,decidedAt:string,
):NarrativeKnowledgeTimingDecision {
  if(!ACCESS_MOMENTS.includes(accessMoment)||!NARRATIVE_ORDERS.includes(narrativeOrder))
    throw new Error("Classificazione temporale della conoscenza non valida.");
  const note=rationale.trim();
  if(note.length<20||note.length>650)
    throw new Error("Motiva il tempo narrativo in 20–650 caratteri.");
  if((book.narrativeKnowledgeTimingDecisions?.length??0)>=MAX_KNOWLEDGE_TIMING_DECISIONS)
    throw new Error("Raggiunto il limite di 200 decisioni temporali: salva un backup.");
  if(!id||id.length>300||!Number.isFinite(Date.parse(decidedAt)))
    throw new Error("ID o data del giudizio temporale non validi.");
  const knowledge=buildNarrativeKnowledgeRegistry(book).current
    .find(x=>x.decision.id===knowledgeDecisionId);
  if(!knowledge)
    throw new Error("La conoscenza non è corrente o attestata: annotazione temporale bloccata.");
  const secret=knowledge.decision.verdict==="still_secret";
  if((secret && !["not_yet_known","uncertain"].includes(accessMoment))||
    (!secret && accessMoment==="not_yet_known"))
    throw new Error("Il momento scelto contraddice la classificazione corrente dell'autore.");
  return {id,knowledgeDecisionId,accessMoment,narrativeOrder,
    rationale:note,decidedAt};
}

/** Last exact knowledge-ID wins (including stale records); no inference that
 * a scene is later in STORY TIME simply because its chapter number is larger.
 * Imported records are historical claims, never authentication. */
export function buildNarrativeKnowledgeTimingRegistry(
  book:BookProject,
):NarrativeKnowledgeTimingRegistry{
  const history=book.narrativeKnowledgeTimingDecisions??[];
  const latest=new Map<string,NarrativeKnowledgeTimingDecision>();
  for(const entry of history) latest.set(entry.knowledgeDecisionId,entry);
  const currentKnowledge=new Map(buildNarrativeKnowledgeRegistry(book).current
    .map(entry=>[entry.decision.id,entry]));
  const current:CurrentKnowledgeTiming[]=[];
  for(const decision of latest.values()){
    const knowledge=currentKnowledge.get(decision.knowledgeDecisionId);
    if(!knowledge ||
      !ACCESS_MOMENTS.includes(decision.accessMoment)||
      !NARRATIVE_ORDERS.includes(decision.narrativeOrder)||
      (knowledge.decision.verdict==="still_secret"
        ? !["not_yet_known","uncertain"].includes(decision.accessMoment)
        : decision.accessMoment==="not_yet_known"))continue;
    current.push({decision,knowledge});
  }
  current.sort((a,b)=>
    a.knowledge.source.candidate.chapterNumber-b.knowledge.source.candidate.chapterNumber ||
    a.knowledge.source.candidate.sceneNumber-b.knowledge.source.candidate.sceneNumber ||
    a.knowledge.source.candidate.offset-b.knowledge.source.candidate.offset ||
    a.decision.id.localeCompare(b.decision.id));
  const groups=new Map<string,KnowledgeCharacterTimeline>();
  for(const entry of current){
    const actor=entry.knowledge.source.candidate.actor;
    const key=actor.normalize("NFC").toLocaleLowerCase("it");
    const group=groups.get(key);
    if(group)group.entries.push(entry);
    else groups.set(key,{actorName:actor,entries:[entry]});
  }
  return {
    current,byCharacter:[...groups.values()].sort((a,b)=>
      a.actorName.localeCompare(b.actorName,"it")),
    nonCurrentCount:history.length-current.length,
    manuscriptOrderOnly:true,
  };
}
