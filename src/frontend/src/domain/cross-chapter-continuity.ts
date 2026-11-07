import type { BookProject, Chapter, Scene } from "./types";
import { extractNarrativeEventCandidates, type NarrativeEventCandidate } from "./narrative-event-candidates";
import { retrievePriorContinuityScenes, targetedLiteralWindows, type RetrievalMatch,
  type RankedPriorScene } from "./continuity-retrieval";

/** Revalidation is a pending obligation, not a claim that any contradiction exists. */
export type ContinuityTrigger = "author_reopen" | "retroactive_revision" | "historical_evidence";

export interface ContinuityRecheck {
  originChapterId: string;
  originChapterNumber: number;
  trigger: ContinuityTrigger;
  requestedAt: string;
  /** IDs of affected scenes from the origin; no prose or private memories stored. */
  originSceneIds: string[];
}

export interface ContinuityRecheckAudit extends ContinuityRecheck {
  completedAt: string;
  sampledSceneIds: string[];
  partialCoverage: boolean;
  /** Optional for persisted audits prior to targeted local retrieval. */
  retrievalMethod?: "local_structured_lexical_v1";
  candidateSceneCount?: number;
  scannedSceneCount?: number;
  unscannedSceneCount?: number;
}

export interface ContinuityEvidenceWindow { offset: number; text: string }
export interface ContinuityEvidenceScene {
  chapterId: string;
  chapterNumber: number;
  sceneId: string;
  sceneNumber: number;
  date: string | null;
  referencedEntities: string[];
  coverage: "complete" | "partial";
  windows: ContinuityEvidenceWindow[];
  /** The matching signals explain selection, NOT a verified inconsistency. */
  matchSignals: RetrievalMatch;
  selectionReason: RankedPriorScene["selectionReason"];
  /** Literal event mentions, NEVER canonical facts; max 4 per sampled scene. */
  eventCandidates?: NarrativeEventCandidate[];
}

export interface ContinuityEvidencePack {
  originChapterId: string;
  originChapterNumber: number;
  trigger: ContinuityTrigger;
  scope: "public_prior_scenes_partial_sample";
  examinedChapterIds: string[];
  omittedSceneCount: number;
  retrieval: {
    method: "local_structured_lexical_v1";
    candidateSceneCount: number;
    scannedSceneCount: number;
    unscannedSceneCount: number;
    maxSelectedScenes: 4;
  };
  scenes: ContinuityEvidenceScene[];
}

/** Mark downstream existing chapters without copying manuscript/private canon.
 * The earliest still-active origin wins, to avoid hiding a prior revision. */
export function markDownstreamContinuity(book: BookProject, origin: Chapter,
  trigger: ContinuityTrigger, changedSceneIds: readonly string[] = []): number {
  const validIds = new Set(origin.scenes.map(s => s.id));
  const sceneIds = [...new Set(changedSceneIds.filter(id => validIds.has(id)))].slice(0,50);
  const stamp = new Date().toISOString();
  let touched = 0;
  for (const ch of book.chapters) {
    if (ch.number <= origin.number || !ch.scenes.some(s => s.text.trim())) continue;
    const earlier = ch.continuityRecheck;
    if (!earlier || earlier.originChapterNumber > origin.number) {
      ch.continuityRecheck = {
        originChapterId: origin.id, originChapterNumber: origin.number,
        trigger, requestedAt: stamp, originSceneIds: sceneIds,
      };
    } else if (earlier.originChapterNumber === origin.number && earlier.originChapterId === origin.id) {
      ch.continuityRecheck = {...earlier,
        originSceneIds: [...new Set([...earlier.originSceneIds, ...sceneIds])].slice(0,50)};
    }
    ch.lastContinuityReview = undefined;
    touched++;
  }
  return touched;
}

/** Historical dossier edits invalidate documentary assumptions, NOT manuscript prose.
 * Reuse the same downstream recheck/earliest-origin semantics atomically with
 * the existing historical rewind transaction. No source text or private canon
 * is copied into markers. */
export function markHistoricalEvidenceChanged(book: BookProject, origin: Chapter): number {
  const affected = markDownstreamContinuity(book, origin, "historical_evidence");
  origin.lastContinuityReview = undefined;
  return affected;
}

/** Never review/freeze downstream while any prior chapter awaits freeze. */
export function assertPriorChaptersFrozen(book: BookProject, chapter: Chapter): void {
  const prior = book.chapters.filter(ch => ch.number < chapter.number)
    .sort((a,b) => a.number - b.number);
  const pending = prior.find(ch => !ch.frozenAt || !ch.scenes.length ||
    ch.scenes.some(scene => !scene.text.trim() || scene.status !== "canon"));
  if (pending) throw new Error(
    "Continuità non verificabile: il capitolo " + pending.number +
    " deve essere scritto, approvato e congelato prima di riesaminare il capitolo " +
    chapter.number + ".");
}

/** Only public, previously frozen manuscript text, NEVER author-only secrets.
 * Sample windows are literal exact slices with offsets. We never advertise
 * complete inspection when an earlier scene was skipped or shortened. */
export function buildContinuityEvidence(book: BookProject, chapter: Chapter,
  currentScene?: Scene): ContinuityEvidencePack | undefined {
  const recheck = chapter.continuityRecheck;
  if (!recheck) return;
  assertPriorChaptersFrozen(book, chapter);
  const prior = book.chapters.filter(ch => ch.number < chapter.number);
  const origin = prior.find(ch => ch.id === recheck.originChapterId &&
    ch.number === recheck.originChapterNumber);
  if (!origin || !origin.frozenAt) throw new Error(
    "Origine della rivalidazione non disponibile o non congelata: correggi la catena prima di avanzare.");
  const selected = retrievePriorContinuityScenes(prior,origin,chapter,
    recheck.originSceneIds,currentScene);
  const sampledScenes: ContinuityEvidenceScene[] = selected.sampled.map(entry=>{
    const {chapter:sourceChapter,scene,match,selectionReason}=entry;
    const windows=targetedLiteralWindows(scene.text,[
      ...match.terms,...match.entities,
    ]);
    return {
      chapterId:sourceChapter.id,chapterNumber:sourceChapter.number,
      sceneId:scene.id,sceneNumber:scene.number,
      date:typeof scene.date==="string"?scene.date.slice(0,80):null,
      referencedEntities:relatedNames(scene).slice(0,18),
      coverage:scene.text.length<=2800?"complete" as const:"partial" as const,
      windows,matchSignals:match,selectionReason,
      eventCandidates:extractNarrativeEventCandidates(sourceChapter,scene),
    };
  });
  return {
    originChapterId:origin.id,originChapterNumber:origin.number,
    trigger:recheck.trigger,scope:"public_prior_scenes_partial_sample",
    examinedChapterIds:[...new Set(sampledScenes.map(s=>s.chapterId))],
    omittedSceneCount:Math.max(0,selected.candidateSceneCount-selected.sampled.length),
    retrieval:{
      method:selected.method,candidateSceneCount:selected.candidateSceneCount,
      scannedSceneCount:selected.scannedSceneCount,
      unscannedSceneCount:selected.unscannedSceneCount,
      maxSelectedScenes:4,
    },
    scenes:sampledScenes,
  };
}

/** Narrow, explicit metadata only. No extraction of story prose or secret values. */
function relatedNames(scene?: Scene): string[] {
  if (!scene) return [];
  return [...new Set([
    ...(scene.characters ?? []),...(scene.locations ?? []),
    ...(scene.items ?? []),...(scene.factions ?? []),
  ].filter(v=>typeof v === "string" && v.length>0 && v.length<=100))].slice(0,30);
}

export function completeContinuityRecheck(book: BookProject, chapter: Chapter,
  completedAt: string): void {
  if (!chapter.continuityRecheck) return;
  const pack = buildContinuityEvidence(book,chapter);
  if (!pack) throw new Error("Campione di confronto mancante.");
  chapter.lastContinuityReview = {...chapter.continuityRecheck,completedAt,
    sampledSceneIds:pack.scenes.map(s=>s.sceneId),
    partialCoverage:pack.omittedSceneCount>0 ||
      pack.retrieval.unscannedSceneCount>0 ||
      pack.scenes.some(s=>s.coverage==="partial"),
    retrievalMethod:pack.retrieval.method,
    candidateSceneCount:pack.retrieval.candidateSceneCount,
    scannedSceneCount:pack.retrieval.scannedSceneCount,
    unscannedSceneCount:pack.retrieval.unscannedSceneCount,
  };
  chapter.continuityRecheck = undefined;
}
