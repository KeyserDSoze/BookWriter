import type { Activity, AppSettings, BookProject, EncryptedSecret, SyncOutboxItem } from "../domain/types";
import type { ManualPushIntent } from "../infrastructure/manual-push-intent";
import type { AiTraceRetention } from "../domain/ai-trace-policy";
import type { AiLocalTrace } from "../infrastructure/ai-observability";
import type { RetrySchedule } from "./retry-policy";
import type { TaskStructuralCheckpoint } from "../domain/task-structural-checkpoint";

/**
 * The durable operational state of ONE book, loaded and committed as a unit.
 * It is not an IndexedDB emulation: every host maps it onto its own atomic storage
 * (a file container on the server, one readwrite transaction in the browser).
 */
export interface HostBookRecord {
  version: 1; revision: number; book: BookProject; activities: Activity[];
  outbox?: SyncOutboxItem; manualPushIntent?: ManualPushIntent; retrySchedule?: RetrySchedule;
  commands: Record<string, { digest: string; clientId: string; sequence: number; state: "accepted" | "completed" | "uncertain"; result: unknown }>;
  watermarks?: Record<string, number>;
  runAuthorization?: { commandId: string; runId: string; state: "requested" | "started" | "stopped" | "uncertain" };
  structuralCheckpoints?: Record<string, TaskStructuralCheckpoint>;
}

export interface TransactionOptions {
  /** Load `record.activities`. Hosts that store activities apart (browser) only read them on request. */
  activities?: boolean;
}
export type LockResult<T> = { held: true; value: T } | { held: false };

/** Optional capability: keeping prompts and replies for later inspection. Hosts without it simply keep nothing. */
export interface TraceStore {
  save(trace: AiLocalTrace, isCurrent?: () => boolean): Promise<void>;
  prune(retention: AiTraceRetention, now: number, inFlight: ReadonlySet<string>): Promise<number>;
  /** Newest first, within `budgetBytes` of serialised text and `maxFiles` conversations. */
  collectKept(bookId: string, budgetBytes: number, maxFiles: number): Promise<{ traces: AiLocalTrace[]; omitted: number }>;
}

/** What a host adds to the admission of ONE AI run, beyond the shared writer guard. */
export interface RunAdmission {
  /** Further exclusive locks held for the whole run, in order. */
  locks?(book: BookProject): string[];
  /** Additional admission for AI: for a server-owned GitHub book the published authority must be current. */
  assert?(book: BookProject, signal?: AbortSignal): Promise<void>;
  /** False for a book that this host only mirrors; the engine then leaves it alone instead of failing. */
  owns?(book: BookProject): boolean;
}

/** One request of the narrow Git Data subset the engine uses, expressed as the GitHub API path it would call. */
export interface GitHubGitCall {
  token: string; method: string; path: string; body?: unknown; signal?: AbortSignal;
}
/**
 * Optional capability: a host that works in a real Git working copy (the personal server) answers the
 * Git Data requests itself, so the shared push/pull/merge logic runs unchanged on it. A request it does
 * not handle (repository metadata, lease branches, contents writes) returns `undefined` and the engine
 * uses HTTPS to api.github.com as usual. It reports a rejected request with its HTTP-like `status`.
 */
export interface GitHubGitTransport {
  handle(call: GitHubGitCall): Promise<{ status: number; json: unknown } | undefined>;
}

/**
 * Everything the editorial engine needs from the place it runs in. The browser
 * (IndexedDB, WebCrypto, Web Locks) and the personal server (files, vault, OS lock)
 * each implement this once; the engine never touches either directly.
 */
export interface HostRuntime {
  readonly kind: "browser" | "node";
  // Books, activities, settings.
  getBook(id: string): Promise<BookProject | undefined>;
  /** Like `getBook`, for a caller that is about to write: a host refuses a book it does not own. */
  getBookForMutation(id: string): Promise<BookProject | undefined>;
  listBooks(): Promise<BookProject[]>;
  listBookIds(): Promise<string[]>;
  loadSettings(): Promise<AppSettings>;
  /** Read policy and revocation epoch together. For the final request fence,
   * include the book and its plan in that same read. */
  loadRetrySettings(bookId?: string): Promise<{
    settings: AppSettings; epoch: string | null; book?: BookProject; plan?: RetrySchedule;
  }>;
  saveSettings(settings: AppSettings, isCurrent?: () => boolean): Promise<void>;
  saveBook(book: BookProject, queueSync: boolean, expectedUpdatedAt?: string): Promise<void>;
  saveActivity(activity: Activity): Promise<void>;
  saveBookAndActivity(book: BookProject, activity: Activity, expectedUpdatedAt?: string): Promise<void>;
  /** Author-side change plus its log entry; never refused for the opt-in history quota. */
  saveBookWithAuthorActivity(book: BookProject, activity: Activity, expectedUpdatedAt: string): Promise<void>;
  listActivities(bookId: string): Promise<Activity[]>;
  // Durable operational state of one book (outbox, manual push intent, retry wait).
  /**
   * Runs `change` against the book's record and commits every change atomically, or none.
   * `change` may only await in-memory work: a host may keep a storage transaction open across it.
   */
  transaction<T>(bookId: string, change: (record: HostBookRecord) => Promise<T> | T, options?: TransactionOptions): Promise<T>;
  readOutbox(bookId: string): Promise<SyncOutboxItem | undefined>;
  listOutbox(): Promise<SyncOutboxItem[]>;
  readManualPushIntent(bookId: string): Promise<ManualPushIntent | undefined>;
  readRetrySchedule(bookId: string): Promise<RetrySchedule | undefined>;
  // Credentials and small device-local records.
  encrypt(text: string): Promise<EncryptedSecret>;
  decrypt(value: EncryptedSecret): Promise<string>;
  getMeta(key: string): Promise<unknown>;
  putMeta(key: string, value: unknown): Promise<void>;
  // Concurrency.
  /** Takes the named exclusive lock without waiting. Throws only when the host cannot lock at all. */
  tryLock<T>(name: string, action: () => Promise<T>): Promise<LockResult<T>>;
  /** Runs `action` inside the scope of one book (the server selects that book's GitHub credential). */
  withBookScope<T>(bookId: string, action: () => Promise<T>): Promise<T>;
  readonly admission?: RunAdmission;
  /** False while the network is known to be down, so background saves wait instead of failing. Default: online. */
  online?(): boolean;
  readonly traces?: TraceStore;
  /** Git working copy behind the Git Data requests; absent in the browser (HTTPS only). */
  readonly gitHub?: GitHubGitTransport;
}

// One host per process, however many copies of this module a bundler or a test runner creates.
const SLOT = Symbol.for("bookwriter.engine.host");
const slot = globalThis as { [SLOT]?: HostRuntime };

/** One host per process, installed before anything else starts. Returns the uninstall function. */
export function installHostRuntime(value: HostRuntime): () => void {
  if (slot[SLOT]) throw new Error("Un ambiente di esecuzione è già configurato.");
  slot[SLOT] = value;
  return () => { if (slot[SLOT] === value) slot[SLOT] = undefined; };
}
/** The installed host. Fails loudly: the engine has no default and no storage of its own. */
export function host(): HostRuntime {
  const value = slot[SLOT];
  if (!value) throw new Error("Nessun ambiente di esecuzione installato: il motore non ha uno storage proprio.");
  return value;
}
