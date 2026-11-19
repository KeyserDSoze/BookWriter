import type { BookProject } from "./types";
import { MAX_TRANSFER_SHARE_DECISIONS, type NarrativeTransferShareDecision } from "./narrative-transfer-sharing";
import { MAX_EDITORIAL_VERIFICATION_CHOICES, type EditorialVerificationChoice } from "./editorial-verification-choices";
import { MAX_KNOWLEDGE_SHARE_DECISIONS, type NarrativeKnowledgeShareDecision } from "./narrative-knowledge-sharing";

/*
 * A book that arrives from another place (ZIP, or the author's own device
 * handing it to a server) never carries an active permission with it. History
 * is preserved when it fits; every active grant is followed by an explicit
 * revocation, otherwise the audit is dropped entirely. Pure, no I/O.
 */

export function importedSharingAudit(book: BookProject): NarrativeKnowledgeShareDecision[] {
  const original = book.narrativeKnowledgeShareDecisions ?? [];
  const latest = new Map<string, NarrativeKnowledgeShareDecision>();
  for (const entry of original) latest.set(entry.knowledgeDecisionId, entry);
  const grants = [...latest.values()].filter(entry => entry.status === "allowed");
  if (original.length + grants.length > MAX_KNOWLEDGE_SHARE_DECISIONS) return [];
  const at = new Date().toISOString();
  return [...original, ...grants.map(entry => ({
    id: crypto.randomUUID(), knowledgeDecisionId: entry.knowledgeDecisionId,
    status: "revoked" as const, recipients: [] as [],
    rationale: "Consenso importato revocato: serve nuova autorizzazione locale.",
    decidedAt: at,
  }))];
}

export function importedTransferShareAudit(book: BookProject): NarrativeTransferShareDecision[] {
  const original = book.narrativeTransferShareDecisions ?? [];
  const latest = new Map<string, NarrativeTransferShareDecision>();
  for (const entry of original) latest.set(entry.transferAssessmentId, entry);
  const grants = [...latest.values()].filter(x => x.status === "allowed");
  if (original.length + grants.length > MAX_TRANSFER_SHARE_DECISIONS) return [];
  const at = new Date().toISOString();
  return [...original, ...grants.map(entry => ({
    id: crypto.randomUUID(), transferAssessmentId: entry.transferAssessmentId,
    status: "revoked" as const, recipients: [] as [],
    rationale: "Consenso importato revocato: serve un nuovo consenso locale.",
    decidedAt: at,
  }))];
}

export function importedVerificationAudit(book: BookProject): EditorialVerificationChoice[] {
  const original = book.editorialVerificationChoices ?? [];
  const latest = new Map<string, EditorialVerificationChoice>();
  for (const entry of original) latest.set(JSON.stringify([entry.chapterId, entry.planKey]), entry);
  const active = [...latest.values()].filter(entry => entry.status !== "reset");
  // Imported authorship is NOT authenticated. Revoke active labels without
  // pretending that a check was accepted, rejected or completed locally.
  if (original.length + active.length > MAX_EDITORIAL_VERIFICATION_CHOICES) return [];
  const at = new Date().toISOString();
  return [...original, ...active.map(entry => ({
    ...entry, id: crypto.randomUUID(), status: "reset" as const,
    rationale: "Scelta importata azzerata: richiede una nuova decisione locale.",
    decidedAt: at,
  }))];
}

/** Permission-bearing fields of a book, reset for a copy that changes hands. */
export function withoutInheritedConsents(book: BookProject): Pick<BookProject,
  "narrativeKnowledgeShareDecisions" | "narrativeTransferShareDecisions" | "editorialVerificationChoices" | "webResearch"> {
  return {
    narrativeKnowledgeShareDecisions: importedSharingAudit(book),
    narrativeTransferShareDecisions: importedTransferShareAudit(book),
    editorialVerificationChoices: importedVerificationAudit(book),
    // Consent to send queries outside the device is never inherited.
    ...(book.webResearch ? { webResearch: { ...book.webResearch, enabled: false } } : {}),
  };
}
