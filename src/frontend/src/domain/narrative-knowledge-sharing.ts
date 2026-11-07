import type {BookProject,Chapter} from "./types";
import {buildNarrativeKnowledgeRegistry,type CurrentKnowledgeDecision}
  from "./narrative-knowledge-decisions";

/** A local, revocable permission for a single, currently valid interpretation.
 * This does NOT authorize the underlying author's private rationale. */
export const KNOWLEDGE_SHARE_RECIPIENTS = [
  "continuity","timeline","secrets","characterVoice","judge",
] as const;
export type KnowledgeShareRecipient=typeof KNOWLEDGE_SHARE_RECIPIENTS[number];
export const MAX_KNOWLEDGE_SHARE_DECISIONS=240;
export const MAX_SHARED_KNOWLEDGE_WITNESSES=4;

export interface NarrativeKnowledgeShareDecision {
  id:string;
  knowledgeDecisionId:string;
  status:"allowed"|"revoked";
  recipients:KnowledgeShareRecipient[];
  rationale:string;
  decidedAt:string;
}
export interface CurrentKnowledgeShare {
  permission:NarrativeKnowledgeShareDecision;
  knowledge:CurrentKnowledgeDecision;
}
export interface KnowledgeSharingRegistry {
  current:CurrentKnowledgeShare[];
  nonCurrentCount:number;
}
export interface SharedKnowledgeWitness {
  knowledgeDecisionId:string;
  chapterId:string;
  chapterNumber:number;
  sceneId:string;
  sceneNumber:number;
  actor:string;
  verdict:CurrentKnowledgeDecision["decision"]["verdict"];
  quote:string;
  offset:number;
  /** Consent only authorizes these fields; private rationale is omitted. */
  evidenceStatus:"author_interpretation_not_canonical_fact";
}
export interface SharedKnowledgePack {
  method:"explicit_current_author_consent_v1";
  witnesses:SharedKnowledgeWitness[];
  eligibleCount:number;
  omittedCount:number;
}
function validRecipients(value:unknown):value is KnowledgeShareRecipient[]{
  return Array.isArray(value) && value.length<=KNOWLEDGE_SHARE_RECIPIENTS.length &&
    new Set(value).size===value.length &&
    value.every(x=>KNOWLEDGE_SHARE_RECIPIENTS.includes(x));
}
function wholeName(text:string,name:string):boolean{
  if(name.length<2||name.length>60 ||
    !/^[\p{L}'’\-]+$/u.test(name))return false;
  return new RegExp("(^|[^\\p{L}])"+name+"(?=$|[^\\p{L}])","iu")
    .test(text.slice(0,10000));
}

/** A permission must be an explicit author action on the CURRENT decision.
 * Changes to the knowledge interpretation require a NEW grant. */
export function createNarrativeKnowledgeShareDecision(
  book:BookProject,knowledgeDecisionId:string,
  status:NarrativeKnowledgeShareDecision["status"],recipients:KnowledgeShareRecipient[],
  rationale:string,id:string,decidedAt:string,
):NarrativeKnowledgeShareDecision{
  if(status!=="allowed" && status!=="revoked")
    throw new Error("Operazione di consenso non valida.");
  if(!validRecipients(recipients) ||
    (status==="allowed" && recipients.length===0) ||
    (status==="revoked" && recipients.length!==0))
    throw new Error("Seleziona solo destinatari autorizzati e distinti.");
  const note=rationale.trim();
  if(note.length<12||note.length>500)
    throw new Error("Motiva il consenso con 12–500 caratteri.");
  if((book.narrativeKnowledgeShareDecisions?.length??0)>=MAX_KNOWLEDGE_SHARE_DECISIONS)
    throw new Error("Limite storico dei consensi raggiunto: salva un backup.");
  if(!id || id.length>300 || !Number.isFinite(Date.parse(decidedAt)))
    throw new Error("ID o timestamp della decisione non valido.");
  const current=buildNarrativeKnowledgeRegistry(book).current
    .find(x=>x.decision.id===knowledgeDecisionId);
  if(!current)
    throw new Error("La conoscenza non è più corrente: scegli una fonte valida.");
  return {id,knowledgeDecisionId,status,
    recipients:KNOWLEDGE_SHARE_RECIPIENTS.filter(x=>recipients.includes(x)),
    rationale:note,decidedAt};
}

/** Last permission wins even if it later becomes stale: no resurrection.
 * Malformed/imported status and obsolete interpretation IDs fail closed. */
export function buildKnowledgeSharingRegistry(book:BookProject):KnowledgeSharingRegistry{
  const history=book.narrativeKnowledgeShareDecisions??[];
  const latest=new Map<string,NarrativeKnowledgeShareDecision>();
  for(const decision of history)latest.set(decision.knowledgeDecisionId,decision);
  const validKnowledge=new Map(buildNarrativeKnowledgeRegistry(book).current
    .map(x=>[x.decision.id,x]));
  const current:CurrentKnowledgeShare[]=[];
  for(const permission of latest.values()){
    if(permission.status!=="allowed"||!validRecipients(permission.recipients)||
      !permission.recipients.length)continue;
    const knowledge=validKnowledge.get(permission.knowledgeDecisionId);
    if(knowledge)current.push({permission,knowledge});
  }
  current.sort((a,b)=>
    a.knowledge.source.candidate.chapterNumber-b.knowledge.source.candidate.chapterNumber ||
    a.knowledge.source.candidate.sceneNumber-b.knowledge.source.candidate.sceneNumber ||
    a.permission.id.localeCompare(b.permission.id));
  return {current,nonCurrentCount:history.length-current.length};
}

/** Strictly earlier frozen witness, named character in a CURRENT segment.
 * No author rationale, spoiler notes, private memory, aliases, future chapters,
 * or unconsented records are copied into AI prompt payloads. */
export function buildSharedKnowledgePack(
  book:BookProject,chapter:Chapter,recipient:KnowledgeShareRecipient,
  currentText:string,
):SharedKnowledgePack{
  if(!KNOWLEDGE_SHARE_RECIPIENTS.includes(recipient))
    throw new Error("Destinatario della conoscenza non autorizzato.");
  const matches:SharedKnowledgeWitness[]=[];
  for(const {permission,knowledge} of buildKnowledgeSharingRegistry(book).current){
    const source=knowledge.source;
    if(!permission.recipients.includes(recipient)||
      source.candidate.chapterNumber>=chapter.number ||
      source.candidate.chapterId===chapter.id ||
      !wholeName(currentText,source.candidate.actor))continue;
    const earlier=book.chapters.find(x=>x.id===source.candidate.chapterId);
    if(!earlier?.frozenAt)continue;
    matches.push({
      knowledgeDecisionId:knowledge.decision.id,
      chapterId:source.candidate.chapterId,chapterNumber:source.candidate.chapterNumber,
      sceneId:source.candidate.sceneId,sceneNumber:source.candidate.sceneNumber,
      actor:source.candidate.actor,verdict:knowledge.decision.verdict,
      quote:source.decision.quote,offset:source.decision.offset,
      evidenceStatus:"author_interpretation_not_canonical_fact",
    });
  }
  const witnesses=matches.slice(0,MAX_SHARED_KNOWLEDGE_WITNESSES);
  return {
    method:"explicit_current_author_consent_v1",witnesses,
    eligibleCount:matches.length,omittedCount:Math.max(0,matches.length-witnesses.length),
  };
}
