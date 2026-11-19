import type { BookProject, Chapter } from "./types";
import type { ChapterEditorialCycle, EditorialDecision, EditorialFinding, EditorialReport, EditorialRole } from "./editorial-board";

/** Pull-request style review of a blocked editorial round.
 * Pure helpers: nothing here calls the model or changes the book. The author's
 * decisions become ONE compact instruction (the book constraints are read by
 * every reviewer and have a hard size limit, so nothing is truncated silently). */

/** Total size of `authorConstraints` joined: every reviewer prompt refuses a longer text. */
export const AUTHOR_CONSTRAINTS_LIMIT = 8000;

export type ItemChoice = "follow_director" | "accept_as_is" | "custom";
export interface ItemDecision { choice: ItemChoice; note: string }
export interface BlockedReviewDraft {
  chapterId: string;
  round: number;
  decisions: Record<string, ItemDecision>;
  generalNote: string;
  updatedAt: string;
}

export interface BlockedReviewItem {
  findingId: string;
  role: EditorialRole;
  severity: EditorialFinding["severity"];
  sceneId: string;
  sceneLabel: string;
  category: string;
  evidence: string;
  reason: string;
  remediation: string;
  /** The director's handling of this finding (absent when the round has no judgment for it). */
  director?: Pick<EditorialDecision, "action" | "rationale" | "remediation">;
}

export interface BlockedReviewSource {
  chapter: Chapter;
  cycle: ChapterEditorialCycle;
  /** The round the author is asked to look at. */
  round: number;
  reports: EditorialReport[];
  decisions: EditorialDecision[];
  /** "limit": the rounds ran out. "rule": a mandatory writer rule was refused or violated. */
  kind: "limit" | "rule";
}

/** The round that explains the block: the last archived one (limit) or the current one (mandatory rule). */
export function blockedReviewSource(book: BookProject): BlockedReviewSource | undefined {
  const cycle = book.editorialCycle;
  if (!cycle || cycle.stage !== "blocked") return;
  const chapter = book.chapters.find(ch => ch.id === cycle.chapterId);
  if (!chapter) return;
  if (cycle.judgment) return { chapter, cycle, round: cycle.round, reports: cycle.reports, decisions: cycle.judgment.decisions, kind: "rule" };
  const last = cycle.priorRounds.at(-1);
  if (!last) return { chapter, cycle, round: cycle.round, reports: [], decisions: [], kind: "limit" };
  return { chapter, cycle, round: last.round, reports: last.reports, decisions: last.judgment.decisions, kind: "limit" };
}

const SEVERITY_ORDER = { critical: 0, major: 1, minor: 2 } as const;

export function blockedReviewItems(book: BookProject): BlockedReviewItem[] {
  const source = blockedReviewSource(book);
  if (!source) return [];
  const byFinding = new Map(source.decisions.map(d => [d.findingId, d]));
  const items: BlockedReviewItem[] = [];
  for (const report of source.reports) for (const finding of report.findings) {
    const scene = source.chapter.scenes.find(s => s.id === finding.sceneId);
    const decision = byFinding.get(finding.id);
    items.push({
      findingId: finding.id, role: report.role, severity: finding.severity, sceneId: finding.sceneId,
      sceneLabel: scene ? "Scena " + scene.number + (scene.title ? " · " + scene.title : "") : finding.sceneId,
      category: finding.category, evidence: finding.evidence, reason: finding.reason, remediation: finding.remediation,
      ...(decision ? { director: { action: decision.action, rationale: decision.rationale, remediation: decision.remediation } } : {}),
    });
  }
  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function emptyDraft(chapterId: string, round: number): BlockedReviewDraft {
  return { chapterId, round, decisions: {}, generalNote: "", updatedAt: new Date(0).toISOString() };
}

/** Is this item answered well enough to count as decided? A personal note needs real content. */
export function itemReady(decision: ItemDecision | undefined): boolean {
  if (!decision) return false;
  return decision.choice !== "custom" || decision.note.trim().length >= 8;
}

export function reviewProgress(items: BlockedReviewItem[], draft: BlockedReviewDraft): { decided: number; total: number; complete: boolean } {
  const decided = items.filter(item => itemReady(draft.decisions[item.findingId])).length;
  return { decided, total: items.length, complete: decided === items.length };
}

/** «Accetto tutte le proposte del direttore»: keeps choices the author already wrote by hand. */
export function followDirectorOnAll(items: BlockedReviewItem[], draft: BlockedReviewDraft): BlockedReviewDraft {
  const decisions = { ...draft.decisions };
  for (const item of items) if (!itemReady(decisions[item.findingId])) decisions[item.findingId] = { choice: "follow_director", note: "" };
  return { ...draft, decisions };
}

/** Characters still free in the book constraints, counting what is already there. */
export function constraintsRoom(book: Pick<BookProject, "authorConstraints">): number {
  const used = (book.authorConstraints ?? []).join("\n").length;
  return Math.max(0, AUTHOR_CONSTRAINTS_LIMIT - used - 1);
}

function brief(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

export interface ComposedInstruction { text: string; length: number; room: number; fits: boolean }

/** One compact instruction for the next round. Only the author's exceptions and
 * personal notes travel in full; «follow the director» is a single counted line. */
export function composeBlockedInstruction(
  book: BookProject, items: BlockedReviewItem[], draft: BlockedReviewDraft,
): ComposedInstruction {
  const chapter = book.chapters.find(ch => ch.id === draft.chapterId);
  const lines: string[] = [`Decisione dell'autore sul capitolo ${chapter?.number ?? "?"} (tornata ${draft.round}).`];
  const followed = items.filter(i => draft.decisions[i.findingId]?.choice === "follow_director").length;
  if (followed) lines.push(`Sui rilievi ${followed} l'autore accetta il trattamento del direttore: le correzioni accettate sono già applicate, i rilievi respinti restano respinti.`);
  for (const item of items) {
    const decision = draft.decisions[item.findingId];
    if (!decision) continue;
    const where = `[${item.category}, ${item.sceneLabel}]`;
    if (decision.choice === "accept_as_is")
      lines.push(`ACCETTATO COSÌ, non riproporre ${where}: «${brief(item.evidence, 120)}»`);
    else if (decision.choice === "custom" && decision.note.trim())
      lines.push(`Indicazione dell'autore ${where}: ${decision.note.trim()}`);
  }
  if (draft.generalNote.trim()) lines.push("Nota generale dell'autore: " + draft.generalNote.trim());
  const text = lines.join("\n");
  const room = constraintsRoom(book);
  return { text, length: text.length, room, fits: text.length <= room };
}
