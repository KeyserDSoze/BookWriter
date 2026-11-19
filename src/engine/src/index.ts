/**
 * The public surface of the shared editorial engine: what a host (the personal server today, the
 * browser through its own imports) is allowed to depend on. Nothing here knows IndexedDB, Web
 * Locks, files or a network listener: a host installs a `HostRuntime` and the engine does the rest.
 */
export { installHostRuntime, host, type HostRuntime, type HostBookRecord, type LockResult, type RunAdmission, type TraceStore, type TransactionOptions } from "./core/host";
export { BookNotFound, BookRevisionConflict, LocksUnavailable } from "./core/errors";
export { withExclusiveLock } from "./core/store";
export * from "./core/retry-policy";
export { narrativeStateJson } from "./core/narrative-state";

export { newBook, DEFAULT_SETTINGS } from "./domain/types";
export type { BookProject, Activity, AppSettings, EncryptedSecret, GitHubRemote } from "./domain/types";
export { bookSchema, activitySchema } from "./domain/book-schema";
export { migrateBook } from "./domain/book-format";
export { hasForbiddenKey, cloudSettingsSchema, projectSettings } from "./domain/cloud-profile";
export { executionAuthoritySchema, isServerBook } from "./domain/execution-authority";
export { createTaskStructuralCheckpoint } from "./domain/task-structural-checkpoint";
export * as bookEditing from "./domain/book-editing";
export { currentStamp } from "./domain/book-edits";
export { createManualReview, cancelManualReview, decideReviewProposal } from "./domain/manual-review-flow";
export { forceCloseCycle } from "./domain/editorial-board";
export { githubPublicationBlocker } from "./domain/github-publication";
export * from "./domain/personal-server";
export { withoutInheritedConsents } from "./domain/consent-revocation";

export { AutopilotRunner } from "./application/autopilot";
export { withWriterGuard } from "./application/writer-guard";
export { drainGitHubOutbox, saveToGitHubNow } from "./application/auto-sync";
export { pushManualGitHubBook } from "./application/manual-github-push";
export { verifyEndpointSettings } from "./application/endpoint-settings-save";

export { enqueueCheckpoint } from "./infrastructure/outbox";
export {
  pushGitHubBook, RemoteConflict, readGitHubSnapshot, readGitHubExecutionAuthority, validateRemote,
  inspectRepository, inspectGitHubDestination,
} from "./infrastructure/github-sync";
export {
  acquireWriterLease, assertWriterLease, renewWriterLease, releaseWriterLease, LeaseRenewalMissed, LEASE_RENEW_MS,
} from "./infrastructure/github-lease";
export { rememberWriterSession } from "./infrastructure/writer-sessions";
export { getRetrySchedule, clearRetrySchedule } from "./infrastructure/retry-schedule";
export { subscribeLiveAi, currentLiveAi } from "./infrastructure/ai-observability";

export { z } from "zod";
