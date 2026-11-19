import type { BookProject } from "./types";
import { extractNarrativeEventCandidates, type NarrativeEventCandidate } from "./narrative-event-candidates";
import { currentNarrativeEventDecision, sceneTextStamp, type NarrativeEventDecision }
  from "./narrative-event-decisions";

/** Local view of author interpretations; not a canon graph or a contradiction detector. */
export interface CurrentEventLedgerEntry {
  decision: NarrativeEventDecision;
  candidate: NarrativeEventCandidate;
}

export interface EventLedgerActorGroup {
  actor: string;
  entries: CurrentEventLedgerEntry[];
}

export interface NarrativeEventLedger {
  currentAffirmed: CurrentEventLedgerEntry[];
  currentDismissed: CurrentEventLedgerEntry[];
  nonCurrentCount: number;
  /** Same literal name in different chapters, NOT a semantic identity proof. */
  crossChapterActors: EventLedgerActorGroup[];
}

function storyOrder(a: CurrentEventLedgerEntry, b: CurrentEventLedgerEntry): number {
  return a.candidate.chapterNumber - b.candidate.chapterNumber ||
    a.candidate.sceneNumber - b.candidate.sceneNumber ||
    a.candidate.offset - b.candidate.offset || a.decision.id.localeCompare(b.decision.id);
}

/** Re-evaluate all saved decisions, including those past the index's 80-event cap.
 * A superseded, stale or unanchored decision cannot re-enter the current ledger. */
export function buildNarrativeEventLedger(book: BookProject): NarrativeEventLedger {
  const currentAffirmed: CurrentEventLedgerEntry[] = [];
  const currentDismissed: CurrentEventLedgerEntry[] = [];
  let nonCurrentCount = 0;
  const candidatesByScene = new Map<string, NarrativeEventCandidate[]>();
  for (const decision of book.narrativeEventDecisions ?? []) {
    const chapter = book.chapters.find(c => c.id === decision.chapterId);
    const scene = chapter?.scenes.find(s => s.id === decision.sceneId);
    if (!chapter?.frozenAt || chapter.frozenAt !== decision.sourceFrozenAt ||
        !scene || scene.status !== "canon" || sceneTextStamp(scene.text) !== decision.sourceTextStamp) {
      nonCurrentCount++;
      continue;
    }
    const cacheKey = chapter.id + ":" + scene.id;
    let candidates = candidatesByScene.get(cacheKey);
    if (!candidates) {
      candidates = extractNarrativeEventCandidates(chapter, scene);
      candidatesByScene.set(cacheKey, candidates);
    }
    const candidate = candidates.find(c => c.kind === decision.kind &&
      c.quote === decision.quote && c.offset === decision.offset);
    if (!candidate || currentNarrativeEventDecision(book, candidate) !== decision) {
      nonCurrentCount++;
      continue;
    }
    const entry = { decision, candidate };
    (decision.verdict === "affirmed" ? currentAffirmed : currentDismissed).push(entry);
  }
  currentAffirmed.sort(storyOrder);
  currentDismissed.sort(storyOrder);
  const groups = new Map<string, EventLedgerActorGroup>();
  for (const entry of currentAffirmed) {
    // Exact-name grouping only: no alias, possessions, knowledge, temporal or causal inference.
    const key = entry.candidate.actor.normalize("NFC").toLocaleLowerCase("it");
    const group = groups.get(key);
    if (group) group.entries.push(entry);
    else groups.set(key, { actor: entry.candidate.actor, entries: [entry] });
  }
  const crossChapterActors = [...groups.values()]
    .filter(group => new Set(group.entries.map(e => e.candidate.chapterId)).size > 1)
    .sort((a, b) => a.entries[0]!.candidate.chapterNumber -
      b.entries[0]!.candidate.chapterNumber || a.actor.localeCompare(b.actor, "it"));
  return { currentAffirmed, currentDismissed, nonCurrentCount, crossChapterActors };
}
