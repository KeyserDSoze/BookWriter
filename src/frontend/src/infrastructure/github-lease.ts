import { z } from "zod";
import type { GitHubRemote } from "../domain/types";
import { decryptLocal } from "./crypto";
import { loadSettings } from "./db";
import { validateRemote } from "./github-sync";

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
function responseError(status: number): Error {
  if (status === 401) return new Error("PAT GitHub non valido (HTTP 401). Scrittura AI non avviata.");
  if (status === 403) return new Error("GitHub ha negato l'accesso al lease (HTTP 403). Verifica Contents: write.");
  if (status === 409 || status === 422)
    return new RemoteWriterLost("Lease aggiornato da un altro browser: GitHub ha rifiutato il commit concorrente.");
  if (status === 404) return new Error("Repository GitHub o branch non disponibile per il lease (HTTP 404).");
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
    throw new RemoteWriterLost("GitHub non raggiungibile o tempo di verifica scaduto: scrittura bloccata.");
  } finally {
    clearTimeout(deadline);
  }
  if (allow404 && response.status === 404) {
    // A missing lock branch is also a lease decision: never infer "free"
    // from an unchecked 404 or an unavailable CORS-exposed clock header.
    assertPlausibleClock(response);
    return null;
  }
  if (!response.ok) throw responseError(response.status);
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

/**
 * Acquisition never steals a live lease. A stale lease requires explicit
 * recovery from a human (allowTakeover), after a 60s clock-skew grace period.
 */
export async function acquireWriterLease(
  remote: GitHubRemote, bookId: string, sessionId: string,
  allowTakeover = false,
): Promise<WriterLeaseHandle> {
  if (!z.string().uuid().safeParse(sessionId).success) throw new Error("ID sessione lease non valido.");
  const secret = await token();
  const oldSha = await getRef(secret, remote, bookId);
  const old = oldSha ? await leaseAt(secret, remote, bookId, oldSha) : null;
  if (old?.sessionId === sessionId && active(old)) return handle(remote, old);
  if (old && !canTakeover(old)) throw new RemoteWriterBusy(old, false);
  if (old?.state === "active" && !allowTakeover) throw new RemoteWriterBusy(old, true);

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
  if (!oldSha) {
    await api(secret, resource(remote, "/git/refs"), "POST", {
      ref: "refs/heads/" + branch(bookId), sha: created,
    });
  } else {
    await api(secret, patchPath(remote, bookId), "PATCH", { sha: created, force: false });
  }
  const latest = await getRef(secret, remote, bookId);
  if (!latest) throw new RemoteWriterLost("Impossibile verificare il lock dopo l'acquisizione.");
  const status = await leaseAt(secret, remote, bookId, latest);
  if (status.sessionId !== sessionId || !active(status))
    throw new RemoteWriterLost("Il lock è cambiato immediatamente dopo l'acquisizione.");
  return handle(remote, status);
}

/** Fencing check before AND after every expensive model call. */
export async function assertWriterLease(current: WriterLeaseHandle): Promise<WriterLeaseHandle> {
  const latest = await inspectWriterLease(current.remote, current.bookId);
  if (!latest || latest.sessionId !== current.sessionId || !active(latest))
    throw new RemoteWriterLost();
  return handle(current.remote, latest);
}

export async function renewWriterLease(current: WriterLeaseHandle): Promise<WriterLeaseHandle> {
  const secret = await token();
  const sha = await getRef(secret, current.remote, current.bookId);
  if (!sha) throw new RemoteWriterLost();
  const previous = await leaseAt(secret, current.remote, current.bookId, sha);
  if (previous.sessionId !== current.sessionId || !active(previous))
    throw new RemoteWriterLost();
  const now = new Date().toISOString();
  const updated: LeasePayload = {
    schemaVersion: 1, bookId: previous.bookId, sessionId: previous.sessionId,
    acquiredAt: previous.acquiredAt, state: "active", renewedAt: now,
    expiresAt: new Date(Date.now() + LEASE_TTL_MS).toISOString(),
  };
  const commit = await writeLease(secret, current.remote, current.bookId, sha, updated);
  try {
    await api(secret, patchPath(current.remote, current.bookId), "PATCH", { sha: commit, force: false });
  } catch (error) {
    // A lost PATCH acknowledgment could mean the commit was applied, but a
    // 409/422 or a lost request must NOT silently renew the old active lease.
    // Read back the exact Git ref below; never retry or force-update it.
    if (!(error instanceof RemoteWriterLost)) throw error;
  }
  // The previous owner/session alone is insufficient evidence of renewal:
  // GitHub may still point to the old, unextended lease or to another commit.
  // Reuse the same two GETs already performed by assertWriterLease, with a
  // stricter check of the committed ref before allowing more AI work.
  const confirmed = await inspectWriterLease(current.remote, current.bookId);
  if (!confirmed || confirmed.headSha !== commit ||
      confirmed.sessionId !== current.sessionId || !active(confirmed))
    throw new RemoteWriterLost("Rinnovo del lease GitHub non confermato: scrittura sospesa.");
  return handle(current.remote, confirmed);
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
