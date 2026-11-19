import type { BookProject } from "./types";
import { buildNarrativeEventLedger, type CurrentEventLedgerEntry } from "./narrative-event-ledger";

/** A revocable, local author interpretation. NEVER a canonical character identity. */
export interface NarrativeAliasDecision {
  id: string;
  firstName: string;
  secondName: string;
  firstEventDecisionId: string;
  secondEventDecisionId: string;
  verdict: "linked" | "separated";
  rationale: string;
  decidedAt: string;
}

export interface CurrentAliasDecision {
  decision: NarrativeAliasDecision;
  first: CurrentEventLedgerEntry;
  second: CurrentEventLedgerEntry;
}

export interface NarrativeAliasRegistry {
  linked: CurrentAliasDecision[];
  separated: CurrentAliasDecision[];
  /** Includes superseded and stale decisions. The audit itself is never deleted. */
  nonCurrentCount: number;
}

export const MAX_ALIAS_DECISIONS = 120;

function normalize(name: string): string {
  return name.trim().normalize("NFC").toLocaleLowerCase("it");
}

function pairKey(first: string, second: string): string {
  return [normalize(first), normalize(second)].sort().join("\u0000");
}

function matchingEntries(book: BookProject, first: string, second: string): {
  first?: CurrentEventLedgerEntry; second?: CurrentEventLedgerEntry;
} {
  const entries = buildNarrativeEventLedger(book).currentAffirmed;
  return {
    first: entries.find(e => normalize(e.candidate.actor) === normalize(first)),
    second: entries.find(e => normalize(e.candidate.actor) === normalize(second)),
  };
}

/** Never attach an alias to merely typed names or rejected/stale event witnesses. */
export function createNarrativeAliasDecision(
  book: BookProject, firstName: string, secondName: string,
  verdict: NarrativeAliasDecision["verdict"], rationale: string,
  id: string, decidedAt: string,
): NarrativeAliasDecision {
  if (verdict !== "linked" && verdict !== "separated")
    throw new Error("Decisione sull'alias non valida.");
  const first = firstName.trim(), second = secondName.trim();
  if (!first || !second || first.length > 60 || second.length > 60 ||
      normalize(first) === normalize(second))
    throw new Error("Seleziona due nomi letterali distinti.");
  const note = rationale.trim();
  if (note.length < 12 || note.length > 500)
    throw new Error("Motiva l'alias con 12–500 caratteri.");
  if ((book.narrativeAliasDecisions?.length ?? 0) >= MAX_ALIAS_DECISIONS)
    throw new Error("Raggiunto il limite di 120 decisioni alias: esporta un backup.");
  const witnesses = matchingEntries(book, first, second);
  if (!witnesses.first || !witnesses.second)
    throw new Error("Uno dei nomi non ha più attestazioni correnti: ricarica il registro.");
  return {
    id, firstName: witnesses.first.candidate.actor,
    secondName: witnesses.second.candidate.actor,
    firstEventDecisionId: witnesses.first.decision.id,
    secondEventDecisionId: witnesses.second.decision.id,
    verdict, rationale: note, decidedAt,
  };
}

/** Last recorded decision per unordered name pair wins, even when stale:
 * outdated approvals MUST NOT reappear after an unlinked or stale revision. */
export function buildNarrativeAliasRegistry(book: BookProject): NarrativeAliasRegistry {
  const decisions = book.narrativeAliasDecisions ?? [];
  const latest = new Map<string, NarrativeAliasDecision>();
  for (const decision of decisions) {
    const key = pairKey(decision.firstName, decision.secondName);
    latest.set(key, decision);
  }
  const current = buildNarrativeEventLedger(book).currentAffirmed;
  const byId = new Map(current.map(entry => [entry.decision.id, entry]));
  const linked: CurrentAliasDecision[] = [];
  const separated: CurrentAliasDecision[] = [];
  for (const decision of latest.values()) {
    const first = byId.get(decision.firstEventDecisionId);
    const second = byId.get(decision.secondEventDecisionId);
    if (!first || !second || normalize(first.candidate.actor) !== normalize(decision.firstName) ||
      normalize(second.candidate.actor) !== normalize(decision.secondName) ||
      normalize(decision.firstName) === normalize(decision.secondName)) continue;
    if (decision.verdict === "linked") linked.push({decision,first,second});
    else if (decision.verdict === "separated") separated.push({decision,first,second});
  }
  const order = (a: CurrentAliasDecision, b: CurrentAliasDecision) =>
    a.decision.firstName.localeCompare(b.decision.firstName,"it") ||
    a.decision.secondName.localeCompare(b.decision.secondName,"it");
  linked.sort(order); separated.sort(order);
  return {linked,separated,nonCurrentCount:decisions.length-linked.length-separated.length};
}
