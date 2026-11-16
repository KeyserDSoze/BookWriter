import { z } from "zod";
import type { AppSettings, BookProject, EndpointProfile, GitHubRemote } from "./types";
import { TASK_KINDS } from "./types";
import { bookProgress } from "./autopilot-step";

/** Control plane kept in the Google Drive appDataFolder / OneDrive approot of the
 * author's account: AI settings, credentials (vault) and an index of the books.
 * The books themselves (prose, memory, audit) travel through Git, never through
 * these files. No function in this module performs I/O. */
export const CLOUD_PROFILE_FILE = "bookwriter-profile.json";
export const CLOUD_LIBRARY_FILE = "bookwriter-library.json";
export const CLOUD_FILE_NAMES = [CLOUD_PROFILE_FILE, CLOUD_LIBRARY_FILE] as const;
export type CloudFileName = (typeof CLOUD_FILE_NAMES)[number];
export const MAX_CLOUD_FILE_BYTES = 1_048_576;
export const MAX_CLOUD_LIBRARY_BOOKS = 200;
export const VAULT_MIN_PBKDF2_ITERATIONS = 100_000;
export const VAULT_MAX_PBKDF2_ITERATIONS = 2_000_000;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/** Untrusted JSON must not carry prototype-pollution keys anywhere in the tree. */
export function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 12 || value === null || typeof value !== "object") return depth > 12;
  if (Array.isArray(value)) return value.some(item => hasForbiddenKey(item, depth + 1));
  return Object.keys(value).some(key => FORBIDDEN_KEYS.has(key) ||
    hasForbiddenKey((value as Record<string, unknown>)[key], depth + 1));
}

const iso = z.string().max(40).refine(value => !Number.isNaN(Date.parse(value)), "Data non valida.");
const shortText = (max: number) => z.string().min(1).max(max);
const base64 = (maxLength: number) => z.string().min(1).max(maxLength).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const route = z.object({ endpointId: z.string().max(100), modelId: z.string().max(200) }).strict();
const capability = z.enum(["chat", "tools", "embedding", "voice"]);
const reasoning = z.enum(["automatic", "low", "medium", "high", "xhigh"]);
const taskKey = z.enum(TASK_KINDS);

const endpointSchema = z.object({
  id: shortText(100), name: shortText(100), baseUrl: shortText(500),
  models: z.array(shortText(300)).max(2_000),
  modelCapabilities: z.record(shortText(300), z.array(capability).min(1).max(4)).optional(),
  modelTokenLimits: z.record(shortText(300), z.object({
    inputTokens: z.number().int().min(256).max(10_000_000).optional(),
    outputTokens: z.number().int().min(256).max(10_000_000).optional(),
  }).strict().refine(v => v.inputTokens !== undefined || v.outputTokens !== undefined)).optional(),
  authMode: z.enum(["api_key", "none"]).optional(),
  headerTimeoutSeconds: z.number().finite().optional(),
  outputTokenParameter: z.enum(["max_tokens", "max_completion_tokens"]).optional(),
  structuredOutput: z.enum(["auto", "off"]).optional(),
  streamMode: z.enum(["off", "sse"]).optional(),
  streamTimeoutSeconds: z.number().finite().optional(),
  apiProtocol: z.enum(["openai", "lmstudio_native"]).optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  autoRetry: z.boolean().optional(),
  autoRetryMax: z.number().int().min(1).max(5).optional(),
  localAutoRetry: z.boolean().optional(),
}).strict();

const rateSchema = z.object({
  endpointId: z.string().max(100), modelId: z.string().max(200),
  inputEurPerMillion: z.number().finite().min(0).max(1_000_000),
  outputEurPerMillion: z.number().finite().min(0).max(1_000_000),
  cachedInputEurPerMillion: z.number().finite().min(0).max(1_000_000).optional(),
}).strict();

export const cloudSettingsSchema = z.object({
  defaultRoute: route,
  taskRoutes: z.partialRecord(taskKey, route),
  taskReasoningEfforts: z.partialRecord(taskKey, reasoning).optional(),
  capabilityRoutes: z.partialRecord(z.enum(["tools", "embedding", "voice"]), route).optional(),
  aiPriceRates: z.array(rateSchema).max(500).optional(),
  endpoints: z.array(endpointSchema).min(1).max(50),
}).strict();
export type CloudSettings = z.infer<typeof cloudSettingsSchema>;

/** Secrets travel only inside the vault: never next to the plain settings. */
export const vaultSecretsSchema = z.object({
  githubToken: z.string().min(1).max(600).nullable(),
  endpointKeys: z.record(shortText(100), z.string().min(1).max(4_096)),
}).strict().refine(value => Object.keys(value.endpointKeys).length <= 50, "Troppe chiavi.");
export type VaultSecrets = z.infer<typeof vaultSecretsSchema>;

const passphraseEnvelope = z.object({
  mode: z.literal("passphrase"), version: z.literal(1),
  kdf: z.object({
    name: z.literal("PBKDF2"), hash: z.literal("SHA-256"),
    iterations: z.number().int().min(VAULT_MIN_PBKDF2_ITERATIONS).max(VAULT_MAX_PBKDF2_ITERATIONS),
    salt: base64(88),
  }).strict(),
  iv: base64(24), data: base64(Math.ceil(MAX_CLOUD_FILE_BYTES * 4 / 3)),
}).strict();
const accountEnvelope = z.object({
  mode: z.literal("account"), version: z.literal(1), secrets: vaultSecretsSchema,
}).strict();
export const vaultEnvelopeSchema = z.discriminatedUnion("mode", [passphraseEnvelope, accountEnvelope]);
export type VaultEnvelope = z.infer<typeof vaultEnvelopeSchema>;
export type PassphraseEnvelope = z.infer<typeof passphraseEnvelope>;

const deviceName = z.string().min(1).max(80);
export const cloudProfileSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("profile"),
  revision: z.number().int().min(1).max(1_000_000_000),
  updatedAt: iso, deviceId: z.string().uuid(), deviceName,
  settings: cloudSettingsSchema,
  vault: vaultEnvelopeSchema.nullable(),
}).strict();
export type CloudProfile = z.infer<typeof cloudProfileSchema>;

const nonNegative = z.number().int().min(0).max(1_000_000);
export const libraryEntrySchema = z.object({
  bookId: z.string().uuid(),
  title: shortText(300),
  status: z.enum(["idle", "running", "paused", "error", "completed"]),
  phase: z.string().max(40),
  createdAt: iso, bookUpdatedAt: iso,
  progress: z.object({
    chapters: nonNegative, scenes: nonNegative,
    canonScenes: nonNegative, frozenChapters: nonNegative,
  }).strict(),
  remote: z.object({
    owner: shortText(40), repository: shortText(100), branch: shortText(150),
  }).strict().optional(),
  lastSyncedCommit: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
  lastSyncAt: iso.optional(),
  deviceId: z.string().uuid(), deviceName,
  entryAt: iso,
  /** Explicit removal from the cloud index; a later book revision may re-add it. */
  removed: z.boolean().optional(),
}).strict();
export type LibraryEntry = z.infer<typeof libraryEntrySchema>;

export const cloudLibrarySchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("library"),
  revision: z.number().int().min(1).max(1_000_000_000),
  updatedAt: iso,
  books: z.array(libraryEntrySchema).max(MAX_CLOUD_LIBRARY_BOOKS),
}).strict().refine(value => new Set(value.books.map(book => book.bookId)).size === value.books.length,
  "ID libro duplicato.");
export type CloudLibrary = z.infer<typeof cloudLibrarySchema>;

export type CloudParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };
function parseCloudJson<T>(text: string, schema: z.ZodType<T>, label: string): CloudParseResult<T> {
  if (text.length > MAX_CLOUD_FILE_BYTES) return { ok: false, reason: label + " oltre il limite di 1 MiB." };
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return { ok: false, reason: label + " non contiene JSON valido." }; }
  if (hasForbiddenKey(raw)) return { ok: false, reason: label + " contiene chiavi non ammesse." };
  const result = schema.safeParse(raw);
  return result.success ? { ok: true, value: result.data }
    : { ok: false, reason: label + " non segue lo schema BookWriter (versione incompatibile o file alterato)." };
}
export const parseCloudProfile = (text: string) => parseCloudJson(text, cloudProfileSchema, "Il profilo cloud");
export const parseCloudLibrary = (text: string) => parseCloudJson(text, cloudLibrarySchema, "La libreria cloud");

function pick<T extends object>(source: T, keys: ReadonlyArray<keyof T>): Partial<T> {
  const result: Partial<T> = {};
  for (const key of keys) if (source[key] !== undefined) result[key] = source[key];
  return result;
}
const ENDPOINT_KEYS = [
  "id", "name", "baseUrl", "models", "modelCapabilities", "modelTokenLimits", "authMode", "headerTimeoutSeconds",
  "outputTokenParameter", "structuredOutput", "streamMode", "streamTimeoutSeconds", "apiProtocol", "reasoningEffort",
  "autoRetry", "autoRetryMax", "localAutoRetry",
] as const satisfies ReadonlyArray<keyof EndpointProfile>;

/** Settings that follow the author across devices. Device-only choices (theme,
 * the consent to keep prompts for inspection) and anything read from a local
 * provider (model reasoning catalogue) deliberately stay on each device. */
export function projectSettings(settings: AppSettings): CloudSettings {
  return structuredClone({
    defaultRoute: settings.defaultRoute,
    taskRoutes: settings.taskRoutes,
    ...(settings.taskReasoningEfforts ? { taskReasoningEfforts: settings.taskReasoningEfforts } : {}),
    ...(settings.capabilityRoutes ? { capabilityRoutes: settings.capabilityRoutes } : {}),
    ...(settings.aiPriceRates ? { aiPriceRates: settings.aiPriceRates } : {}),
    endpoints: settings.endpoints.map(endpoint => pick(endpoint, ENDPOINT_KEYS) as CloudSettings["endpoints"][number]),
  }) as CloudSettings;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object")
    return "{" + Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined)
      .map(key => JSON.stringify(key) + ":" + stableJson((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
/** Detects a local edit of the synchronised part, secrets included, WITHOUT any
 * plaintext fingerprint: a secret contributes only its AES-GCM ciphertext, which
 * changes exactly when the author re-enters the secret. */
export function cloudSettingsSignature(settings: AppSettings): string {
  return stableJson({
    settings: projectSettings(settings),
    github: settings.githubToken ? settings.githubToken.iv + settings.githubToken.data : null,
    keys: settings.endpoints.map(endpoint =>
      [endpoint.id, endpoint.secret ? endpoint.secret.iv + endpoint.secret.data : null]),
  });
}

/** Never authenticates the author: only the shape of what is stored in the cloud. */
export function isDefaultLocalSettings(settings: AppSettings, defaults: AppSettings): boolean {
  return !settings.githubToken && settings.endpoints.every(endpoint => !endpoint.secret) &&
    stableJson(projectSettings(settings)) === stableJson(projectSettings(defaults));
}

export interface CloudDevice { id: string; name: string }
export function cleanDeviceName(raw: string): string {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Dispositivo").slice(0, 80);
}

/** One line of the index: status and coordinates only. Never brief, memory, secrets or prose. */
export function summarizeBook(book: BookProject, device: CloudDevice, now: string): LibraryEntry {
  const progress = bookProgress(book);
  const remote: GitHubRemote | undefined = book.remote;
  return {
    bookId: book.id, title: book.title.slice(0, 300) || "Libro", status: book.status,
    phase: String(book.phase).slice(0, 40),
    createdAt: book.createdAt, bookUpdatedAt: book.updatedAt,
    progress: {
      chapters: progress.chapters, scenes: progress.scenes,
      canonScenes: progress.canonScenes, frozenChapters: progress.frozenChapters,
    },
    ...(remote ? { remote: { owner: remote.owner, repository: remote.repository, branch: remote.branch } } : {}),
    ...(remote?.lastSyncedCommit ? { lastSyncedCommit: remote.lastSyncedCommit } : {}),
    ...(remote?.lastSyncAt ? { lastSyncAt: remote.lastSyncAt } : {}),
    deviceId: device.id, deviceName: device.name, entryAt: now,
  };
}

const time = (value: string | undefined): number => {
  const parsed = value === undefined ? NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
function sameEntryContent(a: LibraryEntry, b: LibraryEntry): boolean {
  const { entryAt: _a, deviceId: _ad, deviceName: _an, ...left } = a;
  const { entryAt: _b, deviceId: _bd, deviceName: _bn, ...right } = b;
  return stableJson(left) === stableJson(right);
}

/** A device never regresses the entry of a book that another device already
 * advanced, and never drops entries of books it does not hold. */
function preferred(remote: LibraryEntry | undefined, local: LibraryEntry): LibraryEntry {
  if (!remote) return local;
  if (remote.removed) return time(local.bookUpdatedAt) > time(remote.entryAt) ? local : remote;
  const remoteTime = time(remote.bookUpdatedAt), localTime = time(local.bookUpdatedAt);
  if (remoteTime > localTime) return remote;
  if (remoteTime < localTime) return local;
  if (sameEntryContent(remote, local)) return remote;
  return time(local.lastSyncAt) >= time(remote.lastSyncAt) ? local : remote;
}

export interface LibraryMerge { library: CloudLibrary; changedBookIds: string[] }
export function mergeLibrary(
  remote: CloudLibrary | null, local: LibraryEntry[], now: string,
): LibraryMerge {
  const byId = new Map<string, LibraryEntry>((remote?.books ?? []).map(entry => [entry.bookId, entry]));
  const changed: string[] = [];
  for (const entry of local) {
    const before = byId.get(entry.bookId);
    const chosen = preferred(before, entry);
    if (chosen !== before) { byId.set(entry.bookId, chosen); changed.push(entry.bookId); }
  }
  if (byId.size > MAX_CLOUD_LIBRARY_BOOKS)
    throw new Error("La libreria cloud supera 200 libri: rimuovi dal cloud quelli che non usi più.");
  const books = [...byId.values()].sort((a, b) => a.bookId.localeCompare(b.bookId));
  return {
    library: {
      schemaVersion: 1, kind: "library", revision: (remote?.revision ?? 0) + (changed.length ? 1 : 0) || 1,
      updatedAt: changed.length || !remote ? now : remote.updatedAt, books,
    },
    changedBookIds: changed,
  };
}

export function removeLibraryEntry(
  library: CloudLibrary, bookId: string, device: CloudDevice, now: string,
): CloudLibrary {
  const entry = library.books.find(book => book.bookId === bookId);
  if (!entry) return library;
  return {
    ...library, revision: library.revision + 1, updatedAt: now,
    books: library.books.map(book => book.bookId === bookId
      ? { ...book, removed: true, deviceId: device.id, deviceName: device.name, entryAt: now } : book),
  };
}

export type CloudBookKind =
  "cloud_only" | "no_repository" | "update_available" | "in_sync" | "local_ahead" | "unlinked";
export interface CloudBookView {
  entry: LibraryEntry; kind: CloudBookKind; local?: BookProject;
}
/** Hint only: GitHub stays the source of truth and is asked again before any pull. */
export function libraryView(
  library: CloudLibrary | null, books: BookProject[], deviceId: string,
): CloudBookView[] {
  const local = new Map(books.map(book => [book.id, book]));
  return (library?.books ?? []).filter(entry => !entry.removed).map((entry): CloudBookView => {
    const book = local.get(entry.bookId);
    if (!book) return { entry, kind: entry.remote ? "cloud_only" : "no_repository" };
    if (!book.remote) return { entry, kind: entry.remote ? "unlinked" : "in_sync", local: book };
    const otherDevice = entry.deviceId !== deviceId;
    const newerRevision = time(entry.bookUpdatedAt) > time(book.updatedAt);
    const newerSync = !!entry.lastSyncedCommit && entry.lastSyncedCommit !== book.remote.lastSyncedCommit &&
      time(entry.lastSyncAt) > time(book.remote.lastSyncAt);
    if (otherDevice && entry.remote && (newerRevision || newerSync))
      return { entry, kind: "update_available", local: book };
    if (time(book.updatedAt) > time(entry.bookUpdatedAt)) return { entry, kind: "local_ahead", local: book };
    return { entry, kind: "in_sync", local: book };
  }).sort((a, b) => b.entry.bookUpdatedAt.localeCompare(a.entry.bookUpdatedAt));
}
