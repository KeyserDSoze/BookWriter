import { z } from "zod";
import type { Activity, BookProject } from "@engine/domain/types";
import { isServerBook } from "@engine/domain/execution-authority";
import { withoutInheritedConsents } from "@engine/domain/consent-revocation";
import { migrateBook } from "@engine/domain/book-format";
import {
  handoffResolutionSchema, serverCommandReceiptSchema, serverHandoffDigestInput, serverGitHubHandoffDigestInput, type ServerConnection,
} from "@engine/domain/personal-server";
import { BookRevisionConflict, getDb, loadSettings } from "./db";
import { decryptLocal } from "./crypto";
import {
  connectionRequest, personalServerConnection, sameConnection, ServerRequestError, syncSnapshot,
  SERVER_CONNECTION_KEY, replicaKey, syncServerBook,
} from "./personal-server-client";
import { serverCommandJournalKey } from "./personal-server-command-journal";

export const handoffKey = (bookId: string) => "personal-server:handoff:v1:" + bookId;
const uuid = z.string().uuid();
export const handoffMarkerSchema = z.object({
  version: z.literal(1), handoffId: uuid, bookId: uuid, epoch: uuid, serverId: uuid, clientId: uuid,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), baseUrl: z.string().max(500), startedAt: z.string().datetime(),
  /** A book that already lives on GitHub: the server reads it there, nothing is uploaded. */
  github: z.object({ owner: z.string().max(100), repository: z.string().max(100), branch: z.string().max(200),
    expectedHead: z.string().regex(/^[a-f0-9]{40}$/), consentPublic: z.boolean() }).strict().optional(),
}).strict();
export type HandoffMarker = z.infer<typeof handoffMarkerSchema>;
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

export function readHandoffMarker(raw: unknown): HandoffMarker | undefined {
  if (raw === undefined) return undefined;
  const parsed = handoffMarkerSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Registro del trasferimento non verificabile: il libro resta bloccato e nessun dato viene eliminato.");
  return parsed.data;
}
export async function pendingPersonalServerHandoff(bookId: string): Promise<HandoffMarker | undefined> {
  return readHandoffMarker(await (await getDb()).get("meta", handoffKey(bookId)));
}

/** Why a book cannot be handed over yet, in plain Italian. Pure; never performs I/O. */
export function handoffBlocker(book: BookProject): string | undefined {
  if (isServerBook(book)) return "Il libro appartiene già a un server.";
  if (book.status === "running") return "Metti in pausa il libro prima di affidarlo al server.";
  if (book.remote && (!book.remote.lastSyncedCommit || book.remote.lastSyncedLocalUpdatedAt !== book.updatedAt))
    return "Salva prima il libro su GitHub: il server legge la versione presente nella repository e non riceve il testo da qui.";
  return undefined;
}

function markerMatches(marker: HandoffMarker, connection: ServerConnection): boolean {
  return marker.serverId === connection.serverId && marker.clientId === connection.clientId &&
    marker.fingerprint === connection.fingerprint && marker.baseUrl === connection.baseUrl;
}
async function sha256(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map(n => n.toString(16).padStart(2, "0")).join("");
}

/**
 * Step 1, local only, no network. The book becomes a read-only replica of the
 * server in the SAME transaction that records the intent, so a lost answer or
 * a closed tab can never leave two executable copies. Consents that would travel
 * with the book are revoked here, exactly as for an imported archive.
 */
export async function beginPersonalServerHandoff(bookId: string, expectedUpdatedAt: string, options: { delegatePat?: boolean } = {}): Promise<HandoffMarker> {
  uuid.parse(bookId);
  const delegated = (await loadSettings()).githubToken;
  const connection = await personalServerConnection();
  if (!connection?.clientId) throw new Error("Ricollega questo client al server prima di affidargli un libro.");
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) throw new Error("Web Locks non disponibile: nessun trasferimento avviato.");
  return locks.request("bookwriter:writer:" + bookId, { ifAvailable: true }, async writer => {
    if (!writer) throw new Error("Il libro è in uso in un'altra scheda: attendi la pausa.");
    return locks.request("bookwriter:github-outbox", { ifAvailable: true }, async outbox => {
      if (!outbox) throw new Error("Un salvataggio GitHub è in corso: riprova fra poco.");
      const db = await getDb();
      const tx = db.transaction(["books", "activities", "mergeDrafts", "outbox", "meta"], "readwrite");
      void tx.done.catch(() => undefined);
      try {
        const meta = tx.objectStore("meta");
        if (!sameConnection(await meta.get(SERVER_CONNECTION_KEY), connection))
          throw new Error("La connessione al server è cambiata: verifica di nuovo.");
        if (await meta.get(handoffKey(bookId))) throw new Error("Un trasferimento è già in corso per questo libro.");
        const raw = await tx.objectStore("books").get(bookId) as BookProject | undefined;
        if (!raw) throw new Error("Libro non trovato.");
        const book = migrateBook(raw);
        const blocker = handoffBlocker(book);
        if (blocker) throw new Error(blocker);
        if (book.remote && (!options.delegatePat || !delegated))
          throw new Error("Un libro su GitHub passa al server solo delegandogli il PAT salvato su questo dispositivo: spunta la delega ed eventualmente salva prima il PAT.");
        if (book.updatedAt !== expectedUpdatedAt) throw new BookRevisionConflict();
        const activities = (await tx.objectStore("activities").getAll() as Activity[]).filter(a => a.bookId === bookId);
        if (activities.some(activity => activity.status === "running"))
          throw new Error("Un tentativo AI risulta ancora in corso: attendi o ripristina il libro prima di affidarlo.");
        const drafts = await tx.objectStore("mergeDrafts").getAll() as Array<{ bookId: string; status: string }>;
        if (drafts.some(draft => draft.bookId === bookId && draft.status === "proposed"))
          throw new Error("Concludi le bozze di fusione in sospeso prima di affidare il libro: non si trasferiscono al server.");
        if (await tx.objectStore("outbox").get(bookId) || await meta.get("manual-github-push:" + bookId) ||
            await meta.get("retry-schedule:v1:" + bookId))
          throw new Error("Ci sono salvataggi o attese di retry locali: concludili o annullali prima del trasferimento.");
        const marker: HandoffMarker = { version: 1, handoffId: crypto.randomUUID(), bookId, epoch: crypto.randomUUID(),
          serverId: connection.serverId, clientId: connection.clientId!, fingerprint: connection.fingerprint,
          baseUrl: connection.baseUrl, startedAt: new Date().toISOString(),
          ...(book.remote ? { github: { owner: book.remote.owner, repository: book.remote.repository, branch: book.remote.branch,
            expectedHead: book.remote.lastSyncedCommit!, consentPublic: book.remote.allowPublicSync === true } } : {}) };
        const handed: BookProject = { ...book, ...withoutInheritedConsents(book),
          executionAuthority: { kind: "server", serverId: connection.serverId, epoch: marker.epoch } };
        await tx.objectStore("books").put(handed, bookId);
        await meta.put(marker, handoffKey(bookId));
        await tx.done;
        return marker;
      } catch (error) { try { tx.abort(); } catch { /* already aborted */ } throw error; }
    });
  });
}

type UploadBody = { handoffId: string; consent: true; epoch: string; book: BookProject; activities: Activity[] };
async function loadHandoff(bookId: string): Promise<{ connection: ServerConnection; marker: HandoffMarker; body: UploadBody }> {
  uuid.parse(bookId);
  const connection = await personalServerConnection();
  const db = await getDb();
  const marker = readHandoffMarker(await db.get("meta", handoffKey(bookId)));
  if (!marker) throw new Error("Nessun trasferimento in corso per questo libro.");
  if (!connection?.clientId || !markerMatches(marker, connection))
    throw new Error("Il trasferimento appartiene a un'altra connessione: ricollega lo stesso server e client. Il libro resta bloccato.");
  const book = await db.get("books", bookId) as BookProject | undefined;
  if (!book || book.executionAuthority?.serverId !== marker.serverId || book.executionAuthority.epoch !== marker.epoch)
    throw new Error("Il libro locale non corrisponde più al trasferimento: nessun invio.");
  const activities = (await db.getAll("activities") as Activity[]).filter(a => a.bookId === bookId);
  return { connection, marker, body: { handoffId: marker.handoffId, consent: true, epoch: marker.epoch, book, activities } };
}

const githubHandoffBody = (marker: HandoffMarker, githubToken: string) => ({
  handoffId: marker.handoffId, consent: true as const, epoch: marker.epoch, bookId: marker.bookId, github: marker.github!, githubToken });
const handoffDigest = async (marker: HandoffMarker, body: UploadBody) =>
  sha256(marker.github ? serverGitHubHandoffDigestInput(marker.clientId, githubHandoffBody(marker, "-")) : serverHandoffDigestInput(marker.clientId, body));

/** Step 2. Safe to repeat: the server answers the same acceptance for the same request. */
export async function sendPersonalServerHandoff(bookId: string): Promise<BookProject> {
  const { connection, marker, body } = await loadHandoff(bookId);
  if (marker.github) {
    const stored = (await loadSettings()).githubToken;
    if (!stored) throw new Error("Il PAT GitHub non è più salvato su questo dispositivo: salvalo di nuovo per riprendere l'invio.");
    const response = await connectionRequest(connection, "/api/v1/handoffs/github",
      { method: "POST", body: githubHandoffBody(marker, await decryptLocal(stored)), maxBytes: 64 * 1024 });
    const accepted = z.object({ bookId: z.literal(bookId), markerPublished: z.boolean().optional() }).strict().parse(response.data);
    return syncSnapshot(connection, accepted.bookId, { handoffId: marker.handoffId });
  }
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_UPLOAD_BYTES)
    throw new ServerRequestError(413);
  const response = await connectionRequest(connection, "/api/v1/handoffs", { method: "POST", body, maxBytes: MAX_UPLOAD_BYTES });
  const accepted = z.object({ bookId: z.literal(bookId) }).strict().parse(response.data);
  return syncSnapshot(connection, accepted.bookId, { handoffId: marker.handoffId });
}

/** Reads the server receipt only. Absence proves nothing about a late delivery. */
export async function checkPersonalServerHandoff(bookId: string): Promise<"adopted" | "not_received"> {
  const { connection, marker, body } = await loadHandoff(bookId);
  let response;
  try { response = await connectionRequest(connection, `/api/v1/books/${bookId}/commands/${marker.handoffId}`); }
  catch (error) {
    if (error instanceof ServerRequestError && error.status === 404) return "not_received";
    throw error;
  }
  const receipt = serverCommandReceiptSchema.parse(response.data);
  if (receipt.clientId !== marker.clientId || receipt.state !== "completed" ||
      receipt.digest !== await handoffDigest(marker, body))
    throw new Error("Ricevuta non coerente con il libro inviato: il libro resta bloccato e nulla viene approvato.");
  await syncSnapshot(connection, bookId, { handoffId: marker.handoffId });
  return "adopted";
}

/**
 * Separate, explicit choice. The server records a durable refusal of this exact
 * handoff before the local copy is unlocked, so a delayed upload cannot create a
 * second authority. If the server had already accepted it, that wins.
 */
export async function cancelPersonalServerHandoff(bookId: string): Promise<"adopted" | "cancelled"> {
  const { connection, marker } = await loadHandoff(bookId);
  const response = await connectionRequest(connection, `/api/v1/handoffs/${marker.handoffId}/resolve`,
    { method: "POST", body: { bookId } });
  const resolution = handoffResolutionSchema.parse(response.data);
  if (resolution.bookId !== bookId) throw new Error("Risposta relativa a un altro libro: il libro resta bloccato.");
  if (resolution.state === "adopted") {
    await syncSnapshot(connection, bookId, { handoffId: marker.handoffId });
    return "adopted";
  }
  const db = await getDb();
  const tx = db.transaction(["books", "meta"], "readwrite");
  void tx.done.catch(() => undefined);
  try {
    const stored = readHandoffMarker(await tx.objectStore("meta").get(handoffKey(bookId)));
    const book = await tx.objectStore("books").get(bookId) as BookProject | undefined;
    if (stored?.handoffId !== marker.handoffId || !sameConnection(await tx.objectStore("meta").get(SERVER_CONNECTION_KEY), connection) ||
        book?.executionAuthority?.epoch !== marker.epoch || await tx.objectStore("meta").get(replicaKey(bookId)))
      throw new Error("Stato locale cambiato durante l'annullamento: il libro resta bloccato.");
    const { executionAuthority: _released, ...local } = book;
    await tx.objectStore("books").put({ ...local, updatedAt: new Date().toISOString() } as BookProject, bookId);
    await tx.objectStore("meta").delete(handoffKey(bookId));
    await tx.done;
    return "cancelled";
  } catch (error) { try { tx.abort(); } catch { /* already aborted */ } throw error; }
}

/**
 * The server gave the book back (its snapshot says so and the repository no longer names it). This device
 * becomes the executor again: the server's final copy replaces the replica, which is exactly what the release
 * commit on GitHub holds. A replica that never learnt about the release is refused.
 */
export async function takeBackPersonalServerBook(bookId: string): Promise<BookProject> {
  uuid.parse(bookId);
  const connection = await personalServerConnection();
  if (!connection?.clientId) throw new Error("Ricollega questo client al server per riprendere il libro.");
  const synced = await syncServerBook(connection, bookId);
  const authority = synced.executionAuthority;
  if (!authority?.releasedAt || !authority.releasedCommit || !synced.remote)
    throw new Error("Il server non ha ancora rilasciato questo libro: nessuna modifica locale.");
  const db = await getDb();
  const tx = db.transaction(["books", "meta"], "readwrite");
  void tx.done.catch(() => undefined);
  try {
    const stored = await tx.objectStore("books").get(bookId) as BookProject | undefined;
    if (!sameConnection(await tx.objectStore("meta").get(SERVER_CONNECTION_KEY), connection) ||
        !stored?.executionAuthority?.releasedCommit || stored.executionAuthority.epoch !== authority.epoch ||
        stored.executionAuthority.serverId !== connection.serverId || stored.updatedAt !== synced.updatedAt ||
        await tx.objectStore("meta").get(handoffKey(bookId)))
      throw new Error("La replica è cambiata durante la ripresa: nessuna modifica applicata.");
    const { executionAuthority, ...local } = stored;
    const next: BookProject = { ...local, status: "paused",
      previousError: "Libro ripreso dal server: la repository non nomina più il server e puoi lavorarci qui.",
      remote: { ...stored.remote!, autoSync: false, lastSyncedCommit: executionAuthority.releasedCommit,
        lastSyncedLocalUpdatedAt: stored.updatedAt, lastSyncAt: new Date().toISOString() } };
    await tx.objectStore("books").put(next, bookId);
    await tx.objectStore("meta").delete(replicaKey(bookId));
    await tx.objectStore("meta").delete(serverCommandJournalKey(bookId));
    await tx.done;
    return next;
  } catch (error) { try { tx.abort(); } catch { /* already aborted */ } throw error; }
}
