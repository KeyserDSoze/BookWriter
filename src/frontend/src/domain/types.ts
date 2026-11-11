export const TASK_KINDS = [
  "brainstorm", "validate", "audience", "adversarial", "outline",
  "prose", "continuity", "consolidate", "summarize", "revision", "merge",
  "chapterAudit", "chapterReaders", "chapterJudge", "chapterRepair",
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export type RunStatus = "idle" | "running" | "paused" | "error" | "completed";
export type Phase = "brainstorm" | "validate" | "audience" | "adversarial" | "outline" | "prose" | "review" | "consolidate" | "chapterReview" | "revision" | "completed";

import type { ChapterEditorialCycle, EditorialRound } from "./editorial-board";
import type { ChapterHistoricalDossier } from "./historical-research";
import type { ContinuityRecheck, ContinuityRecheckAudit } from "./cross-chapter-continuity";
import type { NarrativeEventDecision } from "./narrative-event-decisions";
import type { NarrativeAliasDecision } from "./narrative-alias-decisions";
import type { NarrativeKnowledgeDecision } from "./narrative-knowledge-decisions";
import type { NarrativeKnowledgeShareDecision } from "./narrative-knowledge-sharing";
import type { NarrativeKnowledgeTimingDecision } from "./narrative-knowledge-timing";
import type { NarrativeKnowledgeTopicDecision } from "./narrative-knowledge-topic-decisions";
import type { NarrativeTransferAssessment } from "./narrative-transfer-assessments";
import type { NarrativeTransferShareDecision } from "./narrative-transfer-sharing";
import type { EditorialVerificationChoice } from "./editorial-verification-choices";

export interface EncryptedSecret { iv: string; data: string; }
/** Author-declared roles; /models does not attest capabilities. */
export type ModelCapability = "chat" | "tools" | "embedding" | "voice";
export type AuxiliaryModelCapability = Exclude<ModelCapability, "chat">;
export interface EndpointProfile {
  id: string;
  name: string;
  baseUrl: string;
  secret: EncryptedSecret | null;
  models: string[];
  /** Manual per-model labels. Missing field = legacy, no role restriction. */
  modelCapabilities?: Record<string, ModelCapability[]>;
  /** Opt out of Bearer only for literal loopback hostnames; legacy requires api_key. */
  authMode?: "api_key" | "none";
  /** Max time awaiting POST /chat/completions headers (60–1800 s); default 300. */
  headerTimeoutSeconds?: number;
  /** OpenAI-compatible Chat Completions output cap parameter, legacy max_tokens. */
  outputTokenParameter?: "max_tokens" | "max_completion_tokens";
}
export interface ModelRoute { endpointId: string; modelId: string; }
/** User-entered tariff (not verified against provider invoices). */
export interface AiPriceRate {
  endpointId: string;
  modelId: string;
  inputEurPerMillion: number;
  outputEurPerMillion: number;
}
/** Optional, opt-in guardrails for AI calls made by the book autopilot. */
export interface BookAiBudget {
  enabled: boolean;
  /** Budget for future requests in the period beginning at enabledAt, in EUR. */
  limitEur: number;
  enabledAt: string;
  /** Requests endpoint-selected output cap field; provider billing may differ. */
  maxOutputTokens: number;
  /** Optional estimated EUR ceiling for one runId (one Avvia/Riprendi invocation). */
  sessionLimitEur?: number;
}
export interface GitHubRemote {
  owner: string;
  repository: string;
  branch: string;
  lastSyncedCommit?: string;
  lastSyncedLocalUpdatedAt?: string;
  lastSyncAt?: string;
  autoSync?: boolean;
  allowPublicSync?: boolean;
}
export interface AppSettings {
  githubToken?: EncryptedSecret | null;
  endpoints: EndpointProfile[];
  defaultRoute: ModelRoute;
  taskRoutes: Partial<Record<TaskKind, ModelRoute>>;
  /** Selected defaults for future adapters; Chat continues to use defaultRoute. */
  capabilityRoutes?: Partial<Record<AuxiliaryModelCapability, ModelRoute>>;
  aiPriceRates?: AiPriceRate[];
  theme: "dark" | "light" | "system";
}
export interface Scene {
  id: string;
  number: number;
  title: string;
  objective: string;
  text: string;
  summary?: string;
  date?: string;
  viewpoint?: string;
  locations?: string[];
  characters?: string[];
  items?: string[];
  factions?: string[];
  secret_refs?: string[];
  status: "planned" | "draft" | "canon";
}
export interface Chapter {
  id: string;
  number: number;
  title: string;
  purpose: string;
  scenes: Scene[];
  summary?: string;
  /** Rolling, public book synopsis at this chapter freeze: supports safe rewind. */
  bookSummaryAtFreeze?: string;
  frozenAt?: string;
  editorialRounds?: EditorialRound[];
  historicalDossier?: ChapterHistoricalDossier;
  /** A change upstream requires this chapter's twelve reviewers to run again. */
  continuityRecheck?: ContinuityRecheck;
  /** Evidence sample and source of the last finished downstream recheck, not a semantic certificate. */
  lastContinuityReview?: ContinuityRecheckAudit;
}
export interface NarrativeMemory {
  characters: Record<string, string>;
  locations: Record<string, string>;
  factions: Record<string, string>;
  items: Record<string, string>;
  secrets: Record<string, string>;
  timeline: string[];
  currentState: string;
}
export interface RevisionRequest {
  id: string;
  instruction: string;
  beforePhase: Phase;
  affectedSceneIds: string[];
  cursor: number;
  impactAnalysis?: string;
}
export interface BookProject {
  id: string;
  title: string;
  brief: string;
  writingStyle: string;
  audience: string;
  authorConstraints: string[];
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  phase: Phase;
  previousError?: string;
  editorialReviewSceneIds?: string[]; // Explicit canon confirmation before autopilot can resume.
  editorialCycle?: ChapterEditorialCycle;
  /** Author-confirmed recovery archive; an invalid active review is preserved
   * verbatim before restarting, never promoted to an approved editorial round. */
  editorialRecoveryArchives?: Array<{
    chapterId: string; archivedAt: string; reason: string;
    cycle: ChapterEditorialCycle;
  }>;
  bookSummary?: string;
  aiBudget?: BookAiBudget;
  ideas?: string;
  validation?: string;
  audienceReviews: string[];
  adversarial?: string;
  chapters: Chapter[];
  /** Author annotations only: never automatic updates of narrative memory. */
  narrativeEventDecisions?: NarrativeEventDecision[];
  /** Author-only alias interpretations, never canonical identities. */
  narrativeAliasDecisions?: NarrativeAliasDecision[];
  /** Author-only knowledge interpretations; NEVER automatically promoted to canonical secrets. */
  narrativeKnowledgeDecisions?: NarrativeKnowledgeDecision[];
  /** Opt-in permissions per exact, current knowledge interpretation and recipient. */
  narrativeKnowledgeShareDecisions?: NarrativeKnowledgeShareDecision[];
  /** Author-only manuscript-vs-story timing; no implicit AI sharing or canon edits. */
  narrativeKnowledgeTimingDecisions?: NarrativeKnowledgeTimingDecision[];
  /** Private pairwise subject interpretation; never a transfer or AI authorization. */
  narrativeKnowledgeTopicDecisions?: NarrativeKnowledgeTopicDecision[];
  /** Author judgement of a literal communication candidate; never canon or AI authorization. */
  narrativeTransferAssessments?: NarrativeTransferAssessment[];
  /** Revocable, per-exact-assessment AI permissions; never inherited from knowledge consents. */
  narrativeTransferShareDecisions?: NarrativeTransferShareDecision[];
  /** Private author tracking of checks, never an AI opt-in or repair approval. */
  editorialVerificationChoices?: EditorialVerificationChoice[];
  memory: NarrativeMemory;
  currentSceneId?: string;
  revision?: RevisionRequest;
  modelRoutes?: Partial<Record<TaskKind, ModelRoute>>;
  remote?: GitHubRemote;
}
export interface Activity {
  id: string;
  bookId: string;
  runId: string;
  phase: Phase;
  title: string;
  reason: string;
  nextStep: string;
  status: "running" | "succeeded" | "cancelled" | "failed";
  createdAt: string;
  endedAt?: string;
  summary?: string;
  output?: string;
  endpointId?: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Author-entered EUR/million quote captured BEFORE the provider attempt. */
  priceRateSnapshot?: AiPriceRate;
  /** True once a provider request was about to be sent; absent on legacy logs. */
  aiRequested?: boolean;
  error?: string;
}
export const EMPTY_MEMORY: NarrativeMemory = {
  characters: {}, locations: {}, factions: {}, items: {}, secrets: {}, timeline: [], currentState: "",
};
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  endpoints: [{ id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", secret: null, models: [] }],
  defaultRoute: { endpointId: "openai", modelId: "" },
  taskRoutes: {},
};

export function newBook(brief: string, title: string, writingStyle: string, audience: string): BookProject {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), title: title.trim() || "Nuovo libro", brief,
    writingStyle, audience, authorConstraints: [], createdAt: now, updatedAt: now,
    status: "idle", phase: "brainstorm", audienceReviews: [],
    chapters: [], memory: structuredClone(EMPTY_MEMORY),
  };
}

export function routeFor(task: TaskKind, settings: AppSettings, book: BookProject): ModelRoute {
  const specific = book.modelRoutes?.[task] ?? settings.taskRoutes[task];
  return {
    endpointId: specific?.endpointId || settings.defaultRoute.endpointId,
    modelId: specific?.modelId || settings.defaultRoute.modelId,
  };
}

/** One coalesced pending synchronization per book. No credentials or prose in the outbox. */
export interface SyncOutboxItem {
  bookId: string;
  operationId: string;
  revision: number;
  requestedAt: string;
  state: "pending" | "syncing" | "blocked";
  attempts: number;
  retryAfter?: string;
  lastError?: string;
  lastAttemptAt?: string;
}
