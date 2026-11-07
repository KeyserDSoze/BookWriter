import type { BookProject } from "./types";
import { buildNarrativeEventLedger, type CurrentEventLedgerEntry }
  from "./narrative-event-ledger";

/** Local author interpretation of ONE previously affirmed knowledge mention.
 * Not an authenticated fact, a universal knowledge graph or an AI instruction. */
export interface NarrativeKnowledgeDecision {
  id: string;
  sourceEventDecisionId: string;
  actorName: string;
  verdict: "learned_directly" | "reported_by_other" | "still_secret";
  rationale: string;
  decidedAt: string;
}
export interface CurrentKnowledgeDecision {
  decision: NarrativeKnowledgeDecision;
  source: CurrentEventLedgerEntry;
}
export interface NarrativeKnowledgeRegistry {
  current: CurrentKnowledgeDecision[];
  learnedDirectly: CurrentKnowledgeDecision[];
  reportedByOther: CurrentKnowledgeDecision[];
  stillSecret: CurrentKnowledgeDecision[];
  /** Earlier, superseded, rejected and stale records remain in the audit. */
  nonCurrentCount: number;
}
export const MAX_KNOWLEDGE_DECISIONS = 160;

function normalized(name:string):string {
  return name.trim().normalize("NFC").toLocaleLowerCase("it");
}

/** An author must first affirm the exact, current frozen textual mention.
 * This new interpretation never writes into canonical memory or secrets. */
export function createNarrativeKnowledgeDecision(
  book:BookProject, sourceEventDecisionId:string,
  verdict:NarrativeKnowledgeDecision["verdict"], rationale:string,
  id:string, decidedAt:string,
):NarrativeKnowledgeDecision {
  if (!["learned_directly","reported_by_other","still_secret"].includes(verdict))
    throw new Error("Stato della conoscenza non valido.");
  const note=rationale.trim();
  if (note.length<12 || note.length>500)
    throw new Error("Motiva la conoscenza con 12–500 caratteri.");
  if ((book.narrativeKnowledgeDecisions?.length??0)>=MAX_KNOWLEDGE_DECISIONS)
    throw new Error("Raggiunto il limite di 160 decisioni sulle conoscenze: esporta un backup.");
  const source=buildNarrativeEventLedger(book).currentAffirmed.find(entry=>
    entry.decision.id===sourceEventDecisionId &&
    entry.candidate.kind==="knowledge_mention");
  if (!source)
    throw new Error("La menzione di conoscenza non è più attestata o congelata: aggiorna il registro.");
  const actor=source.candidate.actor.trim();
  if (!actor || actor.length>60)
    throw new Error("Il nome del personaggio non è valido.");
  if (!id || id.length>300 || !Number.isFinite(Date.parse(decidedAt)))
    throw new Error("Identificativo o data della decisione non validi.");
  return {id,sourceEventDecisionId,actorName:actor,
    verdict,rationale:note,decidedAt};
}

/** The LAST decision for each exact source ID wins even when it becomes stale.
 * A later source attestation has a different ID and must be explicitly
 * classified anew; old assertions are never resurrected as current. */
export function buildNarrativeKnowledgeRegistry(book:BookProject):NarrativeKnowledgeRegistry {
  const decisions=book.narrativeKnowledgeDecisions??[];
  const latest=new Map<string,NarrativeKnowledgeDecision>();
  for(const decision of decisions) latest.set(decision.sourceEventDecisionId,decision);
  const currentSources=new Map(buildNarrativeEventLedger(book).currentAffirmed
    .filter(entry=>entry.candidate.kind==="knowledge_mention")
    .map(entry=>[entry.decision.id,entry]));
  const current:CurrentKnowledgeDecision[]=[];
  for(const decision of latest.values()){
    const source=currentSources.get(decision.sourceEventDecisionId);
    if (!source || normalized(source.candidate.actor)!==normalized(decision.actorName) ||
      !["learned_directly","reported_by_other","still_secret"].includes(decision.verdict))
      continue;
    current.push({decision,source});
  }
  current.sort((a,b)=>a.source.candidate.chapterNumber-b.source.candidate.chapterNumber ||
    a.source.candidate.sceneNumber-b.source.candidate.sceneNumber ||
    a.source.candidate.offset-b.source.candidate.offset ||
    a.decision.id.localeCompare(b.decision.id));
  return {
    current,learnedDirectly:current.filter(x=>x.decision.verdict==="learned_directly"),
    reportedByOther:current.filter(x=>x.decision.verdict==="reported_by_other"),
    stillSecret:current.filter(x=>x.decision.verdict==="still_secret"),
    nonCurrentCount:decisions.length-current.length,
  };
}
