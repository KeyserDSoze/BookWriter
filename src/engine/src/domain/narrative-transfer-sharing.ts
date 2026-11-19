import type {BookProject,Chapter} from "./types";
import {buildNarrativeKnowledgeRegistry} from "./narrative-knowledge-decisions";
import {buildNarrativeTransferAssessmentRegistry,
  type CurrentTransferAssessment} from "./narrative-transfer-assessments";

/** A new consent, distinct from all existing knowledge/alias permissions. */
export const TRANSFER_SHARE_RECIPIENTS=[
  "continuity","timeline","secrets","characterVoice","judge",
] as const;
export type TransferShareRecipient=typeof TRANSFER_SHARE_RECIPIENTS[number];
export const MAX_TRANSFER_SHARE_DECISIONS=180;
export const MAX_TRANSFER_SHARE_SCAN=12;
export const MAX_SHARED_TRANSFER_WITNESSES=3;

export interface NarrativeTransferShareDecision {
  id:string;
  transferAssessmentId:string;
  status:"allowed"|"revoked";
  recipients:TransferShareRecipient[];
  rationale:string;
  decidedAt:string;
}
export interface CurrentTransferShare {
  permission:NarrativeTransferShareDecision;
  assessment:CurrentTransferAssessment;
}
export interface NarrativeTransferSharingRegistry {
  current:CurrentTransferShare[];
  nonCurrentCount:number;
}
export interface SharedTransferWitness {
  /** These are the ONLY fields approved for external prompt use. */
  chapterNumber:number;
  sceneNumber:number;
  offset:number;
  quote:string;
  sender:string;
  recipient:string;
  authorVerdict:CurrentTransferAssessment["decision"]["verdict"];
  evidenceStatus:"author_interpretation_not_communication_proof";
}
export interface SharedTransferPack {
  method:"explicit_transfer_assessment_consent_v1";
  witnesses:SharedTransferWitness[];
  eligibleCount:number;
  omittedCount:number;
  /** Relevant allowed entries beyond the bounded local revalidation budget. */
  unscannedGrantCount:number;
}

function validRecipients(value:unknown):value is TransferShareRecipient[]{
  return Array.isArray(value)&&value.length<=TRANSFER_SHARE_RECIPIENTS.length &&
    new Set(value).size===value.length &&
    value.every(x=>TRANSFER_SHARE_RECIPIENTS.includes(x));
}
function literalName(text:string,name:string):boolean {
  if(name.length<2||name.length>60||!/^[\p{L}'’\-]+$/u.test(name))return false;
  return new RegExp("(^|[^\\p{L}])"+name+"(?=$|[^\\p{L}])","iu")
    .test(text.slice(0,10000));
}
/** Last record for the exact assessment ID wins, including revocations.
 * Every candidate is revalidated on current frozen prose before sharing;
 * imported approval records never imply authenticated user permission. */
export function buildTransferSharingRegistry(
  book:BookProject,
):NarrativeTransferSharingRegistry {
  const history=book.narrativeTransferShareDecisions??[];
  const latest=new Map<string,NarrativeTransferShareDecision>();
  for(const permission of history)latest.set(permission.transferAssessmentId,permission);
  const assessmentHistory=new Map((book.narrativeTransferAssessments??[])
    .map(entry=>[entry.id,entry]));
  const topicCache=new Map<string,Map<string,CurrentTransferAssessment>>();
  const current:CurrentTransferShare[]=[];
  for(const permission of latest.values()){
    if(permission.status!=="allowed"||!validRecipients(permission.recipients)||
      !permission.recipients.length)continue;
    const assessment=assessmentHistory.get(permission.transferAssessmentId);
    if(!assessment)continue;
    let records=topicCache.get(assessment.topicDecisionId);
    if(!records){
      records=new Map(buildNarrativeTransferAssessmentRegistry(
        book,assessment.topicDecisionId).current.map(x=>[x.decision.id,x]));
      topicCache.set(assessment.topicDecisionId,records);
    }
    const live=records.get(assessment.id);
    if(live)current.push({permission,assessment:live});
  }
  current.sort((a,b)=>
    a.assessment.candidate.chapterNumber-b.assessment.candidate.chapterNumber ||
    a.assessment.candidate.sceneNumber-b.assessment.candidate.sceneNumber ||
    a.assessment.candidate.offset-b.assessment.candidate.offset ||
    a.permission.id.localeCompare(b.permission.id));
  return {current,nonCurrentCount:history.length-current.length};
}
/** Grant/revoke requires an assessment currently present and independently
 * validated, never an ID found only in an imported ZIP. */
export function createNarrativeTransferShareDecision(
  book:BookProject,assessmentId:string,status:NarrativeTransferShareDecision["status"],
  recipients:TransferShareRecipient[],rationale:string,id:string,decidedAt:string,
):NarrativeTransferShareDecision {
  if(status!=="allowed"&&status!=="revoked")
    throw new Error("Operazione di consenso sulle piste non valida.");
  if(!validRecipients(recipients)||
    (status==="allowed"&&!recipients.length)||
    (status==="revoked"&&recipients.length!==0))
    throw new Error("Seleziona destinatari validi o revoca senza destinatari.");
  const note=rationale.trim();
  if(note.length<12||note.length>500)
    throw new Error("Motiva il consenso sulle piste con 12–500 caratteri.");
  if((book.narrativeTransferShareDecisions?.length??0)>=MAX_TRANSFER_SHARE_DECISIONS)
    throw new Error("Limite di 180 consensi raggiunto: esporta un backup.");
  if(!id||id.length>300||!Number.isFinite(Date.parse(decidedAt)))
    throw new Error("Identificativo o data del consenso non validi.");
  const assessment=(book.narrativeTransferAssessments??[])
    .find(x=>x.id===assessmentId);
  if(!assessment||!buildNarrativeTransferAssessmentRegistry(
    book,assessment.topicDecisionId).current.some(x=>x.decision.id===assessmentId))
    throw new Error("La valutazione non è più corrente: consenso non autorizzato.");
  return {id,transferAssessmentId:assessmentId,status,
    recipients:TRANSFER_SHARE_RECIPIENTS.filter(x=>recipients.includes(x)),
    rationale:note,decidedAt};
}
/** Only an explicitly permitted, CURRENT assessment from an earlier frozen
 * chapter. The recipient must be named verbatim in the CURRENT segment.
 * A bounded prompt pack excludes all private rationale, topic link and
 * temporal knowledge choices, secrets, audit and other recipients. */
export function buildSharedTransferPack(
  book:BookProject,chapter:Chapter,role:TransferShareRecipient,currentText:string,
):SharedTransferPack {
  if(!TRANSFER_SHARE_RECIPIENTS.includes(role))
    throw new Error("Destinatario delle piste non autorizzato.");
  const latest=new Map<string,NarrativeTransferShareDecision>();
  for(const d of book.narrativeTransferShareDecisions??[])
    latest.set(d.transferAssessmentId,d);
  // Fail closed before expensive source revalidation: a grant on an imported
  // or outdated knowledge ID is not enough to expose any narrative text.
  const assessments=new Map((book.narrativeTransferAssessments??[])
    .map(x=>[x.id,x]));
  const knowledge=new Map(buildNarrativeKnowledgeRegistry(book).current
    .map(x=>[x.decision.id,x]));
  const filtered=[...latest.values()].filter(permission=>{
    if(permission.status!=="allowed"||!validRecipients(permission.recipients)||
      !permission.recipients.includes(role))return false;
    const assessment=assessments.get(permission.transferAssessmentId);
    if(!assessment)return false;
    const recipient=knowledge.get(assessment.recipientKnowledgeDecisionId);
    const sender=knowledge.get(assessment.senderKnowledgeDecisionId);
    return !!recipient && !!sender &&
      literalName(currentText,recipient.source.candidate.actor) &&
      recipient.source.candidate.chapterNumber<chapter.number &&
      sender.source.candidate.chapterNumber<chapter.number;
  });
  const selected=filtered.slice(0,MAX_TRANSFER_SHARE_SCAN);
  const cache=new Map<string,Map<string,CurrentTransferAssessment>>();
  const matches:SharedTransferWitness[]=[];
  for(const grant of selected){
    const raw=assessments.get(grant.transferAssessmentId)!;
    let live=cache.get(raw.topicDecisionId);
    if(!live){
      live=new Map(buildNarrativeTransferAssessmentRegistry(
        book,raw.topicDecisionId).current.map(x=>[x.decision.id,x]));
      cache.set(raw.topicDecisionId,live);
    }
    const current=live.get(raw.id);
    if(!current||current.candidate.chapterNumber>=chapter.number ||
      current.candidate.chapterId===chapter.id)continue;
    matches.push({
      chapterNumber:current.candidate.chapterNumber,
      sceneNumber:current.candidate.sceneNumber,
      offset:current.candidate.offset,
      quote:current.candidate.quote,
      sender:current.senderName,
      recipient:current.recipientName,
      authorVerdict:current.decision.verdict,
      evidenceStatus:"author_interpretation_not_communication_proof",
    });
  }
  // Omission counters concern only the bounded set of matching grants and
  // never claim exhaustive coverage of the whole manuscript.
  const witnesses=matches.slice(0,MAX_SHARED_TRANSFER_WITNESSES);
  return {method:"explicit_transfer_assessment_consent_v1",
    witnesses,eligibleCount:matches.length,
    omittedCount:Math.max(0,matches.length-witnesses.length),
    unscannedGrantCount:Math.max(0,filtered.length-selected.length)};
}
