export const TASK_KINDS = [
  "brainstorm", "validate", "audience", "adversarial", "outline",
  "prose", "continuity", "consolidate", "summarize", "revision", "merge",
  "chapterAudit", "chapterReaders", "chapterJudge", "chapterRepair", "research",
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
/** "automatic" explicitly omits reasoning_effort even if endpoint has a default. */
export type TaskReasoning = "automatic" | "low" | "medium" | "high" | "xhigh";
export type TaskReasoningOverrides = Partial<Record<TaskKind, TaskReasoning>>;
/** Levels a provider can accept as reasoning effort. */
export type ReasoningLevel = Exclude<TaskReasoning, "automatic">;
/** Reported by the provider (LM Studio /api/v1/models), never author-declared. */
export interface ModelReasoningInfo { options: ReasoningLevel[]; default?: ReasoningLevel }

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
import type { EditorialProfiles } from "./editorial-profiles";
import type { KnowledgeBase } from "./knowledge";
import type { NarrativeChangeOperation } from "./narrative-change";
import type { ResearchEntry, WebResearchSettings } from "./web-research";
import type { BookEdit } from "./book-edits";
import type { ManualReview } from "./manual-review";
import { BOOK_FORMAT_VERSION } from "./book-format";

export interface EncryptedSecret { iv: string; data: string; }
/** Author-declared roles; /models does not attest capabilities. */
export type ModelCapability = "chat" | "tools" | "embedding" | "voice";
export type AuxiliaryModelCapability = Exclude<ModelCapability, "chat">;
/** Author-declared maximum prompt (input) and answer (output) tokens of one model. */
export interface ModelTokenLimits { inputTokens?: number; outputTokens?: number }
export interface EndpointProfile {
  id: string;
  name: string;
  baseUrl: string;
  secret: EncryptedSecret | null;
  models: string[];
  /** Manual per-model labels. Missing field = legacy, no role restriction. */
  modelCapabilities?: Record<string, ModelCapability[]>;
  /** Manual per-model token limits: the prompt is never sent above `inputTokens`, answers are capped at `outputTokens`. */
  modelTokenLimits?: Record<string, ModelTokenLimits>;
  /** Opt out of Bearer only for literal loopback hostnames; legacy requires api_key. */
  authMode?: "api_key" | "none";
  /** Max time awaiting POST /chat/completions headers (60–1800 s); default 300. */
  headerTimeoutSeconds?: number;
  /** OpenAI-compatible Chat Completions output cap parameter, legacy max_tokens. */
  outputTokenParameter?: "max_tokens" | "max_completion_tokens";
  /** JSON results via a forced function call for models tagged «tools» (auto, default) or never (off). */
  structuredOutput?: "auto" | "off";
  /** Explicit SSE mode for Chat Completions. */
  streamMode?: "off" | "sse";
  /** SSE body deadline, independent of waiting for HTTP headers. 600–3600 s. */
  streamTimeoutSeconds?: number;
  /** Optional local LM Studio native v1 SSE protocol (loopback only). */
  apiProtocol?: "openai" | "lmstudio_native";
  /** Optional OpenAI-compatible reasoning_effort (provider dependent). */
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  /** Legacy: keyless local endpoints only. Superseded by `autoRetry`, still honoured when `autoRetry` is unset. */
  localAutoRetry?: boolean;
  /** Opt-in: retry a failed task by itself on this endpoint (any endpoint; each retry may be billed on paid ones). */
  autoRetry?: boolean;
  /** Retries per task when `autoRetry` is on (1-5, default 2). */
  autoRetryMax?: number;
  /** Read from the provider on an explicit «Leggi /models». null = model reports no reasoning control; missing = not checked. Not exported in backups. */
  modelReasoning?: Record<string, ModelReasoningInfo | null>;
}
export interface ModelRoute { endpointId: string; modelId: string; }
/** User-entered tariff (not verified against provider invoices). */
export interface AiPriceRate {
  endpointId: string;
  modelId: string;
  inputEurPerMillion: number;
  outputEurPerMillion: number;
  /** Price of input tokens served from the provider's cache. Absent = billed as ordinary input. */
  cachedInputEurPerMillion?: number;
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
  /** Task-level effort choices; book overrides take priority, endpoint is fallback. */
  taskReasoningEfforts?: TaskReasoningOverrides;
  /** Selected defaults for future adapters; Chat continues to use defaultRoute. */
  capabilityRoutes?: Partial<Record<AuxiliaryModelCapability, ModelRoute>>;
  aiPriceRates?: AiPriceRate[];
  /** Legacy (≤0.13.x): the old opt-in to keep prompts/replies. Read only when
   * keepAiConversations is absent; see aiTracePolicy. */
  inspectAiRequests?: boolean;
  /** Keep every conversation (prompt + reply) until the author deletes it. Default off:
   * conversations are temporary and pruned by aiTraceRetention. Device-only. */
  keepAiConversations?: boolean;
  /** Also write the kept conversations to the book's GitHub repository on push. Device-only. */
  syncAiConversationsToGitHub?: boolean;
  /** Temporary conversations: keep at most maxTasks, none older than maxMinutes. Device-only. */
  aiTraceRetention?: { maxTasks: number; maxMinutes: number };
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
  /** The text changed after this summary was written: it may be outdated. */
  summaryStale?: boolean;
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
  /** Frozen by the reduced ("light") editorial board. Absent = full twelve-role board. */
  editorialMode?: "light";
  editorialRounds?: EditorialRound[];
  historicalDossier?: ChapterHistoricalDossier;
  /** A change upstream requires this chapter's twelve reviewers to run again. */
  continuityRecheck?: ContinuityRecheck;
  /** Evidence sample and source of the last finished downstream recheck, not a semantic certificate. */
  lastContinuityReview?: ContinuityRecheckAudit;
  /** The author changed this frozen chapter: its earlier validation no longer covers the text.
   * The chapter stays frozen for progression; only an author-requested review re-checks it. */
  reviewStale?: { since: string; editIds: string[] };
  /** The scenes changed after this chapter summary was written. */
  summaryStale?: boolean;
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
  /** Set when the revision executes a tracked narrative change operation. */
  changeOperationId?: string;
}
/** How the author started the book: free idea or binding chapter-by-chapter synopsis. */
export type BookStartMode = "idea" | "synopsis";
/** One author-written chapter of the starting synopsis (order = chapter number). */
export interface AuthorChapterSynopsis { title?: string; synopsis: string; }
/**
 * next_step: one-shot note for the next authoring task;
 * from_now: permanent constraint, no rewrite;
 * rewrite: permanent constraint plus retroactive revision (or a new plan if nothing is written).
 */
export type AuthorInterventionScope = "next_step" | "from_now" | "rewrite";
/** Append-only record of a prompt typed by the author while supervising the autopilot. */
export interface AuthorIntervention {
  id: string;
  createdAt: string;
  instruction: string;
  scope: AuthorInterventionScope;
  phase: Phase;
  /** Human-readable step that was running or next when the author intervened. */
  stepLabel: string;
  /** Task the author interrupted or referenced, when known. */
  activityId?: string;
  /** next_step only: set when a successful AI task received the note. */
  appliedAt?: string;
  appliedActivityId?: string;
  appliedStepLabel?: string;
}
export interface BookProject {
  id: string;
  /** Portable Markdown originals, not executable instructions or AI permissions.
   * Preserves extra metadata/documents of an explicitly imported manuscript. */
  markdownSource?: Record<string, string>;
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
  /** Legacy books omit it and behave as "idea". */
  startMode?: BookStartMode;
  /** synopsis mode: the outline must keep exactly these chapters, in order. */
  authorChapterSynopses?: AuthorChapterSynopsis[];
  /** idea mode: optional chapter count requested by the author. */
  targetChapterCount?: number;
  /** Stop after the chapter plan so the author can approve or change it. */
  pauseAfterOutline?: boolean;
  /** "light" = reduced editorial board for new review cycles (opt-in, ADR 0151). Absent = full board. */
  editorialMode?: "full" | "light";
  /** Reviewer calls in flight at once (1-4). Absent/1 = sequential (default). Ignored while the AI budget is active. */
  editorialConcurrency?: number;
  /** Explicit per-book reader/writer templates. Absent preserves the standard workflow. */
  editorialProfiles?: EditorialProfiles;
  /** Structured sheets, events and timelines (stable IDs). Absent on legacy books. */
  knowledge?: KnowledgeBase;
  /** Tracked prompt-driven changes to entities, events or scenes, with restore data. */
  changeOperations?: NarrativeChangeOperation[];
  /** "auto" (default) rewrites dependent scenes at once; "confirm" pauses on the plan. */
  changeMode?: "auto" | "confirm";
  /** Opt-in web research the autopilot may request (absent = never). */
  webResearch?: WebResearchSettings;
  /** Queries already run, their sources and the task that asked (bounded). */
  webResearchLog?: ResearchEntry[];
  /** Every manual or AI edit of an element, with its review state (bounded). */
  edits?: BookEdit[];
  /** Reviews the author requested after editing (impact, targeted, extended, full). */
  manualReviews?: ManualReview[];
  /** Every author prompt given to the autopilot, never rewritten. */
  authorInterventions?: AuthorIntervention[];
  /** Version of the stored data format (absent = 0, books before 0.22); see `book-format.ts`. */
  formatVersion?: number;
  memory: NarrativeMemory;
  currentSceneId?: string;
  revision?: RevisionRequest;
  modelRoutes?: Partial<Record<TaskKind, ModelRoute>>;
  taskReasoningEfforts?: TaskReasoningOverrides;
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
  /** Part of inputTokens the provider reported as served from its prompt cache (when it says so). */
  cachedInputTokens?: number;
  /** Requested value; does not attest that LM Studio honored the parameter. */
  requestedReasoningEffort?: TaskReasoning;
  /** Author-entered EUR/million quote captured BEFORE the provider attempt. */
  priceRateSnapshot?: AiPriceRate;
  /** True once a provider request was about to be sent; absent on legacy logs. */
  aiRequested?: boolean;
  /** This log entry records the author intervention with this ID (no AI call). */
  interventionId?: string;
  /** Author next-step notes sent to the provider in this task. */
  appliedInterventionIds?: string[];
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

export interface NewBookOptions {
  startMode?: BookStartMode;
  authorChapterSynopses?: AuthorChapterSynopsis[];
  targetChapterCount?: number;
  pauseAfterOutline?: boolean;
}
export function newBook(
  brief: string, title: string, writingStyle: string, audience: string,
  options: NewBookOptions = {},
): BookProject {
  const now = new Date().toISOString();
  const book: BookProject = {
    id: crypto.randomUUID(), title: title.trim() || "Nuovo libro", brief,
    writingStyle, audience, authorConstraints: [], createdAt: now, updatedAt: now,
    status: "idle", phase: "brainstorm", audienceReviews: [],
    chapters: [], memory: structuredClone(EMPTY_MEMORY), formatVersion: BOOK_FORMAT_VERSION,
  };
  if (options.startMode === "synopsis" && options.authorChapterSynopses?.length) {
    book.startMode = "synopsis";
    book.authorChapterSynopses = structuredClone(options.authorChapterSynopses);
  } else if (options.startMode === "idea") {
    book.startMode = "idea";
    if (options.targetChapterCount) book.targetChapterCount = options.targetChapterCount;
  }
  if (options.pauseAfterOutline) book.pauseAfterOutline = true;
  return book;
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
