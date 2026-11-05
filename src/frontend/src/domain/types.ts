export const TASK_KINDS = [
  "brainstorm", "validate", "audience", "adversarial", "outline",
  "prose", "continuity", "consolidate", "summarize", "revision",
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export type RunStatus = "idle" | "running" | "paused" | "error" | "completed";
export type Phase = "brainstorm" | "validate" | "audience" | "adversarial" | "outline" | "prose" | "review" | "consolidate" | "revision" | "completed";

export interface EncryptedSecret { iv: string; data: string; }
export interface EndpointProfile {
  id: string;
  name: string;
  baseUrl: string;
  secret: EncryptedSecret | null;
  models: string[];
}
export interface ModelRoute { endpointId: string; modelId: string; }
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
  ideas?: string;
  validation?: string;
  audienceReviews: string[];
  adversarial?: string;
  chapters: Chapter[];
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
