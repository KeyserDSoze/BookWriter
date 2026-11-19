import type {BookProject,Chapter} from "./types";
import type {
  ChapterEditorialCycle,EditorialFinding,EditorialReport,EditorialRound,
} from "./editorial-board";
import {buildEditorialRecommendationDisagreements}
  from "./editorial-board";
import {
  archivedSuggestionIsCoherent,buildEditorialVerificationPlan,
  type VerificationPlanStatus,
} from "./editorial-verification-plan";
import type {EditorialVerificationChoice} from "./editorial-verification-choices";

/** Comparison is a local textual observation, NOT a claim about a fictional
 * fact, a resolved issue, or an authorization to repair or share notes. */
export const MAX_EDITORIAL_ARCHIVE_COMPARISONS=24;
export type ArchiveLiteralRelation=
  "same_literal_anchor"|"relocated_literal_quote"|
  "ambiguous_literal_candidates"|"not_observed_in_current_sample"|
  "archive_source_unverifiable";
export type ArchiveSuggestedCheckRelation=
  "same_words"|"changed_words"|"awaiting_judge"|"not_comparable";
export type HistoricalAuthorNoteState=
  "none"|"taken_on"|"dismissed"|"reset"|"ambiguous_or_stale";

export interface EditorialArchiveComparison {
  key:string;
  archiveRound:number;
  archiveIndex:number;
  checkIndex:number;
  sceneId:string;
  category:string;
  quote:string;
  oldMissingEvidence:string;
  oldNextCheck:string;
  oldExplanation:string;
  relation:ArchiveLiteralRelation;
  suggestedCheckRelation:ArchiveSuggestedCheckRelation;
  authorNoteState:HistoricalAuthorNoteState;
  /** A matching legacy snapshot is NOT proof of its freeze provenance. */
  authorNoteRationale?:string;
  current?:{
    round:number;
    status:VerificationPlanStatus;
    sceneId:string;
    quote:string;
    missingEvidence?:string;
    nextCheck?:string;
    explanation?:string;
  };
}
export interface EditorialArchiveComparisonPlan {
  method:"local_literal_archive_comparison_v1";
  chapterId:string;
  items:EditorialArchiveComparison[];
  totalArchiveChecks:number;
  omittedArchiveChecks:number;
  currentGroupsCompared:number;
  currentUnreviewableFindingCount:number;
  currentOmittedGroupCount:number;
  currentOversizedGroupCount:number;
  /** Even if all current reports are present this is NOT semantic coverage. */
  currentReportCount:number;
}
function keyOf(ids:string[]):string {
  return JSON.stringify([...ids].sort());
}
function sourceOf(id:string,reports:EditorialReport[]):{
  finding:EditorialFinding;segmentIndex:number;
}|undefined {
  const matches=reports.flatMap(report=>
    report.findings.filter(finding=>finding.id===id).map(finding=>({
      finding,segmentIndex:report.segmentIndex,
    })));
  return matches.length===1?matches[0]:undefined;
}
function comparableCategory(category:string):string {
  return category.trim().toLocaleLowerCase("it");
}
/** Old freezeAt is intentionally cleared by reopenChapterReview. Only an
 * exact archive index + judge + finding IDs + source-text snapshot can link
 * the stored private note. If two old freeze keys fit, report ambiguity;
 * never promote any historical note to a new/current author choice. */
function historicalNote(
  book:BookProject,chapterId:string,round:EditorialRound,
  archiveIndex:number,checkIndex:number,
  quote:string,missingEvidence:string,nextCheck:string,explanation:string,
  ids:string[],
):Pick<EditorialArchiveComparison,"authorNoteState"|"authorNoteRationale"> {
  const suffix=":"+archiveIndex+":"+checkIndex+":"+round.round+":"+
    round.judgment.createdAt+":"+keyOf(ids);
  const all=(book.editorialVerificationChoices??[]).filter(choice=>{
    if(choice.chapterId!==chapterId||choice.round!==round.round||
      !choice.planKey.startsWith("frozen:")||
      !choice.planKey.endsWith(suffix))return false;
    const stamp=choice.planKey.slice("frozen:".length,-suffix.length);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(stamp)&&
      Number.isFinite(Date.parse(stamp));
  });
  if(!all.length)return {authorNoteState:"none"};
  const latest=new Map<string,EditorialVerificationChoice>();
  for(const entry of all)latest.set(entry.planKey,entry);
  if(latest.size!==1)return {authorNoteState:"ambiguous_or_stale"};
  const entry=[...latest.values()][0]!;
  if(entry.quote!==quote||entry.missingEvidence!==missingEvidence||
    entry.nextCheck!==nextCheck||entry.judgeExplanation!==explanation)
    return {authorNoteState:"ambiguous_or_stale"};
  return {
    authorNoteState:entry.status,
    ...(entry.status!=="reset"?{authorNoteRationale:entry.rationale}:{}),
  };
}
/** Reopening leaves chapter.editorialRounds in place, but clears frozenAt.
 * Only archives from that chapter are examined. A textual match is restricted
 * to exact scene ID, literal category and NFC quote; offset/segment decides
 * whether it is an exact anchor or a relocated phrase. No synonym matching.
 * Omitted/oversized new groups are NOT treated as negative evidence. */
export function compareEditorialArchiveToCurrentRevision(
  book:BookProject,chapter:Chapter,cycle:ChapterEditorialCycle,
):EditorialArchiveComparisonPlan {
  const empty:EditorialArchiveComparisonPlan={
    method:"local_literal_archive_comparison_v1",
    chapterId:chapter.id,items:[],totalArchiveChecks:0,
    omittedArchiveChecks:0,currentGroupsCompared:0,
    currentUnreviewableFindingCount:0,currentOmittedGroupCount:0,
    currentOversizedGroupCount:0,currentReportCount:0,
  };
  if(cycle.chapterId!==chapter.id||chapter.frozenAt||
    !book.chapters.some(x=>x.id===chapter.id&&x.frozenAt===undefined))
    return empty;
  const current=buildEditorialRecommendationDisagreements(cycle,chapter);
  const currentPlan=buildEditorialVerificationPlan(book,cycle,chapter);
  const nowGroups=current.groups.map(group=>{
    const witness=sourceOf(group.findingIds[0]??"",cycle.reports);
    return {
      group,
      offset:witness?.finding.evidenceAnchor?.offset,
      segmentIndex:witness?.finding.evidenceAnchor?.segmentIndex,
      item:currentPlan.items.find(item=>item.status!=="archived"&&
        item.key==="current:"+cycle.round+":"+keyOf(group.findingIds)),
    };
  });
  const entries:EditorialArchiveComparison[]=[];
  let total=0;
  for(let archiveIndex=(chapter.editorialRounds??[]).length-1;
    archiveIndex>=0;archiveIndex--){
    const round=chapter.editorialRounds![archiveIndex]!;
    const reviews=round.judgment.recommendationReconciliations??[];
    for(let checkIndex=reviews.length-1;checkIndex>=0;checkIndex--){
      const review=reviews[checkIndex]!;
      // Only historical doubts are in scope. Previously approved edits
      // remain in the complete archival review and are not re-evaluated here.
      if(review.evidenceAssessment!=="unresolved")continue;
      // Every unresolved record is represented, even if the archived anchor
      // cannot be authenticated. Never silently treat it as resolved.
      total++;
      if(entries.length>=MAX_EDITORIAL_ARCHIVE_COMPARISONS)continue;
      const witness=sourceOf(review.findingIds[0]??"",round.reports);
      const anchor=witness?.finding.evidenceAnchor;
      const coherent=archivedSuggestionIsCoherent(round,review)&&
        !!anchor&&anchor.quote.length<=250;
      const quote=(anchor?.quote??witness?.finding.evidence??"").slice(0,250);
      const sceneId=witness?.finding.sceneId??"";
      const category=witness?.finding.category??"";
      let relation:ArchiveLiteralRelation="archive_source_unverifiable";
      let checkRelation:ArchiveSuggestedCheckRelation="not_comparable";
      let matched:typeof nowGroups[number]|undefined;
      if(coherent&&anchor){
        const candidates=nowGroups.filter(x=>
          x.group.sceneId===sceneId&&
          comparableCategory(x.group.category)===comparableCategory(category)&&
          x.group.quote.normalize("NFC")===anchor.quote.normalize("NFC"));
        const exact=candidates.filter(x=>
          x.offset===anchor.offset&&x.segmentIndex===anchor.segmentIndex);
        if(exact.length===1){
          matched=exact[0]!;
          relation="same_literal_anchor";
        }else if(exact.length>1||candidates.length>1){
          relation="ambiguous_literal_candidates";
        }else if(candidates.length===1){
          matched=candidates[0]!;
          relation="relocated_literal_quote";
        }else{
          relation="not_observed_in_current_sample";
        }
        if(matched){
          const next=matched.item;
          checkRelation=!next||next.status==="requires_recheck"
            ?"not_comparable"
            :!next.nextCheck?"awaiting_judge"
            :next.nextCheck===review.nextCheck&&
                next.missingEvidence===review.missingEvidence
              ?"same_words":"changed_words";
        }
      }
      const note=coherent?historicalNote(book,chapter.id,round,
        archiveIndex,checkIndex,quote,review.missingEvidence,
        review.nextCheck,review.rationale,review.findingIds):
        {authorNoteState:"ambiguous_or_stale" as const};
      entries.push({
        key:"comparison:"+archiveIndex+":"+checkIndex+":"+round.round+":"+
          round.judgment.createdAt+":"+keyOf(review.findingIds),
        archiveRound:round.round,archiveIndex,checkIndex,
        sceneId,category,quote,
        oldMissingEvidence:review.missingEvidence,
        oldNextCheck:review.nextCheck,
        oldExplanation:review.rationale,
        relation,suggestedCheckRelation:checkRelation,...note,
        ...(matched?.item?{current:{
          round:cycle.round,status:matched.item.status,
          sceneId:matched.group.sceneId,
          quote:matched.group.quote.slice(0,250),
          ...(matched.item.missingEvidence
            ?{missingEvidence:matched.item.missingEvidence}:{}),
          ...(matched.item.nextCheck?{nextCheck:matched.item.nextCheck}:{}),
          ...(matched.item.explanation
            ?{explanation:matched.item.explanation}:{}),
        }}:{}),
      });
    }
  }
  return {
    ...empty,items:entries,totalArchiveChecks:total,
    omittedArchiveChecks:Math.max(0,total-entries.length),
    currentGroupsCompared:nowGroups.length,
    currentUnreviewableFindingCount:current.unreviewableFindingIds.length,
    currentOmittedGroupCount:current.omittedGroupCount,
    currentOversizedGroupCount:current.oversizedGroupCount,
    currentReportCount:cycle.reports.length,
  };
}
