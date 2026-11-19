import type {BookProject,Chapter} from "./types";
import type {
  ChapterEditorialCycle,EditorialReport,EditorialRound,
} from "./editorial-board";
import {buildEditorialRecommendationDisagreements}
  from "./editorial-board";
import {
  archivedSuggestionIsCoherent,buildEditorialVerificationPlan,
  type VerificationPlanStatus,
} from "./editorial-verification-plan";

/** A bounded, ephemeral view over literal witnesses, never an inferred
 * narrative issue identity, fix-completion flag, author grant or AI context. */
export const MAX_EDITORIAL_LEDGER_CANDIDATES=240;
export const MAX_EDITORIAL_LEDGER_THREADS=12;
export const MAX_EDITORIAL_LEDGER_OBSERVATIONS=8;
export type EditorialLedgerProvenance=
  "archived_structural"|"archived_unverifiable"|
  "current_validated"|"current_unvalidated"|"current_awaiting_judge";
export type EditorialLedgerSource="archive"|"prior_round"|"current";
/** Consultative filters over bounded observations, never editorial verdicts. */
export type EditorialLedgerFocus=
  "all"|"ambiguous"|"moved"|"reworded"|"unobserved"|"unverifiable";
export type EditorialLedgerTextChange=
  "first_literal_witness"|"same_literal_position"|"moved_literal_position"|
  "source_not_comparable"|"ambiguous_literal_witness";
export type EditorialLedgerCheckChange=
  "first_suggestion"|"same_suggestion_words"|"different_suggestion_words"|
  "new_judge_not_available"|"not_comparable";

export interface EditorialLedgerObservation {
  key:string;
  /** Oldest to newest in recorded archive/round order; round numbers can repeat. */
  order:number;
  source:EditorialLedgerSource;
  sourceIndex:number;
  round:number;
  sceneId:string;
  category:string;
  quote:string;
  segmentIndex:number|null;
  offset:number|null;
  provenance:EditorialLedgerProvenance;
  /** Only a current, fully validated judgment may have this status. */
  currentStatus?:VerificationPlanStatus;
  missingEvidence?:string;
  nextCheck?:string;
  textChange:EditorialLedgerTextChange;
  checkChange:EditorialLedgerCheckChange;
}
export interface EditorialLedgerThread {
  key:string;
  sceneId:string;
  category:string;
  quote:string;
  /** Same text is a candidate for human comparison, NOT the same concern. */
  literalOnly:true;
  ambiguousOccurrences:boolean;
  observedInCurrentSample:boolean;
  totalObservations:number;
  omittedObservations:number;
  observations:EditorialLedgerObservation[];
}
export interface EditorialDiffLedger {
  method:"local_editorial_diff_ledger_v1";
  chapterId:string;
  /** Filters apply before the 12 visible threads, after the 240-witness cap. */
  focus:EditorialLedgerFocus;
  threads:EditorialLedgerThread[];
  totalThreads:number;
  matchingThreads:number;
  filteredOutThreads:number;
  omittedThreads:number;
  /** Counters include all raw old unresolved reconciliations, even invalid. */
  totalHistoricalUnresolved:number;
  omittedCandidateObservations:number;
  currentReportCount:number;
  currentGroupsCompared:number;
  currentUnreviewableFindingCount:number;
  currentOmittedGroupCount:number;
  currentOversizedGroupCount:number;
  hasCurrentReview:boolean;
}
interface Candidate extends Omit<EditorialLedgerObservation,
  "textChange"|"checkChange">{
  fingerprint:string;
  sourceIdentity:string;
}
function keyFor(ids:string[]):string {return JSON.stringify([...ids].sort());}
function firstWitness(reports:EditorialReport[],id:string){
  const candidates=reports.flatMap(report=>report.findings
    .filter(finding=>finding.id===id).map(finding=>({
      finding,segmentIndex:report.segmentIndex,
    })));
  return candidates.length===1?candidates[0]:undefined;
}
function fingerprintOf(sceneId:string,category:string,quote:string):string {
  return JSON.stringify([sceneId,category.trim().toLocaleLowerCase("it"),
    quote.normalize("NFC")]);
}
function historicalCandidate(
  round:EditorialRound,kind:"archive"|"prior_round",
  sourceIndex:number,reviewIndex:number,
):Candidate|null {
  const review=round.judgment.recommendationReconciliations?.[reviewIndex];
  if(!review||review.evidenceAssessment!=="unresolved")return null;
  const witness=firstWitness(round.reports,review.findingIds[0]??"");
  const anchor=witness?.finding.evidenceAnchor;
  const coherent=archivedSuggestionIsCoherent(round,review)&&
    !!anchor&&anchor.quote.length<=250;
  const sceneId=witness?.finding.sceneId??"";
  const category=witness?.finding.category??"";
  const quote=(anchor?.quote??witness?.finding.evidence??"").slice(0,250);
  return {
    key:kind+":"+sourceIndex+":"+reviewIndex+":"+round.round+":"+
      round.judgment.createdAt+":"+keyFor(review.findingIds),
    order:0,source:kind,sourceIndex,round:round.round,
    sceneId,category,quote,
    segmentIndex:coherent?anchor!.segmentIndex:null,
    offset:coherent?anchor!.offset:null,
    provenance:coherent?"archived_structural":"archived_unverifiable",
    ...(coherent?{
      missingEvidence:review.missingEvidence,nextCheck:review.nextCheck,
    }:{}),
    fingerprint:coherent?fingerprintOf(sceneId,category,quote):
      "unverifiable:"+kind+":"+sourceIndex+":"+reviewIndex,
    sourceIdentity:kind+":"+sourceIndex,
  };
}
function currentCandidates(
  book:BookProject,chapter:Chapter,cycle:ChapterEditorialCycle,
):{candidates:Candidate[],report:ReturnType<typeof buildEditorialRecommendationDisagreements>}{
  const report=buildEditorialRecommendationDisagreements(cycle,chapter);
  const plan=buildEditorialVerificationPlan(book,cycle,chapter);
  return {
    candidates:report.groups.map((group,i)=>{
      const witness=firstWitness(cycle.reports,group.findingIds[0]??"");
      const anchor=witness?.finding.evidenceAnchor;
      const item=plan.items.find(x=>
        x.key==="current:"+cycle.round+":"+keyFor(group.findingIds)&&
        x.status!=="archived");
      const validated=!!item&&item.status!=="requires_recheck"&&
        item.status!=="awaiting_judge";
      return {
        key:"current:"+cycle.round+":"+i+":"+keyFor(group.findingIds),
        order:0,source:"current" as const,sourceIndex:0,round:cycle.round,
        sceneId:group.sceneId,category:group.category,
        quote:group.quote.slice(0,250),
        segmentIndex:anchor?.segmentIndex??null,
        offset:anchor?.offset??null,
        fingerprint:fingerprintOf(group.sceneId,group.category,group.quote),
        sourceIdentity:"current",
        provenance:!item||item.status==="requires_recheck"
          ?"current_unvalidated" as const:
          validated?"current_validated" as const:"current_awaiting_judge" as const,
        ...(validated?{
          currentStatus:item.status,
          ...(item.missingEvidence?{missingEvidence:item.missingEvidence}:{}),
          ...(item.nextCheck?{nextCheck:item.nextCheck}:{}),
        }:{}),
      };
    }),report,
  };
}
/** Archive order is retained, then prior rounds of the active cycle, then
 * current. A repeat of the same quote in one source is ambiguous, not an
 * automatic link. A missing current candidate is never marked "resolved".
 * No entries from author notes are consulted or passed to any AI. */
export function buildEditorialDiffLedger(
  book:BookProject,chapter:Chapter,focus:EditorialLedgerFocus="all",
):EditorialDiffLedger {
  const current=book.editorialCycle?.chapterId===chapter.id&&
    !chapter.frozenAt?book.editorialCycle:undefined;
  const empty:EditorialDiffLedger={
    method:"local_editorial_diff_ledger_v1",chapterId:chapter.id,focus,
    threads:[],totalThreads:0,matchingThreads:0,filteredOutThreads:0,
    omittedThreads:0,
    totalHistoricalUnresolved:0,omittedCandidateObservations:0,
    currentReportCount:current?.reports.length??0,
    currentGroupsCompared:0,currentUnreviewableFindingCount:0,
    currentOmittedGroupCount:0,currentOversizedGroupCount:0,
    hasCurrentReview:!!current,
  };
  // Accept only chapter data belonging to this book. No cross-chapter lookup.
  if(!book.chapters.some(x=>x===chapter))return empty;
  const history:Candidate[]=[];
  let totalHistoricalUnresolved=0;
  const archives=chapter.editorialRounds??[];
  function addHistory(round:EditorialRound,kind:"archive"|"prior_round",index:number){
    for(let i=0;i<(round.judgment.recommendationReconciliations?.length??0);i++){
      const item=historicalCandidate(round,kind,index,i);
      if(!item)continue;
      totalHistoricalUnresolved++;
      history.push(item);
    }
  }
  for(const [i,round] of archives.entries())addHistory(round,"archive",i);
  for(const [i,round] of (current?.priorRounds??[]).entries())
    addHistory(round,"prior_round",i);
  const {candidates:active,report}=current?
    currentCandidates(book,chapter,current):
    {candidates:[] as Candidate[],report:null};
  const totalCandidates=history.length+active.length;
  // Retain the newest bounded candidates, including currently sampled ones.
  const selected=[...history,...active].slice(-MAX_EDITORIAL_LEDGER_CANDIDATES);
  const groups=new Map<string,Candidate[]>();
  selected.forEach((candidate,i)=>{
    candidate.order=totalCandidates-selected.length+i;
    const entries=groups.get(candidate.fingerprint)??[];
    entries.push(candidate);groups.set(candidate.fingerprint,entries);
  });
  const threads=[...groups.entries()].map(([key,observations])=>{
    const latest=observations[observations.length-1]!;
    const sourceCounts=new Map<string,number>();
    for(const obs of observations)sourceCounts.set(obs.sourceIdentity,
      (sourceCounts.get(obs.sourceIdentity)??0)+1);
    const ambiguity=observations.some(obs=>
      (sourceCounts.get(obs.sourceIdentity)??0)>1);
    const expanded:EditorialLedgerObservation[]=observations.map((obs,i)=>{
      const previous=observations[i-1];
      const unverifiable=obs.provenance==="archived_unverifiable"||
        obs.provenance==="current_unvalidated";
      const textChange:EditorialLedgerTextChange=
        ambiguity?"ambiguous_literal_witness":
        unverifiable?"source_not_comparable":
        !previous?"first_literal_witness":
        previous.segmentIndex===obs.segmentIndex&&previous.offset===obs.offset
          ?"same_literal_position":"moved_literal_position";
      const checkChange:EditorialLedgerCheckChange=
        ambiguity||unverifiable?"not_comparable":
        !previous?"first_suggestion":
        !obs.nextCheck||!previous.nextCheck?"new_judge_not_available":
        obs.nextCheck===previous.nextCheck&&
          obs.missingEvidence===previous.missingEvidence
          ?"same_suggestion_words":"different_suggestion_words";
      // Do not return internal fingerprint/source identity or a live grant.
      return {
        key:obs.key,order:obs.order,source:obs.source,
        sourceIndex:obs.sourceIndex,round:obs.round,sceneId:obs.sceneId,
        category:obs.category,quote:obs.quote,segmentIndex:obs.segmentIndex,
        offset:obs.offset,provenance:obs.provenance,
        ...(obs.currentStatus?{currentStatus:obs.currentStatus}:{}),
        ...(obs.missingEvidence?{missingEvidence:obs.missingEvidence}:{}),
        ...(obs.nextCheck?{nextCheck:obs.nextCheck}:{}),
        textChange,checkChange,
      };
    });
    return {
      key,sceneId:latest.sceneId,category:latest.category,quote:latest.quote,
      literalOnly:true as const,ambiguousOccurrences:ambiguity,
      observedInCurrentSample:observations.some(x=>x.source==="current"),
      totalObservations:expanded.length,
      omittedObservations:Math.max(0,expanded.length-
        MAX_EDITORIAL_LEDGER_OBSERVATIONS),
      observations:expanded.slice(-MAX_EDITORIAL_LEDGER_OBSERVATIONS),
      // Compute focus flags BEFORE trimming the 8 visible observations.
      hasMoved:expanded.some(x=>x.textChange==="moved_literal_position"),
      hasReworded:expanded.some(x=>x.checkChange==="different_suggestion_words"),
      hasUnverifiable:expanded.some(x=>
        x.provenance==="archived_unverifiable"||
        x.provenance==="current_unvalidated"),
      latestOrder:latest.order,
    };
  }).sort((a,b)=>b.latestOrder-a.latestOrder||a.key.localeCompare(b.key));
  // Focus cannot resurrect witnesses outside the 240-candidate window, but it
  // can reveal older matching threads hidden by the default 12-thread display.
  const matching=threads.filter(thread=>{
    switch(focus){
      case "all":return true;
      case "ambiguous":return thread.ambiguousOccurrences;
      case "moved":return thread.hasMoved;
      case "reworded":return thread.hasReworded;
      case "unobserved":return !!current&&!thread.observedInCurrentSample;
      case "unverifiable":return thread.hasUnverifiable;
    }
  });
  return {
    ...empty,
    threads:matching.slice(0,MAX_EDITORIAL_LEDGER_THREADS).map(
      ({latestOrder:_latestOrder,hasMoved:_moved,hasReworded:_reworded,
        hasUnverifiable:_unverifiable,...thread})=>thread),
    totalThreads:threads.length,
    matchingThreads:matching.length,
    filteredOutThreads:threads.length-matching.length,
    omittedThreads:Math.max(0,matching.length-MAX_EDITORIAL_LEDGER_THREADS),
    totalHistoricalUnresolved,
    omittedCandidateObservations:Math.max(0,totalCandidates-selected.length),
    currentGroupsCompared:report?.groups.length??0,
    currentUnreviewableFindingCount:report?.unreviewableFindingIds.length??0,
    currentOmittedGroupCount:report?.omittedGroupCount??0,
    currentOversizedGroupCount:report?.oversizedGroupCount??0,
  };
}
