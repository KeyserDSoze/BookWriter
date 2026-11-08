import type {BookProject,Chapter} from "./types";
import {
  buildEditorialRecommendationDisagreements,
  validateJudgment,
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
  /** Historical-only, structural inspection: NOT a live proof or repair permission. */
  historicalCheckEligible?:boolean;
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

/** The frozen chapter carries its OWN immutable-looking editorial archive.
 * We never consult the current prose to make an old check "current".
 * All entries are explicitly historical, even when their quote still occurs.
 * Archive index and freeze stamp prevent repeated round/finding IDs from
 * aliasing after re-freeze or another editorial review. */
function frozenArchiveKey(chapter:Chapter,round:EditorialRound,
  archiveIndex:number,reviewIndex:number,ids:string[]):string {
  return "frozen:"+chapter.frozenAt+":"+archiveIndex+":"+reviewIndex+":"+
    round.round+":"+round.judgment.createdAt+":"+keyFor(ids);
}

/** Check only that the frozen, recorded witness and judge recommendation
 * structurally agree. This does NOT authenticate an archive, check prose
 * freshness, approve remediation or establish that the criticism is true. */
function archivedSuggestionIsCoherent(
  round:EditorialRound,
  review:NonNullable<EditorialJudgment["recommendationReconciliations"]>[number],
):boolean {
  if(review.evidenceAssessment!=="unresolved"||
     review.resolution!=="reject_all"||
     review.findingIds.length<2||review.findingIds.length>12||
     new Set(review.findingIds).size!==review.findingIds.length)return false;
  const all=round.reports.flatMap(report=>
    report.findings.map(finding=>({role:report.role,finding,
      reportSegmentIndex:report.segmentIndex})));
  const selected=review.findingIds.map(id=>all.filter(x=>x.finding.id===id));
  if(selected.some(matches=>matches.length!==1))return false;
  const witnesses=selected.map(x=>x[0]!);
  const first=witnesses[0]!;
  const anchor=first.finding.evidenceAnchor;
  if(!anchor||!anchor.quote||!first.finding.evidence ||
    anchor.quote!==first.finding.evidence)return false;
  const signature=JSON.stringify([
    first.finding.sceneId,anchor.segmentIndex,anchor.offset,
    anchor.quote.normalize("NFC"),
    first.finding.category.trim().toLocaleLowerCase("it"),
  ]);
  if(witnesses.some(({finding,reportSegmentIndex})=>{
    const a=finding.evidenceAnchor;
    return !a||!a.quote||a.quote!==finding.evidence ||
      reportSegmentIndex!==a.segmentIndex||
      JSON.stringify([finding.sceneId,a.segmentIndex,a.offset,
        a.quote.normalize("NFC"),finding.category.trim().toLocaleLowerCase("it")])
        !==signature;
  }))return false;
  if(new Set(witnesses.map(x=>x.role)).size<2||
    new Set(witnesses.map(x=>x.finding.remediation.trim()
      .replace(/\s+/gu," ").toLocaleLowerCase("it"))).size<2)return false;
  return review.findingIds.every(id=>{
    const decisions=round.judgment.decisions.filter(x=>x.findingId===id);
    return decisions.length===1&&decisions[0]!.action==="reject";
  });
}

/** Bounded, display-only source for a chapter that is CURRENTLY frozen.
 * Round numbers may repeat on reopen, so use archive ARRAY indexes too.
 * Only unresolved, structurally coherent old checks get an author-note
 * affordance; even those remain status=archived, never needs_evidence. */
export function buildFrozenEditorialVerificationPlan(
  book:BookProject,chapter:Chapter,
):EditorialVerificationPlan {
  const counts:Record<VerificationPlanStatus,number>={
    awaiting_judge:0,needs_evidence:0,approved_edit:0,
    closed_no_edit:0,requires_recheck:0,archived:0,
  };
  const empty:EditorialVerificationPlan={
    method:"local_editorial_disagreement_plan_v1",items:[],
    totalItemCount:0,omittedItemCount:0,unreviewableFindingCount:0,
    omittedGroupCount:0,oversizedGroupCount:0,counts,
  };
  if(!chapter.frozenAt||!book.chapters.some(ch=>
    ch.id===chapter.id&&ch.frozenAt===chapter.frozenAt))return empty;
  const entries:VerificationPlanItem[]=[];
  for(const [archiveIndex,round] of (chapter.editorialRounds??[]).entries()){
    for(const [reviewIndex,review] of
      (round.judgment.recommendationReconciliations??[]).entries()){
      const item=pastEntry(round.round,round.reports,review,"archived");
      item.key=frozenArchiveKey(chapter,round,archiveIndex,reviewIndex,
        review.findingIds);
      item.historicalCheckEligible=
        archivedSuggestionIsCoherent(round,review)&&
        item.quote.length>0&&item.quote.length<=250;
      entries.push(item);
    }
  }
  // Most recent archive first; within an archive, stable original order.
  entries.reverse();
  counts.archived=entries.length;
  return {...empty,items:entries.slice(0,MAX_VERIFICATION_PLAN_ITEMS),
    totalItemCount:entries.length,
    omittedItemCount:Math.max(0,entries.length-MAX_VERIFICATION_PLAN_ITEMS)};
}

/** Resolve from current saved chapter data, never trust the supplied key
 * or an old UI item. This does NOT grant a current editorial authorization. */
export function findFrozenEditorialVerificationCheck(
  book:BookProject,chapterId:string,planKey:string,
):VerificationPlanItem|undefined {
  const chapter=book.chapters.find(x=>x.id===chapterId);
  if(!chapter?.frozenAt)return;
  const plan=buildFrozenEditorialVerificationPlan(book,chapter);
  return plan.items.find(item=>item.key===planKey&&
    item.status==="archived"&&item.historicalCheckEligible===true&&
    !!item.quote&&!!item.missingEvidence&&!!item.nextCheck&&!!item.explanation);
}
