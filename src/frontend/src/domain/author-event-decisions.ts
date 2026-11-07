import type { Chapter, Scene } from "./types";
import { extractNarrativeEventCandidates, type NarrativeEventCandidate,
  type NarrativeEventKind } from "./narrative-event-candidates";

/** A local, author-authored interpretation of a literal passage.
 * It is NOT cryptographically signed or independently authenticated. */
export type AuthorEventVerdict = "confirmed" | "rejected" | "withdrawn";
export interface AuthorEventDecision {
  id: string;
  chapterId: string;
  sceneId: string;
  kind: NarrativeEventKind;
  quote: string;
  offset: number;
  actor: string;
  detail: string;
  recipient: string | null;
  verdict: AuthorEventVerdict;
  note: string;
  recordedAt: string;
  sourceFrozenAt: string;
  /** Noncryptographic full-scene change detector, NOT a security signature. */
  sourceSceneFingerprint: string;
  /** Imported ZIP statements need fresh local author confirmation. */
  importedUnverified?: boolean;
}

export interface ConfirmedNarrativeEvent {
  chapterId: string;
  sceneId: string;
  kind: NarrativeEventKind;
  quote: string;
  offset: number;
  actor: string;
  detail: string;
  recipient: string | null;
  sourceFrozenAt: string;
  evidenceStatus: "author_confirmed_interpretation";
}

const MAX_HISTORY = 120;
const NOTE_MIN = 24;
const NOTE_MAX = 400;
const MAX_QUOTE = 180;
const ID_PATTERN = /^event-decision:\d{13}:\d{1,3}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{16}$/;

/** Two bounded 32-bit full-text checksums. This detects ordinary edits,
 * not deliberate forgery. Imported statements never become trusted by default. */
export function sceneTextFingerprint(text: string): string {
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    first = Math.imul(first ^ c, 0x01000193);
    second = Math.imul(second ^ c, 0x85ebca6b);
  }
  return (first >>> 0).toString(16).padStart(8, "0") +
    (second >>> 0).toString(16).padStart(8, "0");
}

function key(value: Pick<AuthorEventDecision, "sceneId" | "kind" | "offset" | "quote">): string {
  return JSON.stringify([value.sceneId, value.kind, value.offset, value.quote]);
}

export function authorEventDecisionHistory(chapter: Chapter): AuthorEventDecision[] {
  const history = chapter.authorEventDecisions ?? [];
  if (!Array.isArray(history) || history.length > MAX_HISTORY) {
    throw new Error("Storico decisioni autore non valido o oltre il limite.");
  }
  const unique = new Set<string>();
  for (let i=0; i<history.length; i++) {
    const entry = history[i]!;
    if (!entry || typeof entry !== "object" || !ID_PATTERN.test(entry.id) ||
      unique.has(entry.id) || entry.chapterId !== chapter.id ||
      !chapter.scenes.some(s => s.id === entry.sceneId) ||
      !["knowledge_mention","item_transfer_mention","state_change_mention"].includes(entry.kind) ||
      !["confirmed","rejected","withdrawn"].includes(entry.verdict) ||
      typeof entry.quote !== "string" || entry.quote.length < 4 || entry.quote.length > MAX_QUOTE ||
      typeof entry.offset !== "number" || !Number.isInteger(entry.offset) ||
      entry.offset < 0 || entry.offset > 2_000_000 ||
      typeof entry.actor !== "string" || entry.actor.length < 1 || entry.actor.length > 100 ||
      typeof entry.detail !== "string" || entry.detail.length < 1 || entry.detail.length > 180 ||
      (entry.recipient !== null && (typeof entry.recipient !== "string" || entry.recipient.length > 100)) ||
      typeof entry.note !== "string" || entry.note.trim().length < NOTE_MIN ||
      entry.note.length > NOTE_MAX || !Number.isFinite(Date.parse(entry.recordedAt)) ||
      !Number.isFinite(Date.parse(entry.sourceFrozenAt)) ||
      typeof entry.sourceSceneFingerprint !== "string" ||
      !FINGERPRINT_PATTERN.test(entry.sourceSceneFingerprint) ||
      (entry.importedUnverified !== undefined && typeof entry.importedUnverified !== "boolean")) {
      throw new Error("Storico decisioni autore alterato: nessuna attestazione è affidabile.");
    }
    unique.add(entry.id);
  }
  return history;
}

/** Compare against the current extractor, not only a user-controlled quote. */
function candidateCurrent(chapter: Chapter, candidate: NarrativeEventCandidate): Scene | undefined {
  const scene = chapter.scenes.find(s => s.id === candidate.sceneId);
  if (!chapter.frozenAt || !scene || scene.status !== "canon" ||
    candidate.chapterId !== chapter.id || candidate.chapterNumber !== chapter.number ||
    !extractNarrativeEventCandidates(chapter, scene).some(v =>
      v.kind === candidate.kind && v.quote === candidate.quote &&
      v.offset === candidate.offset && v.actor === candidate.actor &&
      v.detail === candidate.detail && v.recipient === candidate.recipient)) return;
  return scene;
}

export type AuthorEventStatus = "pending" | "confirmed" | "rejected" | "withdrawn" | "stale" | "imported_unverified";

export function authorEventStatus(chapter: Chapter, candidate: NarrativeEventCandidate): AuthorEventStatus {
  const history = authorEventDecisionHistory(chapter);
  const latest = [...history].reverse().find(v => key(v) === key(candidate));
  if (!latest) return "pending";
  const scene = candidateCurrent(chapter, candidate);
  if (!scene || latest.sourceFrozenAt !== chapter.frozenAt ||
    latest.sourceSceneFingerprint !== sceneTextFingerprint(scene.text) ||
    latest.actor !== candidate.actor || latest.detail !== candidate.detail ||
    latest.recipient !== candidate.recipient) return "stale";
  if (latest.importedUnverified) return "imported_unverified";
  return latest.verdict;
}

export function appendAuthorEventDecision(chapter: Chapter, candidate: NarrativeEventCandidate,
  verdict: AuthorEventVerdict, note: string, recordedAt: string): AuthorEventDecision {
  const history = authorEventDecisionHistory(chapter);
  const scene = candidateCurrent(chapter,candidate);
  if (!scene) throw new Error("La scena non è congelata o la citazione candidata è obsoleta.");
  if (!["confirmed","rejected","withdrawn"].includes(verdict))
    throw new Error("Decisione autore non riconosciuta.");
  if (note.trim().length < NOTE_MIN || note.trim().length > NOTE_MAX ||
      note.length > NOTE_MAX) throw new Error("Motivazione obbligatoria: da 24 a 400 caratteri.");
  if (!Number.isFinite(Date.parse(recordedAt)) || history.length >= MAX_HISTORY)
    throw new Error("Storico decisioni completo o data non valida.");
  const previous = authorEventStatus(chapter,candidate);
  if (previous === verdict) throw new Error("Questa decisione è già attiva.");
  if (verdict === "withdrawn" && (previous === "pending" || previous === "stale"))
    throw new Error("Nessuna dichiarazione attiva da ritirare.");
  const entry: AuthorEventDecision = {
    id: "event-decision:" + Date.parse(recordedAt) + ":" + history.length,
    chapterId: chapter.id, sceneId:scene.id, kind:candidate.kind,
    quote:candidate.quote, offset:candidate.offset,
    actor:candidate.actor, detail:candidate.detail, recipient:candidate.recipient,
    verdict, note:note.trim(), recordedAt,
    sourceFrozenAt:chapter.frozenAt!,
    sourceSceneFingerprint:sceneTextFingerprint(scene.text),
  };
  chapter.authorEventDecisions = [...history,entry];
  return entry;
}

/** Only the latest, still-valid explicit confirmations are read as author
 * interpretations. Never include private notes in an AI prompt. */
export function confirmedAuthorNarrativeEvents(chapter: Chapter, scene: Scene): ConfirmedNarrativeEvent[] {
  authorEventDecisionHistory(chapter);
  if (!chapter.frozenAt || scene.status !== "canon") return [];
  const valid=extractNarrativeEventCandidates(chapter,scene);
  return valid.filter(candidate => authorEventStatus(chapter,candidate) === "confirmed")
    .map(candidate => ({
      chapterId:chapter.id,sceneId:scene.id,kind:candidate.kind,
      quote:candidate.quote,offset:candidate.offset,actor:candidate.actor,
      detail:candidate.detail,recipient:candidate.recipient,
      sourceFrozenAt:chapter.frozenAt!,evidenceStatus:"author_confirmed_interpretation" as const,
    })).slice(0,4);
}
