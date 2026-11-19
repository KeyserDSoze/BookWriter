import type {BookProject} from "./types";
import {buildNarrativeKnowledgeTopicRegistry,
  type CurrentKnowledgeTopicLink} from "./narrative-knowledge-topic-decisions";
import {buildInformationTransferTrace,
  type InformationTransferTrace} from "./information-transfer-traces";
import type {CurrentKnowledgeDecision} from "./narrative-knowledge-decisions";

export interface DirectedKnowledgeTransferPreview {
  sender:CurrentKnowledgeDecision;
  recipient:CurrentKnowledgeDecision;
  /** Bounded lexical candidates, NOT evidence of actual communication. */
  trace:InformationTransferTrace;
}
export interface KnowledgeTransferPreview {
  topic:CurrentKnowledgeTopicLink;
  directions:[DirectedKnowledgeTransferPreview,DirectedKnowledgeTransferPreview];
  method:"author_topic_pair_bounded_transfer_mentions_v1";
  manuscriptOrderOnly:true;
}

/** Deliberately runs ONLY on an exact, CURRENT author-confirmed pair.
 * This does not infer a relationship between unlinked knowledge mentions,
 * validate chronology or modify anything. Triggered explicitly from the UI.
 * Each direction scans only chapters frozen BEFORE its recipient's chapter
 * in manuscript order, not fiction time, using only its literal quote. */
export function previewKnowledgeTransferForPair(
  book:BookProject,topicDecisionId:string,
):KnowledgeTransferPreview|null {
  const topic=buildNarrativeKnowledgeTopicRegistry(book).sameInformation
    .find(link=>link.decision.id===topicDecisionId);
  if(!topic)return null;
  function direction(
    sender:CurrentKnowledgeDecision,recipient:CurrentKnowledgeDecision,
  ):DirectedKnowledgeTransferPreview {
    const ch=book.chapters.find(x=>x.id===recipient.source.candidate.chapterId);
    // An invalid imported anchor is never allowed to become new evidence.
    if(!ch||!ch.frozenAt)
      throw new Error("La fonte della conoscenza non è più congelata.");
    const trace=buildInformationTransferTrace(
      book,ch,recipient.source.decision.quote,{
        sender:sender.source.candidate.actor,
        recipient:recipient.source.candidate.actor,
      });
    return {sender,recipient,trace};
  }
  return {
    topic,
    directions:[
      direction(topic.first,topic.second),
      direction(topic.second,topic.first),
    ],
    method:"author_topic_pair_bounded_transfer_mentions_v1",
    manuscriptOrderOnly:true,
  };
}
