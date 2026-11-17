import { z } from "zod";
import type { GitHubRemote } from "../domain/types";
import { decryptLocal } from "./crypto";
import { loadSettings } from "./db";
import { validateRemote } from "./github-sync";
import { isOwnWriterSession } from "./writer-sessions";

/**
 * A GitHub branch acts as an optimistic, fast-forward-only compare-and-swap.
 * Every lease renewal/takeover is a descendant of the HEAD just inspected.
 * This does not make GitHub an always-on coordinator: the owner must stop when
 * offline, when its lease expires, or when verification cannot be completed.
 */
export const LEASE_TTL_MS = 120_000;
export const LEASE_RENEW_MS = 25_000;
export const LEASE_TAKEOVER_GRACE_MS = 60_000;
/** The GitHub core limit resets within its one-hour window. This exposed
 * response header gives only a coarse sanity check, NOT the server's clock.
 * Allow five minutes for header/caching/transport variations; smaller skew
 * can still exist and the lease remains best-effort. */
const RATE_LIMIT_WINDOW_MS = 60 * 60_000;
const CLOCK_MARGIN_MS = 5 * 60_000;
const API = "https://api.github.com";
const SHA = /^[a-f\d]{40}$/i;
const leaseSchema = z.object({
  schemaVersion: z.literal(1),
  bookId: z.string().uuid(),
  sessionId: z.string().uuid(),
  state: z.enum(["active", "released"]),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  renewedAt: z.string().datetime(),
});
type LeasePayload = z.infer<typeof leaseSchema>;
export interface WriterLeaseStatus extends LeasePayload { headSha: string }
export interface WriterLeaseHandle {
  bookId: string;
  sessionId: string;
  remote: GitHubRemote;
  headSha: string;
  expiresAt: string;
}

export class RemoteWriterBusy extends Error {
  constructor(public readonly lease: WriterLeaseStatus, public readonly canTakeover: boolean) {
    super(canTakeover
      ? "Un altro dispositivo ha un lease scaduto. Puoi richiedere il recupero esplicito in Archivio."
      : "Questo libro è già in scrittura da un altro dispositivo. Nessuna chiamata AI avviata.");
    this.name = "RemoteWriterBusy";
  }
}
export class RemoteWriterLost extends Error {
  constructor(detail = "Il lease remoto non è più valido. Scrittura sospesa senza canonizzare il risultato AI.") {
    super(detail); this.name = "RemoteWriterLost";
  }
}
/** GitHub did not answer (network, timeout) or answered with a server error (5xx). Unlike a refusal
 * (409/422) it says nothing about WHO holds the lock: a request that failed this way has changed
 * nothing we know of, so while our last confirmed lease is still valid the work may go on. */
export class LeaseGitHubUnavailable extends RemoteWriterLost {
  constructor(detail: string) { super(detail); this.name = "LeaseGitHubUnavailable"; }
}
/** The renewal was accepted by GitHub but the branch never showed our commit, while the lease is
 * still OURS and valid for a good while: nothing was extended, nothing is claimed as renewed, but
 * the work need not stop yet. The next heartbeat tries again; the carried handle keeps the OLD
 * expiry, so the guard still gives up well before another device could take over (expiry + 60 s). */
export class LeaseRenewalMissed extends RemoteWriterLost {
  constructor(public readonly current: WriterLeaseHandle, detail: string) {
    super(detail); this.name = "LeaseRenewalMissed";
  }
}
/** Read-after-write lag of GitHub is real but short: a few more READS (never another write). Tests shorten it. */
export const leaseTuning = {
  readbackDelaysMs: [600, 1500, 3000],
  /** Pauses before trying a request again after GitHub did not answer or failed with a 5xx. */
  unavailableRetryDelaysMs: [600, 1500],
};
/** A missed renewal (or an unreachable GitHub) is tolerated only while at least this much validity is
 * left on the lease: another device may take over only at expiry + 60 s, so the margin stays >= 110 s. */
const MISSED_RENEWAL_MIN_VALIDITY_MS = 50_000;

/** Repeats a step that failed because GitHub was unavailable. Only for steps that change no ref:
 * reads, and the creation of trees and commits nobody points to yet. NEVER for the branch update. */
async function retryUnavailable<T>(step: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await step(); }
    catch (error) {
      const delay = leaseTuning.unavailableRetryDelaysMs[attempt];
      if (!(error instanceof LeaseGitHubUnavailable) || delay === undefined) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function branch(bookId: string): string {
  if (!z.string().uuid().safeParse(bookId).success) throw new Error("ID libro non valido per il lease.");
  return "bookwriter-lock/" + bookId;
}
function resource(remote: GitHubRemote, path: string): string {
  const valid = validateRemote(remote);
  return "/repos/" + encodeURIComponent(valid.owner) + "/" + encodeURIComponent(valid.repository) + path;
}
function refPath(remote: GitHubRemote, bookId: string): string {
  return resource(remote, "/git/ref/heads/" + branch(bookId));
}
function patchPath(remote: GitHubRemote, bookId: string): string {
  return resource(remote, "/git/refs/heads/" + branch(bookId));
}
async function token(): Promise<string> {
  const settings = await loadSettings();
  if (!settings.githubToken) throw new Error("Per scrivere questo libro collegato serve un PAT GitHub configurato.");
  return decryptLocal(settings.githubToken);
}
/** GitHub exposes X-RateLimit-Reset to browser CORS clients; it does NOT
 * expose the HTTP Date header. Reject gross local clock skew before any lease
 * ownership/recovery decision or write. This does not synchronize clocks. */
function assertPlausibleClock(response:Response):void {
  const raw=response.headers.get("X-RateLimit-Reset");
  if(!raw || !/^\d{9,12}$/.test(raw))
    throw new RemoteWriterLost("GitHub non espone un X-RateLimit-Reset valido: verifica del clock impossibile, scrittura bloccata.");
  const reset=Number(raw)*1000;
  if(!Number.isSafeInteger(reset))
    throw new RemoteWriterLost("Orario GitHub non valido: scrittura bloccata.");
  const local=Date.now();
  if(local<reset-RATE_LIMIT_WINDOW_MS-CLOCK_MARGIN_MS ||
      local>reset+CLOCK_MARGIN_MS)
    throw new RemoteWriterLost("L'orologio del dispositivo non è compatibile con la finestra temporale GitHub. Correggi data e ora automatiche prima di riprendere.");
}
function operation(method: string, path: string): string {
  if (method === "GET") return "lettura del blocco di scrittura";
  if (path.endsWith("/git/trees")) return "preparazione dei dati del blocco di scrittura";
  if (path.endsWith("/git/commits")) return "creazione del commit del blocco di scrittura";
  if (method === "POST") return "creazione del ramo del blocco di scrittura";
  return "modifica del ramo del blocco di scrittura";
}

function responseError(status: number, method: string, path: string): Error {
  if (status === 401) return new Error("PAT GitHub non valido (HTTP 401). Scrittura AI non avviata.");
  if (status === 403) return new Error("GitHub ha negato l'accesso al lease (HTTP 403). Verifica Contents: write.");
  if (status === 409 || status === 422)
    return new RemoteWriterLost(`GitHub ha rifiutato la ${operation(method, path)} (HTTP ${status}). ` +
      "Questo non dimostra che un altro browser stia scrivendo. Verifica in Archivio lo stato del blocco, " +
      "che la repository sia inizializzata e che il PAT e le regole GitHub consentano di creare e aggiornare i rami bookwriter-lock/. Nessuna scrittura forzata.");
  if (status === 404) return new Error("Repository GitHub o branch non disponibile per il lease (HTTP 404).");
  if (status >= 500)
    return new LeaseGitHubUnavailable(`GitHub non ha confermato la ${operation(method, path)} (HTTP ${status}). Scrittura bloccata; verifica di nuovo lo stato in Archivio.`);
  return new Error("Verifica GitHub lease fallita (HTTP " + status + ").");
}
async function api<T>(secret: string, path: string,
  method = "GET", body?: unknown, allow404 = false): Promise<T | null> {
  const url = new URL(path, API);
  if (url.origin !== API || !url.pathname.startsWith("/repos/"))
    throw new Error("Destinazione GitHub non autorizzata.");
  let response: Response;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15_000);
  try {
    response = await fetch(url, {
      method, cache: "no-store", mode: "cors", redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + secret,
        "X-GitHub-Api-Version": "2026-03-10",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new LeaseGitHubUnavailable("GitHub non raggiungibile o tempo di verifica scaduto: scrittura bloccata.");
  } finally {
    clearTimeout(deadline);
  }
  if (allow404 && response.status === 404) {
    // A missing lock branch is also a lease decision: never infer "free"
    // from an unchecked 404 or an unavailable CORS-exposed clock header.
    assertPlausibleClock(response);
    return null;
  }
  if (!response.ok) {
    // Never expose the remote error body (which may echo request data).
    try { void response.body?.cancel().catch(() => undefined); } catch { /* best effort */ }
    throw responseError(response.status, method, path);
  }
  assertPlausibleClock(response);
  const raw = await response.text();
  if (raw.length > 20_000) throw new Error("Risposta GitHub lease troppo grande.");
  try { return JSON.parse(raw) as T; }
  catch { throw new Error("Risposta GitHub lease non valida."); }
}
async function getRef(secret: string, remote: GitHubRemote, bookId: string): Promise<string | null> {
  const result = await api<{ object?: { sha?: string } }>(
    secret, refPath(remote, bookId), "GET", undefined, true,
  );
  if (!result) return null;
  const sha = result.object?.sha;
  if (!sha || !SHA.test(sha)) throw new Error("Riferimento GitHub lease non valido.");
  return sha;
}
async function leaseAt(secret: string, remote: GitHubRemote, bookId: string, sha: string): Promise<WriterLeaseStatus> {
  const file = await api<{ content?: string; type?: string; encoding?: string }>(
    secret, resource(remote, "/contents/.bookwriter/lease.json?ref=" + encodeURIComponent(sha)),
  );
  if (file?.type !== "file" || file.encoding !== "base64" || !file.content)
    throw new RemoteWriterLost("La branch di lock non ha un documento lease valido.");
  let payload: unknown;
  try {
    const binary = atob(file.content.replace(/\s/g, ""));
    payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
  } catch { throw new RemoteWriterLost("Il documento di lock remoto è corrotto."); }
  const parsed = leaseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.bookId !== bookId)
    throw new RemoteWriterLost("Il documento di lock non corrisponde al libro selezionato.");
  return { ...parsed.data, headSha: sha };
}

function active(status: WriterLeaseStatus): boolean {
  return status.state === "active" && Date.parse(status.expiresAt) > Date.now();
}
function canTakeover(status: WriterLeaseStatus): boolean {
  return status.state === "released" ||
    Date.now() > Date.parse(status.expiresAt) + LEASE_TAKEOVER_GRACE_MS;
}

export function isLeaseRecoverable(status: WriterLeaseStatus): boolean {
  return status.state === "active" &&
    Date.now() > Date.parse(status.expiresAt) + LEASE_TAKEOVER_GRACE_MS;
}

export async function recoverExpiredWriterLease(remote: GitHubRemote, bookId: string): Promise<void> {
  const before = await inspectWriterLease(remote, bookId);
  if (!before || !isLeaseRecoverable(before))
    throw new Error("Il lease è ancora attivo oppure non ha superato il tempo di sicurezza.");
  const session = await acquireWriterLease(remote, bookId, crypto.randomUUID(), true);
  await releaseWriterLease(session);
  const final = await inspectWriterLease(remote, bookId);
  if (!final || final.sessionId !== session.sessionId || final.state !== "released")
    throw new Error("Il rilascio del lease non è stato confermato da GitHub. Verifica prima di ripartire.");
}


/** Read-only status, used by the UI and to diagnose recovery. */
export async function inspectWriterLease(remote: GitHubRemote, bookId: string): Promise<WriterLeaseStatus | null> {
  const secret = await token();
  const sha = await getRef(secret, remote, bookId);
  return sha ? leaseAt(secret, remote, bookId, sha) : null;
}

async function writeLease(secret: string, remote: GitHubRemote, bookId: string,
  parent: string, next: LeasePayload): Promise<string> {
  const commit = await api<{ tree?: { sha?: string } }>(
    secret, resource(remote, "/git/commits/" + parent),
  );
  const treeSha = commit?.tree?.sha;
  if (!treeSha || !SHA.test(treeSha)) throw new Error("Tree GitHub lease non valido.");
  const tree = await api<{ sha?: string }>(
    secret, resource(remote, "/git/trees"), "POST", {
      base_tree: treeSha,
      tree: [{
        path: ".bookwriter/lease.json", mode: "100644", type: "blob",
        content: JSON.stringify(next, null, 2) + "\n",
      }],
    },
  );
  if (!tree?.sha || !SHA.test(tree.sha)) throw new Error("Tree GitHub lease non creato.");
  const newCommit = await api<{ sha?: string }>(
    secret, resource(remote, "/git/commits"), "POST", {
      message: "bookwriter: lease " + next.state + " " + next.sessionId,
      tree: tree.sha, parents: [parent],
    },
  );
  if (!newCommit?.sha || !SHA.test(newCommit.sha)) throw new Error("Commit GitHub lease non creato.");
  return newCommit.sha;
}

function handle(remote: GitHubRemote, state: WriterLeaseStatus): WriterLeaseHandle {
  return {
    bookId: state.bookId, sessionId: state.sessionId,
    remote: validateRemote(remote), expiresAt: state.expiresAt, headSha: state.headSha,
  };
}

/** True when the lease was left by a session this browser opened for the book. Only meaningful
 * to someone who holds the book's writer Web Lock: then that page is gone. */
export async function isLeaseFromThisBrowser(status: Pick<WriterLeaseStatus, "bookId" | "sessionId">): Promise<boolean> {
  return isOwnWriterSession(status.bookId, status.sessionId);
}

export interface AcquireOptions {
  /** The caller holds this book's writer Web Lock (shared by every tab of this browser).
   * A lease left by an earlier session of THIS browser is then taken over at once, with the
   * same fast-forward-only commit, instead of waiting for its expiry plus the grace period.
   * A lease of any other device is never taken over this way. */
  writerLockHeld?: boolean;
}

/**
 * Acquisition never steals a live lease of another device. A stale lease requires explicit
 * recovery from a human (allowTakeover), after a 60s clock-skew grace period. The only
 * exception is a lease our own browser left behind (reload, closed tab) while the caller
 * holds the writer Web Lock: nothing else of this browser can still be writing.
 */
export async function acquireWriterLease(
  remote: GitHubRemote, bookId: string, sessionId: string,
  allowTakeover = false, options: AcquireOptions = {},
): Promise<WriterLeaseHandle> {
  if (!z.string().uuid().safeParse(sessionId).success) throw new Error("ID sessione lease non valido.");
  const secret = await token();
  const oldSha = await getRef(secret, remote, bookId);
  const old = oldSha ? await leaseAt(secret, remote, bookId, oldSha) : null;
  if (old?.sessionId === sessionId && active(old)) return handle(remote, old);
  const leftByThisBrowser = !!old && old.state === "active" && options.writerLockHeld === true &&
    await isOwnWriterSession(bookId, old.sessionId);
  if (old && !leftByThisBrowser && !canTakeover(old)) throw new RemoteWriterBusy(old, false);
  if (old?.state === "active" && !allowTakeover && !leftByThisBrowser) throw new RemoteWriterBusy(old, true);

  let parent = oldSha;
  if (!parent) {
    parent = await getRef(secret, remote, bookId).then(async current => {
      if (current) throw new RemoteWriterLost("Il lock è stato creato da un altro dispositivo.");
      const head = await api<{ object?: { sha?: string } }>(
        secret, resource(remote, "/git/ref/heads/" + validateRemote(remote).branch),
      );
      return head?.object?.sha ?? null;
    });
  }
  if (!parent || !SHA.test(parent)) throw new Error("Per i lease serve una repository GitHub già inizializzata.");
  const now = new Date().toISOString();
  const next: LeasePayload = {
    schemaVersion: 1, bookId, sessionId, state: "active",
    acquiredAt: now, renewedAt: now, expiresAt: new Date(Date.now() + LEASE_TTL_MS).toISOString(),
  };
  const created = await writeLease(secret, remote, bookId, parent, next);
  let writeError: unknown;
  try {
    if (!oldSha) {
      await api(secret, resource(remote, "/git/refs"), "POST", {
        ref: "refs/heads/" + branch(bookId), sha: created,
      });
    } else {
      await api(secret, patchPath(remote, bookId), "PATCH", { sha: created, force: false });
    }
  } catch (error) {
    // The ref may have been saved before the connection failed. Only a read
    // of OUR EXACT commit can confirm acquisition; never issue a second write.
    if (!(error instanceof RemoteWriterLost)) throw error;
    writeError = error;
  }
  const latest = await getRef(secret, remote, bookId);
  if (latest !== created)
    throw writeError ?? new RemoteWriterLost("Acquisizione del blocco GitHub non confermata: il ramo non punta al commit richiesto. Nessuna chiamata AI avviata.");
  const status = await leaseAt(secret, remote, bookId, latest);
  if (status.sessionId !== sessionId || !active(status))
    throw new RemoteWriterLost("Il lock è cambiato immediatamente dopo l'acquisizione.");
  return handle(remote, status);
}

/** Fencing check before AND after every expensive model call. */
export async function assertWriterLease(current: WriterLeaseHandle): Promise<WriterLeaseHandle> {
  let latest: WriterLeaseStatus | null;
  try {
    latest = await retryUnavailable(() => inspectWriterLease(current.remote, current.bookId));
  } catch (error) {
    // GitHub cannot be reached: nobody can have taken the lock over while OUR last confirmed lease is
    // still valid for long enough (a takeover needs expiry + 60 s). Past that margin: fail closed.
    if (error instanceof LeaseGitHubUnavailable &&
        Date.parse(current.expiresAt) - Date.now() > MISSED_RENEWAL_MIN_VALIDITY_MS) return current;
    throw error;
  }
  if (!latest || latest.sessionId !== current.sessionId || !active(latest))
    throw new RemoteWriterLost();
  return handle(current.remote, latest);
}

export async function renewWriterLease(current: WriterLeaseHandle): Promise<WriterLeaseHandle> {
  const secret = await token();
  const validityLeft = () => Date.parse(current.expiresAt) - Date.now();
  const time = (iso: string) => new Date(iso).toLocaleTimeString("it-IT");
  let sha: string | null, previous: WriterLeaseStatus, commit: string;
  try {
    sha = await retryUnavailable(() => getRef(secret, current.remote, current.bookId));
    if (!sha) throw new RemoteWriterLost();
    const parent = sha;
    previous = await retryUnavailable(() => leaseAt(secret, current.remote, current.bookId, parent));
    if (previous.sessionId !== current.sessionId || !active(previous))
      throw new RemoteWriterLost();
    const now = new Date().toISOString();
    const updated: LeasePayload = {
      schemaVersion: 1, bookId: previous.bookId, sessionId: previous.sessionId,
      acquiredAt: previous.acquiredAt, state: "active", renewedAt: now,
      expiresAt: new Date(Date.now() + LEASE_TTL_MS).toISOString(),
    };
    commit = await retryUnavailable(() => writeLease(secret, current.remote, current.bookId, parent, updated));
  } catch (error) {
    // GitHub did not answer (or failed with a 5xx) BEFORE the branch was touched: nothing changed, the lease
    // is still ours until the expiry we last confirmed. Not a renewal, but no reason to stop yet.
    if (error instanceof LeaseGitHubUnavailable && validityLeft() > MISSED_RENEWAL_MIN_VALIDITY_MS)
      throw new LeaseRenewalMissed(current, "Rinnovo del lease GitHub non confermato: GitHub non risponde (" +
        error.message.replace(/ Scrittura bloccata.*$/, "") + "). Nulla è stato scritto: il blocco resta tuo fino alle " +
        time(current.expiresAt) + " e il rinnovo viene ritentato al prossimo battito.");
    throw error;
  }
  let writeError: RemoteWriterLost | undefined;
  try {
    await api(secret, patchPath(current.remote, current.bookId), "PATCH", { sha: commit, force: false });
  } catch (error) {
    // A lost PATCH acknowledgment could mean the commit was applied, but a
    // 409/422 or a lost request must NOT silently renew the old active lease.
    // Read back the exact Git ref below; never retry or force-update it.
    if (!(error instanceof RemoteWriterLost)) throw error;
    writeError = error;
  }
  // 409/422: GitHub REFUSED the update (the branch moved under us): never tolerated. Network or 5xx: it may
  // or may not have been applied, which only a read can tell.
  const refused = !!writeError && !(writeError instanceof LeaseGitHubUnavailable);
  // The previous owner/session alone is insufficient evidence of renewal:
  // GitHub may still point to the old, unextended lease or to another commit.
  // Reuse the same two GETs already performed by assertWriterLease, with a
  // stricter check of the committed ref before allowing more AI work.
  const isOurs = (status: WriterLeaseStatus | null | undefined): boolean =>
    !!status && status.headSha === commit && status.sessionId === current.sessionId && active(status);
  // undefined = the branch could not be read at all (GitHub unavailable)
  let confirmed: WriterLeaseStatus | null | undefined;
  const readBack = async () => {
    try { confirmed = await inspectWriterLease(current.remote, current.bookId); }
    catch (error) {
      if (error instanceof LeaseGitHubUnavailable) confirmed = undefined; else throw error;
    }
  };
  await readBack();
  let reads = 1;
  if (!refused) {
    // The PATCH was accepted (or its outcome is unknown): if the branch still shows something else it is
    // either a lagging read of GitHub (our session, an older commit: read again, a write is never
    // repeated) or another session.
    for (const delay of leaseTuning.readbackDelaysMs) {
      if (isOurs(confirmed) || (confirmed && confirmed.sessionId !== current.sessionId)) break;
      await new Promise(resolve => setTimeout(resolve, delay));
      await readBack();
      reads++;
    }
  }
  if (isOurs(confirmed)) return handle(current.remote, confirmed!);

  const detail = "Rinnovo del lease GitHub non confermato: scrittura sospesa. " +
    (writeError ? writeError.message + " " : "") +
    (confirmed === undefined ? "GitHub non risponde alla rilettura del blocco."
      : refused ? "" : describeUnconfirmedRenewal(confirmed, current, commit, reads)) +
    " Verifica lo stato del blocco in Archivio.";
  // Still ours and valid for a good while (read back, or unreadable but our last confirmed lease says so):
  // no renewal is claimed and the old expiry stays, but the work goes on until the next beat.
  const ownAndValid = confirmed === undefined ? validityLeft() > MISSED_RENEWAL_MIN_VALIDITY_MS
    : !!confirmed && confirmed.sessionId === current.sessionId && active(confirmed) &&
      Date.parse(confirmed.expiresAt) - Date.now() > MISSED_RENEWAL_MIN_VALIDITY_MS;
  if (!refused && ownAndValid)
    throw new LeaseRenewalMissed(confirmed ? handle(current.remote, confirmed) : current, detail);
  throw new RemoteWriterLost(detail);
}

/** What the readback actually found, so the author (and a bug report) can tell a real second writer
 * from a lagging read. Only identifiers shortened to a few characters, never a credential. */
function describeUnconfirmedRenewal(found: WriterLeaseStatus | null, current: WriterLeaseHandle, commit: string, reads: number): string {
  const time = (iso: string) => new Date(iso).toLocaleTimeString("it-IT");
  if (!found) return "Il ramo del blocco non esiste più.";
  if (found.sessionId !== current.sessionId)
    return `Il blocco è passato a un'altra sessione (${found.sessionId.slice(0, 8)}, rinnovato alle ${time(found.renewedAt)}): ` +
      "un altro browser o dispositivo sta scrivendo questo libro.";
  if (found.state !== "active") return "Il blocco risulta rilasciato.";
  if (Date.parse(found.expiresAt) <= Date.now()) return "Il blocco risulta scaduto.";
  return `GitHub ha accettato il rinnovo ma il ramo mostra ancora il commit precedente (${found.headSha.slice(0, 7)} invece di ${commit.slice(0, 7)}) ` +
    `dopo ${reads} letture; il blocco è ancora tuo fino alle ${time(found.expiresAt)}.`;
}

/** Release is best-effort; never force a lock branch backwards. */
export async function releaseWriterLease(current: WriterLeaseHandle): Promise<void> {
  try {
    const secret = await token();
    const sha = await getRef(secret, current.remote, current.bookId);
    if (!sha) return;
    const previous = await leaseAt(secret, current.remote, current.bookId, sha);
    if (previous.sessionId !== current.sessionId || previous.state !== "active") return;
    const now = new Date().toISOString();
    const commit = await writeLease(secret, current.remote, current.bookId, sha, {
      schemaVersion: 1, bookId: previous.bookId, sessionId: previous.sessionId,
      acquiredAt: previous.acquiredAt, state: "released", renewedAt: now, expiresAt: now,
    });
    await api(secret, patchPath(current.remote, current.bookId), "PATCH", { sha: commit, force: false });
  } catch { /* A dead browser cannot release: expiry + explicit takeover handles recovery. */ }
}
