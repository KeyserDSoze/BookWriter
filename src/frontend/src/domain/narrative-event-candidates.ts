import type { BookProject, Chapter, Scene } from "./types";

/** Heuristic, unverified text mentions. Never canonical memory, facts, or instructions. */
export type NarrativeEventKind = "knowledge_mention" | "item_transfer_mention" | "state_change_mention";
export interface NarrativeEventCandidate {
  chapterId: string;
  chapterNumber: number;
  sceneId: string;
  sceneNumber: number;
  kind: NarrativeEventKind;
  actor: string;
  detail: string;
  recipient: string | null;
  sceneDate: string | null;
  /** Exact literal substring of the public scene, indexed in UTF-16 offsets. */
  quote: string;
  offset: number;
  evidenceStatus: "unverified_literal_pattern";
}
export interface NarrativeEventCandidateIndex {
  method: "bounded_literal_patterns_v1";
  scannedSceneCount: number;
  unscannedSceneCount: number;
  eventLimitReached: boolean;
  events: NarrativeEventCandidate[];
}

const MAX_SCENES = 1600;
const MAX_EVENTS = 80;
const MAX_SCENE_CHARS = 20_000;
const MAX_EVENTS_PER_SCENE = 4;
// These conservative forms identify *possible textual mentions*, not the truth
// of what happened or what a character really knows/possesses.
const RULES: ReadonlyArray<{
  kind: NarrativeEventKind;
  pattern: RegExp;
  detailGroup: number;
  recipientGroup?: number;
}> = [
  {
    kind: "knowledge_mention",
    pattern: /\b([\p{Lu}][\p{L}'’-]{1,39})\s+(?:scopre|apprende|capisce)\s+che\s+([^\n.!?]{8,120})/gu,
    detailGroup: 2,
  },
  {
    kind: "item_transfer_mention",
    pattern: /\b([\p{Lu}][\p{L}'’-]{1,39})\s+(?:consegna|cede|passa)\s+(?:la|il|lo|le|un|una)\s+([\p{L}'’ -]{2,50}?)\s+a\s+([\p{Lu}][\p{L}'’-]{1,39})(?=\W|$)/gu,
    detailGroup: 2,
    recipientGroup: 3,
  },
  {
    kind: "state_change_mention",
    pattern: /\b([\p{Lu}][\p{L}'’-]{1,39})\s+(muore|scompare|fugge|arriva|parte|ritorna|risorge)\b/gu,
    detailGroup: 2,
  },
];

/** For every candidate quote, scene.text.slice(offset, offset + quote.length) === quote.
 * A mention can be in dialogue, a lie, a dream, an unreliable narrator or
 * a hypothetical passage: consumers MUST NOT treat it as a factual event. */
export function extractNarrativeEventCandidates(chapter: Chapter, scene: Scene): NarrativeEventCandidate[] {
  if (scene.status !== "canon" || !scene.text.trim()) return [];
  const source = scene.text.slice(0, MAX_SCENE_CHARS);
  const found: NarrativeEventCandidate[] = [];
  for (const rule of RULES) {
    for (const match of source.matchAll(rule.pattern)) {
      const offset = match.index;
      const quote = match[0];
      const actor = match[1]?.trim() ?? "";
      const detail = match[rule.detailGroup]?.trim() ?? "";
      const recipient = rule.recipientGroup ? (match[rule.recipientGroup]?.trim() ?? null) : null;
      if (!actor || !detail || quote.length > 180) continue;
      // Do not mistake simple adjacent negation for a positive statement.
      if (/\bnon\s*$/iu.test(source.slice(Math.max(0, offset - 8), offset))) continue;
      found.push({
        chapterId: chapter.id,
        chapterNumber: chapter.number,
        sceneId: scene.id,
        sceneNumber: scene.number,
        kind: rule.kind,
        actor, detail, recipient,
        sceneDate: typeof scene.date === "string" && scene.date.length <= 80 ? scene.date : null,
        quote, offset,
        evidenceStatus: "unverified_literal_pattern",
      });
    }
  }
  return found.sort((a, b) => a.offset - b.offset ||
    a.kind.localeCompare(b.kind)).slice(0, MAX_EVENTS_PER_SCENE);
}

/** Ephemeral on-device index of previously frozen public prose; no new AI or HTTP.
 * Optional chapter boundary prevents a reviewer from seeing future scenes. */
export function buildNarrativeEventCandidateIndex(book: BookProject,
  beforeChapterNumber = Number.POSITIVE_INFINITY): NarrativeEventCandidateIndex {
  const scenes = book.chapters
    .filter(ch => !!ch.frozenAt && ch.number < beforeChapterNumber)
    .sort((a, b) => a.number - b.number || a.id.localeCompare(b.id))
    .flatMap(ch => [...ch.scenes].sort((a, b) => a.number - b.number ||
      a.id.localeCompare(b.id)).map(scene => ({ chapter: ch, scene })));
  const scanned = scenes.slice(0, MAX_SCENES);
  const events: NarrativeEventCandidate[] = [];
  let eventLimitReached = false;
  let actuallyScanned = 0;
  for (const entry of scanned) {
    actuallyScanned++;
    for (const candidate of extractNarrativeEventCandidates(entry.chapter, entry.scene)) {
      if (events.length === MAX_EVENTS) {
        eventLimitReached = true;
        break;
      }
      events.push(candidate);
    }
    if (eventLimitReached) break;
  }
  return {
    method: "bounded_literal_patterns_v1",
    scannedSceneCount: actuallyScanned,
    unscannedSceneCount: scenes.length - actuallyScanned,
    eventLimitReached, events,
  };
}
