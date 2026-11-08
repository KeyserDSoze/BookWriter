import type {BookProject,Chapter} from "./types";
import {
  buildEditorialRecommendationDisagreements,
  isNarrativeEvidenceAnchorCurrent,validateJudgment,
  type ChapterEditorialCycle,type EditorialFinding,type EditorialJudgment,
  type EditorialReport,type EditorialRound,type EditorialRecommendationDisagreement,
} from "./editorial-board";

/** Local author-facing view over existing editorial judgments. Never persisted,
 * appended to a prompt, or interpreted as semantic truth. */
export const MAX_VERIFICATION_PLAN_ITEMS=24;
export type VerificationPlanStatus=
  "awaiting_judge"|"needs_evidence"|"approved_edit"|
  "closed_no_edit"|"requires_recheck"|"archived";
export interface VerificationPlanItem {
  key:string;
  round:number;
  status:VerificationPlanStatus;
  sceneId:string;
  segmentIndex:number|null;
  category:string;
  quote:string;
  findingIds:string[];
  acceptedFindingIds:string[];
  missingEvidence?:string;
  nextCheck?:string;
  explanation?:string;
}
export interface EditorialVerificationPlan {
  method:"local_editorial_disagreement_plan_v1";
  items:VerificationPlanItem[];
  totalItemCount:number;
  omittedItemCount:number;
  unreviewableFindingCount:number;
  omittedGroupCount:number;
  oversizedGroupCount:number;
  counts:Record<VerificationPlanStatus,number>;
}
function keyFor(ids:string[]):string {
  return JSON.stringify([...ids].sort());
}
function quoteFor(finding:EditorialFinding|undefined):string{
  return (finding?.evidenceAnchor?.quote??finding?.evidence??"").slice(0,250);
}
function sourceFor(id:string,reports:EditorialReport[]):{
  sceneId:string;category:string;quote:string;segmentIndex:number|null;
} {
  const finding=reports.flatMap(r=>r.findings).find(f=>f.id===id);
  return {
    sceneId:finding?.sceneId??"",
    category:finding?.category??"Non disponibile",
    quote:quoteFor(finding),
    segmentIndex:finding?.evidenceAnchor?.segmentIndex??null,
  };
}
function judgmentIsCurrent(book:BookProject,cycle:ChapterEditorialCycle,
  chapter:Chapter):boolean {
  if(!cycle.judgment)return false;
  try{
    const {reasoning,decisions,authorTransferCritique,recommendationReconciliations}
      =cycle.judgment;
    validateJudgment(cycle,JSON.stringify({
      reasoning,decisions,
      ...(authorTransferCritique?{authorTransferCritique}:{}),
      ...(recommendationReconciliations!==undefined
        ?{recommendationReconciliations}:{}),
    }),chapter,book);
    return true;
  }catch {
    // Imported, outdated or ill-formed judgments are not live authorizations.
    return false;
  }
}
function currentGroupItem(group:EditorialRecommendationDisagreement,
  round:number,judgment:EditorialJudgment|undefined,
  safeJudgment:boolean):VerificationPlanItem {
  const review=judgment?.recommendationReconciliations
    ?.find(x=>keyFor(x.findingIds)===keyFor(group.findingIds));
  const accepted=group.findingIds.filter(id=>
    judgment?.decisions.some(x=>x.findingId===id && x.action==="accept"));
  let status:VerificationPlanStatus;
  if(!judgment)status="awaiting_judge";
  else if(!safeJudgment||!review)status="requires_recheck";
  else if(review.evidenceAssessment==="unresolved")status="needs_evidence";
  else if(review.resolution==="reject_all")status="closed_no_edit";
  else status="approved_edit";
  return {
    key:"current:"+round+":"+keyFor(group.findingIds),round,status,
    sceneId:group.sceneId,segmentIndex:group.segmentIndex,
    category:group.category,quote:group.quote,
    findingIds:group.findingIds,
    acceptedFindingIds:safeJudgment&&status==="approved_edit"?accepted:[],
    ...(review?{
      missingEvidence:review.missingEvidence,nextCheck:review.nextCheck,
      explanation:review.rationale,
    }:{}),
  };
}
function pastEntry(round:number,reports:EditorialReport[],
  review:NonNullable<EditorialJudgment["recommendationReconciliations"]>[number],
  kind:"archived"|"requires_recheck"):VerificationPlanItem {
  const source=sourceFor(review.findingIds[0]??"",reports);
  return {
    key:kind+":"+round+":"+keyFor(review.findingIds),
    round,status:kind,...source,
    findingIds:review.findingIds,acceptedFindingIds:[],
    missingEvidence:review.missingEvidence,nextCheck:review.nextCheck,
    explanation:review.rationale,
  };
}
/** Current chapter only, plus explicit historical rounds from its own cycle.
 * A stale current judgment is shown as requiring recheck, never "approved".
 * Prior rounds are purely archival even if their quoted text still matches.
 * Bounded presentation; absence from the output does not prove resolution. */
export function buildEditorialVerificationPlan(
  book:BookProject,cycle:ChapterEditorialCycle,chapter:Chapter,
):EditorialVerificationPlan {
  const counts:Record<VerificationPlanStatus,number>={
    awaiting_judge:0,needs_evidence:0,approved_edit:0,
    closed_no_edit:0,requires_recheck:0,archived:0,
  };
  if(cycle.chapterId!==chapter.id)return {
    method:"local_editorial_disagreement_plan_v1",items:[],
    totalItemCount:0,omittedItemCount:0,unreviewableFindingCount:0,
    omittedGroupCount:0,oversizedGroupCount:0,counts,
  };
  const report=buildEditorialRecommendationDisagreements(cycle,chapter);
  const safeJudgment=judgmentIsCurrent(book,cycle,chapter);
  const liveKeys=new Set(report.groups.map(g=>keyFor(g.findingIds)));
  const items:VerificationPlanItem[]=report.groups.map(group=>
    currentGroupItem(group,cycle.round,cycle.judgment,safeJudgment));
  // A saved reconciliation whose source changed must still be visible in
  // the private audit, but NEVER described as a currently actionable edit.
  for(const review of cycle.judgment?.recommendationReconciliations??[]){
    if(!liveKeys.has(keyFor(review.findingIds)))
      items.push(pastEntry(cycle.round,cycle.reports,review,"requires_recheck"));
  }
  // A prior round's suggestions are historical: they may have been repaired.
  // They cannot authorize work in this round even if textual anchors match.
  const oldRounds:EditorialRound[]=cycle.priorRounds??[];
  for(const round of oldRounds){
    for(const review of round.judgment.recommendationReconciliations??[])
      items.push(pastEntry(round.round,round.reports,review,"archived"));
  }
  const rank:Record<VerificationPlanStatus,number>={
    needs_evidence:0,awaiting_judge:1,requires_recheck:2,
    approved_edit:3,closed_no_edit:4,archived:5,
  };
  items.sort((a,b)=>rank[a.status]-rank[b.status] ||
    b.round-a.round || (a.segmentIndex??-1)-(b.segmentIndex??-1) ||
    a.key.localeCompare(b.key));
  for(const item of items)counts[item.status]++;
  return {
    method:"local_editorial_disagreement_plan_v1",
    items:items.slice(0,MAX_VERIFICATION_PLAN_ITEMS),
    totalItemCount:items.length,
    omittedItemCount:Math.max(0,items.length-MAX_VERIFICATION_PLAN_ITEMS),
    unreviewableFindingCount:report.unreviewableFindingIds.length,
    omittedGroupCount:report.omittedGroupCount,
    oversizedGroupCount:report.oversizedGroupCount,counts,
  };
}
