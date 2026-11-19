import type { BookProject, Scene } from "./types";
import { extractNarrativeEventCandidates, type NarrativeEventCandidate } from "./narrative-event-candidates";

/** A recorded author interpretation, NOT an authenticated fact or canonical memory update. */
export interface NarrativeEventDecision {
  id: string;
  chapterId: string;
  sceneId: string;
  kind: NarrativeEventCandidate["kind"];
  quote: string;
  offset: number;
  /** Freeze and non-cryptographic revision marker; neither authenticates the author. */
  sourceFrozenAt: string;
  sourceTextStamp: string;
  verdict: "affirmed" | "dismissed";
  rationale: string;
  decidedAt: string;
}
export const MAX_EVENT_DECISIONS = 400;

/** Fast freshness hint only; never a tamper-proof signature or semantic proof. */
export function sceneTextStamp(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return text.length + ":" + (hash >>> 0).toString(16).padStart(8, "0");
}

function isSameAnchor(decision: NarrativeEventDecision, candidate: NarrativeEventCandidate): boolean {
  return decision.chapterId === candidate.chapterId &&
    decision.sceneId === candidate.sceneId && decision.kind === candidate.kind &&
    decision.offset === candidate.offset && decision.quote === candidate.quote;
}

/** Only a currently frozen, canonical, locally re-extracted witness can receive an author decision. */
export function createNarrativeEventDecision(
  book: BookProject, candidate: NarrativeEventCandidate,
  verdict: NarrativeEventDecision["verdict"], rationale: string,
  id: string, decidedAt: string,
): NarrativeEventDecision {
  if (verdict !== "affirmed" && verdict !== "dismissed")
    throw new Error("Decisione sull'evento non valida.");
  const note = rationale.trim();
  if (note.length < 12 || note.length > 500)
    throw new Error("Motiva la decisione con 12–500 caratteri.");
  if ((book.narrativeEventDecisions?.length ?? 0) >= MAX_EVENT_DECISIONS)
    throw new Error("Raggiunto il limite dello storico delle decisioni (400). Esporta un backup prima di proseguire.");
  const chapter = book.chapters.find(c => c.id === candidate.chapterId);
  const scene = chapter?.scenes.find(s => s.id === candidate.sceneId);
  if (!chapter?.frozenAt || !scene || scene.status !== "canon")
    throw new Error("Il capitolo non è più congelato o la scena non è canonica.");
  const actual = extractNarrativeEventCandidates(chapter, scene)
    .find(e => e.chapterNumber === candidate.chapterNumber &&
      e.sceneNumber === candidate.sceneNumber && e.evidenceStatus === "unverified_literal_pattern" &&
      e.actor === candidate.actor && e.detail === candidate.detail &&
      e.recipient === candidate.recipient && e.sceneDate === candidate.sceneDate &&
      e.kind === candidate.kind && e.offset === candidate.offset && e.quote === candidate.quote);
  if (!actual) throw new Error("Menzione modificata o non più presente: aggiorna l'indice.");
  return {
    id, chapterId: chapter.id, sceneId: scene.id,
    kind: actual.kind, quote: actual.quote, offset: actual.offset,
    sourceFrozenAt: chapter.frozenAt, sourceTextStamp: sceneTextStamp(scene.text),
    verdict, rationale: note, decidedAt,
  };
}

/** A stale/reopened witness never revives a past endorsement, even if the quote repeats. */
export function currentNarrativeEventDecision(book: BookProject,
  candidate: NarrativeEventCandidate): NarrativeEventDecision | undefined {
  const chapter = book.chapters.find(c => c.id === candidate.chapterId);
  const scene: Scene | undefined = chapter?.scenes.find(s => s.id === candidate.sceneId);
  if (!chapter?.frozenAt || !scene || scene.status !== "canon" ||
    scene.text.slice(candidate.offset, candidate.offset + candidate.quote.length) !== candidate.quote) return;
  const stamp = sceneTextStamp(scene.text);
  return [...(book.narrativeEventDecisions ?? [])].reverse().find(d =>
    isSameAnchor(d, candidate) && d.sourceFrozenAt === chapter.frozenAt &&
    d.sourceTextStamp === stamp);
}
