import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import {
  installHostRuntime, BookRevisionConflict, enqueueCheckpoint,
  DEFAULT_SETTINGS, type HostRuntime, type BookProject, type Activity, type AppSettings,
  createTaskStructuralCheckpoint, verifyEndpointSettings,
  cloudSettingsSchema, projectSettings, type EncryptedSecret,
  isReleasedBook, retrySettingsEpochSchema, sameRetrySettings, retryStamp, narrativeStateJson, type GitHubGitTransport,
} from "@engine/index";
import { endpointAuthMode } from "@engine/infrastructure/ai";
import { atomicJson, FileBookStore, readJson } from "./files";
import { Vault } from "./vault";
import { ApiError } from "./errors";

export async function createRuntime(store: FileBookStore, vault: Vault, options?: {
  serverId: string; assertAuthority?: (book: BookProject, signal?: AbortSignal) => Promise<void>;
  /** Real Git working copies behind the Git Data requests; absent = HTTPS to api.github.com. */
  git?: GitHubGitTransport;
}) {
  const scope = new AsyncLocalStorage<string>();
  const held = new Set<string>();
  const configFile = join(store.root, "private", "settings.json");
  const saved = await readJson(configFile, 1024 * 1024) as {
    version: number; revision: number; settings: AppSettings; bookTokens: Record<string, EncryptedSecret>;
    retrySettingsEpoch?: string | null;
  } | undefined;
  if (saved && (saved.version !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision < 0))
    throw new Error("Configurazione server non valida.");
  let settings = saved?.settings ?? structuredClone(DEFAULT_SETTINGS);
  let configRevision = saved?.revision ?? 0;
  let retrySettingsEpoch = retrySettingsEpochSchema.parse(saved?.retrySettingsEpoch ?? null);
  let bookTokens: Record<string, EncryptedSecret> = saved?.bookTokens ?? {};
  const metaFile = join(store.root, "private", "meta.json");
  const meta = await readJson(metaFile, 1024 * 1024) as Record<string, unknown> | undefined ?? {};
  verifyEndpointSettings(settings);
  const owns = (book: BookProject) => !options || book.executionAuthority?.serverId === options.serverId;
  const assertLocalAuthority = (book: BookProject) => {
    if (!owns(book))
      throw new Error("Autorità del server non confermata: nessuna scrittura.");
  };
  /** A released book is the client's again: nothing is written for it on this server. */
  const assertWritable = (book: BookProject) => {
    assertLocalAuthority(book);
    if (isReleasedBook(book)) throw new Error("Libro rilasciato al client: nessuna scrittura sul server.");
  };
  const stamp = (book: BookProject, previous: BookProject) => {
    book.updatedAt = new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString();
  };
  const queue = async (record: Awaited<ReturnType<typeof store.read>>) => {
    if (!record) return;
    await enqueueCheckpoint(record.book, { get: async () => record.outbox, put: async value => { record.outbox = value; } });
  };
  const save = async (book: BookProject, queueSync: boolean, expected?: string, activity?: Activity, checkpoint = true) => {
    const written = await store.transaction(book.id, async record => {
      if (expected !== undefined && record.book.updatedAt !== expected) throw new BookRevisionConflict();
      assertWritable(record.book); assertLocalAuthority(book);
      if (record.book.executionAuthority?.epoch !== book.executionAuthority?.epoch)
        throw new Error("Autorità del libro cambiata.");
      const previous = record.book;
      const next = structuredClone(book); stamp(next, record.book); record.book = next;
      if (record.retrySchedule && record.retrySchedule.bookStamp !== retryStamp(narrativeStateJson(next)))
        delete record.retrySchedule;
      if (activity) {
        if (activity.bookId !== book.id) throw new Error("Attività di un altro libro.");
        record.activities = [...record.activities.filter(a => a.id !== activity.id), structuredClone(activity)];
        if (checkpoint && activity.status === "succeeded") {
          record.structuralCheckpoints ??= {};
          if (record.structuralCheckpoints[activity.id]) throw new Error("Checkpoint del task già presente.");
          record.structuralCheckpoints[activity.id] = createTaskStructuralCheckpoint(previous, next, activity);
        }
        if (activity.status === "succeeded" && record.retrySchedule?.runId === activity.runId) delete record.retrySchedule;
      }
      if (queueSync) await queue(record);
      return next.updatedAt;
    });
    book.updatedAt = written;
  };
  const scopedSettings = () => {
    const id = scope.getStore();
    const result = structuredClone(settings);
    result.githubToken = id ? bookTokens[id] ?? null : null;
    return result;
  };
  const runtime: HostRuntime = {
    kind: "node",
    transaction: (id, action) => store.transaction(id, async record => {
      assertWritable(record.book);
      const epoch = record.book.executionAuthority?.epoch;
      const result = await action(record);
      assertLocalAuthority(record.book);
      if (record.book.id !== id || record.book.executionAuthority?.epoch !== epoch)
        throw new Error("Autorità o identità del libro cambiata.");
      return result;
    }),
    getBook: async id => (await store.read(id))?.book,
    getBookForMutation: async id => {
      const book = (await store.read(id))?.book;
      if (book) assertWritable(book);
      return book;
    },
    listBookIds: () => store.ids(),
    listBooks: async () => (await store.list()).map(r => r.book),
    readOutbox: async id => (await store.read(id))?.outbox,
    listOutbox: async () => {
      const entries = [];
      // Never load all manuscripts/audits concurrently just to inspect a small queue.
      for (const id of await store.ids()) { const outbox = (await store.read(id))?.outbox; if (outbox) entries.push(outbox); }
      return entries;
    },
    readManualPushIntent: async id => (await store.read(id))?.manualPushIntent,
    readRetrySchedule: async id => (await store.read(id))?.retrySchedule,
    loadSettings: async () => scopedSettings(),
    loadRetrySettings: async id => id ? store.serial(id, async () => {
      const record = await store.read(id);
      return { settings: scopedSettings(), epoch: retrySettingsEpoch, book: record?.book, plan: record?.retrySchedule };
    }) : { settings: scopedSettings(), epoch: retrySettingsEpoch },
    saveSettings: async (next, isCurrent) => store.serial("$config", async () => {
      verifyEndpointSettings(next);
      if (isCurrent && !isCurrent()) throw new BookRevisionConflict();
      await commitSettings(structuredClone(next), bookTokens);
    }),
    saveBook: (book, sync, expected) => save(book, sync, expected),
    saveActivity: async activity => { await runtime.transaction(activity.bookId, record => {
      record.activities = [...record.activities.filter(a => a.id !== activity.id), structuredClone(activity)];
    }); },
    saveBookAndActivity: (book, activity, expected) => save(book, activity.status === "succeeded", expected, activity),
    saveBookWithAuthorActivity: (book, activity, expected) => save(book, true, expected, activity, false),
    listActivities: async id => (await store.read(id))?.activities ?? [],
    encrypt: text => vault.encrypt(text), decrypt: value => vault.decrypt(value),
    tryLock: async (name, action) => {
      if (held.has(name)) return { held: false };
      held.add(name);
      try { return { held: true, value: await action() }; } finally { held.delete(name); }
    },
    withBookScope: (id, action) => scope.run(id, action),
    getMeta: async key => structuredClone(meta[key]),
    putMeta: async (key, value) => store.serial("$meta", async () => {
      const next = { ...meta, [key]: structuredClone(value) };
      await atomicJson(metaFile, next); Object.assign(meta, next);
    }),
    // What the shared writer guard still asks of this host: who may write, and what else serialises a run.
    ...(options?.git ? { gitHub: options.git } : {}),
    admission: {
      owns,
      assert: async (book, signal) => {
        assertWritable(book);
        await options?.assertAuthority?.(book, signal);
      },
      locks: book => [book.remote ? "bookwriter:github-run" : "bookwriter:local-run:" + book.id],
    },
  };
  const dispose = installHostRuntime(runtime);
  async function commitSettings(next: AppSettings, bindings: typeof bookTokens) {
    const revision = configRevision + 1;
    const nextEpoch = sameRetrySettings(settings, next) ? retrySettingsEpoch : crypto.randomUUID();
    await atomicJson(configFile, { version: 1, revision, settings: next, bookTokens: bindings, retrySettingsEpoch: nextEpoch });
    settings = next; bookTokens = bindings; configRevision = revision;
    retrySettingsEpoch = nextEpoch;
    return { revision };
  }
  function checkRevision(expected: number) {
    if (configRevision !== expected) throw new ApiError(412, "configuration_revision", "Configurazione server cambiata: ricontrollala prima di inviare.");
  }
  async function patBindings(bookId: string, token: string | null) {
    const record = await store.read(bookId);
    if (!record) throw new ApiError(404, "book_missing", "Libro non trovato per il PAT.");
    assertLocalAuthority(record.book);
    const bindings = { ...bookTokens };
    if (token === null) delete bindings[bookId];
    else bindings[bookId] = await vault.encrypt(token);
    return bindings;
  }
  return {
    runtime, dispose,
    /** Adoption reads the repository BEFORE the book exists: its credential is bound to the book id first. */
    stageBookPat: (bookId: string, token: string) => store.serial("$config", async () => {
      await commitSettings(settings, { ...bookTokens, [bookId]: await vault.encrypt(token) });
    }),
    /** A released book no longer needs the credential the client delegated for it. */
    revokeBookPat: (bookId: string) => store.serial("$config", async () => {
      if (!bookTokens[bookId]) return;
      const bindings = { ...bookTokens }; delete bindings[bookId];
      await commitSettings(settings, bindings);
    }),
    dropBookPat: (bookId: string) => store.serial("$config", async () => {
      if (!bookTokens[bookId] || await store.read(bookId)) return;
      const bindings = { ...bookTokens }; delete bindings[bookId];
      await commitSettings(settings, bindings);
    }),
    configuration: () => ({ revision: configRevision, settings: projectSettings(settings),
      endpointKeys: settings.endpoints.filter(e => e.secret && e.authMode !== "none").map(e => e.id),
      githubBooks: Object.keys(bookTokens) }),
    setBookPat: (bookId: string, token: string | null, expected: number, authorize: () => void) => store.serial("$config", async () => {
      checkRevision(expected);
      const bindings = await patBindings(bookId, token);
      authorize();
      return commitSettings(settings, bindings);
    }),
    provision: async (input: {
      settings: unknown; endpointKeys: Record<string, string | null>;
      bookId?: string; githubToken?: string | null;
    }, expected: number, allowedBases: string[], authorize: () => void = () => undefined) => store.serial("$config", async () => {
      checkRevision(expected);
      const publicSettings = cloudSettingsSchema.parse(input.settings);
      if (publicSettings.endpoints.some(e => !allowedBases.includes(e.baseUrl)))
        throw new ApiError(422, "endpoint_not_approved", "Approva le basi AI nel pannello locale prima di inviarle.");
      const ids = new Set(publicSettings.endpoints.map(e => e.id));
      if (ids.size !== publicSettings.endpoints.length || Object.keys(input.endpointKeys).some(id => !ids.has(id)))
        throw new ApiError(422, "endpoint_keys", "Identificativi degli endpoint o delle chiavi non validi.");
      const endpoints = await Promise.all(publicSettings.endpoints.map(async endpoint => {
        const key = Object.hasOwn(input.endpointKeys, endpoint.id) ? input.endpointKeys[endpoint.id] : undefined;
        const mode = endpointAuthMode(endpoint.authMode, endpoint.baseUrl);
        if (typeof key === "string" && (!key.trim() || mode === "none"))
          throw new ApiError(422, "endpoint_keys", "Non si può delegare una chiave vuota o per un endpoint senza autenticazione.");
        const secret = mode === "none" || key === null ? null : typeof key === "string" ? await vault.encrypt(key)
          : settings.endpoints.find(e => e.id === endpoint.id && e.baseUrl === endpoint.baseUrl && e.authMode !== "none")?.secret ?? null;
        return { ...endpoint, secret };
      }));
      const next = { ...structuredClone(DEFAULT_SETTINGS), ...publicSettings, endpoints };
      verifyEndpointSettings(next);
      if (input.githubToken !== undefined && !input.bookId) throw new ApiError(422, "book_missing", "Indica il libro per il PAT.");
      const bindings = input.githubToken !== undefined && input.bookId ? await patBindings(input.bookId, input.githubToken) : bookTokens;
      authorize();
      return commitSettings(next, bindings);
    }),
  };
}
