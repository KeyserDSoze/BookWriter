import { host as installedHost, type HostRuntime } from "../core/host";
import { BookNotFound, BookRevisionConflict } from "../core/errors";
import { DEFAULT_SETTINGS, newBook, type Activity, type BookProject, type SyncOutboxItem } from "../domain/types";
import { makeRetrySchedule, retryStamp } from "../core/retry-policy";
import { narrativeStateJson } from "../core/narrative-state";
import { acknowledgeOutbox, enqueueIfUnsaved, markAttempt, getOutbox, recordSyncFailure } from "../infrastructure/outbox";
import { prepareManualPushIntent } from "../infrastructure/manual-push-intent";
import { claimRetrySchedule, getRetrySchedule, saveFailedRetry } from "../infrastructure/retry-schedule";
import { persistRemoteAcknowledgment } from "../infrastructure/github-sync";

/**
 * The behaviour the engine relies on from ANY host, written once. The browser host (IndexedDB) and the
 * server host (files) both run exactly these cases, with their own runner: if a host drifts from the
 * port, the same case fails on it. The cases also run real engine code (outbox, retry, push intent,
 * ACK) on the host under test, so "one engine" is checked and not only claimed.
 */
export interface ContractAsserts {
  ok(value: unknown, message?: string): void;
  equal(actual: unknown, expected: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  rejects(promise: Promise<unknown>, accept: (error: unknown) => boolean, message?: string): Promise<void>;
}
export interface ContractEnv {
  /** The host under test, already installed as the engine's host. */
  host: HostRuntime;
  /** Stores a brand-new book exactly as given, in the host's own storage. */
  seed(book: BookProject): Promise<void>;
}
export interface ContractCase { name: string; run(env: ContractEnv, t: ContractAsserts): Promise<void> }

const sha = (char: string) => char.repeat(40);
function paused(title: string): BookProject {
  const book = newBook("Storia sintetica", title, "Chiaro", "Adulti");
  book.status = "paused";
  return book;
}
function linked(title: string): BookProject {
  const book = paused(title);
  book.remote = { owner: "synthetic", repository: "book", branch: "main", autoSync: true, lastSyncedCommit: sha("a") };
  return book;
}
function activityOf(book: BookProject, status: Activity["status"], runId: string = crypto.randomUUID()): Activity {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), bookId: book.id, runId, phase: "brainstorm", title: "Task sintetico", reason: "Contratto",
    nextStep: "Nessuno", status, aiRequested: status === "failed", createdAt: now, endedAt: now };
}
const queueItem = (bookId: string): SyncOutboxItem => ({
  bookId, operationId: crypto.randomUUID(), revision: 1, requestedAt: new Date().toISOString(), state: "pending", attempts: 0,
});
const isNotFound = (error: unknown) => error instanceof BookNotFound;
const isConflict = (error: unknown) => error instanceof BookRevisionConflict;

export const hostContract: ContractCase[] = [
  { name: "the installed host is the one the engine uses", async run({ host }, t) {
    t.ok(installedHost() === host, "the engine resolves the host that was installed");
  } },

  { name: "a missing book is BookNotFound, never a generic error and never an empty record", async run({ host }, t) {
    const id = crypto.randomUUID();
    t.equal(await host.getBook(id), undefined);
    await t.rejects(host.transaction(id, () => undefined), isNotFound);
  } },

  { name: "a transaction commits book, queue, manual-push intent and log together", async run({ host, seed }, t) {
    const book = linked("commit insieme"); await seed(book);
    const run = activityOf(book, "succeeded");
    const intent = { bookId: book.id, operationId: crypto.randomUUID(), owner: "synthetic", repository: "book", branch: "main",
      baseSha: sha("a"), sourceRevision: book.updatedAt, preparedAt: new Date().toISOString() };
    await host.transaction(book.id, record => {
      record.book.title = "Titolo cambiato";
      record.outbox = queueItem(book.id);
      record.manualPushIntent = intent;
      record.activities = [...record.activities, run];
    }, { activities: true });
    t.equal((await host.getBook(book.id))?.title, "Titolo cambiato");
    t.equal((await host.readOutbox(book.id))?.state, "pending");
    t.deepEqual(await host.readManualPushIntent(book.id), intent);
    t.deepEqual((await host.listActivities(book.id)).map(a => a.id), [run.id]);
    t.deepEqual((await host.listOutbox()).filter(item => item.bookId === book.id).length, 1);
  } },

  { name: "a transaction that throws writes nothing", async run({ host, seed }, t) {
    const book = linked("annullata"); await seed(book);
    await t.rejects(host.transaction(book.id, record => {
      record.book.title = "Mai scritto"; record.outbox = queueItem(book.id);
      throw new Error("annulla");
    }), error => error instanceof Error && error.message === "annulla");
    t.equal((await host.getBook(book.id))?.title, book.title);
    t.equal(await host.readOutbox(book.id), undefined);
  } },

  { name: "a transaction that changes nothing leaves the book as it was", async run({ host, seed }, t) {
    const book = paused("immutata"); await seed(book);
    const before = JSON.stringify(await host.getBook(book.id));
    t.equal(await host.transaction(book.id, record => record.book.title), book.title);
    t.equal(JSON.stringify(await host.getBook(book.id)), before);
  } },

  { name: "saveBook is compare-and-swap on the revision the caller saw", async run({ host, seed }, t) {
    const book = paused("cas"); await seed(book);
    const seen = book.updatedAt;
    const edited = structuredClone(book); edited.title = "Prima modifica";
    await host.saveBook(edited, false, seen);
    t.ok(Date.parse(edited.updatedAt) > Date.parse(seen), "the revision moves forward");
    const stale = structuredClone(book); stale.title = "Da una copia vecchia";
    await t.rejects(host.saveBook(stale, false, seen), isConflict);
    t.equal((await host.getBook(book.id))?.title, "Prima modifica");
  } },

  { name: "saveBookAndActivity stores the book and its log entry as one commit", async run({ host, seed }, t) {
    const book = paused("libro e attività"); await seed(book);
    const seen = book.updatedAt;
    const next = structuredClone(book); next.brief = "Trama aggiornata dal task";
    const run = activityOf(book, "succeeded");
    await host.saveBookAndActivity(next, run, seen);
    t.equal((await host.getBook(book.id))?.brief, "Trama aggiornata dal task");
    t.deepEqual((await host.listActivities(book.id)).map(a => a.id), [run.id]);
    const stale = structuredClone(book); stale.brief = "Vecchia";
    const second = activityOf(book, "succeeded");
    await t.rejects(host.saveBookAndActivity(stale, second, seen), isConflict);
    t.deepEqual((await host.listActivities(book.id)).map(a => a.id), [run.id], "a refused commit leaves no log entry");
  } },

  { name: "tryLock is exclusive, does not wait, and is released even after an error", async run({ host }, t) {
    const name = "contratto:" + crypto.randomUUID();
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    let entered!: () => void;
    const inside = new Promise<void>(done => { entered = done; });
    const first = host.tryLock(name, async () => { entered(); await gate; return "primo"; });
    await inside;
    t.deepEqual(await host.tryLock(name, async () => "secondo"), { held: false });
    release();
    t.deepEqual(await first, { held: true, value: "primo" });
    await t.rejects(host.tryLock(name, async () => { throw new Error("fallita"); }),
      error => error instanceof Error && error.message === "fallita");
    t.deepEqual(await host.tryLock(name, async () => "dopo l'errore"), { held: true, value: "dopo l'errore" });
  } },

  { name: "device secrets round-trip and a tampered one is refused", async run({ host }, t) {
    const secret = await host.encrypt("sk-segreto-sintetico");
    t.ok(!JSON.stringify(secret).includes("sk-segreto-sintetico"), "the stored form is not the plaintext");
    t.equal(await host.decrypt(secret), "sk-segreto-sintetico");
    const flipped = { ...secret, data: secret.data.slice(0, -4) + (secret.data.endsWith("AAAA") ? "BBBB" : "AAAA") };
    await t.rejects(host.decrypt(flipped), () => true);
  } },

  { name: "small device records round-trip as JSON", async run({ host }, t) {
    const key = "contratto-meta:" + crypto.randomUUID();
    t.equal(await host.getMeta(key), undefined);
    await host.putMeta(key, { elenco: ["a", "b"], numero: 3 });
    t.deepEqual(await host.getMeta(key), { elenco: ["a", "b"], numero: 3 });
  } },

  { name: "the save queue: queue, attempt, failure with back-off, and an ACK for exactly what was sent", async run({ host, seed }, t) {
    const book = linked("coda"); await seed(book);
    t.equal(await enqueueIfUnsaved(book.id), "queued");
    const item = (await getOutbox(book.id))!;
    t.equal(item.state, "pending");
    t.ok(await markAttempt(item), "the attempt is granted");
    t.equal((await getOutbox(book.id))?.state, "syncing");
    await recordSyncFailure(book.id, item.operationId, "rete assente", false);
    const failed = (await getOutbox(book.id))!;
    t.equal(failed.state, "pending"); t.ok(failed.retryAfter, "a retry time is set"); t.equal(failed.lastError, "rete assente");
    t.ok(!await markAttempt(failed), "an attempt before the back-off ends is refused");
    t.ok(await markAttempt(failed, true), "«save now» ignores the back-off");
    // Acknowledged revision equals the stored one: the request is done.
    const stored = (await host.getBook(book.id))!;
    await acknowledgeOutbox(book.id, failed.operationId, stored.updatedAt);
    t.equal(await getOutbox(book.id), undefined);
  } },

  { name: "the remote ACK keeps newer work queued and refuses a foreign baseline", async run({ host, seed }, t) {
    const book = linked("ack"); await seed(book);
    t.equal(await enqueueIfUnsaved(book.id), "queued");
    const queued = (await getOutbox(book.id))!;
    const remote = { owner: "synthetic", repository: "book", branch: "main" };
    // The book moved on while GitHub was receiving the commit that described an older revision.
    await persistRemoteAcknowledgment(book.id, remote, sha("b"), "2000-01-01T00:00:00.000Z", queued.operationId, sha("a"));
    const stored = (await host.getBook(book.id))!;
    t.equal(stored.remote?.lastSyncedCommit, sha("b"));
    t.equal(stored.remote?.lastSyncedLocalUpdatedAt, "2000-01-01T00:00:00.000Z");
    t.equal(stored.updatedAt, book.updatedAt, "an ACK alone never moves the book's revision");
    const rotated = (await getOutbox(book.id))!;
    t.equal(rotated.state, "pending"); t.ok(rotated.operationId !== queued.operationId, "the request is rotated, not dropped");
    await t.rejects(persistRemoteAcknowledgment(book.id, { ...remote, branch: "altro" }, sha("c"), book.updatedAt, rotated.operationId, sha("b")),
      error => error instanceof Error && error.name === "RemoteConflict");
    t.equal((await host.getBook(book.id))?.remote?.lastSyncedCommit, sha("b"), "a foreign ACK changes nothing");
  } },

  { name: "a manual push intent is created once, reused, and released only by its own ACK", async run({ host, seed }, t) {
    const book = linked("intento"); book.remote!.autoSync = false; await seed(book);
    const first = await prepareManualPushIntent(book.id);
    t.deepEqual(await prepareManualPushIntent(book.id), first, "the same operation is reused after a reload");
    t.deepEqual(await host.readManualPushIntent(book.id), first);
    await persistRemoteAcknowledgment(book.id, { owner: "synthetic", repository: "book", branch: "main" }, sha("b"),
      book.updatedAt, crypto.randomUUID(), sha("a"));
    t.ok(await host.readManualPushIntent(book.id), "another operation's ACK does not release the intent");
    await persistRemoteAcknowledgment(book.id, { owner: "synthetic", repository: "book", branch: "main" }, sha("c"),
      book.updatedAt, first.operationId, sha("b"));
    t.equal(await host.readManualPushIntent(book.id), undefined);
  } },

  { name: "long-term retry: the failed attempt and the wait commit together, and the wait is claimed once", async run({ host, seed }, t) {
    const book = paused("retry"); await seed(book);
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.endpoints[0]!.longTermRetry = { enabled: true, intervalMinutes: 1, maxCycles: 3 };
    await host.saveSettings(settings);
    const runId = crypto.randomUUID();
    const plan = makeRetrySchedule({ bookId: book.id, runId, endpointId: "openai", modelId: "mock",
      bookStamp: retryStamp(narrativeStateJson(book)), taskKey: retryStamp("brainstorm:contratto"),
      policy: settings.endpoints[0]!.longTermRetry!, authorizedPolicies: { openai: settings.endpoints[0]!.longTermRetry! },
      cyclesUsed: 0, now: Date.now() })!;
    const attempt = activityOf(book, "failed", runId);
    await t.rejects(saveFailedRetry(book, attempt, "token-vecchio", plan), () => true);
    t.equal((await host.listActivities(book.id)).length, 0, "a refused save leaves neither wait nor log");
    t.equal(await getRetrySchedule(book.id), undefined);
    await saveFailedRetry(book, attempt, book.updatedAt, plan);
    t.equal((await getRetrySchedule(book.id))?.runId, runId);
    const log = await host.listActivities(book.id);
    t.equal(log.length, 1); t.equal(log[0]?.aiRequested, true);
    t.equal(log[0]?.inputTokens, undefined, "unknown usage stays unknown");
    const claims = await Promise.allSettled([claimRetrySchedule(book.id, plan.generation, true), claimRetrySchedule(book.id, plan.generation, true)]);
    t.equal(claims.filter(claim => claim.status === "fulfilled").length, 1, "exactly one claimant wins the wait");
  } },
];
