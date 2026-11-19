import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import {
  installHostRuntime, BookRevisionConflict, enqueueCheckpoint,
  DEFAULT_SETTINGS, type HostRuntime, type BookProject, type Activity, type AppSettings,
  createTaskStructuralCheckpoint, verifyEndpointSettings,
  cloudSettingsSchema, projectSettings, type EncryptedSecret,
  retryStamp, narrativeStateJson,
} from "@engine/index";
import { atomicJson, FileBookStore, readJson } from "./files";
import { Vault } from "./vault";

export async function createRuntime(store: FileBookStore, vault: Vault, options?: {
  serverId: string; assertAuthority?: (book: BookProject) => Promise<void>;
}) {
  const scope = new AsyncLocalStorage<string>();
  const held = new Set<string>();
  const configFile = join(store.root, "private", "settings.json");
  const saved = await readJson(configFile, 1024 * 1024) as {
    version: number; revision: number; settings: AppSettings; bookTokens: Record<string, EncryptedSecret>;
  } | undefined;
  if (saved && (saved.version !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision < 0))
    throw new Error("Configurazione server non valida.");
  let settings = saved?.settings ?? structuredClone(DEFAULT_SETTINGS);
  let configRevision = saved?.revision ?? 0;
  let bookTokens: Record<string, EncryptedSecret> = saved?.bookTokens ?? {};
  const metaFile = join(store.root, "private", "meta.json");
  const meta = await readJson(metaFile, 1024 * 1024) as Record<string, unknown> | undefined ?? {};
  verifyEndpointSettings(settings);
  const assertAuthority = async (book: BookProject) => {
    if (options && book.executionAuthority?.serverId !== options.serverId)
      throw new Error("Autorità del server non confermata: nessuna scrittura.");
    await options?.assertAuthority?.(book);
  };
  const stamp = (book: BookProject, previous: BookProject) => {
    book.updatedAt = new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString();
  };
  const queue = async (record: Awaited<ReturnType<typeof store.read>>) => {
    if (!record) return;
    await enqueueCheckpoint(record.book, { get: async () => record.outbox, put: async value => { record.outbox = value; } });
  };
  const save = async (book: BookProject, queueSync: boolean, expected?: string, activity?: Activity) => {
    const written = await store.transaction(book.id, async record => {
      if (expected !== undefined && record.book.updatedAt !== expected) throw new BookRevisionConflict();
      if (options && (record.book.executionAuthority?.serverId !== options.serverId ||
          record.book.executionAuthority.epoch !== book.executionAuthority?.epoch))
        throw new Error("Autorità del libro cambiata.");
      const previous = record.book;
      const next = structuredClone(book); stamp(next, record.book); record.book = next;
      if (record.retrySchedule && record.retrySchedule.bookStamp !== retryStamp(narrativeStateJson(next)))
        delete record.retrySchedule;
      if (activity) {
        if (activity.bookId !== book.id) throw new Error("Attività di un altro libro.");
        record.activities = [...record.activities.filter(a => a.id !== activity.id), structuredClone(activity)];
        if (activity.status === "succeeded") {
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
  const runtime: HostRuntime = {
    kind: "node",
    transaction: (id, action) => store.transaction(id, action),
    getBook: async id => (await store.read(id))?.book,
    getBookForMutation: async id => (await store.read(id))?.book,
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
    loadSettings: async () => {
      const id = scope.getStore();
      const result = structuredClone(settings);
      result.githubToken = id ? bookTokens[id] ?? null : null;
      return result;
    },
    saveSettings: async next => store.serial("$config", async () => {
      verifyEndpointSettings(next);
      const revision = configRevision + 1;
      await atomicJson(configFile, { version: 1, revision, settings: next, bookTokens });
      settings = structuredClone(next); configRevision = revision;
    }),
    saveBook: (book, sync, expected) => save(book, sync, expected),
    saveActivity: async activity => { await store.transaction(activity.bookId, record => {
      record.activities = [...record.activities.filter(a => a.id !== activity.id), structuredClone(activity)];
    }); },
    saveBookAndActivity: (book, activity, expected) => save(book, activity.status === "succeeded", expected, activity),
    saveBookWithAuthorActivity: (book, activity, expected) => save(book, activity.status === "succeeded", expected, activity),
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
    admission: {
      assert: assertAuthority,
      locks: book => [book.remote ? "bookwriter:github-run" : "bookwriter:local-run:" + book.id],
    },
  };
  const dispose = installHostRuntime(runtime);
  return {
    runtime, dispose,
    configuration: () => ({ revision: configRevision, settings: projectSettings(settings),
      endpointKeys: settings.endpoints.filter(e => e.secret).map(e => e.id),
      githubBooks: Object.keys(bookTokens) }),
    provision: async (input: {
      settings: unknown; endpointKeys: Record<string, string>;
      bookId?: string; githubToken?: string | null;
    }, expected: number, allowedBases: string[]) => store.serial("$config", async () => {
      if (configRevision !== expected) throw new BookRevisionConflict();
      const publicSettings = cloudSettingsSchema.parse(input.settings);
      if (publicSettings.endpoints.some(e => !allowedBases.includes(e.baseUrl)))
        throw new Error("Endpoint non approvato nel pannello locale del server.");
      const endpoints = await Promise.all(publicSettings.endpoints.map(async endpoint => ({
        ...endpoint, secret: input.endpointKeys[endpoint.id]
          ? await vault.encrypt(input.endpointKeys[endpoint.id]!)
          : settings.endpoints.find(e => e.id === endpoint.id && e.baseUrl === endpoint.baseUrl)?.secret ?? null,
      })));
      const next = { ...structuredClone(DEFAULT_SETTINGS), ...publicSettings, endpoints };
      verifyEndpointSettings(next);
      const bindings = { ...bookTokens };
      if (input.githubToken !== undefined) {
        if (!input.bookId || !await store.read(input.bookId)) throw new Error("Libro non trovato per il PAT.");
        if (input.githubToken === null) delete bindings[input.bookId];
        else bindings[input.bookId] = await vault.encrypt(input.githubToken);
      }
      const revision = configRevision + 1;
      await atomicJson(configFile, { version: 1, revision, settings: next, bookTokens: bindings });
      settings = next; bookTokens = bindings; configRevision = revision;
      return { revision };
    }),
  };
}
