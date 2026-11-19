import type {BookProject} from "./types";
import {previewKnowledgeTransferForPair}
  from "./knowledge-transfer-preview";
import type {InformationTransferCandidate} from "./information-transfer-traces";

/** Human interpretation of ONE exact, currently visible textual candidate.
 * This attests an author's reading, not message delivery, belief or canon. */
export type NarrativeTransferVerdict=
  "author_attested_report"|"possible_path"|"dismissed";
export interface NarrativeTransferAssessment {
  id:string;
  topicDecisionId:string;
  senderKnowledgeDecisionId:string;
  recipientKnowledgeDecisionId:string;
  candidateId:string;
  verdict:NarrativeTransferVerdict;
  rationale:string;
  decidedAt:string;
}
export interface CurrentTransferAssessment {
  decision:NarrativeTransferAssessment;
  candidate:InformationTransferCandidate;
  senderName:string;
  recipientName:string;
}
export interface NarrativeTransferAssessmentRegistry {
  current:CurrentTransferAssessment[];
  nonCurrentCount:number;
  /** Does not assert that a recipient learned a true fact. */
  authorInterpretationsOnly:true;
}
export const MAX_TRANSFER_ASSESSMENTS=120;
const VERDICTS:readonly NarrativeTransferVerdict[]=[
  "author_attested_report","possible_path","dismissed",
];

function decisionKey(d:NarrativeTransferAssessment):string {
  return JSON.stringify([
    d.topicDecisionId,d.senderKnowledgeDecisionId,
    d.recipientKnowledgeDecisionId,d.candidateId,
  ]);
}

/** Fail closed when the exact topic/link, direction, source quote, freeze,
 * offset or scene stamp has changed. Re-run the existing bounded scanner;
 * never accept a candidate ID merely because it is present in a ZIP. */
function currentCandidate(
  book:BookProject,topicId:string,senderId:string,recipientId:string,
  candidateId:string,
):{candidate:InformationTransferCandidate;senderName:string;recipientName:string}|null {
  const preview=previewKnowledgeTransferForPair(book,topicId);
  if(!preview)return null;
  for(const direction of preview.directions){
    if(direction.sender.decision.id!==senderId ||
      direction.recipient.decision.id!==recipientId)continue;
    const candidate=direction.trace.candidates.find(c=>c.id===candidateId);
    if(candidate)return {candidate,
      senderName:direction.sender.source.candidate.actor,
      recipientName:direction.recipient.source.candidate.actor};
  }
  return null;
}

export function createNarrativeTransferAssessment(
  book:BookProject,topicId:string,senderId:string,recipientId:string,
  candidateId:string,verdict:NarrativeTransferVerdict,rationale:string,
  id:string,decidedAt:string,
):NarrativeTransferAssessment {
  if(!VERDICTS.includes(verdict))
    throw new Error("Interpretazione della pista non valida.");
  const note=rationale.trim();
  if(note.length<20||note.length>650)
    throw new Error("Motiva la pista comunicativa con 20–650 caratteri.");
  if((book.narrativeTransferAssessments?.length??0)>=MAX_TRANSFER_ASSESSMENTS)
    throw new Error("Limite di 120 giudizi raggiunto: salva un backup.");
  if(!id||id.length>300||!Number.isFinite(Date.parse(decidedAt)))
    throw new Error("ID o data del giudizio non validi.");
  if(!topicId||!senderId||!recipientId||senderId===recipientId||!candidateId)
    throw new Error("Seleziona una pista esatta da due conoscenze diverse.");
  if(!currentCandidate(book,topicId,senderId,recipientId,candidateId))
    throw new Error("Pista o collegamento non più corrente: aggiorna l'anteprima.");
  return {
    id,topicDecisionId:topicId,
    senderKnowledgeDecisionId:senderId,recipientKnowledgeDecisionId:recipientId,
    candidateId,verdict,rationale:note,decidedAt,
  };
}

/** Last entry for the SAME exact source wins, even if it is stale. Never
 * resurrect an older decision; a changed topic or text needs a new act.
 * Only a selected topic is scanned (expensive bounded scan remains opt-in). */
export function buildNarrativeTransferAssessmentRegistry(
  book:BookProject,topicId:string,
):NarrativeTransferAssessmentRegistry {
  const history=(book.narrativeTransferAssessments??[])
    .filter(x=>x.topicDecisionId===topicId);
  const latest=new Map<string,NarrativeTransferAssessment>();
  for(const decision of history)latest.set(decisionKey(decision),decision);
  const preview=previewKnowledgeTransferForPair(book,topicId);
  const sources=new Map<string,{
    candidate:InformationTransferCandidate;senderName:string;recipientName:string;
  }>();
  if(preview)for(const direction of preview.directions)
    for(const candidate of direction.trace.candidates){
      const key=JSON.stringify([
        topicId,direction.sender.decision.id,direction.recipient.decision.id,candidate.id,
      ]);
      sources.set(key,{
        candidate,senderName:direction.sender.source.candidate.actor,
        recipientName:direction.recipient.source.candidate.actor,
      });
    }
  const current:CurrentTransferAssessment[]=[];
  for(const [key,decision] of latest){
    if(!VERDICTS.includes(decision.verdict))continue;
    const source=sources.get(key);
    if(source)current.push({decision,...source});
  }
  current.sort((a,b)=>a.candidate.chapterNumber-b.candidate.chapterNumber ||
    a.candidate.sceneNumber-b.candidate.sceneNumber ||
    a.candidate.offset-b.candidate.offset ||
    a.decision.id.localeCompare(b.decision.id));
  return {current,nonCurrentCount:history.length-current.length,
    authorInterpretationsOnly:true};
}
