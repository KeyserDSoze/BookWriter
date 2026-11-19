import { z } from "zod";
import { MAX_EDITORIAL_REPORTS, narrativeConflictSchema, priorSceneConflictSchema, narrativeReviewSchema, knowledgeReviewSchema, informationTransferReviewSchema, authorTransferCritiqueSchema, recommendationReconciliationSchema, ruleChecksSchema } from "./editorial-board";
import { editorialProfilesSchema, profileSnapshotFields, refineProfileSnapshot } from "./editorial-profiles";
import { knowledgeBaseSchema } from "./knowledge";
import { changeOperationSchema, MAX_CHANGE_OPERATIONS } from "./narrative-change";
import { researchLogSchema, webResearchSettingsSchema } from "./web-research";
import { bookEditSchema, MAX_EDITS, reviewStaleSchema } from "./book-edits";
import { manualReviewSchema, MAX_REVIEWS } from "./manual-review";
import { BOOK_FORMAT_VERSION } from "./book-format";
import { MAX_AUTHOR_INTERVENTIONS, MAX_INTERVENTION_CHARS } from "./author-interventions";
import { MAX_CHAPTER_SYNOPSIS_CHARS, MAX_CHAPTER_TITLE_CHARS, MAX_SYNOPSIS_CHAPTERS, MAX_TARGET_CHAPTERS } from "./book-start";
import { importedSharingAudit, importedTransferShareAudit, importedVerificationAudit } from "./consent-revocation";
import { validMarkdownSource } from "./markdown-document";
import { longTermRetrySchema } from "../core/retry-policy";
import { executionAuthoritySchema } from "./execution-authority";
import { validateTaskReasoningOverrides } from "./task-reasoning";
import { MIN_CHAT_HEADER_TIMEOUT_SECONDS, MAX_CHAT_HEADER_TIMEOUT_SECONDS } from "../infrastructure/ai-header-timeout";

/**
 * The shape of a book and of an activity, as stored and as exchanged. It lives with the engine
 * because every host (browser backup, GitHub snapshot, personal server) validates the same data.
 */
export const zId = z.string().min(1).max(300);
const sceneSchema = z.object({
  id: zId, number: z.number().int().nonnegative(), title: z.string().max(300),
  objective: z.string().max(20_000), text: z.string().max(2_000_000),
  summary: z.string().optional(), status: z.enum(["planned", "draft", "canon"]),
  summaryStale: z.boolean().optional(),
}).passthrough();
// Untrusted ZIPs must not inject arbitrary instructions or unbounded state into
// cross-chapter continuity prompts. Existing archives without these fields work.
const continuityRecheckSchema = z.object({
  originChapterId: zId,
  originChapterNumber: z.number().int().min(1).max(200),
  trigger: z.enum(["author_reopen","retroactive_revision","historical_evidence"]),
  requestedAt: z.string().datetime(),
  originSceneIds: z.array(zId).max(50),
}).strict();
const continuityAuditSchema = continuityRecheckSchema.extend({
  completedAt: z.string().datetime(),
  sampledSceneIds: z.array(zId).max(4),
  partialCoverage: z.boolean(),
  retrievalMethod: z.literal("local_structured_lexical_v1").optional(),
  candidateSceneCount: z.number().int().min(0).max(40_000).optional(),
  scannedSceneCount: z.number().int().min(0).max(1600).optional(),
  unscannedSceneCount: z.number().int().min(0).max(40_000).optional(),
  // Additive coverage audit from v0.11.39; tightly bounded for untrusted ZIPs.
  currentWrittenSceneCount: z.number().int().min(0).max(200).optional(),
  currentQueriedSceneCount: z.number().int().min(0).max(6).optional(),
  currentOmittedSceneCount: z.number().int().min(0).max(200).optional(),
  currentQueriedSceneIds: z.array(zId).max(6).optional(),
  // Optional 0.11.40 pair: only queried scenes can be lexically truncated.
  currentLexicallyTruncatedSceneCount: z.number().int().min(0).max(6).optional(),
  currentLexicallyTruncatedSceneIds: z.array(zId).max(6).optional(),
}).strict().superRefine((audit,ctx)=>{
  const {currentWrittenSceneCount:written,currentQueriedSceneCount:queried,
    currentOmittedSceneCount:omitted,currentQueriedSceneIds:ids}=audit;
  const values=[written,queried,omitted,ids];
  if(values.every(v=>v===undefined)){
    if(audit.currentLexicallyTruncatedSceneCount!==undefined ||
      audit.currentLexicallyTruncatedSceneIds!==undefined){
      ctx.addIssue({code:z.ZodIssueCode.custom,
        message:"Scansione parziale senza copertura corrente."});
    }
    return; // valid legacy audit without any current-query data
  }
  if(written===undefined || queried===undefined || omitted===undefined ||
    ids===undefined){
    ctx.addIssue({code:z.ZodIssueCode.custom,
      message:"Campi di copertura corrente incompleti."});
    return;
  }
  if(queried+omitted!==written ||
    ids.length!==queried ||
    new Set(ids).size!==ids.length){
    ctx.addIssue({code:z.ZodIssueCode.custom,
      message:"Conteggi di copertura corrente incoerenti."});
  }
  const n=audit.currentLexicallyTruncatedSceneCount;
  const truncated=audit.currentLexicallyTruncatedSceneIds;
  // Older audits (including 0.11.39) lack this pair; never invent it.
  if(n===undefined&&truncated===undefined)return;
  if(n===undefined||truncated===undefined ||
    n!==truncated.length ||
    new Set(truncated).size!==truncated.length ||
    truncated.some(id=>!ids.includes(id))){
    ctx.addIssue({code:z.ZodIssueCode.custom,
      message:"Scansione lessicale parziale incoerente."});
  }
});
// Preserve legacy editorial reports, but validate NEW structured narratives
// even in imported archives. Imported judgments are NOT authenticated.
const archivedFindingSchema = z.object({
  narrativeConflict: narrativeConflictSchema.optional(),
  priorSceneConflict: priorSceneConflictSchema.optional(),
}).passthrough();
const archivedReportSchema = z.object({
  findings: z.array(archivedFindingSchema).max(12),
  reviewerName: z.string().max(120).optional(),
  profileStamp: z.string().regex(/^\d+:[a-f0-9]{8}$/).optional(),
}).passthrough();
const archivedJudgmentSchema = z.object({
  ruleChecks: ruleChecksSchema.optional(),
  authorTransferCritique:authorTransferCritiqueSchema.optional(),
  recommendationReconciliations:z.array(recommendationReconciliationSchema).max(6).optional(),
  decisions: z.array(z.object({
    narrativeReview: narrativeReviewSchema.optional(),
    knowledgeReview: knowledgeReviewSchema.optional(),
    informationTransferReview: informationTransferReviewSchema.optional(),
  }).passthrough()).max(600),
}).passthrough();
const archivedRoundSchema = z.object({
  ...profileSnapshotFields,
  reports: z.array(archivedReportSchema).max(MAX_EDITORIAL_REPORTS),
  judgment: archivedJudgmentSchema,
}).passthrough().superRefine(refineProfileSnapshot);
const MAX_ARCHIVED_ROUNDS = 300;
const archivedCycleSchema = z.object({
  ...profileSnapshotFields,
  reports: z.array(archivedReportSchema).max(MAX_EDITORIAL_REPORTS),
  judgment: archivedJudgmentSchema.optional(),
  priorRounds: z.array(archivedRoundSchema).max(3),
  forcedClose: z.object({
    at: z.string().datetime(), by: z.enum(["author", "director"]), note: z.string().max(20_000),
  }).strict().optional(),
}).passthrough().superRefine(refineProfileSnapshot);
const editorialRecoveryArchiveSchema = z.object({
  chapterId: zId,
  archivedAt: z.string().datetime(),
  reason: z.string().min(1).max(1000),
  cycle: archivedCycleSchema,
}).strict();

const chapterSchema = z.object({
  id: zId, number: z.number().int().nonnegative(), title: z.string().max(300),
  purpose: z.string().max(20_000), scenes: z.array(sceneSchema).max(200),
  continuityRecheck: continuityRecheckSchema.optional(),
  editorialMode: z.literal("light").optional(),
  forcedFreeze: z.object({
    at: z.string().datetime(), by: z.enum(["author", "director"]),
    note: z.string().max(20_000), frozenAt: z.string().datetime(),
  }).strict().optional(),
  // Each reopening (Rivaluta, tracked change, edit) archives up to three more rounds.
  editorialRounds: z.array(archivedRoundSchema).max(MAX_ARCHIVED_ROUNDS).optional(),
  lastContinuityReview: continuityAuditSchema.optional(),
  reviewStale: reviewStaleSchema.optional(), summaryStale: z.boolean().optional(),
}).passthrough();
const memorySchema = z.object({
  characters: z.record(z.string(), z.string()),
  locations: z.record(z.string(), z.string()),
  factions: z.record(z.string(), z.string()),
  items: z.record(z.string(), z.string()),
  secrets: z.record(z.string(), z.string()),
  timeline: z.array(z.string()),
  currentState: z.string(),
});
export const routeSchema = z.object({ endpointId: z.string(), modelId: z.string() });
const narrativeEventDecisionSchema = z.object({
  id: zId, chapterId: zId, sceneId: zId,
  kind: z.enum(["knowledge_mention","item_transfer_mention","state_change_mention"]),
  quote: z.string().min(1).max(180),
  offset: z.number().int().min(0).max(2_000_000),
  sourceFrozenAt: z.string().datetime(),
  // Lightweight freshness marker, NOT a cryptographic signature.
  sourceTextStamp: z.string().regex(/^\d{1,8}:[0-9a-f]{8}$/),
  verdict: z.enum(["affirmed","dismissed"]),
  rationale: z.string().min(12).max(500),
  decidedAt: z.string().datetime(),
}).strict();
const narrativeAliasDecisionSchema = z.object({
  id: zId, firstName: z.string().min(1).max(60),
  secondName: z.string().min(1).max(60),
  firstEventDecisionId: zId, secondEventDecisionId: zId,
  verdict: z.enum(["linked","separated"]),
  rationale: z.string().min(12).max(500),
  decidedAt: z.string().datetime(),
}).strict().refine(d=>d.firstName.trim().normalize("NFC").toLocaleLowerCase("it") !==
  d.secondName.trim().normalize("NFC").toLocaleLowerCase("it"));
const narrativeKnowledgeDecisionSchema = z.object({
  id:zId,sourceEventDecisionId:zId,
  actorName:z.string().min(1).max(60),
  verdict:z.enum(["learned_directly","reported_by_other","still_secret"]),
  rationale:z.string().min(12).max(500),
  decidedAt:z.string().datetime(),
}).strict();

const narrativeKnowledgeShareSchema=z.object({
  id:zId,knowledgeDecisionId:zId,
  status:z.enum(["allowed","revoked"]),
  recipients:z.array(z.enum([
    "continuity","timeline","secrets","characterVoice","judge",
  ])).max(5).refine(x=>new Set(x).size===x.length),
  rationale:z.string().min(12).max(500),
  decidedAt:z.string().datetime(),
}).strict().refine(x=>
  x.status==="allowed" ? x.recipients.length>0 : x.recipients.length===0);

const narrativeKnowledgeTimingSchema=z.object({
  id:zId,
  knowledgeDecisionId:zId,
  accessMoment:z.enum([
    "acquired_in_scene","known_before_scene","not_yet_known","uncertain",
  ]),
  narrativeOrder:z.enum(["chronological","flashback_or_reordered","undetermined"]),
  rationale:z.string().min(20).max(650),
  decidedAt:z.string().datetime(),
}).strict();

const narrativeKnowledgeTopicSchema=z.object({
  id:zId,
  firstKnowledgeDecisionId:zId,
  secondKnowledgeDecisionId:zId,
  verdict:z.enum(["same_information","different_information"]),
  rationale:z.string().min(20).max(650),
  decidedAt:z.string().datetime(),
}).strict().refine(x=>
  x.firstKnowledgeDecisionId<x.secondKnowledgeDecisionId);

const narrativeTransferAssessmentSchema=z.object({
  id:zId,
  topicDecisionId:zId,
  senderKnowledgeDecisionId:zId,
  recipientKnowledgeDecisionId:zId,
  candidateId:z.string().min(1).max(500),
  verdict:z.enum(["author_attested_report","possible_path","dismissed"]),
  rationale:z.string().min(20).max(650),
  decidedAt:z.string().datetime(),
}).strict().refine(x=>x.senderKnowledgeDecisionId!==x.recipientKnowledgeDecisionId);

const narrativeTransferShareSchema=z.object({
  id:zId,
  transferAssessmentId:zId,
  status:z.enum(["allowed","revoked"]),
  recipients:z.array(z.enum([
    "continuity","timeline","secrets","characterVoice","judge",
  ])).max(5).refine(x=>new Set(x).size===x.length),
  rationale:z.string().min(12).max(500),
  decidedAt:z.string().datetime(),
}).strict().refine(x=>x.status==="allowed" ? x.recipients.length>0 :
  x.recipients.length===0);

const editorialVerificationChoiceSchema=z.object({
  id:zId,chapterId:zId,
  planKey:z.string().min(1).max(2500),
  round:z.number().int().min(1).max(3),
  quote:z.string().min(1).max(250),
  missingEvidence:z.string().min(24).max(600),
  nextCheck:z.string().min(24).max(600),
  judgeExplanation:z.string().min(30).max(850),
  status:z.enum(["taken_on","dismissed","reset"]),
  rationale:z.string().min(20).max(500),
  decidedAt:z.string().datetime(),
}).strict();

const PHASES = ["brainstorm", "validate", "audience", "adversarial", "outline",
  "prose", "review", "consolidate", "chapterReview", "revision", "completed"] as const;
// Author prompts are verbatim history: strict shape, bounded size, no extra keys.
const authorInterventionSchema = z.object({
  id: zId, createdAt: z.string().datetime(),
  instruction: z.string().min(1).max(MAX_INTERVENTION_CHARS),
  scope: z.enum(["next_step", "from_now", "rewrite"]),
  phase: z.enum(PHASES),
  stepLabel: z.string().max(300),
  activityId: zId.optional(),
  appliedAt: z.string().datetime().optional(),
  appliedActivityId: zId.optional(),
  appliedStepLabel: z.string().max(300).optional(),
}).strict();
const authorChapterSynopsisSchema = z.object({
  title: z.string().min(1).max(MAX_CHAPTER_TITLE_CHARS).optional(),
  synopsis: z.string().min(1).max(MAX_CHAPTER_SYNOPSIS_CHARS),
}).strict();

export const bookSchema = z.object({
  executionAuthority: executionAuthoritySchema.optional(),
  id: zId, title: z.string(), brief: z.string(),
  markdownSource: z.record(z.string(), z.string()).refine(validMarkdownSource, "Documenti Markdown originali non validi.").optional(),
  writingStyle: z.string(), audience: z.string(),
  authorConstraints: z.array(z.string()).default([]),
  createdAt: z.string(), updatedAt: z.string(),
  status: z.enum(["idle", "running", "paused", "error", "completed"]),
  phase: z.enum(PHASES),
  previousError: z.string().optional(),
  ideas: z.string().optional(), validation: z.string().optional(),
  audienceReviews: z.array(z.string()),
  adversarial: z.string().optional(),
  chapters: z.array(chapterSchema).max(200),
  narrativeEventDecisions: z.array(narrativeEventDecisionSchema).max(400).optional(),
  narrativeAliasDecisions: z.array(narrativeAliasDecisionSchema).max(120).optional(),
  narrativeKnowledgeDecisions: z.array(narrativeKnowledgeDecisionSchema).max(160).optional(),
  narrativeKnowledgeShareDecisions: z.array(narrativeKnowledgeShareSchema).max(240).optional(),
  narrativeKnowledgeTimingDecisions: z.array(narrativeKnowledgeTimingSchema).max(200).optional(),
  narrativeKnowledgeTopicDecisions: z.array(narrativeKnowledgeTopicSchema).max(120).optional(),
  narrativeTransferAssessments: z.array(narrativeTransferAssessmentSchema).max(120).optional(),
  narrativeTransferShareDecisions: z.array(narrativeTransferShareSchema).max(180).optional(),
  editorialVerificationChoices: z.array(editorialVerificationChoiceSchema).max(160).optional(),
  startMode: z.enum(["idea", "synopsis"]).optional(),
  authorChapterSynopses: z.array(authorChapterSynopsisSchema).max(MAX_SYNOPSIS_CHAPTERS).optional(),
  targetChapterCount: z.number().int().min(1).max(MAX_TARGET_CHAPTERS).optional(),
  pauseAfterOutline: z.boolean().optional(),
  editorialMode: z.enum(["full", "light"]).optional(),
  editorialConcurrency: z.number().int().min(1).max(4).optional(),
  editorialProfiles: editorialProfilesSchema.optional(),
  knowledge: knowledgeBaseSchema.optional(),
  changeOperations: z.array(changeOperationSchema).max(MAX_CHANGE_OPERATIONS).optional(),
  changeMode: z.enum(["auto", "confirm"]).optional(),
  directorDecidesWhenBlocked: z.boolean().optional(),
  webResearch: webResearchSettingsSchema.optional(),
  webResearchLog: researchLogSchema.optional(),
  edits: z.array(bookEditSchema).max(MAX_EDITS).optional(),
  manualReviews: z.array(manualReviewSchema).max(MAX_REVIEWS).optional(),
  authorInterventions: z.array(authorInterventionSchema).max(MAX_AUTHOR_INTERVENTIONS).optional(),
  formatVersion: z.number().int().min(0).max(BOOK_FORMAT_VERSION).optional(),
  editorialCycle: archivedCycleSchema.optional(),
  editorialRecoveryArchives: z.array(editorialRecoveryArchiveSchema).max(8).optional(),
  // Legacy books omit aiBudget. If present, untrusted ZIPs must not supply
  // malformed session limits that could silently bypass the local guard.
  aiBudget: z.object({
    enabled: z.boolean(),
    enabledAt: z.string(),
    limitEur: z.number().finite().min(0.01).max(100_000),
    maxOutputTokens: z.number().int().min(256).max(32_768),
    sessionLimitEur: z.number().finite().min(0.01).max(100_000).optional(),
  }).passthrough().optional(),
  memory: memorySchema,
  currentSceneId: z.string().optional(),
  revision: z.object({
    id: zId, instruction: z.string(), beforePhase: z.string(),
    affectedSceneIds: z.array(z.string()), cursor: z.number().int().nonnegative(),
    impactAnalysis: z.string().optional(),
    changeOperationId: z.string().uuid().optional(),
  }).passthrough().optional(),
  modelRoutes: z.record(z.string(), routeSchema).optional(),
  taskReasoningEfforts: z.record(z.string(),z.enum(["automatic","low","medium","high","xhigh"])).superRefine((v,ctx)=>{
    try{validateTaskReasoningOverrides(v);}catch{ctx.addIssue({code:"custom",message:"Task reasoning non valido"});}
  }).optional(),
}).passthrough().superRefine((book, ctx) => {
  // A tracked revision must point to an operation of the same book.
  const id = (book.revision as { changeOperationId?: string } | undefined)?.changeOperationId;
  if (id && !book.changeOperations?.some(op => op.id === id))
    ctx.addIssue({ code: "custom", message: "Revisione collegata a una modifica inesistente." });
});
export const activitySchema = z.object({
  id: zId, bookId: zId, runId: z.string(), phase: z.string(), title: z.string(),
  reason: z.string(), nextStep: z.string(), status: z.enum(["running", "succeeded", "cancelled", "failed"]),
  createdAt: z.string(),
  // Optional on legacy backups. Validate untrusted historical quotes strictly.
  priceRateSnapshot: z.object({
    endpointId: z.string().min(1).max(300),
    modelId: z.string().min(1).max(300),
    inputEurPerMillion: z.number().finite().min(0).max(10_000),
    outputEurPerMillion: z.number().finite().min(0).max(10_000),
    cachedInputEurPerMillion: z.number().finite().min(0).max(10_000).optional(),
  }).strict().optional(),
  cachedInputTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  interventionId: zId.optional(),
  appliedInterventionIds: z.array(zId).max(MAX_AUTHOR_INTERVENTIONS).optional(),
}).passthrough();
