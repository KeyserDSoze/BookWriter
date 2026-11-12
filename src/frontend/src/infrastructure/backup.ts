import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import type { Activity, AppSettings, BookProject } from "../domain/types";
import type { SceneMergeDraft } from "../domain/scene-merge";
import { narrativeConflictSchema, priorSceneConflictSchema, narrativeReviewSchema, knowledgeReviewSchema, informationTransferReviewSchema, authorTransferCritiqueSchema, recommendationReconciliationSchema } from "../domain/editorial-board";
import { decryptLocal, encryptLocal } from "./crypto";
import { getDb, listBooks, listActivities, loadSettings } from "./db";
import { endpointAuthMode, normalizeEndpoint } from "./ai";
import { assertModelCapabilitySettings } from "../domain/model-capabilities";
import { MIN_CHAT_HEADER_TIMEOUT_SECONDS, MAX_CHAT_HEADER_TIMEOUT_SECONDS } from "./ai-header-timeout";
import {MAX_TRANSFER_SHARE_DECISIONS,type NarrativeTransferShareDecision}
  from "../domain/narrative-transfer-sharing";
import {MAX_EDITORIAL_VERIFICATION_CHOICES,type EditorialVerificationChoice}
  from "../domain/editorial-verification-choices";
import {MAX_KNOWLEDGE_SHARE_DECISIONS,type NarrativeKnowledgeShareDecision}
  from "../domain/narrative-knowledge-sharing";

const VERSION = 1;
const MAX_ZIP = 40 * 1024 * 1024;
const MAX_UNPACKED = 80 * 1024 * 1024;
const ITERATIONS = 310_000;

const zId = z.string().min(1).max(300);
const sceneSchema = z.object({
  id: zId, number: z.number().int().nonnegative(), title: z.string().max(300),
  objective: z.string().max(20_000), text: z.string().max(2_000_000),
  summary: z.string().optional(), status: z.enum(["planned", "draft", "canon"]),
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
}).passthrough();
const archivedJudgmentSchema = z.object({
  authorTransferCritique:authorTransferCritiqueSchema.optional(),
  recommendationReconciliations:z.array(recommendationReconciliationSchema).max(6).optional(),
  decisions: z.array(z.object({
    narrativeReview: narrativeReviewSchema.optional(),
    knowledgeReview: knowledgeReviewSchema.optional(),
    informationTransferReview: informationTransferReviewSchema.optional(),
  }).passthrough()).max(600),
}).passthrough();
const archivedRoundSchema = z.object({
  reports: z.array(archivedReportSchema).max(480),
  judgment: archivedJudgmentSchema,
}).passthrough();
const archivedCycleSchema = z.object({
  reports: z.array(archivedReportSchema).max(480),
  judgment: archivedJudgmentSchema.optional(),
  priorRounds: z.array(archivedRoundSchema).max(3),
}).passthrough();
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
  editorialRounds: z.array(archivedRoundSchema).max(3).optional(),
  lastContinuityReview: continuityAuditSchema.optional(),
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
const routeSchema = z.object({ endpointId: z.string(), modelId: z.string() });
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

const bookSchema = z.object({
  id: zId, title: z.string(), brief: z.string(),
  writingStyle: z.string(), audience: z.string(),
  authorConstraints: z.array(z.string()).default([]),
  createdAt: z.string(), updatedAt: z.string(),
  status: z.enum(["idle", "running", "paused", "error", "completed"]),
  phase: z.enum(["brainstorm", "validate", "audience", "adversarial", "outline",
    "prose", "review", "consolidate", "chapterReview", "revision", "completed"]),
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
  }).passthrough().optional(),
  modelRoutes: z.record(z.string(), routeSchema).optional(),
}).passthrough();
const activitySchema = z.object({
  id: zId, bookId: zId, runId: z.string(), phase: z.string(), title: z.string(),
  reason: z.string(), nextStep: z.string(), status: z.enum(["running", "succeeded", "cancelled", "failed"]),
  createdAt: z.string(),
  // Optional on legacy backups. Validate untrusted historical quotes strictly.
  priceRateSnapshot: z.object({
    endpointId: z.string().min(1).max(300),
    modelId: z.string().min(1).max(300),
    inputEurPerMillion: z.number().finite().min(0).max(10_000),
    outputEurPerMillion: z.number().finite().min(0).max(10_000),
  }).strict().optional(),
}).passthrough();
const mergeDraftSchema = z.object({
  id: zId, bookId: zId, chapterId: zId, sceneId: zId,
  localRevision: z.string(), remoteHead: z.string().max(100),
  localText: z.string().max(200_000), remoteText: z.string().max(200_000),
  proposedText: z.string().max(200_000), acceptedText: z.string().max(200_000).optional(),
  instruction: z.string().max(3000),
  status: z.enum(["proposed", "accepted", "rejected"]),
  source: z.enum(["ai", "manual"]), createdAt: z.string(),
  endpointId: z.string().optional(), modelId: z.string().optional(),
  inputTokens: z.number().optional(), outputTokens: z.number().optional(),
});
const backupSchema = z.object({
  version: z.literal(VERSION),
  kind: z.enum(["content", "full"]),
  createdAt: z.string(),
  books: z.array(bookSchema).max(100),
  activities: z.array(activitySchema).max(50_000),
  mergeDrafts: z.array(mergeDraftSchema).max(5000).optional(),
  settings: z.object({
    theme: z.enum(["dark", "light", "system"]),
    endpoints: z.array(z.object({
      id: z.string(), name: z.string(), baseUrl: z.string(),
      models: z.array(z.string()), apiKey: z.string().nullable(),
      headerTimeoutSeconds: z.number().int().min(MIN_CHAT_HEADER_TIMEOUT_SECONDS)
        .max(MAX_CHAT_HEADER_TIMEOUT_SECONDS).optional(),
      outputTokenParameter: z.enum(["max_tokens", "max_completion_tokens"]).optional(),
      streamMode: z.enum(["off","sse"]).optional(),
      reasoningEffort: z.enum(["low","medium","high","xhigh"]).optional(),
      authMode: z.enum(["api_key", "none"]).optional(),
      modelCapabilities: z.record(z.string(), z.array(
        z.enum(["chat", "tools", "embedding", "voice"]),
      ).min(1).max(4)).optional(),
    }).refine(profile => {
      try {
        endpointAuthMode(profile.authMode, profile.baseUrl);
        return profile.authMode !== "none" || profile.apiKey === null;
      } catch { return false; }
    }, "Autenticazione senza chiave consentita solo su localhost.")).max(30),
    defaultRoute: routeSchema,
    taskRoutes: z.record(z.string(), routeSchema),
    capabilityRoutes: z.object({
      tools: routeSchema.optional(),
      embedding: routeSchema.optional(),
      voice: routeSchema.optional(),
    }).strict().optional(),
    aiPriceRates: z.array(z.object({
      endpointId: z.string(), modelId: z.string(),
      inputEurPerMillion: z.number().finite().min(0).max(10_000),
      outputEurPerMillion: z.number().finite().min(0).max(10_000),
    })).max(200).optional(),
  }).refine(settings => {
    try {
      assertModelCapabilitySettings({
        ...settings, taskRoutes: settings.taskRoutes as AppSettings["taskRoutes"],
        endpoints: settings.endpoints.map(endpoint => ({ ...endpoint, secret: null })),
      });
      return true;
    } catch { return false; }
  }, "Tag o predefiniti dei modelli non validi.").optional(),
}).refine(x => (x.kind === "full") === !!x.settings, "Contenuto e credenziali incoerenti.");

type BackupData = {
  version: 1;
  kind: "content" | "full";
  createdAt: string;
  books: BookProject[];
  activities: Activity[];
  mergeDrafts?: SceneMergeDraft[];
  settings?: {
    theme: AppSettings["theme"];
    endpoints: Array<{ id: string; name: string; baseUrl: string; models: string[]; apiKey: string | null; headerTimeoutSeconds?: number;
      outputTokenParameter?: "max_tokens" | "max_completion_tokens"; authMode?: "api_key" | "none";
      streamMode?: "off" | "sse"; reasoningEffort?: "low" | "medium" | "high" | "xhigh";
      modelCapabilities?: AppSettings["endpoints"][number]["modelCapabilities"] }>;
    defaultRoute: AppSettings["defaultRoute"];
    taskRoutes: AppSettings["taskRoutes"];
    capabilityRoutes?: AppSettings["capabilityRoutes"];
    aiPriceRates?: AppSettings["aiPriceRates"];
  };
};
export type BackupMode = "content" | "full";

function toBase64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}
function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), char => char.charCodeAt(0));
}
async function passphraseKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  if (passphrase.length < 12) throw new Error("La password dell'archivio deve avere almeno 12 caratteri.");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations: ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function protect(clear: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passphraseKey(passphrase, salt);
  const bytes = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(clear)));
  return strToU8(JSON.stringify({
    cipher: "AES-256-GCM", kdf: "PBKDF2-SHA256", iterations: ITERATIONS,
    salt: toBase64(salt), iv: toBase64(iv), data: toBase64(bytes),
  }));
}
async function unprotect(encrypted: Uint8Array, passphrase: string): Promise<Uint8Array> {
  try {
    const obj = JSON.parse(strFromU8(encrypted)) as {
      cipher: string; kdf: string; iterations: number; salt: string; iv: string; data: string;
    };
    if (obj.cipher !== "AES-256-GCM" || obj.kdf !== "PBKDF2-SHA256" || obj.iterations !== ITERATIONS)
      throw new Error("Metodo di cifratura non supportato.");
    const key = await passphraseKey(passphrase, fromBase64(obj.salt));
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(fromBase64(obj.iv)) }, key, new Uint8Array(fromBase64(obj.data)),
    ));
  } catch {
    throw new Error("Password errata o archivio cifrato danneggiato.");
  }
}

function validateZipStructure(bytes: Uint8Array): void {
  if (bytes.length > MAX_ZIP) throw new Error("ZIP troppo grande (massimo 40 MiB).");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); --i) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Formato ZIP non valido.");
  const entries = view.getUint16(eocd + 10, true);
  const offset = view.getUint32(eocd + 16, true);
  if (entries < 1 || entries > 4 || offset >= eocd) throw new Error("Numero di file ZIP non consentito.");
  let cursor = offset;
  let unpacked = 0;
  const names = new Set<string>();
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error("Directory ZIP non valida.");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const start = cursor + 46;
    const name = new TextDecoder().decode(bytes.subarray(start, start + nameLen));
    if (flags & 1 || (method !== 0 && method !== 8) || size === 0xffffffff ||
        !["manifest.json", "content.json", "vault.enc.json", "vault.json"].includes(name) ||
        names.has(name))
      throw new Error("Il file ZIP contiene elementi non autorizzati.");
    names.add(name);
    unpacked += size;
    if (unpacked > MAX_UNPACKED) throw new Error("Il contenuto dello ZIP supera 80 MiB.");
    cursor = start + nameLen + extraLen + commentLen;
    if (cursor > eocd) throw new Error("Directory ZIP danneggiata.");
  }
  if (!names.has("manifest.json") ||
      (names.has("content.json") === (names.has("vault.enc.json") || names.has("vault.json"))))
    throw new Error("File richiesti mancanti o duplicati nell'archivio.");
}

async function snapshot(mode: BackupMode): Promise<BackupData> {
  const books = await listBooks();
  const activities = (await Promise.all(books.map(book => listActivities(book.id)))).flat();
  const mergeDrafts = await (await getDb()).getAll("mergeDrafts") as SceneMergeDraft[];
  const bookIds = new Set(books.map(b => b.id));
  const data: BackupData = {
    version: VERSION, kind: mode, createdAt: new Date().toISOString(),
    books: books.map(b => ({ ...b, status: b.status === "running" ? "paused" : b.status })),
    activities: activities.map(a => a.status === "running" ? { ...a, status: "cancelled" } : a),
    mergeDrafts: mergeDrafts.filter(d => bookIds.has(d.bookId)),
  };
  if (mode === "full") {
    const settings = await loadSettings();
    data.settings = {
      theme: settings.theme, defaultRoute: settings.defaultRoute,
      taskRoutes: settings.taskRoutes,
      capabilityRoutes: settings.capabilityRoutes,
      aiPriceRates: settings.aiPriceRates,
      endpoints: await Promise.all(settings.endpoints.map(async endpoint => ({
        id: endpoint.id, name: endpoint.name, baseUrl: endpoint.baseUrl,
        models: endpoint.models,
        modelCapabilities: endpoint.modelCapabilities,
        headerTimeoutSeconds: endpoint.headerTimeoutSeconds,
        outputTokenParameter: endpoint.outputTokenParameter,
        streamMode: endpoint.streamMode,
        reasoningEffort: endpoint.reasoningEffort,

        authMode: endpoint.authMode,
        apiKey: endpoint.authMode === "none" ? null :
          endpoint.secret ? await decryptLocal(endpoint.secret) : null,
      }))),
    };
  }
  return data;
}

export async function createBackup(mode: BackupMode, passphrase?: string, allowPlaintext = false): Promise<Blob> {
  if (mode === "full" && !passphrase && !allowPlaintext)
    throw new Error("Per includere le credenziali devi impostare una password o confermare esplicitamente l'esportazione in chiaro.");
  const raw = strToU8(JSON.stringify(await snapshot(mode)));
  if (raw.length > MAX_UNPACKED) throw new Error("Archivio troppo grande.");
  const encrypted = mode === "full" && !!passphrase;
  const name = encrypted ? "vault.enc.json" : mode === "full" ? "vault.json" : "content.json";
  const meta = {
    format: "bookwriter-backup", version: VERSION, mode,
    encrypted, createdAt: new Date().toISOString(),
    notice: "Il file ZIP contiene un payload AES-GCM cifrato solo se encrypted=true.",
  };
  const zipped = zipSync({
    "manifest.json": strToU8(JSON.stringify(meta)),
    [name]: encrypted ? await protect(raw, passphrase!) : raw,
  }, { level: 6 });
  return new Blob([new Uint8Array(zipped)], { type: "application/zip" });
}

export function downloadBackup(blob: Blob, kind: BackupMode): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "bookwriter-" + kind + "-" + new Date().toISOString().slice(0, 10) + ".zip";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function readBackup(file: File, passphrase?: string): Promise<BackupData> {
  if (file.size > MAX_ZIP) throw new Error("ZIP oltre il limite di 40 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateZipStructure(bytes);
  const zip = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(zip["manifest.json"]!)) as {
    format?: string; version?: number; mode?: string; encrypted?: boolean;
  };
  if (manifest.format !== "bookwriter-backup" || manifest.version !== VERSION)
    throw new Error("Questo non è uno ZIP BookWriter supportato.");
  const fileName = manifest.encrypted ? "vault.enc.json" : manifest.mode === "full" ? "vault.json" : "content.json";
  const payload = zip[fileName];
  if (!payload) throw new Error("Payload del backup non trovato.");
  if (manifest.encrypted && !passphrase) throw new Error("Questa copia richiede la password di esportazione.");
  const textBytes = manifest.encrypted ? await unprotect(payload, passphrase!) : payload;
  if (textBytes.length > MAX_UNPACKED) throw new Error("Archivio decompressso troppo grande.");
  let value: unknown;
  try { value = JSON.parse(strFromU8(textBytes)); }
  catch { throw new Error("Il payload non contiene JSON valido."); }
  const result = backupSchema.safeParse(value);
  if (!result.success) throw new Error("Schema backup non valido o incompatibile.");
  if (result.data.kind !== manifest.mode) throw new Error("Tipo di backup incoerente.");
  return result.data as unknown as BackupData;
}

/** Importa come copie distinte: non sovrascrive nessun libro locale. */
export async function importBackup(data: BackupData, withSettings: boolean): Promise<number> {
  const db = await getDb();
  const idMap = new Map<string, string>();
  for (const book of data.books) {
    if (idMap.has(book.id)) throw new Error("ID libro duplicato nell'archivio.");
    idMap.set(book.id, crypto.randomUUID());
  }
  // ZIP data never authenticates a permission. Preserve its historical audit
  // when possible but append explicit revocations before imported copies can
  // ever enter an AI call. If the archive is full, discard permissions entirely.
  function importedSharingAudit(book:BookProject):NarrativeKnowledgeShareDecision[]{
    const original=book.narrativeKnowledgeShareDecisions??[];
    const latest=new Map<string,NarrativeKnowledgeShareDecision>();
    for(const entry of original)latest.set(entry.knowledgeDecisionId,entry);
    const grants=[...latest.values()].filter(entry=>entry.status==="allowed");
    if(original.length+grants.length>MAX_KNOWLEDGE_SHARE_DECISIONS)return [];
    const at=new Date().toISOString();
    return [...original,...grants.map(entry=>({
      id:crypto.randomUUID(),knowledgeDecisionId:entry.knowledgeDecisionId,
      status:"revoked" as const,recipients:[] as [],
      rationale:"Consenso importato revocato: serve nuova autorizzazione locale.",
      decidedAt:at,
    }))];
  }
  function importedTransferShareAudit(book:BookProject):NarrativeTransferShareDecision[]{
    const original=book.narrativeTransferShareDecisions??[];
    const latest=new Map<string,NarrativeTransferShareDecision>();
    for(const entry of original)latest.set(entry.transferAssessmentId,entry);
    const grants=[...latest.values()].filter(x=>x.status==="allowed");
    if(original.length+grants.length>MAX_TRANSFER_SHARE_DECISIONS)return [];
    const at=new Date().toISOString();
    return [...original,...grants.map(entry=>({
      id:crypto.randomUUID(),transferAssessmentId:entry.transferAssessmentId,
      status:"revoked" as const,recipients:[] as [],
      rationale:"Consenso importato revocato: serve un nuovo consenso locale.",
      decidedAt:at,
    }))];
  }
  function importedVerificationAudit(book:BookProject):EditorialVerificationChoice[]{
    const original=book.editorialVerificationChoices??[];
    const latest=new Map<string,EditorialVerificationChoice>();
    for(const entry of original)
      latest.set(JSON.stringify([entry.chapterId,entry.planKey]),entry);
    const active=[...latest.values()].filter(entry=>entry.status!=="reset");
    // Imported authorship is NOT authenticated. Revoke active labels without
    // pretending that a check was accepted, rejected or completed locally.
    if(original.length+active.length>MAX_EDITORIAL_VERIFICATION_CHOICES)return [];
    const at=new Date().toISOString();
    return [...original,...active.map(entry=>({
      ...entry,id:crypto.randomUUID(),status:"reset" as const,
      rationale:"Scelta importata azzerata: richiede una nuova decisione locale.",
      decidedAt:at,
    }))];
  }
  const safeBooks: BookProject[] = data.books.map(book => ({
    ...book,
    id: idMap.get(book.id)!,
    title: book.title + " (importato)",
    authorConstraints: book.authorConstraints ?? [],
    narrativeKnowledgeShareDecisions: importedSharingAudit(book),
    narrativeTransferShareDecisions: importedTransferShareAudit(book),
    editorialVerificationChoices: importedVerificationAudit(book),
    remote: undefined, // Imported copies must not inherit GitHub write permissions/remote SHA.
    status: book.status === "running" ? "paused" : book.status,
    previousError: "Importato da ZIP: verifica endpoint e modelli prima di riprendere.",
    updatedAt: new Date().toISOString(),
  })) as BookProject[];
  const safeActivities: Activity[] = data.activities
    .filter(activity => idMap.has(activity.bookId))
    .map(activity => ({
      ...activity,
      id: crypto.randomUUID(), bookId: idMap.get(activity.bookId)!,
      status: activity.status === "running" ? "cancelled" : activity.status,
    })) as Activity[];
  const safeDrafts: SceneMergeDraft[] = (data.mergeDrafts ?? [])
    .filter(draft => idMap.has(draft.bookId))
    .map(draft => ({
      ...draft, id: crypto.randomUUID(), bookId: idMap.get(draft.bookId)!,
      // Imported history is reference material, not an approval for a new GitHub branch.
      status: draft.status === "proposed" ? "rejected" as const : draft.status,
    }));
  let importedSettings: AppSettings | undefined;
  if (withSettings && data.settings) {
    importedSettings = {
      theme: data.settings.theme, defaultRoute: data.settings.defaultRoute,
      taskRoutes: data.settings.taskRoutes as AppSettings["taskRoutes"],
      capabilityRoutes: data.settings.capabilityRoutes,
      aiPriceRates: data.settings.aiPriceRates,
      endpoints: await Promise.all(data.settings.endpoints.map(async endpoint => ({
        id: endpoint.id, name: endpoint.name, baseUrl: normalizeEndpoint(endpoint.baseUrl),
        models: endpoint.models,
        modelCapabilities: endpoint.modelCapabilities,
        headerTimeoutSeconds: endpoint.headerTimeoutSeconds,
        outputTokenParameter: endpoint.outputTokenParameter,
        streamMode: endpoint.streamMode,
        reasoningEffort: endpoint.reasoningEffort,

        authMode: endpoint.authMode,
        secret: endpoint.authMode === "none" ? null :
          endpoint.apiKey ? await encryptLocal(endpoint.apiKey) : null,
      }))),
    };
  }
  const tx = db.transaction(["books", "activities", "settings", "mergeDrafts"], "readwrite");
  for (const book of safeBooks) await tx.objectStore("books").put(book, book.id);
  for (const activity of safeActivities) await tx.objectStore("activities").put(activity, activity.id);
  for (const draft of safeDrafts) await tx.objectStore("mergeDrafts").put(draft, draft.id);
  if (importedSettings) await tx.objectStore("settings").put(importedSettings, "global");
  await tx.done;
  return safeBooks.length;
}
