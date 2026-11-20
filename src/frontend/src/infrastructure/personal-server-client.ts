import { z } from "zod";
import {
  normalizeServerUrl, serverInfoSchema, serverConnectionSchema, serverSessionSchema,
  serverCommandEnvelopeSchema, serverCommandReceiptSchema, serverCommandDigestInput,
  serverConfigurationSchema, serverBookCreationInputSchema,
  type ServerInfo, type ServerConnection, type ServerCommand, type ServerSession, type ServerCommandReceipt,
  type ServerBookCreationInput, type ServerConfiguration,
} from "@engine/domain/personal-server";
import { bookSchema, activitySchema } from "@engine/domain/book-schema";
import { getDb, loadSettings } from "./db";
import { encryptLocal, decryptLocal } from "./crypto";
import type { AppSettings, BookProject, Activity } from "@engine/domain/types";
import { BOOK_FORMAT_VERSION } from "@engine/domain/book-format";
import { cloudSettingsSignature, projectSettings } from "@engine/domain/cloud-profile";
import { retryScheduleSchema, type RetrySchedule } from "@engine/core/retry-policy";
import {
  serverCommandJournalKey, readServerCommandJournal, MAX_PENDING_SERVER_COMMANDS,
  assertCommandConnection, commandMatchesConnection, settleCommandJournal, type PendingServerCommand,
} from "./personal-server-command-journal";

export const SERVER_CONNECTION_KEY = "personal-server:connection:v1";
export const SERVER_CREATE_INTENT_KEY = "personal-server:create:v1";
export const replicaKey = (id: string) => "personal-server:replica:v1:" + id;
const pendingCreationSchema = z.object({
  commandId: z.string().uuid(), clientId: z.string().uuid(), serverId: z.string().uuid(),
  baseUrl: z.string().max(500), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  input: serverBookCreationInputSchema, preparedAt: z.string().datetime(),
}).strict();
export type PendingPersonalServerCreation = z.infer<typeof pendingCreationSchema>;
let generation = 0;
const b64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const hex = (value: Uint8Array) => [...value].map(n => n.toString(16).padStart(2, "0")).join("");
export class ServerRequestError extends Error {
  constructor(readonly status?: number) {
    super(status === 401 ? "Token del server assente, scaduto o revocato." :
      status === 403 ? "Permesso o origine del client non autorizzati." :
      status === 409 || status === 412 ? "Stato remoto cambiato: aggiorna la replica e conserva la bozza." :
      status === 413 ? "Dati oltre il limite del server: nessun contenuto troncato." :
      status === 422 ? "Richiesta non valida o consenso mancante." :
      "Server non raggiungibile o operazione non confermata. Non è autorizzato un fallback locale.");
  }
}
async function http(base: string, path: string, options: {
  method?: string; body?: unknown; token?: string; etag?: string; maxBytes?: number;
} = {}): Promise<{ data: unknown; etag: string | null }> {
  const controller = new AbortController();
  let expired!: () => void;
  const deadline = new Promise<never>((_, reject) => { expired = () => reject(new ServerRequestError()); });
  controller.signal.addEventListener("abort", expired, { once: true });
  const timer = setTimeout(() => controller.abort(), (options.maxBytes ?? 16_384) > 1_048_576 ? 120_000 : 20_000);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const requested = fetch(normalizeServerUrl(base) + path, {
      method: options.method ?? "GET", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
      signal: controller.signal, headers: {
        ...(options.token ? { apikey: options.token } : {}),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.etag ? { "If-Match": options.etag } : {}),
      }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    // Abort alone is not a deadline if a stalled fetch/reader ignores it.
    void requested.then(late => {
      if (controller.signal.aborted) try { void late.body?.cancel().catch(() => undefined); } catch { /* best effort */ }
    }, () => undefined);
    response = await Promise.race([requested, deadline]);
    if (!response.ok) throw new ServerRequestError(response.status);
    if (!/^application\/json\b/i.test(response.headers.get("content-type") ?? "") || !response.body)
      throw new ServerRequestError();
    const max = options.maxBytes ?? 16_384;
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) throw new ServerRequestError(413);
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      length += part.value.byteLength;
      if (length > max) throw new ServerRequestError(413);
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), etag: response.headers.get("etag") };
  } catch (error) { throw error instanceof ServerRequestError ? error : new ServerRequestError(); }
  finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", expired);
    try { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => undefined); } catch { /* best effort */ }
    try { reader?.releaseLock(); } catch { /* best effort */ }
  }
}

export async function probePersonalServer(baseUrl: string, expected?: Pick<ServerInfo, "serverId" | "publicKey">): Promise<ServerInfo> {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  const { data } = await http(baseUrl, "/api/v1/info?nonce=" + nonce);
  const info = serverInfoSchema.parse(data);
  if (info.nonce !== nonce || expected && (info.serverId !== expected.serverId || info.publicKey !== expected.publicKey))
    throw new Error("Identità del server diversa: non inviare credenziali. Serve una nuova approvazione locale.");
  const key = await crypto.subtle.importKey("spki", b64(info.publicKey), { name: "Ed25519" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("Ed25519", key, b64(info.signature),
    new TextEncoder().encode(nonce + "\n" + info.serverId + "\n" + info.publicKey));
  const fingerprint = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", b64(info.publicKey))));
  if (!valid || fingerprint !== info.fingerprint) throw new Error("Firma dell'identità server non valida.");
  if (info.bookFormatVersion > BOOK_FORMAT_VERSION)
    throw new Error("Il server usa un formato libro più recente: aggiorna il client prima di inviare token o comandi.");
  return info;
}
export async function personalServerConnection(): Promise<ServerConnection | undefined> {
  const raw = await (await getDb()).get("meta", SERVER_CONNECTION_KEY);
  return raw === undefined ? undefined : serverConnectionSchema.parse(raw);
}
export async function connectPersonalServer(base: string, token: string, expected: ServerInfo, current: () => boolean = () => true): Promise<ServerSession> {
  const ticket = ++generation;
  const baseUrl = normalizeServerUrl(base);
  const info = await probePersonalServer(baseUrl, expected);
  if (ticket !== generation || !current()) throw new Error("Connessione modificata: verifica di nuovo.");
  const { data } = await http(baseUrl, "/api/v1/session", { token });
  const session = serverSessionSchema.parse(data);
  const encrypted = await encryptLocal(token);
  const connection: ServerConnection = { id: crypto.randomUUID(), baseUrl, serverId: info.serverId,
    publicKey: info.publicKey, fingerprint: info.fingerprint, clientId: session.clientId, token: encrypted };
  const db = await getDb();
  const tx = db.transaction("meta", "readwrite");
  void tx.done.catch(() => undefined);
  if (ticket !== generation || !current()) { tx.abort(); throw new Error("Connessione modificata durante il salvataggio."); }
  await tx.store.put(connection, SERVER_CONNECTION_KEY); await tx.done;
  announceServerConnectionChange();
  return session;
}
export async function disconnectPersonalServer(): Promise<void> {
  generation++;
  await (await getDb()).delete("meta", SERVER_CONNECTION_KEY);
  announceServerConnectionChange();
}
export const SERVER_CONNECTION_EVENT = "bookwriter:server-connection";
function announceServerConnectionChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SERVER_CONNECTION_EVENT));
}
export const sameConnection = (a: unknown, b: unknown) => {
  const left = serverConnectionSchema.safeParse(a), right = serverConnectionSchema.safeParse(b);
  return left.success && right.success && JSON.stringify(left.data) === JSON.stringify(right.data);
};
export async function connectionRequest(connection: ServerConnection, path: string, options: Parameters<typeof http>[2] = {},
  beforeSend?: () => Promise<void>) {
  const expectedGeneration = generation;
  if (!sameConnection(await personalServerConnection(), connection)) throw new Error("Connessione server cambiata.");
  await probePersonalServer(connection.baseUrl, connection);
  const token = await decryptLocal(connection.token);
  await beforeSend?.();
  if (expectedGeneration !== generation || !sameConnection(await personalServerConnection(), connection))
    throw new Error("Connessione server cambiata prima dell'invio.");
  const response = await http(connection.baseUrl, path, { ...options, token });
  if (expectedGeneration !== generation || !sameConnection(await personalServerConnection(), connection))
    throw new Error("Risposta di una connessione superata: nessuna replica aggiornata.");
  return response;
}
const replicaSchema = z.object({
  book: bookSchema, activities: z.array(activitySchema).max(50_000), revision: z.number().int().min(0),
  nextSequence: z.number().int().min(1), retrySchedule: retryScheduleSchema.nullable(), hasManualPushIntent: z.boolean(),
}).strict();
export async function syncServerBook(connection: ServerConnection, bookId: string): Promise<BookProject> {
  return syncSnapshot(connection, bookId);
}
export interface SnapshotSettlement {
  /** A command whose receipt is confirmed by this very snapshot. */
  command?: { pending: PendingServerCommand; receipt: ServerCommandReceipt };
  /** The adoption marker that this snapshot closes (same transaction). */
  handoffId?: string;
  /** Clear just this creation intent, together with the verified replica. */
  creationId?: string;
}
export async function syncSnapshot(connection: ServerConnection, bookId: string, settlement?: SnapshotSettlement): Promise<BookProject> {
  z.string().uuid().parse(bookId);
  const response = await connectionRequest(connection, `/api/v1/books/${bookId}/snapshot`, { maxBytes: 80 * 1024 * 1024 });
  const replica = replicaSchema.parse(response.data);
  const book = replica.book as BookProject;
  if (book.id !== bookId || book.executionAuthority?.serverId !== connection.serverId ||
      replica.activities.some(a => a.bookId !== bookId) ||
      response.etag !== `"${book.executionAuthority.epoch}:${replica.revision}"`)
    throw new Error("Snapshot del server non coerente con il libro e l'autorità verificati.");
  const db = await getDb();
  const tx = db.transaction(["books", "activities", "outbox", "meta"], "readwrite");
  void tx.done.catch(() => undefined);
  try {
    const storedConnection = await tx.objectStore("meta").get(SERVER_CONNECTION_KEY);
    const previous = await tx.objectStore("books").get(bookId) as BookProject | undefined;
    const cursor = await tx.objectStore("meta").get(replicaKey(bookId)) as { revision: number; epoch: string } | undefined;
    if (!sameConnection(storedConnection, connection) ||
        previous && (previous.executionAuthority?.serverId !== connection.serverId ||
          previous.executionAuthority.epoch !== book.executionAuthority.epoch) ||
        cursor && (cursor.epoch !== book.executionAuthority.epoch || cursor.revision > replica.revision))
      throw new Error("Replica non applicabile: preservato il libro locale. Riconcilia prima il trasferimento.");
    if (settlement?.handoffId !== undefined) {
      const marker = await tx.objectStore("meta").get("personal-server:handoff:v1:" + bookId) as { handoffId?: string } | undefined;
      if (marker?.handoffId !== settlement.handoffId)
        throw new Error("Trasferimento non più in corso: nessuna replica applicata.");
      await tx.objectStore("meta").delete("personal-server:handoff:v1:" + bookId);
    }
    if (settlement?.command) {
      const { pending, receipt } = settlement.command;
      assertCommandConnection(pending, connection, book.executionAuthority.epoch);
      if (replica.nextSequence <= pending.envelope.sequence)
        throw new Error("Snapshot precedente alla ricevuta del comando: nessun cursore o intento avanzato.");
      const journal = readServerCommandJournal(await tx.objectStore("meta").get(serverCommandJournalKey(bookId)));
      await tx.objectStore("meta").put(settleCommandJournal(journal, pending, receipt), serverCommandJournalKey(bookId));
    }
    for (const activity of replica.activities) {
      const old = await tx.objectStore("activities").get(activity.id) as Activity | undefined;
      if (old && old.bookId !== bookId) throw new Error("Identificativo attività di un altro libro: replica rifiutata.");
      await tx.objectStore("activities").put(activity, activity.id);
    }
    // Replica/cursor and disabling of all local executable queues share ONE commit.
    await tx.objectStore("books").put(book, book.id);
    await tx.objectStore("outbox").delete(bookId);
    await tx.objectStore("meta").delete("retry-schedule:v1:" + bookId);
    await tx.objectStore("meta").put({ serverId: connection.serverId, epoch: book.executionAuthority.epoch,
      revision: replica.revision, etag: response.etag, nextSequence: replica.nextSequence,
      clientId: connection.clientId, retrySchedule: replica.retrySchedule, syncedAt: new Date().toISOString() }, replicaKey(bookId));
    if (settlement?.creationId) {
      const meta = tx.objectStore("meta");
      const pending = parsePendingCreation(await meta.get(SERVER_CREATE_INTENT_KEY));
      if (pending?.commandId === settlement.creationId) await meta.delete(SERVER_CREATE_INTENT_KEY);
    }
    await tx.done; return book;
  } catch (error) { try { tx.abort(); } catch { /* already aborted */ } throw error; }
}
const bookPageSchema = z.object({ books: z.array(z.object({ bookId: z.string().uuid(), title: z.string(),
  status: z.string(), epoch: z.string().uuid(), revision: z.number().int(), released: z.boolean().optional() }).strict()).max(100),
  nextCursor: z.string().uuid().nullable() }).strict();
export type ServerBookEntry = z.infer<typeof bookPageSchema>["books"][number];
async function listServerBooks(connection: ServerConnection): Promise<ServerBookEntry[]> {
  const found: ServerBookEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const response: { data: unknown } = await connectionRequest(connection,
      "/api/v1/books" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""), { maxBytes: 128 * 1024 });
    const page = bookPageSchema.parse(response.data);
    for (const book of page.books) {
      if (seen.has(book.bookId) || seen.size >= 200) throw new Error("Libreria server oltre il limite o paginazione non verificabile.");
      seen.add(book.bookId); found.push(book);
    }
    if (page.nextCursor && (page.nextCursor === cursor || page.books.length !== 100)) throw new Error("Cursore server non valido.");
    cursor = page.nextCursor;
  } while (cursor);
  return found;
}
export async function syncPersonalServer(): Promise<number> {
  const connection = await personalServerConnection();
  if (!connection) throw new Error("Collega e verifica prima il server personale.");
  let count = 0;
  const db = await getDb();
  for (const book of await listServerBooks(connection)) {
    // A book the server gave back is followed only by the replica that is waiting to take it back.
    if (book.released && !await db.get("meta", replicaKey(book.bookId))) continue;
    await syncServerBook(connection, book.bookId); count++;
  }
  return count;
}
/** Cheap catch-up after a reconnect: only books whose epoch/revision differ from the local cursor. */
export async function syncChangedServerBooks(): Promise<{ synced: string[]; failed: number }> {
  const connection = await personalServerConnection();
  if (!connection) throw new Error("Collega e verifica prima il server personale.");
  const db = await getDb();
  const synced: string[] = [];
  let failed = 0;
  for (const book of await listServerBooks(connection)) {
    const cursor = await db.get("meta", replicaKey(book.bookId)) as { epoch?: string; revision?: number } | undefined;
    if (book.released && !cursor) continue;
    if (cursor?.epoch === book.epoch && cursor.revision === book.revision) continue;
    try { await syncServerBook(connection, book.bookId); synced.push(book.bookId); } catch { failed++; }
  }
  return { synced, failed };
}
/** Authenticated SSE: `EventSource` cannot send the `apikey` header and the token never goes in a URL. */
export async function openServerEventStream(connection: ServerConnection, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const expectedGeneration = generation;
  if (!sameConnection(await personalServerConnection(), connection)) throw new Error("Connessione server cambiata.");
  await probePersonalServer(connection.baseUrl, connection);
  const token = await decryptLocal(connection.token);
  if (expectedGeneration !== generation || !sameConnection(await personalServerConnection(), connection))
    throw new Error("Connessione server cambiata prima dell'apertura del flusso.");
  const opening = new AbortController();
  const onAbort = () => opening.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => opening.abort(), 20_000);
  try {
    const response = await fetch(normalizeServerUrl(connection.baseUrl) + "/api/v1/events", {
      method: "GET", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
      signal, headers: { apikey: token, Accept: "text/event-stream" },
    });
    if (!response.ok) throw new ServerRequestError(response.status);
    if (!/^text\/event-stream\b/i.test(response.headers.get("content-type") ?? "") || !response.body) {
      try { void response.body?.cancel().catch(() => undefined); } catch { /* best effort */ }
      throw new ServerRequestError();
    }
    return response.body;
  } catch (error) { throw error instanceof ServerRequestError ? error : new ServerRequestError(); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
}
function parsePendingCreation(raw: unknown): PendingPersonalServerCreation | undefined {
  return raw === undefined ? undefined : pendingCreationSchema.parse(raw);
}
export async function pendingPersonalServerCreation(): Promise<PendingPersonalServerCreation | undefined> {
  return parsePendingCreation(await (await getDb()).get("meta", SERVER_CREATE_INTENT_KEY));
}
async function postCreation(connection: ServerConnection, pending: PendingPersonalServerCreation): Promise<BookProject> {
  if (pending.serverId !== connection.serverId || pending.clientId !== connection.clientId ||
      pending.baseUrl !== connection.baseUrl || pending.fingerprint !== connection.fingerprint)
    throw new Error("La creazione precedente appartiene a un'altra connessione: ricollega lo stesso server e client prima di riprenderla.");
  const response = await connectionRequest(connection, "/api/v1/books", { method: "POST",
    body: { commandId: pending.commandId, ...pending.input } });
  const result = z.strictObject({ bookId: z.string().uuid() }).parse(response.data);
  return syncSnapshot(connection, result.bookId, { creationId: pending.commandId });
}
export async function resumePersonalServerCreation(): Promise<BookProject> {
  const pending = await pendingPersonalServerCreation();
  if (!pending) throw new Error("Nessuna creazione del libro server è in attesa.");
  const connection = await personalServerConnection();
  if (!connection) throw new Error("Collega prima il server.");
  return postCreation(connection, pending);
}
export async function createPersonalServerBook(input: ServerBookCreationInput): Promise<BookProject> {
  const connection = await personalServerConnection();
  if (!connection?.clientId) throw new Error("Ricollega il client prima di creare un libro sul server.");
  const parsed = serverBookCreationInputSchema.parse(input);
  const prepared: PendingPersonalServerCreation = {
    commandId: crypto.randomUUID(), clientId: connection.clientId,
    serverId: connection.serverId, baseUrl: connection.baseUrl, fingerprint: connection.fingerprint,
    input: parsed, preparedAt: new Date().toISOString(),
  };
  if (new TextEncoder().encode(JSON.stringify({ commandId: prepared.commandId, ...parsed })).byteLength > 1_048_576)
    throw new ServerRequestError(413);
  const tx = (await getDb()).transaction("meta", "readwrite");
  void tx.done.catch(() => undefined);
  try {
    if (!sameConnection(await tx.store.get(SERVER_CONNECTION_KEY), connection))
      throw new Error("Connessione server cambiata prima della creazione.");
    if (await tx.store.get(SERVER_CREATE_INTENT_KEY) !== undefined)
      throw new Error("Esiste già una creazione server da confermare. Riprendi quella richiesta prima di crearne un'altra.");
    await tx.store.add(prepared, SERVER_CREATE_INTENT_KEY); await tx.done;
  } catch (error) { try { tx.abort(); } catch { /* already aborted */ } throw error; }
  return postCreation(connection, prepared);
}

/** Display only: a server retry is never placed in the local executable scheduler. */
export async function replicatedRetrySchedule(book: BookProject): Promise<RetrySchedule | undefined> {
  const raw = await (await getDb()).get("meta", replicaKey(book.id)) as {
    serverId?: string; epoch?: string; retrySchedule?: unknown;
  } | undefined;
  if (!raw || !book.executionAuthority || raw.serverId !== book.executionAuthority.serverId ||
      raw.epoch !== book.executionAuthority.epoch || raw.retrySchedule == null) return undefined;
  const plan = retryScheduleSchema.parse(raw.retrySchedule);
  return plan.bookId === book.id ? plan : undefined;
}
function commandCursor(raw: unknown) {
  const parsed = z.object({ serverId: z.string().uuid(), clientId: z.string().uuid(), epoch: z.string().uuid(),
    etag: z.string().min(1).max(200), nextSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).passthrough().safeParse(raw);
  if (!parsed.success) throw new Error("Aggiorna la replica e verifica di nuovo la connessione prima di inviare comandi.");
  return parsed.data;
}
async function commandDigest(clientId: string, envelope: PendingServerCommand["envelope"]): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serverCommandDigestInput(clientId, envelope)))));
}
function commandFailure(receipt: ServerCommandReceipt): Error | undefined {
  if (receipt.state === "uncertain") return new Error("Esito del comando incerto: nessuna esecuzione ripetuta. Controlla attività e coda sul server.");
  if (receipt.state === "completed" && receipt.result && typeof receipt.result === "object" &&
      "ok" in receipt.result && receipt.result.ok === false)
    return new Error("code" in receipt.result && receipt.result.code === "cancelled_before_acceptance"
      ? "Richiesta annullata prima dell'esecuzione; un invio tardivo non può più avviarla."
      : "Comando non completato dal server. Controlla attività e coda; conserva la tua bozza.");
  return undefined;
}
export async function sendServerCommand(bookId: string, command: ServerCommand): Promise<BookProject> {
  z.string().uuid().parse(bookId);
  const connection = await personalServerConnection();
  if (!connection) throw new Error("Server scollegato: la replica resta di sola lettura.");
  if (!connection.clientId) throw new Error("Ricollega questo client per verificare l'identità dei suoi comandi.");
  const db = await getDb();
  const replica = commandCursor(await db.get("meta", replicaKey(bookId)));
  const envelope = serverCommandEnvelopeSchema.parse({ commandId: crypto.randomUUID(), sequence: replica.nextSequence, command });
  if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > 64 * 1024)
    throw new ServerRequestError(413);
  // WebCrypto stays outside the IDB transaction; a fresh read below fences it.
  const digest = await commandDigest(connection.clientId, envelope);
  const pending: PendingServerCommand = { serverId: connection.serverId, clientId: connection.clientId,
    fingerprint: connection.fingerprint, baseUrl: connection.baseUrl, epoch: replica.epoch, etag: replica.etag,
    envelope, digest, state: "prepared" };
  const tx = db.transaction(["books", "meta"], "readwrite");
  void tx.done.catch(() => undefined);
  try {
    const currentConnection = await tx.objectStore("meta").get(SERVER_CONNECTION_KEY);
    const current = commandCursor(await tx.objectStore("meta").get(replicaKey(bookId)));
    const book = await tx.objectStore("books").get(bookId) as BookProject | undefined;
    const journal = readServerCommandJournal(await tx.objectStore("meta").get(serverCommandJournalKey(bookId)));
    assertCommandConnection(pending, connection, book?.executionAuthority?.epoch ?? "");
    if (!sameConnection(currentConnection, connection) || current.serverId !== connection.serverId || current.clientId !== connection.clientId ||
        current.epoch !== replica.epoch || current.etag !== replica.etag || current.nextSequence !== replica.nextSequence ||
        book?.executionAuthority?.serverId !== connection.serverId)
      throw new Error("Replica o connessione cambiata prima dell'invio: nessun comando preparato.");
    const relevant = journal.entries.filter(entry => commandMatchesConnection(entry, connection, replica.epoch));
    if (relevant.some(entry => entry.state === "prepared"))
      throw new Error("Comando precedente dall'esito non verificato: usa «Verifica esito comando», senza ripeterlo.");
    if (relevant.some(entry => entry.envelope.sequence >= replica.nextSequence))
      throw new Error("Aggiorna la replica prima del prossimo comando: sequenza non ancora confermata.");
    if (journal.entries.length >= MAX_PENDING_SERVER_COMMANDS)
      throw new Error("Venti comandi ancora da riconciliare: nessuna ricevuta o bozza eliminata automaticamente.");
    journal.entries.push(pending);
    await tx.objectStore("meta").put(journal, serverCommandJournalKey(bookId));
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* already aborted */ }
    throw error;
  }
  const response = await connectionRequest(connection, `/api/v1/books/${bookId}/commands`, {
    method: "POST", body: envelope, etag: replica.etag, maxBytes: 64 * 1024,
  });
  const receipt = serverCommandReceiptSchema.parse(response.data);
  const book = await syncSnapshot(connection, bookId, { command: { pending, receipt } });
  const failure = commandFailure(receipt);
  if (failure) throw failure;
  return book;
}
/** Reads receipts only. An absent request can be tombstoned on a SEPARATE
 * explicit author action; GET 404 alone never proves that it will not arrive. */
export async function reconcileServerCommand(bookId: string, options?: { cancelUnreceived?: boolean }) {
  z.string().uuid().parse(bookId);
  const connection = await personalServerConnection();
  const db = await getDb();
  if (!connection?.clientId) throw new Error("Collega il client originale per verificare le sue ricevute.");
  const cursor = commandCursor(await db.get("meta", replicaKey(bookId)));
  const journal = readServerCommandJournal(await db.get("meta", serverCommandJournalKey(bookId)));
  const pending = journal.entries.filter(entry => commandMatchesConnection(entry, connection, cursor.epoch));
  if (!pending.length) throw new Error("Nessun comando da verificare per questa identità e questo client. Le altre ricevute restano conservate.");
  const summary = { completed: 0, accepted: 0, uncertain: 0, cancelled: 0, failed: 0 };
  for (const entry of pending) {
    if (entry.digest !== await commandDigest(connection.clientId, entry.envelope))
      throw new Error("Impronta del comando locale non valida: nessuna richiesta inviata o eliminata.");
    const path = `/api/v1/books/${bookId}/commands/${entry.envelope.commandId}`;
    let response;
    try { response = await connectionRequest(connection, path); }
    catch (error) {
      if (!(error instanceof ServerRequestError) || error.status !== 404) throw error;
      if (!options?.cancelUnreceived)
        throw new Error("Ricevuta assente: non prova che la richiesta non arrivi in ritardo. Puoi scegliere separatamente «Annulla richieste non ricevute».");
      await syncServerBook(connection, bookId);
      const current = commandCursor(await db.get("meta", replicaKey(bookId)));
      assertCommandConnection(entry, connection, current.epoch);
      response = await connectionRequest(connection, path + "/resolve", {
        method: "POST", body: entry.envelope, etag: current.etag, maxBytes: 64 * 1024,
      });
    }
    const receipt = serverCommandReceiptSchema.parse(response.data);
    await syncSnapshot(connection, bookId, { command: { pending: entry, receipt } });
    summary[receipt.state]++;
    if (receipt.state === "completed" && receipt.result && typeof receipt.result === "object" &&
        "code" in receipt.result && receipt.result.code === "cancelled_before_acceptance") summary.cancelled++;
    else if (receipt.state === "completed" && receipt.result && typeof receipt.result === "object" &&
        "ok" in receipt.result && receipt.result.ok === false) summary.failed++;
  }
  return summary;
}
export interface PendingServerPairing { id: string; nonce: string; baseUrl: string; serverId: string; publicKey: string }
export async function pairPersonalServer(base: string, code: string, label: string,
  expected: Pick<ServerInfo, "serverId" | "publicKey">, isCurrent: () => boolean = () => true): Promise<PendingServerPairing> {
  const baseUrl = normalizeServerUrl(base);
  const info = await probePersonalServer(baseUrl, expected);
  if (!isCurrent()) throw new Error("Connessione cambiata prima dell'abbinamento.");
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  const response = await http(baseUrl, "/api/v1/pairings", { method: "POST", body: { code, nonce, label } });
  return { id: z.strictObject({ id: z.string().uuid() }).parse(response.data).id, nonce, baseUrl,
    serverId: info.serverId, publicKey: info.publicKey };
}
export async function finishPairPersonalServer(pending: PendingServerPairing, isCurrent: () => boolean = () => true): Promise<string | undefined> {
  await probePersonalServer(pending.baseUrl, pending);
  if (!isCurrent()) throw new Error("Connessione cambiata durante l'abbinamento.");
  const response = await http(pending.baseUrl, `/api/v1/pairings/${pending.id}/result`, { method: "POST", body: { nonce: pending.nonce } });
  const result = z.union([z.object({ pending: z.literal(true) }).strict(), z.object({ token: z.string().min(40).max(200) }).strict()]).parse(response.data);
  return "token" in result ? result.token : undefined;
}

export interface ServerConfigurationReview { configuration: ServerConfiguration; etag: string; connectionId: string }
export async function personalServerConfiguration(): Promise<ServerConfigurationReview> {
  const connection = await personalServerConnection();
  if (!connection) throw new Error("Collega prima il server.");
  const response = await connectionRequest(connection, "/api/v1/settings", { maxBytes: 1_048_576 });
  const configuration = serverConfigurationSchema.parse(response.data);
  if (response.etag !== `"config:${configuration.revision}"`)
    throw new Error("Versione delle impostazioni server non verificabile.");
  return { configuration, etag: response.etag, connectionId: connection.id };
}

async function connectionForConfiguration(review: ServerConfigurationReview): Promise<ServerConnection> {
  const connection = await personalServerConnection();
  if (connection?.id !== review.connectionId)
    throw new Error("Connessione server cambiata: rileggi la configurazione prima di inviarla.");
  return connection;
}

export async function setPersonalServerBookPat(review: ServerConfigurationReview, bookId: string,
  action: "delegate" | "revoke", expectedSecret?: AppSettings["githubToken"]): Promise<void> {
  z.string().uuid().parse(bookId);
  const connection = await connectionForConfiguration(review);
  if (action === "delegate" && !expectedSecret) throw new Error("Salva prima il PAT GitHub su questo dispositivo.");
  const githubToken = action === "delegate" && expectedSecret ? await decryptLocal(expectedSecret) : null;
  await connectionRequest(connection, `/api/v1/books/${bookId}/github-credential`, {
    method: "POST", etag: review.etag, body: { consent: true, githubToken },
  }, async () => {
    if (action === "delegate" && JSON.stringify((await loadSettings()).githubToken) !== JSON.stringify(expectedSecret))
      throw new Error("Il PAT locale è cambiato: nessuna credenziale inviata.");
  });
}

/** Use the revision the author actually saw. A separate PAT action never replaces the AI settings. */
export async function provisionPersonalServer(review: ServerConfigurationReview, displayed: AppSettings,
  actions: Readonly<Record<string, "delegate" | "revoke">>): Promise<void> {
  const connection = await connectionForConfiguration(review);
  const signature = cloudSettingsSignature(displayed);
  const checkLocal = async () => {
    const saved = await loadSettings();
    if (cloudSettingsSignature(saved) !== signature)
      throw new Error("Le impostazioni salvate sono cambiate: aggiornate la scheda prima di inviarle.");
    return saved;
  };
  const settings = await checkLocal();
  const entries = await Promise.all(Object.entries(actions).map(async ([id, action]) => {
    const endpoint = settings.endpoints.find(e => e.id === id);
    if (!endpoint || action === "delegate" && (!endpoint.secret || endpoint.authMode === "none"))
      throw new Error("Impossibile delegare una chiave AI non salvata o di un endpoint senza autenticazione.");
    return [id, action === "revoke" ? null : await decryptLocal(endpoint.secret!)] as const;
  }));
  await connectionRequest(connection, "/api/v1/settings", {
    method: "POST", etag: review.etag,
    body: { consent: true, settings: projectSettings(settings), endpointKeys: Object.fromEntries(entries) },
  }, async () => { await checkLocal(); });
}

const branchListSchema = z.object({
  current: z.string().max(200), baseline: z.string().max(40), dirty: z.boolean(),
  branches: z.array(z.object({ name: z.string().min(1).max(200), sha: z.string().regex(/^[a-f0-9]{40}$/) }).strict()).max(500),
}).strict();
export type PersonalServerBranches = z.infer<typeof branchListSchema>;
/** Read-only: the server asks GitHub (through its working copy) which branches exist. Nothing is changed. */
export async function listPersonalServerBranches(bookId: string): Promise<PersonalServerBranches> {
  z.string().uuid().parse(bookId);
  const connection = await personalServerConnection();
  if (!connection) throw new Error("Server scollegato.");
  const response = await connectionRequest(connection, `/api/v1/books/${bookId}/branches`, { maxBytes: 1_048_576 });
  return branchListSchema.parse(response.data);
}

export async function personalServerUpdateStatus(): Promise<import("@engine/domain/personal-server").ServerUpdateInfo> {
  const { serverUpdateInfoSchema } = await import("@engine/domain/personal-server");
  const connection = await personalServerConnection();
  if (!connection) throw new Error("Collega prima il server.");
  const response = await connectionRequest(connection, "/api/v1/updates", { maxBytes: 16 * 1024 });
  return serverUpdateInfoSchema.parse(response.data);
}
export async function requestPersonalServerUpdate(installedVersion: string, version: string): Promise<void> {
  const { serverUpdateRequestSchema } = await import("@engine/domain/personal-server");
  const connection = await personalServerConnection();
  if (!connection) throw new Error("Collega prima il server.");
  const body = serverUpdateRequestSchema.parse({ installedVersion, version, confirmed: true });
  await connectionRequest(connection, "/api/v1/updates", { method: "POST", body, maxBytes: 16 * 1024 });
}
