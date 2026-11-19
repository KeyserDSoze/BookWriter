import type { BookProject, Chapter } from "./types";
import { buildNarrativeAliasRegistry } from "./narrative-alias-decisions";
import { buildNarrativeEventLedger, type CurrentEventLedgerEntry } from "./narrative-event-ledger";

export const MAX_ATTESTED_REVIEW_WITNESSES = 8;
export const MAX_ATTESTED_REVIEW_QUERY_CHARS = 20_000;

export interface AttestedReviewWitness {
  chapterId: string;
  chapterNumber: number;
  sceneId: string;
  sceneNumber: number;
  eventDecisionId: string;
  actor: string;
  kind: "knowledge_mention" | "item_transfer_mention" | "state_change_mention";
  detail: string;
  quote: string;
  offset: number;
  /** The queried name matches the recorded actor or an author-linked name. */
  matchBasis: "literal_name" | "saved_alias";
  /** Used only for author-linked pairs. Never an identity proof. */
  matchedAs?: string;
  aliasDecisionId?: string;
}

export interface AttestedReviewContext {
  method: "prior_affirmed_literal_names_v1";
  /** Exact earlier, still frozen and still attested event mentions only. */
  witnesses: AttestedReviewWitness[];
  relevantWitnessCount: number;
  omittedWitnessCount: number;
  priorAttestationCount: number;
  /** Only current, witnessed author links with both anchors strictly prior. */
  eligibleAliasPairCount: number;
}

function normalize(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("it");
}

function containsWholeName(text: string, name: string): boolean {
  if (!name || name.length > 100) return false;
  const search = normalize(text), literal = normalize(name);
  let offset = search.indexOf(literal);
  const isWord = (ch: string) => /[\p{L}\p{N}_]/u.test(ch);
  while (offset !== -1) {
    const before = offset ? search[offset-1]! : "";
    const after = search[offset+literal.length] ?? "";
    if ((!before || !isWord(before)) && (!after || !isWord(after))) return true;
    offset = search.indexOf(literal,offset+1);
  }
  return false;
}

function storyRecency(a: CurrentEventLedgerEntry,b: CurrentEventLedgerEntry): number {
  return b.candidate.chapterNumber-a.candidate.chapterNumber ||
    b.candidate.sceneNumber-a.candidate.sceneNumber ||
    b.candidate.offset-a.candidate.offset ||
    a.decision.id.localeCompare(b.decision.id);
}

/** Provenance-only context for EXISTING specialist/judge AI requests.
 * It never creates findings, merges identities, sends author rationales/secrets,
 * reads future chapters, or modifies the book. An attestation is NOT a fact. */
export function buildAttestedReviewContext(
  book: BookProject, chapter: Chapter, currentText: string,
): AttestedReviewContext {
  const ledger = buildNarrativeEventLedger(book);
  const previous = ledger.currentAffirmed.filter(entry =>
    entry.candidate.chapterNumber < chapter.number &&
    entry.candidate.chapterId !== chapter.id);
  const query = currentText.slice(0,MAX_ATTESTED_REVIEW_QUERY_CHARS);
  const named = new Set<string>();
  const priorNames = new Set(previous.map(entry => normalize(entry.candidate.actor)));
  const aliases = buildNarrativeAliasRegistry(book).linked.filter(link =>
    link.first.candidate.chapterNumber < chapter.number &&
    link.second.candidate.chapterNumber < chapter.number &&
    link.first.candidate.chapterId !== chapter.id &&
    link.second.candidate.chapterId !== chapter.id);
  // A name can be matched directly or as one half of an explicit, still
  // current pair whose two source attestations were made in earlier chapters.
  for (const entry of previous) {
    const actor=entry.candidate.actor;
    if (containsWholeName(query,actor)) named.add(normalize(actor));
  }
  for (const link of aliases) {
    for (const name of [link.decision.firstName,link.decision.secondName]) {
      if (containsWholeName(query,name)) named.add(normalize(name));
    }
  }
  const relevant: Array<{ entry:CurrentEventLedgerEntry; basis:AttestedReviewWitness["matchBasis"];
    matchedAs?:string; aliasDecisionId?:string }> = [];
  for (const entry of previous) {
    const key = normalize(entry.candidate.actor);
    if (named.has(key)) {
      relevant.push({entry,basis:"literal_name"});
      continue;
    }
    // A direct pair is allowed. Chaining A-B and B-C to infer A-C is forbidden.
    const link=aliases.find(item => {
      const first=normalize(item.decision.firstName), second=normalize(item.decision.secondName);
      return (first===key && named.has(second)) || (second===key && named.has(first));
    });
    if (link) {
      const first=normalize(link.decision.firstName), actorName=entry.candidate.actor;
      relevant.push({entry,basis:"saved_alias",
        matchedAs:first===key?link.decision.secondName:link.decision.firstName,
        aliasDecisionId:link.decision.id});
      if (!priorNames.has(normalize(actorName))) throw new Error("Attestazione assente.");
    }
  }
  relevant.sort((a,b) => (a.basis==="literal_name"?0:1)-(b.basis==="literal_name"?0:1) ||
    storyRecency(a.entry,b.entry));
  const witnesses: AttestedReviewWitness[]=relevant.slice(0,MAX_ATTESTED_REVIEW_WITNESSES)
    .map(({entry,basis,matchedAs,aliasDecisionId})=>({
      chapterId:entry.candidate.chapterId,
      chapterNumber:entry.candidate.chapterNumber,
      sceneId:entry.candidate.sceneId,
      sceneNumber:entry.candidate.sceneNumber,
      eventDecisionId:entry.decision.id,
      actor:entry.candidate.actor,
      kind:entry.candidate.kind,
      detail:entry.candidate.detail,
      quote:entry.candidate.quote,
      offset:entry.candidate.offset,
      matchBasis:basis,
      ...(matchedAs?{matchedAs}:{}),
      ...(aliasDecisionId?{aliasDecisionId}:{}),
    }));
  return {method:"prior_affirmed_literal_names_v1",witnesses,
    relevantWitnessCount:relevant.length,
    omittedWitnessCount:Math.max(0,relevant.length-witnesses.length),
    priorAttestationCount:previous.length,
    eligibleAliasPairCount:aliases.length};
}
