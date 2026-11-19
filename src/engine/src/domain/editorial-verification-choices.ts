import type {BookProject} from "./types";
import {
  buildEditorialVerificationPlan,findFrozenEditorialVerificationCheck,
  type VerificationPlanItem,
} from "./editorial-verification-plan";

export const MAX_EDITORIAL_VERIFICATION_CHOICES=160;
export type EditorialVerificationChoiceStatus="taken_on"|"dismissed"|"reset";

/** An author's private note about an ALREADY suggested check.
 * No status is an approval to run a task, repair prose or share data with AI. */
export interface EditorialVerificationChoice {
  id:string;
  chapterId:string;
  planKey:string;
  round:number;
  quote:string;
  missingEvidence:string;
  nextCheck:string;
  judgeExplanation:string;
  status:EditorialVerificationChoiceStatus;
  rationale:string;
  decidedAt:string;
}

export function verificationSourceMatches(
  choice:EditorialVerificationChoice,
  chapterId:string,item:VerificationPlanItem,
):boolean {
  return choice.chapterId===chapterId &&
    choice.planKey===item.key &&choice.round===item.round &&
    choice.quote===item.quote &&
    choice.missingEvidence===item.missingEvidence &&
    choice.nextCheck===item.nextCheck &&
    choice.judgeExplanation===item.explanation;
}
/** Last entry for the same chapter + exact plan group wins, including reset
 * or a record whose source snapshot is stale. It may not resurrect a prior
 * choice merely because a later entry refers to a changed judge conclusion. */
export function currentEditorialVerificationChoice(
  book:BookProject,chapterId:string,item:VerificationPlanItem,
):EditorialVerificationChoice|null {
  if(item.status!=="needs_evidence")return null;
  const history=book.editorialVerificationChoices??[];
  const latest=[...history].reverse().find(x=>
    x.chapterId===chapterId&&x.planKey===item.key);
  if(!latest||latest.status==="reset"||
    !verificationSourceMatches(latest,chapterId,item))return null;
  return latest;
}
/** Validate on the live book, never trusting a user-supplied checklist,
 * a prior round, an imported choice or an old finding ID. */
export function createEditorialVerificationChoice(
  book:BookProject,chapterId:string,planKey:string,
  status:EditorialVerificationChoiceStatus,rationale:string,
  id:string,decidedAt:string,
):EditorialVerificationChoice {
  if(!(["taken_on","dismissed","reset"] as string[]).includes(status))
    throw new Error("Scelta sul controllo editoriale non valida.");
  const note=rationale.trim();
  if(note.length<20||note.length>500)
    throw new Error("Motiva la scelta con 20–500 caratteri.");
  if(!id||id.length>300||!Number.isFinite(Date.parse(decidedAt)))
    throw new Error("Identificativo o data della scelta non validi.");
  if((book.editorialVerificationChoices?.length??0)>=MAX_EDITORIAL_VERIFICATION_CHOICES)
    throw new Error("Limite di 160 scelte raggiunto: esporta un backup.");
  const cycle=book.editorialCycle;
  const chapter=book.chapters.find(ch=>ch.id===chapterId);
  if(!cycle||!chapter||cycle.chapterId!==chapterId)
    throw new Error("Il ciclo editoriale corrente non corrisponde al capitolo.");
  const plan=buildEditorialVerificationPlan(book,cycle,chapter);
  const item=plan.items.find(x=>x.key===planKey &&
    x.status==="needs_evidence"&&x.round===cycle.round);
  if(!item||!item.missingEvidence||!item.nextCheck||!item.explanation)
    throw new Error("La verifica è storica, omessa o non più corrente.");
  if(status==="reset"&&!currentEditorialVerificationChoice(book,chapterId,item))
    throw new Error("Nessuna scelta corrente da azzerare.");
  return {id,chapterId,planKey:item.key,round:item.round,
    quote:item.quote,missingEvidence:item.missingEvidence,
    nextCheck:item.nextCheck,judgeExplanation:item.explanation,
    status,rationale:note,decidedAt};
}

/** Archived suggestions are NOT live findings. A note is allowed only on a
 * frozen chapter's exact, structurally coherent, unresolved historical
 * reconciliation. It never approves a repair or marks the check completed. */
export function currentArchivedEditorialVerificationChoice(
  book:BookProject,chapterId:string,item:VerificationPlanItem,
):EditorialVerificationChoice|null {
  if(item.status!=="archived"||!item.historicalCheckEligible)return null;
  const exact=findFrozenEditorialVerificationCheck(book,chapterId,item.key);
  if(!exact||!verificationSourceMatches({
    id:"",chapterId,planKey:item.key,round:item.round,
    quote:item.quote,missingEvidence:item.missingEvidence??"",
    nextCheck:item.nextCheck??"",judgeExplanation:item.explanation??"",
    status:"reset",rationale:"",decidedAt:"",
  },chapterId,exact))return null;
  const latest=[...(book.editorialVerificationChoices??[])].reverse().find(x=>
    x.chapterId===chapterId&&x.planKey===item.key);
  if(!latest||latest.status==="reset"||
    !verificationSourceMatches(latest,chapterId,exact))return null;
  return latest;
}

/** Separate validation path for archival notes, never reused for a current
 * needs_evidence approval or a chapter editorial lifecycle transition. */
export function createArchivedEditorialVerificationChoice(
  book:BookProject,chapterId:string,planKey:string,
  status:EditorialVerificationChoiceStatus,rationale:string,
  id:string,decidedAt:string,
):EditorialVerificationChoice {
  if(!(["taken_on","dismissed","reset"] as string[]).includes(status))
    throw new Error("Scelta storica sul controllo non valida.");
  const note=rationale.trim();
  if(note.length<20||note.length>500)
    throw new Error("Motiva la scelta storica con 20–500 caratteri.");
  if(!id||id.length>300||!Number.isFinite(Date.parse(decidedAt)))
    throw new Error("Identificativo o data della scelta storica non validi.");
  if((book.editorialVerificationChoices?.length??0)>=MAX_EDITORIAL_VERIFICATION_CHOICES)
    throw new Error("Limite di 160 scelte raggiunto: esporta un backup.");
  const item=findFrozenEditorialVerificationCheck(book,chapterId,planKey);
  if(!item)throw new Error("Controllo storico non trovato, non coerente o fuori campione.");
  if(status==="reset"&&!currentArchivedEditorialVerificationChoice(book,chapterId,item))
    throw new Error("Nessuna scelta storica corrente da azzerare.");
  return {
    id,chapterId,planKey:item.key,round:item.round,
    quote:item.quote,missingEvidence:item.missingEvidence!,
    nextCheck:item.nextCheck!,judgeExplanation:item.explanation!,
    status,rationale:note,decidedAt,
  };
}
