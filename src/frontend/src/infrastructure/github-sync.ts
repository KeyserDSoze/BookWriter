import { z } from "zod";
import type { Activity, BookProject, GitHubRemote, SyncOutboxItem } from "../domain/types";
import { projectBook } from "../domain/narrarium";
import { decryptLocal } from "./crypto";
import { getDb, getBook, listActivities, loadSettings } from "./db";
import type { ManualPushIntent } from "./manual-push-intent";

const BASE = "https://api.github.com";
const MAX_BYTES = 12 * 1024 * 1024;
const shaPattern = /^[a-f0-9]{40}$/i;
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  bookId: z.string().uuid(),
  paths: z.array(z.string()).max(20_000),
});

export class RemoteConflict extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "RemoteConflict";
  }
}

export function validateRemote(remote: Pick<GitHubRemote, "owner" | "repository" | "branch">): GitHubRemote {
  const owner = remote.owner.trim();
  const repository = remote.repository.trim();
  const branch = remote.branch.trim();
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37})$/.test(owner))
    throw new Error("Proprietario GitHub non valido.");
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(repository) || repository === "." || repository === "..")
    throw new Error("Nome repository GitHub non valido.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,149}$/.test(branch) ||
      branch.includes("..") || branch.includes("//") || branch.endsWith(".") || branch.endsWith("/"))
    throw new Error("Nome branch GitHub non valido.");
  return { owner, repository, branch };
}

function apiPath(remote: GitHubRemote, suffix: string): string {
  return "/repos/" + encodeURIComponent(remote.owner) + "/" + encodeURIComponent(remote.repository) + suffix;
}
function apiError(status: number): Error {
  if (status === 401) return new Error("PAT GitHub non valido o revocato (HTTP 401).");
  if (status === 403) return new Error("Permessi GitHub insufficienti, limite API o repository non autorizzata (HTTP 403).");
  if (status === 404) return new Error("Repository, file o branch non trovato con questo PAT (HTTP 404).");
  if (status === 409 || status === 422) return new RemoteConflict("GitHub ha rifiutato la modifica concorrente (HTTP " + status + "). Nessun force push effettuato.");
  return new Error("GitHub ha risposto con HTTP " + status + ".");
}
async function request<T>(
  token: string, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  allow404 = false,
): Promise<T | null> {
  const url = new URL(path, BASE);
  if (url.origin !== BASE || !url.pathname.startsWith("/repos/"))
    throw new Error("URL GitHub non autorizzato.");
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: init.method ?? "GET",
      mode: "cors",
      redirect: "error",
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2026-03-10",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch {
    if (init.signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
    throw new Error("GitHub non raggiungibile. Controlla rete e autorizzazioni del browser.");
  }
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw apiError(response.status);
  const raw = await response.text();
  if (raw.length > MAX_BYTES * 2) throw new Error("Risposta GitHub troppo grande.");
  if (!raw.trim()) return {} as T;
  try { return JSON.parse(raw) as T; }
  catch { throw new Error("GitHub ha restituito una risposta non valida."); }
}

function decodeBase64(text: string): string {
  const normalized = text.replace(/\s/g, "");
  const binary = atob(normalized);
  return new TextDecoder().decode(Uint8Array.from(binary, x => x.charCodeAt(0)));
}
async function tokenFromVault(): Promise<string> {
  const settings = await loadSettings();
  if (!settings.githubToken) throw new Error("Configura prima un PAT GitHub nelle Impostazioni.");
  return decryptLocal(settings.githubToken);
}

export interface RepoInfo { private: boolean; defaultBranch: string; canPush: boolean; fullName: string }
export async function inspectRepository(
  remote: GitHubRemote, signal?: AbortSignal,
): Promise<RepoInfo> {
  const token = await tokenFromVault();
  const info = await request<{
    private: boolean; default_branch: string; full_name: string;
    permissions?: { push?: boolean };
  }>(token, apiPath(remote, ""), { signal });
  if (!info) throw new Error("Repository non disponibile.");
  return {
    private: info.private,
    defaultBranch: info.default_branch,
    fullName: info.full_name,
    canPush: info.permissions?.push ?? false,
  };
}

async function headSha(token: string, remote: GitHubRemote, signal?: AbortSignal): Promise<string> {
  const response = await request<{ object?: { sha?: string } }>(
    token, apiPath(remote, "/git/ref/heads/" + remote.branch.split("/").map(encodeURIComponent).join("/")), { signal },
  );
  const sha = response?.object?.sha;
  if (!sha || !shaPattern.test(sha)) throw new Error("Il branch GitHub non punta a un commit valido.");
  return sha;
}

async function readFile(
  token: string, remote: GitHubRemote, path: string, ref: string, signal?: AbortSignal,
): Promise<string | null> {
  const url = apiPath(remote, "/contents/" + path.split("/").map(encodeURIComponent).join("/")) +
    "?ref=" + encodeURIComponent(ref);
  const result = await request<{
    type?: string; encoding?: string; content?: string; sha?: string;
  }>(token, url, { signal }, true);
  if (!result) return null;
  if (result.type !== "file") throw new Error("Il percorso GitHub non è un file.");
  if (result.encoding === "base64" && result.content) return decodeBase64(result.content);
  if (!result.sha || !shaPattern.test(result.sha)) throw new Error("GitHub non fornisce il blob del file.");
  const blob = await request<{ encoding: string; content: string; size?: number }>(
    token, apiPath(remote, "/git/blobs/" + result.sha), { signal },
  );
  if (!blob || blob.encoding !== "base64" || (blob.size ?? 0) > MAX_BYTES)
    throw new Error("Blob remoto mancante o troppo grande.");
  return decodeBase64(blob.content);
}

function parseJson<T>(text: string, label: string): T {
  if (text.length > MAX_BYTES) throw new Error(label + " supera il limite di 12 MiB.");
  try { return JSON.parse(text) as T; }
  catch { throw new Error(label + " non contiene JSON valido."); }
}
function parseRemoteBook(raw: string): BookProject {
  const data = parseJson<unknown>(raw, "Progetto remoto");
  const parsed = z.object({
    id: z.string().uuid(),
    title: z.string().min(1),
    brief: z.string(),
    writingStyle: z.string(),
    audience: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    status: z.enum(["idle", "running", "paused", "error", "completed"]),
    phase: z.string(),
    chapters: z.array(z.object({
      id: z.string(), number: z.number().int(), title: z.string(), purpose: z.string(),
      scenes: z.array(z.object({
        id: z.string(), number: z.number().int(),
        title: z.string(), objective: z.string(), text: z.string(),
        status: z.enum(["planned", "draft", "canon"]),
      }).passthrough()),
    }).passthrough()),
    memory: z.object({
      characters: z.record(z.string(), z.string()),
      locations: z.record(z.string(), z.string()),
      factions: z.record(z.string(), z.string()),
      items: z.record(z.string(), z.string()),
      secrets: z.record(z.string(), z.string()),
      timeline: z.array(z.string()),
      currentState: z.string(),
    }),
  }).passthrough().safeParse(data);
  if (!parsed.success) throw new Error("Il progetto remoto non segue lo schema BookWriter.");
  const project = parsed.data as unknown as BookProject;
  return {
    ...project,
    authorConstraints: project.authorConstraints ?? [],
    audienceReviews: project.audienceReviews ?? [],
    status: project.status === "running" ? "paused" : project.status,
    remote: undefined, // Do not trust remote-supplied local sync settings.
  };
}

export interface RemoteBookSnapshot {
  book: BookProject;
  activities: Activity[];
  head: string;
}

async function snapshotAtRef(
  token: string, remote: GitHubRemote, ref: string, signal?: AbortSignal,
): Promise<RemoteBookSnapshot | null> {
  const project = await readFile(token, remote, ".bookwriter/project.json", ref, signal);
  if (project === null) return null;
  const book = parseRemoteBook(project);
  const rawActivities = await readFile(token, remote, ".bookwriter/activities.json", ref, signal);
  const unknownActivities = rawActivities ? parseJson<unknown>(rawActivities, "Log remoto") : [];
  const parsedActivities = z.array(z.object({
    id: z.string(), bookId: z.string(), runId: z.string(),
    phase: z.string(), title: z.string(), reason: z.string(),
    nextStep: z.string(), status: z.enum(["running", "succeeded", "cancelled", "failed"]),
    createdAt: z.string(),
  }).passthrough()).max(100_000).safeParse(unknownActivities);
  if (!parsedActivities.success) throw new Error("Formato dei log GitHub non valido.");
  const activities = parsedActivities.data as Activity[];
  if (activities.some(a => a.bookId !== book.id)) throw new Error("Log GitHub riferito a un altro libro.");
  return { book, activities, head: ref };
}

export async function readGitHubSnapshot(remote: GitHubRemote, signal?: AbortSignal):
  Promise<RemoteBookSnapshot | null> {
  const token = await tokenFromVault();
  const ref = await headSha(token, remote, signal);
  return snapshotAtRef(token, remote, ref, signal);
}

/** Read the common ancestor at a concrete SHA, never a mutable branch name. */
export async function readGitHubSnapshotAt(
  remote: GitHubRemote, commitSha: string, signal?: AbortSignal,
): Promise<RemoteBookSnapshot | null> {
  if (!shaPattern.test(commitSha)) throw new Error("SHA di confronto GitHub non valido.");
  const token = await tokenFromVault();
  return snapshotAtRef(token, remote, commitSha, signal);
}

/** Recheck immutable reviewed HEAD just before any local recovery transaction. */
export async function confirmGitHubHead(
  remote: GitHubRemote, expectedHead: string, signal?: AbortSignal,
): Promise<void> {
  if (!shaPattern.test(expectedHead)) throw new Error("SHA di confronto non valido.");
  const token = await tokenFromVault();
  const actual = await headSha(token, remote, signal);
  if (actual !== expectedHead)
    throw new RemoteConflict("La repository è cambiata durante il confronto. Ricarica le versioni e ripeti la scelta.");
}

/** Restore only if the book ID does not exist locally. Never overwrite browser data. */
export async function importGitHubBook(remote: GitHubRemote): Promise<BookProject> {
  const source = await readGitHubSnapshot(remote);
  if (!source) throw new Error("Nessun libro BookWriter in questa repository.");
  const db = await getDb();
  const tx = db.transaction(["books", "activities"], "readwrite");
  const existing = await tx.objectStore("books").get(source.book.id);
  if (existing) {
    await tx.done;
    throw new RemoteConflict("Questo libro è già presente in IndexedDB. Esporta un backup e risolvi il conflitto prima di importare.");
  }
  source.book.remote = {
    ...validateRemote(remote),
    lastSyncedCommit: source.head,
    lastSyncedLocalUpdatedAt: source.book.updatedAt,
    lastSyncAt: new Date().toISOString(),
  };
  await tx.objectStore("books").put(source.book, source.book.id);
  for (const activity of source.activities) {
    await tx.objectStore("activities").put(
      activity.status === "running" ? { ...activity, status: "cancelled" } : activity,
      activity.id,
    );
  }
  await tx.done;
  return source.book;
}

export interface PushOptions {
  /** Enabled only by the autosync coordinator, never by an untrusted remote payload. */
  automatic?: boolean;
  operationId?: string;
}
export interface PushResult {
  commit: string;
  paths: number;
  repository: string;
  sourceRevision: string;
  operationId: string;
  recovered?: boolean;
}

/**
 * After the GitHub SHA is confirmed, persist its ACK and the durable queue
 * decision in ONE IndexedDB transaction. This cannot make the HTTP PATCH
 * atomic with IndexedDB; the remote operation marker handles a lost ACK.
 */
export async function persistRemoteAcknowledgment(
  bookId: string, remote: GitHubRemote, sha: string, sourceRevision: string,
  operationId: string, expectedLastSyncedCommit?: string,
): Promise<void> {
  const db = await getDb();
  // The manual operation ID and remote ACK must commit or roll back together:
  // a crash cannot leave an ACKed commit with an obsolete manual marker.
  const tx = db.transaction(["books", "outbox", "meta"], "readwrite");
  const books = tx.objectStore("books");
  const latest = await books.get(bookId) as BookProject | undefined;
  if (!latest?.remote || latest.remote.owner !== remote.owner ||
      latest.remote.repository !== remote.repository || latest.remote.branch !== remote.branch ||
      (latest.remote.lastSyncedCommit !== expectedLastSyncedCommit &&
       latest.remote.lastSyncedCommit !== sha)) {
    // Reject stale/foreign ACKs before *any* write, including an outbox ACK.
    await tx.done;
    throw new RemoteConflict("Il libro o la baseline GitHub sono cambiati durante il commit: conferma locale annullata.");
  }

  const pending = await tx.objectStore("outbox").get(bookId) as SyncOutboxItem | undefined;
  // The book was re-read under the transaction: retain newer prose, canon,
  // author constraints and status. An ACK alone must not bump updatedAt.
  latest.remote = {
    ...latest.remote, lastSyncedCommit: sha,
    lastSyncAt: new Date().toISOString(), lastSyncedLocalUpdatedAt: sourceRevision,
  };
  await books.put(latest, bookId);

  if (pending && latest.updatedAt === sourceRevision) {
    // The current local book really is the published snapshot. A manual push
    // may also supersede an older queued operationId.
    await tx.objectStore("outbox").delete(bookId);
  } else if (pending?.operationId === operationId && pending.state !== "blocked") {
    // New prose/metadata arrived during the PATCH. Rotate the attempt marker
    // and leave a fresh durable checkpoint for a subsequent GitHub commit.
    await tx.objectStore("outbox").put({
      ...pending, operationId: crypto.randomUUID(),
      attempts: 0, retryAfter: undefined, lastError: undefined,
      state: "pending",
    }, bookId);
  }
  // Only the exact manual operation that was remotely acknowledged may
  // release its durable intent. Never clear a newer or unrelated attempt.
  const intentKey = "manual-github-push:" + bookId;
  const intent = await tx.objectStore("meta").get(intentKey) as {
    operationId: string; owner: string; repository: string; branch: string;
  } | undefined;
  if (intent?.operationId === operationId &&
      intent.owner === remote.owner &&
      intent.repository === remote.repository &&
      intent.branch === remote.branch)
    await tx.objectStore("meta").delete(intentKey);
  // Independent or blocked requests stay unchanged; never silently resolve
  // a real conflict or falsely mark newer prose as published.
  await tx.done;
}

/**
 * A remote marker is authoritative only together with the exact HEAD commit
 * message, book ID and operation ID. Never treat HEAD alone as an ACK.
 */
interface GitCommitProof {
  message?: string;
  parents?: Array<{ sha?: string }>;
}
async function matchingPublishedMarker(
  token: string, remote: GitHubRemote, sha: string, bookId: string, operationId: string,
  expectedParentSha?: string, knownCommit?: GitCommitProof,
): Promise<string | null> {
  const latestCommit = knownCommit ?? await request<GitCommitProof>(
    token, apiPath(remote, "/git/commits/" + sha),
  );
  if (latestCommit?.message !== "bookwriter: sync " + operationId) return null;
  if (expectedParentSha && (latestCommit.parents?.length !== 1 ||
      latestCommit.parents[0]?.sha !== expectedParentSha)) return null;
  const metadataRaw = await readFile(token, remote, ".bookwriter/sync.json", sha);
  const metadata = metadataRaw ? z.object({
    operationId: z.string(), sourceRevision: z.string(), bookId: z.string(),
  }).safeParse(parseJson<unknown>(metadataRaw, "Sync marker")) : null;
  return metadata?.success &&
      metadata.data.operationId === operationId && metadata.data.bookId === bookId
    ? metadata.data.sourceRevision : null;
}

/**
 * Read-only, bounded DAG proof for a human-approved suspended manual push.
 * Follow BOTH parents of ordinary Git merges. Never accept the first matching
 * message without exhausting all reachable branches above the old baseline:
 * a duplicate operation or an uninspected branch makes proof ambiguous.
 *
 * This is deliberately NOT used by normal pushes or automatic ACK recovery.
 */
const MAX_MANUAL_RECONCILIATION_COMMITS = 32;
export async function verifyPublishedManualPush(intent: ManualPushIntent): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(intent.operationId) ||
      !intent.bookId || !intent.sourceRevision ||
      (intent.baseSha !== undefined && !shaPattern.test(intent.baseSha)))
    throw new RemoteConflict("Intento GitHub precedente non valido: riconciliazione bloccata.");
  const remote = validateRemote(intent);
  const token = await tokenFromVault();
  const originalHead = await headSha(token, remote);
  if (originalHead === intent.baseSha)
    throw new RemoteConflict("La HEAD GitHub non dimostra la pubblicazione del tentativo precedente.");

  const pending = [originalHead];
  const queued = new Set(pending);
  const edges = new Map<string, string[]>();
  let candidate: string | undefined;

  while (pending.length) {
    if (edges.size >= MAX_MANUAL_RECONCILIATION_COMMITS)
      throw new RemoteConflict("Cronologia GitHub oltre 32 commit: verifica incompleta, intento conservato.");
    const sha = pending.shift()!;
    if (!shaPattern.test(sha))
      throw new RemoteConflict("Cronologia GitHub con SHA non valido: archiviazione bloccata.");

    const commit = await request<GitCommitProof>(
      token, apiPath(remote, "/git/commits/" + sha),
    );
    // Root commits on an unrelated branch are valid; octopus merges are
    // outside this bounded proof, and repeated/self parents are malformed.
    const rawParents = commit?.parents;
    if (!Array.isArray(rawParents) || rawParents.length > 2)
      throw new RemoteConflict("Cronologia GitHub con merge non supportato o parent mancanti.");
    const parents = rawParents.map(p => p?.sha);
    if (parents.some(p => !p || !shaPattern.test(p) || p === sha) ||
        new Set(parents).size !== parents.length)
      throw new RemoteConflict("Cronologia GitHub con parent non valido, duplicato o ciclo.");
    const validParents = parents as string[];
    edges.set(sha, validParents);

    if (commit?.message === "bookwriter: sync " + intent.operationId) {
      if (candidate)
        throw new RemoteConflict("Più commit GitHub dichiarano la stessa operazione: archiviazione bloccata.");
      if (validParents.length !== 1 ||
          (intent.baseSha !== undefined && validParents[0] !== intent.baseSha))
        throw new RemoteConflict("Il commit GitHub non discende direttamente dalla baseline prevista.");
      const publishedRevision = await matchingPublishedMarker(
        token, remote, sha, intent.bookId, intent.operationId,
        intent.baseSha, commit,
      );
      if (publishedRevision !== intent.sourceRevision)
        throw new RemoteConflict("Il commit o il marker GitHub non attestano il tentativo precedente: archiviazione bloccata.");
      candidate = sha;
    }
    // Treat the original base as a verification boundary: no claim is made
    // about the old history beneath it, and we never fetch that object.
    for (const parent of validParents) {
      if (parent !== intent.baseSha && !queued.has(parent)) {
        queued.add(parent);
        pending.push(parent);
      }
    }
  }
  // Inspect the complete bounded graph, not just the first candidate.
  // A shared parent is ordinary DAG ancestry; an active DFS vertex is a
  // malformed directed cycle, even when the candidate itself was valid.
  const active = new Set<string>();
  const finished = new Set<string>();
  const checkCycle = (sha: string): void => {
    if (active.has(sha))
      throw new RemoteConflict("Cronologia GitHub ciclica: archiviazione bloccata.");
    if (finished.has(sha) || sha === intent.baseSha) return;
    const parents = edges.get(sha);
    if (!parents)
      throw new RemoteConflict("Cronologia GitHub incompleta: archiviazione bloccata.");
    active.add(sha);
    for (const parent of parents) checkCycle(parent);
    active.delete(sha);
    finished.add(sha);
  };
  checkCycle(originalHead);

  if (!candidate)
    throw new RemoteConflict("La cronologia GitHub non dimostra la pubblicazione del tentativo precedente.");
  if (await headSha(token, remote) !== originalHead)
    throw new RemoteConflict("La HEAD GitHub è cambiata durante la verifica: archiviazione bloccata.");
  return candidate; // original commit, never an unrelated merge HEAD
}

export async function pushGitHubBook(
  bookId: string, consentPublic = false, options: PushOptions = {},
): Promise<PushResult> {
  const token = await tokenFromVault();
  const current = await getBook(bookId);
  if (!current?.remote) throw new Error("Collega prima una repository a questo libro.");
  if (current.editorialReviewSceneIds?.length)
    throw new Error("Sincronizzazione bloccata: conferma nel Lettore tutte le scene fuse prima del push GitHub.");
  if (current.editorialCycle || current.phase === "revision" ||
      current.chapters.some(ch => !ch.frozenAt && ch.scenes.some(s => s.status !== "planned")))
    throw new Error("Sincronizzazione bloccata: un capitolo non è ancora congelato dalla redazione.");
  if (current.status === "running" && !options.automatic)
    throw new Error("Metti in pausa l'autopilot prima della sincronizzazione GitHub.");
  if (options.automatic && !current.remote.autoSync)
    throw new Error("La sincronizzazione automatica non è abilitata su questo libro.");
  const operationId = options.operationId ?? crypto.randomUUID();
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error("Identificatore di sincronizzazione non valido.");
  const remote = validateRemote(current.remote);
  const repo = await request<{
    private: boolean;
    permissions?: { push?: boolean };
    default_branch: string;
  }>(token, apiPath(remote, ""));
  if (!repo) throw new Error("Repository GitHub non accessibile.");
  if (!repo.private && !(consentPublic || options.automatic && current.remote.allowPublicSync))
    throw new Error("Repository PUBBLICA: devi autorizzare esplicitamente la pubblicazione del libro e dei segreti narrativi.");
  if (!repo.permissions?.push) throw new Error("Il PAT non ha permessi di scrittura su questa repository.");

  const head = await headSha(token, remote);
  if (!current.remote.lastSyncedCommit || current.remote.lastSyncedCommit !== head) {
    // An interrupted PATCH may have succeeded remotely but failed before its local ACK.
    // Only our EXACT HEAD commit marker authorizes recovery, never an unrelated newer commit.
    if (options.operationId) {
      const publishedRevision = await matchingPublishedMarker(
        token, remote, head, bookId, operationId,
      );
      if (publishedRevision !== null) {
        await persistRemoteAcknowledgment(
          bookId, remote, head, publishedRevision,
          operationId, current.remote.lastSyncedCommit,
        );
        return {
          commit: head, paths: 0, repository: remote.owner + "/" + remote.repository,
          operationId, sourceRevision: publishedRevision, recovered: true,
        };
      }
    }
    if (current.remote.lastSyncedCommit)
      throw new RemoteConflict("Il branch remoto è cambiato dall'ultima sincronizzazione. Importa/controlla le modifiche prima di scrivere.");
  }
  const previousManifestRaw = await readFile(token, remote, ".bookwriter/manifest.json", head);
  let previousPaths: string[] = [];
  if (previousManifestRaw) {
    const manifest = manifestSchema.safeParse(parseJson<unknown>(previousManifestRaw, "Manifest"));
    if (!manifest.success) throw new Error("Manifest GitHub non supportato.");
    if (manifest.data.bookId !== bookId)
      throw new RemoteConflict("Questa repository contiene già un altro libro BookWriter.");
    if (!current.remote.lastSyncedCommit)
      throw new RemoteConflict("Esiste un libro remoto non ancora collegato: importa prima la versione presente.");
    previousPaths = manifest.data.paths;
  } else {
    const preexistingBook = await readFile(token, remote, "book.md", head);
    if (preexistingBook !== null)
      throw new RemoteConflict("La repository contiene già book.md senza manifest BookWriter. Importarla tramite un adapter Narrarium prima di sincronizzare.");
    if (current.remote.lastSyncedCommit)
      throw new RemoteConflict("Il manifest remoto è stato eliminato da un altro dispositivo.");
  }

  const activities = await listActivities(bookId);
  const projection = projectBook(current, activities);
  // The operation marker allows a crash/retry to prove that the previous write succeeded.
  projection.files[".bookwriter/sync.json"] = JSON.stringify({
    operationId, sourceRevision: current.updatedAt, bookId,
    createdAt: new Date().toISOString(),
  }, null, 2) + "\n";
  projection.manifest.paths = [...new Set([...projection.manifest.paths, ".bookwriter/sync.json"])].sort();
  projection.files[".bookwriter/manifest.json"] = JSON.stringify(projection.manifest, null, 2) + "\n";
  const removed = previousPaths.filter(p =>
    !projection.files[p] &&
    (p === ".bookwriter/project.json" || p === ".bookwriter/activities.json" ||
     p === ".bookwriter/manifest.json" || p.endsWith(".md")) &&
    !p.includes("..") && !p.startsWith("/"),
  );
  const treeEntries: Array<{
    path: string; mode: "100644"; type: "blob"; content?: string; sha?: null;
  }> = Object.entries(projection.files).map(([path, content]) =>
    ({ path, mode: "100644", type: "blob", content }),
  );
  for (const path of removed) treeEntries.push({ path, mode: "100644", type: "blob", sha: null });
  const size = JSON.stringify(treeEntries).length;
  if (size > MAX_BYTES) throw new Error("Il libro supera il limite dell'operazione remota (12 MiB); esegui un backup ZIP locale.");

  const commitData = await request<{ tree?: { sha?: string } }>(
    token, apiPath(remote, "/git/commits/" + head),
  );
  const baseTree = commitData?.tree?.sha;
  if (!baseTree || !shaPattern.test(baseTree)) throw new Error("Impossibile determinare il tree di GitHub.");

  // Check the HEAD immediately before producing new Git objects.
  if (await headSha(token, remote) !== head)
    throw new RemoteConflict("GitHub è cambiato durante la preparazione; ripeti la verifica.");
  const verifiedLocal = await getBook(bookId);
  if (!verifiedLocal || verifiedLocal.updatedAt !== current.updatedAt ||
      verifiedLocal.editorialReviewSceneIds?.length)
    throw new RemoteConflict("Il libro locale è cambiato o attende conferma editoriale: push annullato.");
  const tree = await request<{ sha?: string }>(
    token, apiPath(remote, "/git/trees"),
    { method: "POST", body: { base_tree: baseTree, tree: treeEntries } },
  );
  if (!tree?.sha || !shaPattern.test(tree.sha)) throw new Error("GitHub non ha creato un tree valido.");
  const commit = await request<{ sha?: string }>(
    token, apiPath(remote, "/git/commits"),
    { method: "POST", body: { message: "bookwriter: sync " + operationId, tree: tree.sha, parents: [head] } },
  );
  if (!commit?.sha || !shaPattern.test(commit.sha)) throw new Error("GitHub non ha creato un commit valido.");

  // A non-fast-forward update is rejected, NEVER force-push over another device.
  // HTTP 2xx alone is not proof that our commit is the current branch HEAD.
  let patched: { object?: { sha?: string } } | null;
  try {
    patched = await request<{ object?: { sha?: string } }>(
      token, apiPath(remote, "/git/refs/heads/" +
        remote.branch.split("/").map(encodeURIComponent).join("/")),
      { method: "PATCH", body: { sha: commit.sha, force: false } },
    );
  } catch (patchError) {
    // A transport loss or HTTP 5xx is ambiguous: GitHub may have applied
    // force:false and dropped the response. Never issue another PATCH here.
    // 409/422/permission errors are definite rejections, not recoverable ACKs.
    const ambiguous = patchError instanceof Error && (
      patchError.message.includes("GitHub non raggiungibile") ||
      /GitHub ha risposto con HTTP 5\d\d\./.test(patchError.message)
    );
    if (!ambiguous) throw patchError;

    let proven = false;
    try {
      if (await headSha(token, remote) === commit.sha) {
        const publishedRevision = await matchingPublishedMarker(
          token, remote, commit.sha, bookId, operationId,
        );
        proven = publishedRevision === current.updatedAt;
      }
    } catch {
      // An unavailable ref/marker is NOT evidence that the push succeeded.
    }
    if (!proven) throw patchError;
    await persistRemoteAcknowledgment(
      bookId, remote, commit.sha, current.updatedAt,
      operationId, current.remote.lastSyncedCommit,
    );
    return {
      commit: commit.sha, paths: treeEntries.length,
      repository: remote.owner + "/" + remote.repository,
      sourceRevision: current.updatedAt, operationId, recovered: true,
    };
  }
  if (patched?.object?.sha !== commit.sha)
    throw new RemoteConflict("GitHub non ha confermato lo SHA richiesto dopo il push: ACK locale non applicato.");
  // Read back the exact HEAD before attesting the local baseline or removing
  // the durable outbox request. Never infer success from a 2xx PATCH alone.
  if (await headSha(token, remote) !== commit.sha)
    throw new RemoteConflict("La HEAD GitHub è diversa dal commit pubblicato: ACK locale non applicato.");

  await persistRemoteAcknowledgment(
    bookId, remote, commit.sha, current.updatedAt,
    operationId, current.remote.lastSyncedCommit,
  );
  return {
    commit: commit.sha, paths: treeEntries.length,
    repository: remote.owner + "/" + remote.repository,
    sourceRevision: current.updatedAt, operationId,
  };
}
